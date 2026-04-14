/**
 * 홀리심볼 버프 타이머 — 상태머신
 * 상태: IDLE → SCANNING → TRACKING ↔ ALERTING
 */
const Timer = (function () {
    const CONFIG = {
        SCAN_INTERVAL_MS: 1000,
        CONSECUTIVE_DETECT_REQUIRED: 3,
        CONSECUTIVE_MISS_RESCAN: 10,
        ALERT_THRESHOLD_SECONDS: 5,
        BUFF_DURATION_SECONDS: 120,
        REFRESH_SCORE_DELTA: 0.2,
        REFRESH_COOLDOWN_MS: 5000,
        OCR_ACTIVE_BELOW_SEC: 60,
        SCORE_BUFFER_SIZE: 3,
    };

    const listeners = {
        stateChange: [],
        tick: [],
        detect: [],
        alert: [],
        expired: [],
        refreshed: [],
    };

    let state = 'IDLE';
    let intervalId = null;
    let isTicking = false;

    // 탐지/추적 컨텍스트
    let detectStreak = 0;    // SCANNING 연속 성공 카운터
    let missStreak = 0;      // TRACKING 연속 실패 카운터
    let roi = null;
    let fixedScale = null;
    let lastLoc = null;
    let lastSize = null;
    let lastScore = 0;
    let initialScore = 0;
    let detectedAt = 0;      // 감지 성공 시각 (ms)
    let startTime = 0;       // 버프 시작 기준 시각 (ms); remainingSec 역산 기준
    let remainingSec = 0;
    let lastRefreshAt = 0;
    let alertedThisCycle = false; // 같은 사이클 중복 알림 방지
    let recentScores = [];

    function on(event, callback) {
        if (!(event in listeners)) return;
        if (typeof callback !== 'function') return;
        listeners[event].push(callback);
    }

    function emit(event, ...args) {
        const arr = listeners[event];
        if (!arr) return;
        for (const cb of arr) {
            try { cb(...args); } catch (e) { console.warn('[Timer] listener error', event, e); }
        }
    }

    function transition(newState) {
        if (newState === state) return;
        const oldState = state;
        state = newState;
        console.log('[Timer]', oldState, '->', newState);
        emit('stateChange', oldState, newState);
    }

    function resetTrackingContext() {
        detectStreak = 0;
        missStreak = 0;
        roi = null;
        fixedScale = null;
        lastLoc = null;
        lastSize = null;
        lastScore = 0;
        initialScore = 0;
        detectedAt = 0;
        startTime = 0;
        remainingSec = 0;
        lastRefreshAt = 0;
        alertedThisCycle = false;
        recentScores = [];
    }

    function modulesReady() {
        if (typeof window.Capture === 'undefined' || !Capture.isSharing()) {
            console.warn('[Timer] Capture 미준비');
            return false;
        }
        if (typeof window.Detector === 'undefined' || !Detector.isReady()) {
            console.warn('[Timer] Detector 미준비');
            return false;
        }
        return true;
    }

    function pushScore(score) {
        recentScores.push(score);
        if (recentScores.length > CONFIG.SCORE_BUFFER_SIZE) recentScores.shift();
    }

    function avgRecentScore() {
        if (recentScores.length === 0) return 0;
        let s = 0;
        for (const v of recentScores) s += v;
        return s / recentScores.length;
    }

    // 갱신 감지: 직전 N틱 평균 대비 +REFRESH_SCORE_DELTA 이상 스파이크
    function detectRefreshSpike(currentScore) {
        if (recentScores.length < CONFIG.SCORE_BUFFER_SIZE) return false;
        if (Date.now() - lastRefreshAt < CONFIG.REFRESH_COOLDOWN_MS) return false;
        const avg = avgRecentScore();
        return (currentScore - avg) >= CONFIG.REFRESH_SCORE_DELTA;
    }

    function handleRefresh() {
        lastRefreshAt = Date.now();
        startTime = Date.now();
        remainingSec = CONFIG.BUFF_DURATION_SECONDS;
        alertedThisCycle = false;
        recentScores = []; // 스파이크 직후 평균 오염 방지
        emit('refreshed');
    }

    // OCR 영역: 아이콘 하단 40% (잔여 숫자가 표시되는 구간)
    function buildOcrCanvas() {
        if (!lastLoc || !lastSize) return null;
        const canvas = Capture.grabFrameCanvas();
        if (!canvas) return null;
        const sx = Math.max(0, lastLoc[0]);
        const sy = Math.max(0, Math.round(lastLoc[1] + lastSize[1] * 0.6));
        const sw = Math.min(canvas.width - sx, lastSize[0]);
        const sh = Math.min(canvas.height - sy, Math.round(lastSize[1] * 0.4));
        if (sw <= 0 || sh <= 0) return null;

        const crop = document.createElement('canvas');
        crop.width = sw;
        crop.height = sh;
        const ctx = crop.getContext('2d');
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return crop;
    }

    async function tryOcrCorrection() {
        if (typeof window.OCR === 'undefined' || !OCR.isReady()) return;
        const crop = buildOcrCanvas();
        if (!crop) return;
        try {
            const res = await OCR.readNumber(crop);
            const n = res && res.number;
            if (typeof n === 'number' && n >= 1 && n <= 59) {
                remainingSec = n;
                // 내부 시계 재동기화: 현재가 n초 남은 시점이라고 가정
                startTime = Date.now() - (CONFIG.BUFF_DURATION_SECONDS - n) * 1000;
            }
        } catch (_) {
            // OCR 실패는 무시
        }
    }

    function updateRemainingFromClock() {
        if (!startTime) return;
        const elapsed = (Date.now() - startTime) / 1000;
        remainingSec = Math.max(0, CONFIG.BUFF_DURATION_SECONDS - elapsed);
    }

    async function doScanning(frame) {
        const result = Detector.scanFullFrame(frame);
        if (result) {
            detectStreak++;
            lastScore = result.score;
            lastLoc = result.loc;
            lastSize = result.size;
            fixedScale = result.scale;

            if (detectStreak >= CONFIG.CONSECUTIVE_DETECT_REQUIRED) {
                // TRACKING 진입
                const frameSize = Capture.getVideoSize();
                roi = Detector.computeROI(lastLoc, lastSize, frameSize);
                try { Storage.saveROI(roi); } catch (_) {}
                initialScore = result.score;
                detectedAt = Date.now();
                startTime = Date.now();
                remainingSec = CONFIG.BUFF_DURATION_SECONDS;
                missStreak = 0;
                alertedThisCycle = false;
                recentScores = [];
                pushScore(result.score);
                emit('detect', { loc: lastLoc, score: result.score, scale: fixedScale });
                transition('TRACKING');
            }
        } else {
            detectStreak = 0;
        }
    }

    async function doTracking(frame) {
        const result = Detector.scanROI(frame, roi, fixedScale);
        if (result && result.score >= Detector.getConfig().MATCH_THRESHOLD) {
            missStreak = 0;
            lastLoc = result.loc;
            lastSize = result.size;

            if (detectRefreshSpike(result.score)) {
                handleRefresh();
            }

            lastScore = result.score;
            pushScore(result.score);

            updateRemainingFromClock();

            // OCR는 60초 이하에서만 (Tesseract 비용)
            if (remainingSec > 0 && remainingSec <= CONFIG.OCR_ACTIVE_BELOW_SEC) {
                await tryOcrCorrection();
            }

            if (remainingSec <= 0) {
                emit('expired');
                // TRACKING 유지 — 갱신/소실 감지 계속
                alertedThisCycle = false;
            } else if (remainingSec <= CONFIG.ALERT_THRESHOLD_SECONDS && !alertedThisCycle) {
                alertedThisCycle = true;
                transition('ALERTING');
                try { Notifier.alertExpiring(Math.ceil(remainingSec)); } catch (_) {}
                emit('alert', Math.ceil(remainingSec));
                // 즉시 TRACKING 복귀 — 갱신 대기
                transition('TRACKING');
            }
        } else {
            missStreak++;
            // 실패 중에도 내부 시계는 흘러감
            updateRemainingFromClock();
            if (missStreak >= CONFIG.CONSECUTIVE_MISS_RESCAN) {
                resetTrackingContext();
                transition('SCANNING');
            }
        }
    }

    async function tick() {
        if (isTicking) return;
        isTicking = true;
        try {
            const frame = Capture.grabFrame();
            if (!frame) return;

            if (state === 'SCANNING') {
                await doScanning(frame);
            } else if (state === 'TRACKING' || state === 'ALERTING') {
                await doTracking(frame);
            }

            emit('tick', {
                state,
                remainingSec,
                score: lastScore,
                loc: lastLoc,
            });
        } catch (e) {
            console.warn('[Timer] tick error', e);
        } finally {
            isTicking = false;
        }
    }

    function start() {
        if (intervalId) return;
        if (!modulesReady()) return;

        resetTrackingContext();
        transition('SCANNING');
        intervalId = setInterval(tick, CONFIG.SCAN_INTERVAL_MS);
        // 첫 틱 즉시
        tick();
    }

    function stop() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        isTicking = false;
        resetTrackingContext();
        transition('IDLE');
    }

    function rescan() {
        if (!intervalId) return;
        resetTrackingContext();
        transition('SCANNING');
    }

    function getStatus() {
        return {
            state,
            remainingSec,
            score: lastScore,
            roi,
            detectedAt,
        };
    }

    return { on, start, stop, getStatus, rescan };
})();

if (typeof window !== 'undefined') window.Timer = Timer;

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
        REFRESH_SCORE_DELTA: 0.06,         // 점수 스파이크 임계 (낮춤: 초반 갱신은 점수차 작음)
        REFRESH_BRIGHTNESS_DELTA: 10,      // 밝기(0~255) 스파이크 임계 (낮춤)
        REFRESH_BRIGHTNESS_RATIO: 0.92,    // 현재 밝기가 초기 밝기의 92% 이상이면 '깨끗한 상태'
        REFRESH_MIN_ELAPSED_SEC: 3,        // 최소 경과 시간 (10→3, 초반 갱신 허용)
        REFRESH_COOLDOWN_MS: 3000,         // 쿨다운 (5→3초)
        REFRESH_DEBUG: true,               // 매 틱 점수/밝기 로깅
        OCR_ACTIVE_BELOW_SEC: 60,           // 사용 안 함 (호환용 유지)
        SCORE_BUFFER_SIZE: 3,
        BRIGHTNESS_BUFFER_SIZE: 3,
        OCR_REFRESH_JUMP_MIN: 10,
        // Tesseract.js는 pytesseract보다 낮은 신뢰도 반환 경향 → 30으로 완화
        OCR_MIN_CONFIDENCE: 30,
        OCR_SYNC_CONFIRM: 2,               // 낮은 값에서는 2회 확인 필요
        OCR_SYNC_FAST_MIN: 50,             // 이 이상 값이면 1회만 읽어도 즉시 동기화 (초반 5X 구간 빠른 캐치)
        OCR_MAX_DECREMENT: 10,             // OCR 지연으로 인한 큰 감소도 허용 (1→3 → 1→10)
    };

    const listeners = {
        stateChange: [],
        tick: [],
        detect: [],
        alert: [],
        expired: [],
        refreshed: [],
        sync: [],
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
    let recentBrightness = [];
    let initialBrightness = 0;
    let lastBrightness = 0;
    let ocrSynced = false;   // OCR로 최초 "59" 감지되어 카운트다운이 시작된 상태
    let lastOcrNumber = null; // 직전 OCR 값 (연속 재확인용)
    let ocrConfirmStreak = 0; // 동일/단조 감소 연속 확인 (오인식 방어)

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
        recentBrightness = [];
        initialBrightness = 0;
        lastBrightness = 0;
        ocrSynced = false;
        lastOcrNumber = null;
        ocrConfirmStreak = 0;
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

    function pushBrightness(b) {
        recentBrightness.push(b);
        if (recentBrightness.length > CONFIG.BRIGHTNESS_BUFFER_SIZE) recentBrightness.shift();
    }

    function avgOf(arr) {
        if (!arr.length) return 0;
        let s = 0;
        for (const v of arr) s += v;
        return s / arr.length;
    }

    // 갱신 감지 (3가지 지표):
    // 1) 점수 스파이크  2) 밝기 스파이크  3) 현재 밝기가 초기 밝기의 92%+ 복귀
    function detectRefresh(currentScore, currentBrightness) {
        const sinceRefresh = Date.now() - lastRefreshAt;
        const elapsedSec = (Date.now() - detectedAt) / 1000;

        if (sinceRefresh < CONFIG.REFRESH_COOLDOWN_MS) {
            if (CONFIG.REFRESH_DEBUG) console.log(`[RefreshBlock] 쿨다운 ${(sinceRefresh/1000).toFixed(1)}s < ${CONFIG.REFRESH_COOLDOWN_MS/1000}s`);
            return null;
        }
        if (elapsedSec < CONFIG.REFRESH_MIN_ELAPSED_SEC) {
            if (CONFIG.REFRESH_DEBUG) console.log(`[RefreshBlock] 경과 ${elapsedSec.toFixed(1)}s < ${CONFIG.REFRESH_MIN_ELAPSED_SEC}s`);
            return null;
        }

        const scoreAvg = avgOf(recentScores);
        const brightAvg = avgOf(recentBrightness);
        const scoreDelta = currentScore - scoreAvg;
        const brightDelta = currentBrightness - brightAvg;
        const brightRatio = initialBrightness > 0 ? currentBrightness / initialBrightness : 0;

        const scoreJump = (recentScores.length >= CONFIG.SCORE_BUFFER_SIZE) &&
                          scoreDelta >= CONFIG.REFRESH_SCORE_DELTA;
        const brightJump = (recentBrightness.length >= CONFIG.BRIGHTNESS_BUFFER_SIZE) &&
                           brightDelta >= CONFIG.REFRESH_BRIGHTNESS_DELTA;
        const brightRecovered = initialBrightness > 0 &&
                                brightRatio >= CONFIG.REFRESH_BRIGHTNESS_RATIO &&
                                brightAvg < initialBrightness * (CONFIG.REFRESH_BRIGHTNESS_RATIO - 0.08);

        if (CONFIG.REFRESH_DEBUG) {
            console.log(`[RefreshChk] score=${currentScore.toFixed(3)} (Δ${scoreDelta.toFixed(3)}) ` +
                        `bright=${currentBrightness.toFixed(1)} (Δ${brightDelta.toFixed(1)}, ratio=${brightRatio.toFixed(2)}) ` +
                        `init=${initialBrightness.toFixed(1)} | jumps[S=${scoreJump}, B=${brightJump}, R=${brightRecovered}]`);
        }

        if (scoreJump || brightJump || brightRecovered) {
            return { scoreJump, brightJump, brightRecovered,
                     score: currentScore, scoreAvg, scoreDelta,
                     brightness: currentBrightness, brightAvg, brightDelta,
                     brightRatio, initialBrightness };
        }
        return null;
    }

    function handleRefresh(reason) {
        if (reason) console.info('[Timer] 갱신 감지', reason);
        lastRefreshAt = Date.now();
        detectedAt = Date.now();
        // 갱신 후에는 다시 "대기" 상태로: OCR이 59초를 감지할 때까지 카운트다운 안 함
        startTime = 0;
        remainingSec = 0;
        alertedThisCycle = false;
        recentScores = [];
        recentBrightness = [];
        ocrSynced = false;
        lastOcrNumber = null;
        ocrConfirmStreak = 0;
        emit('refreshed');
    }

    // OCR 영역: 아이콘 좌하단 55%×55% (카운트다운 숫자 위치). 업스케일은 OCR.readNumber 내부에서 수행.
    function buildOcrCanvas() {
        if (!lastLoc || !lastSize) return null;
        const canvas = Capture.grabFrameCanvas();
        if (!canvas) return null;
        const sx = Math.max(0, lastLoc[0]);
        const sy = Math.max(0, Math.round(lastLoc[1] + lastSize[1] * 0.45));
        const sw = Math.min(canvas.width - sx, Math.round(lastSize[0] * 0.55));
        const sh = Math.min(canvas.height - sy, Math.round(lastSize[1] * 0.55));
        if (sw <= 0 || sh <= 0) return null;

        const crop = document.createElement('canvas');
        crop.width = sw;
        crop.height = sh;
        const ctx = crop.getContext('2d');
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return crop;
    }

    async function tryOcrRead() {
        if (typeof window.OCR === 'undefined' || !OCR.isReady()) return;
        const crop = buildOcrCanvas();
        if (!crop) return;
        try {
            const res = await OCR.readNumber(crop);
            if (!res || typeof res.number !== 'number') return;
            const n = res.number;
            const conf = res.confidence || 0;

            if (n < 1 || n > 59) return;
            if (conf < CONFIG.OCR_MIN_CONFIDENCE) return;

            if (!ocrSynced) {
                // 초반 5X 구간은 1회 읽어도 바로 동기화 (50 이상 값은 오탐 가능성 매우 낮음)
                if (n >= CONFIG.OCR_SYNC_FAST_MIN) {
                    lastOcrNumber = n;
                    ocrConfirmStreak = CONFIG.OCR_SYNC_CONFIRM; // 즉시 sync 트리거
                    console.log(`[OCR-Sync] FAST n=${n} conf=${conf.toFixed(0)} (>=${CONFIG.OCR_SYNC_FAST_MIN})`);
                } else if (lastOcrNumber === null) {
                    lastOcrNumber = n;
                    ocrConfirmStreak = 1;
                    console.log(`[OCR-Sync] first=${n} conf=${conf.toFixed(0)} streak=1`);
                } else {
                    const decrement = lastOcrNumber - n;
                    if (decrement >= 1 && decrement <= CONFIG.OCR_MAX_DECREMENT) {
                        ocrConfirmStreak++;
                        lastOcrNumber = n;
                        console.log(`[OCR-Sync] decrement=${decrement} n=${n} streak=${ocrConfirmStreak}`);
                    } else if (decrement === 0) {
                        console.log(`[OCR-Sync] same n=${n} (ignored)`);
                    } else {
                        console.log(`[OCR-Sync] reset (diff=${decrement})`);
                        lastOcrNumber = n;
                        ocrConfirmStreak = 1;
                    }
                }

                if (ocrConfirmStreak >= CONFIG.OCR_SYNC_CONFIRM) {
                    ocrSynced = true;
                    remainingSec = n;
                    startTime = Date.now() - (CONFIG.BUFF_DURATION_SECONDS - n) * 1000;
                    alertedThisCycle = false;
                    console.info(`[Timer] OCR 동기화 완료 → 카운트다운 시작 (${n}초)`);
                    emit('sync', n);
                }
                return;
            }

            // 동기화 이후 — 시계와 큰 차이(+10s 이상) 있으면 갱신으로 간주
            const diff = n - remainingSec;
            if (diff >= CONFIG.OCR_REFRESH_JUMP_MIN) {
                if (Date.now() - lastRefreshAt >= CONFIG.REFRESH_COOLDOWN_MS) {
                    handleRefresh({ ocrJump: true, before: remainingSec, after: n });
                }
                return;
            }

            // 일반 보정: ±(−4,+1)만 허용
            if (diff > 1 || diff < -4) return;
            remainingSec = n;
            startTime = Date.now() - (CONFIG.BUFF_DURATION_SECONDS - n) * 1000;
        } catch (_) {
            // OCR 실패 무시
        }
    }

    // 사용자가 직접 갱신 버튼 눌렀을 때
    function manualRefresh() {
        if (state !== 'TRACKING' && state !== 'ALERTING') return false;
        handleRefresh();
        transition('TRACKING');
        return true;
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
                initialBrightness = Detector.measureBrightness(frame, lastLoc, lastSize);
                lastBrightness = initialBrightness;
                detectedAt = Date.now();
                // 카운트다운은 OCR이 첫 유효 숫자(≤59)를 읽을 때까지 대기
                startTime = 0;
                remainingSec = 0;
                ocrSynced = false;
                lastOcrNumber = null;
                ocrConfirmStreak = 0;
                missStreak = 0;
                alertedThisCycle = false;
                recentScores = [];
                recentBrightness = [];
                pushScore(result.score);
                pushBrightness(initialBrightness);
                emit('detect', { loc: lastLoc, score: result.score, scale: fixedScale, brightness: initialBrightness });
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

            const brightness = Detector.measureBrightness(frame, lastLoc, lastSize);
            lastBrightness = brightness;

            const refreshInfo = detectRefresh(result.score, brightness);
            if (refreshInfo) {
                handleRefresh(refreshInfo);
            }

            lastScore = result.score;
            pushScore(result.score);
            pushBrightness(brightness);

            // 카운트다운 시계는 동기화 완료 후에만 진행
            if (ocrSynced) updateRemainingFromClock();

            // OCR는 항상 시도 (동기화 전: 최초 숫자 포착 / 동기화 후: 보정·갱신감지)
            await tryOcrRead();

            if (ocrSynced && remainingSec <= 0) {
                emit('expired');
                // TRACKING 유지 — 갱신/소실 감지 계속
                alertedThisCycle = false;
            } else if (ocrSynced && remainingSec <= CONFIG.ALERT_THRESHOLD_SECONDS && remainingSec > 0 && !alertedThisCycle) {
                alertedThisCycle = true;
                transition('ALERTING');
                try { Notifier.alertExpiring(Math.ceil(remainingSec)); } catch (_) {}
                emit('alert', Math.ceil(remainingSec));
                transition('TRACKING');
            }
        } else {
            missStreak++;
            if (ocrSynced) updateRemainingFromClock();
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
            loc: lastLoc,
            size: lastSize,
            detectedAt,
            ocrSynced,
        };
    }

    function setAlertThreshold(seconds) {
        const n = Number(seconds);
        if (!Number.isFinite(n) || n < 1 || n > 60) return false;
        CONFIG.ALERT_THRESHOLD_SECONDS = n;
        return true;
    }

    function getConfig() {
        return { ...CONFIG };
    }

    return { on, start, stop, getStatus, rescan, setAlertThreshold, getConfig, manualRefresh };
})();

if (typeof window !== 'undefined') window.Timer = Timer;

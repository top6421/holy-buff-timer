(function () {
    const els = {};
    let detectorReady = false;

    const STATE_LABEL = {
        IDLE: '대기',
        SCANNING: '🔍 탐색 중',
        TRACKING: '✅ 탐지 중',
        ALERTING: '⚠️ 만료 임박',
    };

    function initElements() {
        const ids = [
            'startShareBtn', 'stopShareBtn', 'shareStatus',
            'startDetectBtn', 'stopDetectBtn', 'detectStatus',
            'togglePipBtn', 'toggleOverlayBtn', 'alertSeconds',
            'remainingTime', 'progressBar',
            'preview', 'previewPlaceholder', 'overlayCanvas',
        ];
        for (const id of ids) els[id] = document.getElementById(id);
    }

    function formatTime(sec) {
        const s = Math.max(0, Math.ceil(sec));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    }

    function setState(el, text, className) {
        if (!el) return;
        el.textContent = text;
        el.className = `value ${className}`;
    }

    function stateClassFor(state) {
        switch (state) {
            case 'SCANNING': return 'state-scanning';
            case 'TRACKING': return 'state-tracking';
            case 'ALERTING': return 'state-alerting';
            default: return 'state-idle';
        }
    }

    function updateProgress(remainingSec, totalSec) {
        const total = totalSec || 120;
        const pct = Math.max(0, Math.min(100, (remainingSec / total) * 100));
        const bar = els.progressBar;
        if (!bar) return;
        bar.style.width = `${pct}%`;
        bar.classList.remove('level-high', 'level-mid', 'level-low');
        if (pct >= 50) bar.classList.add('level-high');
        else if (pct >= 20) bar.classList.add('level-mid');
        else bar.classList.add('level-low');
    }

    function resetTimerUI() {
        if (els.remainingTime) els.remainingTime.textContent = '--:--';
        updateProgress(120, 120);
        setState(els.detectStatus, STATE_LABEL.IDLE, 'state-idle');
    }

    async function initModules() {
        const saved = Storage.load();
        if (saved) console.info('[App] 저장 데이터 복원', saved);

        const savedAlert = (saved && typeof saved.alertSeconds === 'number') ? saved.alertSeconds : 5;
        if (els.alertSeconds) els.alertSeconds.value = String(savedAlert);
        try { Timer.setAlertThreshold(savedAlert); } catch (_) {}

        Overlay.init('preview', 'overlayCanvas');

        Notifier.init().catch(() => {});

        const ok = await Detector.init();
        detectorReady = ok;
        if (!ok) {
            console.error('[App] Detector 초기화 실패 — 탐지 기능 비활성화');
            setState(els.detectStatus, '⚠️ 라이브러리 로드 실패', 'state-idle');
            if (els.startDetectBtn) els.startDetectBtn.disabled = true;
        }

        OCR.init().catch((e) => console.warn('[App] OCR init 실패(비치명)', e));

        // PIP 미지원 브라우저는 버튼 비활성
        if (els.togglePipBtn && !PIP.isSupported()) {
            els.togglePipBtn.disabled = true;
            els.togglePipBtn.title = '이 브라우저는 PIP 모드를 지원하지 않습니다 (Chrome/Edge 116+ 필요)';
        }
    }

    function wireSettings() {
        els.alertSeconds?.addEventListener('change', () => {
            const v = Math.max(1, Math.min(60, parseInt(els.alertSeconds.value, 10) || 5));
            els.alertSeconds.value = String(v);
            if (Timer.setAlertThreshold(v)) {
                const saved = Storage.load() || {};
                saved.alertSeconds = v;
                Storage.save(saved);
                console.info('[App] 알림시간 =', v, '초');
            }
        });

        els.toggleOverlayBtn?.addEventListener('click', () => {
            const on = !Overlay.isEnabled();
            Overlay.setEnabled(on);
            els.toggleOverlayBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
            els.toggleOverlayBtn.textContent = on ? '👁️ 영역 표시 ON' : '👁️ 영역 표시';
        });

        els.togglePipBtn?.addEventListener('click', async () => {
            await PIP.toggle();
        });

        PIP.on('open', () => {
            if (els.togglePipBtn) {
                els.togglePipBtn.setAttribute('aria-pressed', 'true');
                els.togglePipBtn.textContent = '📺 PIP 닫기';
            }
        });
        PIP.on('close', () => {
            if (els.togglePipBtn) {
                els.togglePipBtn.setAttribute('aria-pressed', 'false');
                els.togglePipBtn.textContent = '📺 PIP 모드';
            }
        });
    }

    function wireShare() {
        els.startShareBtn?.addEventListener('click', async () => {
            try {
                await Capture.startShare('preview');
            } catch (e) {
                console.error('[App] 화면 공유 실패:', e);
            }
        });

        els.stopShareBtn?.addEventListener('click', () => {
            Capture.stopShare();
        });

        Capture.on('shareStart', () => {
            setState(els.shareStatus, 'ON', 'status-on');
            els.previewPlaceholder?.classList.add('hidden');
            els.startShareBtn.disabled = true;
            els.stopShareBtn.disabled = false;
            if (detectorReady) els.startDetectBtn.disabled = false;
        });

        Capture.on('shareStop', () => {
            try { Timer.stop(); } catch (_) {}
            try { PIP.close(); } catch (_) {}

            setState(els.shareStatus, 'OFF', 'status-off');
            els.previewPlaceholder?.classList.remove('hidden');
            if (els.preview) els.preview.srcObject = null;

            els.startShareBtn.disabled = false;
            els.stopShareBtn.disabled = true;
            els.startDetectBtn.disabled = true;
            els.stopDetectBtn.disabled = true;

            resetTimerUI();
        });

        Capture.on('error', (err) => {
            console.error('[App] Capture error', err);
        });
    }

    function pipPayload(remainingSec, status) {
        return {
            state: status.state,
            remainingSec: remainingSec || 0,
            ocrSynced: status.ocrSynced,
            alertSeconds: Timer.getConfig().ALERT_THRESHOLD_SECONDS,
        };
    }

    function wireDetect() {
        els.startDetectBtn?.addEventListener('click', () => {
            if (!detectorReady || !Detector.isReady()) {
                console.warn('[App] Detector 미준비');
                return;
            }
            Timer.start();
            els.startDetectBtn.disabled = true;
            els.stopDetectBtn.disabled = false;
        });

        els.stopDetectBtn?.addEventListener('click', () => {
            Timer.stop();
            els.startDetectBtn.disabled = !Capture.isSharing();
            els.stopDetectBtn.disabled = true;
            resetTimerUI();
        });

        Timer.on('stateChange', (oldState, newState) => {
            const label = STATE_LABEL[newState] || newState;
            setState(els.detectStatus, label, stateClassFor(newState));
        });

        Timer.on('tick', ({ remainingSec }) => {
            const status = Timer.getStatus();
            if (els.remainingTime) {
                if (status.state === 'TRACKING' || status.state === 'ALERTING') {
                    els.remainingTime.textContent = status.ocrSynced
                        ? formatTime(remainingSec || 0)
                        : '대기 중...';
                } else {
                    els.remainingTime.textContent = '--:--';
                }
            }
            if (status.ocrSynced) {
                updateProgress(remainingSec || 0, 120);
            } else if (status.state === 'TRACKING' || status.state === 'ALERTING') {
                updateProgress(120, 120);
            } else {
                updateProgress(0, 120);
            }

            Overlay.update({
                loc: status.loc,
                size: status.size,
                roi: status.roi,
                videoSize: Capture.getVideoSize(),
            });

            // PIP 창 동기 갱신
            if (PIP.isOpen()) PIP.update(pipPayload(remainingSec, status));
        });

        Timer.on('sync', (n) => {
            console.info('[App] OCR 동기화 →', n, '초');
        });

        Timer.on('detect', ({ loc, score }) => {
            console.info('[App] 아이콘 감지', { loc, score });
        });

        Timer.on('alert', (secondsLeft) => {
            console.info('[App] 만료 임박 알림', secondsLeft);
        });

        Timer.on('refreshed', () => {
            console.info('[App] 갱신 감지');
            if (PIP.isOpen()) PIP.notifyRefreshed?.();
        });

        Timer.on('expired', () => {
            console.info('[App] 만료');
            if (els.remainingTime) els.remainingTime.textContent = '00:00';
            updateProgress(0, 120);
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        initElements();
        resetTimerUI();
        await initModules();
        wireSettings();
        wireShare();
        wireDetect();
    });
})();

(function () {
    const els = {};
    let recordTimerId = null;
    let detectorReady = false;

    function initElements() {
        const ids = [
            'startShareBtn', 'stopShareBtn', 'shareStatus',
            'startDetectBtn', 'stopDetectBtn', 'detectStatus',
            'toggleOverlayBtn', 'alertSeconds',
            'matchScore', 'remainingTime', 'progressBar',
            'preview', 'previewPlaceholder', 'overlayCanvas',
            'startRecordBtn', 'stopRecordBtn', 'downloadBtn',
            'recordStatus', 'recordTime', 'fileSize',
            'playback', 'playbackPlaceholder',
        ];
        for (const id of ids) els[id] = document.getElementById(id);
    }

    function formatTime(sec) {
        const s = Math.max(0, Math.ceil(sec));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    }

    function formatRecordMs(ms) {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    function formatSize(bytes) {
        const mb = bytes / 1024 / 1024;
        return mb < 1 ? `${(bytes / 1024).toFixed(0)} KB` : `${mb.toFixed(2)} MB`;
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
        if (els.matchScore) els.matchScore.textContent = '—';
        if (els.remainingTime) els.remainingTime.textContent = '--:--';
        updateProgress(120, 120);
        setState(els.detectStatus, 'IDLE', 'state-idle');
    }

    async function initModules() {
        const saved = Storage.load();
        if (saved) console.info('[App] 저장 데이터 복원', saved);

        // 저장된 알림시간 복원 (기본 5)
        const savedAlert = (saved && typeof saved.alertSeconds === 'number') ? saved.alertSeconds : 5;
        if (els.alertSeconds) els.alertSeconds.value = String(savedAlert);
        try { Timer.setAlertThreshold(savedAlert); } catch (_) {}

        Overlay.init('preview', 'overlayCanvas');

        Notifier.init().catch(() => {});

        const ok = await Detector.init();
        detectorReady = ok;
        if (!ok) {
            console.error('[App] Detector 초기화 실패 — 탐지 기능 비활성화');
            setState(els.detectStatus, 'OpenCV 로드 실패', 'state-idle');
            if (els.startDetectBtn) els.startDetectBtn.disabled = true;
        }

        OCR.init().catch((e) => console.warn('[App] OCR init 실패(비치명)', e));
    }

    function wireSettings() {
        // 알림시간 입력 변경 → Timer + Storage 동기화
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

        // 영역 표시 토글
        els.toggleOverlayBtn?.addEventListener('click', () => {
            const on = !Overlay.isEnabled();
            Overlay.setEnabled(on);
            els.toggleOverlayBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
            els.toggleOverlayBtn.textContent = on ? '👁️ 영역 표시 ON' : '👁️ 영역 표시';
        });
    }

    function wireShare() {
        els.startShareBtn?.addEventListener('click', async () => {
            try {
                const stream = await Capture.startShare('preview');
                if (!stream) return;
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
            els.startRecordBtn.disabled = false;
        });

        Capture.on('shareStop', () => {
            // Timer 자동 정지
            try { Timer.stop(); } catch (_) {}

            // Recorder 자동 정지 (녹화 중인 경우)
            try {
                if (Recorder.isRecording && Recorder.isRecording()) {
                    Recorder.stopRecord();
                }
                if (Recorder.isSharing && Recorder.isSharing()) {
                    Recorder.stopShare();
                }
            } catch (_) {}

            setState(els.shareStatus, 'OFF', 'status-off');
            els.previewPlaceholder?.classList.remove('hidden');
            if (els.preview) els.preview.srcObject = null;

            els.startShareBtn.disabled = false;
            els.stopShareBtn.disabled = true;
            els.startDetectBtn.disabled = true;
            els.stopDetectBtn.disabled = true;
            els.startRecordBtn.disabled = true;
            els.stopRecordBtn.disabled = true;

            resetTimerUI();
            stopRecordTicker();
            setState(els.recordStatus, 'OFF', 'status-off');
        });

        Capture.on('error', (err) => {
            console.error('[App] Capture error', err);
        });
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
            setState(els.detectStatus, newState, stateClassFor(newState));
        });

        Timer.on('tick', ({ remainingSec, score }) => {
            if (els.matchScore) {
                els.matchScore.textContent = (typeof score === 'number' && score > 0)
                    ? score.toFixed(3) : '—';
            }
            if (els.remainingTime) {
                els.remainingTime.textContent = formatTime(remainingSec || 0);
            }
            updateProgress(remainingSec || 0, 120);

            // Overlay 업데이트
            const status = Timer.getStatus();
            Overlay.update({
                loc: status.loc,
                size: status.size,
                roi: status.roi,
                videoSize: Capture.getVideoSize(),
            });
        });

        Timer.on('detect', ({ loc, score }) => {
            console.info('[App] 아이콘 감지', { loc, score });
        });

        Timer.on('alert', (secondsLeft) => {
            console.info('[App] 만료 임박 알림', secondsLeft);
        });

        Timer.on('refreshed', () => {
            console.info('[App] 갱신 감지');
        });

        Timer.on('expired', () => {
            console.info('[App] 만료');
            if (els.remainingTime) els.remainingTime.textContent = '00:00';
            updateProgress(0, 120);
        });
    }

    function startRecordTicker() {
        stopRecordTicker();
        recordTimerId = setInterval(() => {
            if (els.recordTime) els.recordTime.textContent = formatRecordMs(Recorder.getRecordDuration());
            if (els.fileSize) els.fileSize.textContent = formatSize(Recorder.getTotalSize());
        }, 500);
    }

    function stopRecordTicker() {
        if (recordTimerId) {
            clearInterval(recordTimerId);
            recordTimerId = null;
        }
    }

    function wireRecord() {
        Recorder.on('onRecordStart', () => {
            setState(els.recordStatus, '● REC', 'status-recording');
            els.startRecordBtn.disabled = true;
            els.stopRecordBtn.disabled = false;
            els.downloadBtn.disabled = true;
            startRecordTicker();
        });

        Recorder.on('onRecordStop', (blob) => {
            setState(els.recordStatus, 'OFF', 'status-off');
            els.startRecordBtn.disabled = !Capture.isSharing();
            els.stopRecordBtn.disabled = true;
            els.downloadBtn.disabled = false;
            stopRecordTicker();

            if (blob) {
                const url = URL.createObjectURL(blob);
                if (els.playback) els.playback.src = url;
                els.playbackPlaceholder?.classList.add('hidden');
                if (els.fileSize) els.fileSize.textContent = formatSize(blob.size);
            }
        });

        els.startRecordBtn?.addEventListener('click', async () => {
            try {
                // Recorder는 자체 스트림이 필요. Capture 스트림 재사용 시도.
                if (!Recorder.isSharing || !Recorder.isSharing()) {
                    const stream = Capture.getStream && Capture.getStream();
                    if (stream) {
                        // Recorder 내부에 mediaStream 주입 필요 — 없으면 별도 share 호출
                        try {
                            await Recorder.startShare();
                        } catch (e) {
                            if (e && e.name !== 'NotAllowedError') {
                                console.error('[App] 녹화용 화면 공유 실패:', e);
                                return;
                            }
                            return;
                        }
                    } else {
                        await Recorder.startShare();
                    }
                }
                Recorder.startRecord();
            } catch (err) {
                console.error('[App] 녹화 시작 실패:', err);
            }
        });

        els.stopRecordBtn?.addEventListener('click', () => {
            try { Recorder.stopRecord(); } catch (e) { console.error(e); }
        });

        els.downloadBtn?.addEventListener('click', () => {
            try { Recorder.download(); } catch (e) { console.error('[App] 다운로드 실패:', e); }
        });

        els.playbackPlaceholder?.classList.remove('hidden');
    }

    document.addEventListener('DOMContentLoaded', async () => {
        initElements();
        resetTimerUI();
        await initModules();
        wireSettings();
        wireShare();
        wireDetect();
        wireRecord();
    });
})();

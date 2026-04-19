(function () {
    const els = {};
    let detectorReady = false;
    let currentROI = null;
    let previewRAF = null;

    function initElements() {
        const ids = [
            'startShareBtn', 'stopShareBtn',
            'startDetectBtn', 'stopDetectBtn',
            'status', 'matchScore', 'currentTemplateName',
            'preview', 'previewPlaceholder', 'previewCanvas',
            'templateGrid', 'alertSound',
            'soundSelect', 'soundTestBtn', 'volumeSlider', 'volumeValue',
        ];
        for (const id of ids) els[id] = document.getElementById(id);
    }

    function setStatus(text) {
        if (els.status) els.status.textContent = text;
    }

    function getAudio() {
        return els.alertSound;
    }

    function applyVolume() {
        const audio = getAudio();
        if (!audio || !els.volumeSlider) return;
        audio.volume = parseInt(els.volumeSlider.value, 10) / 100;
    }

    async function initModules() {
        const saved = Storage.load();

        // 사운드 설정 복원
        if (saved) {
            if (saved.soundSrc && els.soundSelect) els.soundSelect.value = saved.soundSrc;
            if (typeof saved.volume === 'number' && els.volumeSlider) {
                els.volumeSlider.value = String(saved.volume);
            }
        }
        // 오디오 소스 설정
        const audio = getAudio();
        if (audio && els.soundSelect) {
            audio.src = els.soundSelect.value;
        }
        applyVolume();
        if (els.volumeValue && els.volumeSlider) {
            els.volumeValue.textContent = els.volumeSlider.value + '%';
        }

        // 저장된 템플릿 복원
        if (saved && saved.templateSrc && saved.templateName) {
            await selectTemplate(saved.templateSrc, saved.templateName,
                saved.roiWidth, saved.roiHeight, saved.roiY);
        }

        Notifier.init().catch(() => {});

        const ok = await Detector.init();
        detectorReady = ok;
        if (!ok) {
            setStatus('⚠️ OpenCV 로드 실패');
        }
    }

    // 템플릿 선택
    async function selectTemplate(src, name, rolw, rolh, roly) {
        const ok = await Detector.loadTemplate(src);
        if (!ok) {
            setStatus('⚠️ 템플릿 로드 실패');
            return false;
        }
        currentROI = { width: parseInt(rolw), height: parseInt(rolh), y: parseInt(roly) };
        Detector.setROI(currentROI);
        if (els.currentTemplateName) els.currentTemplateName.textContent = name;

        // 저장 (기존 설정 보존)
        const prev = Storage.load() || {};
        Storage.save({ ...prev, templateSrc: src, templateName: name,
                       roiWidth: rolw, roiHeight: rolh, roiY: roly });

        // 선택 표시
        document.querySelectorAll('.time-btn').forEach(el => el.classList.remove('selected'));
        const matched = document.querySelector(`.time-btn[data-src="${src}"]`);
        if (matched) matched.classList.add('selected');

        return true;
    }

    function wireTemplateGrid() {
        els.templateGrid?.addEventListener('click', async (e) => {
            const btn = e.target.closest('.time-btn');
            if (!btn) return;
            const { src, name, rolw, rolh, roly } = btn.dataset;
            await selectTemplate(src, name, rolw, rolh, roly);
        });
    }

    function wireSound() {
        els.soundSelect?.addEventListener('change', () => {
            const audio = getAudio();
            if (audio) audio.src = els.soundSelect.value;
            const prev = Storage.load() || {};
            Storage.save({ ...prev, soundSrc: els.soundSelect.value });
        });

        els.volumeSlider?.addEventListener('input', () => {
            const v = parseInt(els.volumeSlider.value, 10);
            if (els.volumeValue) els.volumeValue.textContent = v + '%';
            applyVolume();
            const prev = Storage.load() || {};
            Storage.save({ ...prev, volume: v });
        });

        els.soundTestBtn?.addEventListener('click', () => {
            const audio = getAudio();
            if (!audio) return;
            applyVolume();
            audio.currentTime = 0;
            audio.play().catch(() => {});
        });
    }

    // ROI 프리뷰 루프
    function startPreviewLoop() {
        stopPreviewLoop();
        const video = els.preview;
        const canvas = els.previewCanvas;
        if (!video || !canvas) return;
        const ctx = canvas.getContext('2d');

        function draw() {
            if (!Capture.isSharing() || !currentROI) {
                previewRAF = requestAnimationFrame(draw);
                return;
            }
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            if (vw === 0 || vh === 0) {
                previewRAF = requestAnimationFrame(draw);
                return;
            }
            const rx = Math.max(0, vw - currentROI.width);
            const ry = Math.max(0, Math.min(currentROI.y, vh - 1));
            const rw = Math.min(currentROI.width, vw - rx);
            const rh = Math.min(currentROI.height, vh - ry);
            if (canvas.width !== rw || canvas.height !== rh) {
                canvas.width = rw;
                canvas.height = rh;
            }
            ctx.drawImage(video, rx, ry, rw, rh, 0, 0, rw, rh);
            previewRAF = requestAnimationFrame(draw);
        }
        previewRAF = requestAnimationFrame(draw);
    }

    function stopPreviewLoop() {
        if (previewRAF) {
            cancelAnimationFrame(previewRAF);
            previewRAF = null;
        }
    }

    function wireShare() {
        els.startShareBtn?.addEventListener('click', async () => {
            try {
                await Capture.startShare('preview');
            } catch (e) {
                console.error('[App] 화면 공유 실패:', e);
            }
        });

        els.stopShareBtn?.addEventListener('click', () => Capture.stopShare());

        Capture.on('shareStart', () => {
            setStatus('🟢 화면 공유 중');
            els.previewPlaceholder?.classList.add('hidden');
            els.startShareBtn.disabled = true;
            els.stopShareBtn.disabled = false;
            if (detectorReady && Detector.isReady()) {
                els.startDetectBtn.disabled = false;
            }
            startPreviewLoop();
        });

        Capture.on('shareStop', () => {
            stopPreviewLoop();
            try { Timer.stop(); } catch (_) {}
            setStatus('🔴 대기 중');
            els.previewPlaceholder?.classList.remove('hidden');
            if (els.preview) els.preview.srcObject = null;
            els.startShareBtn.disabled = false;
            els.stopShareBtn.disabled = true;
            els.startDetectBtn.disabled = true;
            els.stopDetectBtn.disabled = true;
        });
    }

    function wireDetect() {
        els.startDetectBtn?.addEventListener('click', () => {
            if (!Detector.isReady()) {
                setStatus('⚠️ 알림 시간을 먼저 선택하세요');
                return;
            }
            Timer.start();
            els.startDetectBtn.disabled = true;
            els.stopDetectBtn.disabled = false;
            setStatus('🟢 탐지 중');
        });

        els.stopDetectBtn?.addEventListener('click', () => {
            Timer.stop();
            els.startDetectBtn.disabled = !Capture.isSharing();
            els.stopDetectBtn.disabled = true;
            setStatus('🔴 탐지 중지');
        });

        Timer.on('tick', ({ score }) => {
            if (els.matchScore) {
                els.matchScore.textContent = typeof score === 'number' ? score.toFixed(4) : '—';
            }
        });

        Timer.on('matched', ({ score }) => {
            console.info('[App] 매칭!', (score * 100).toFixed(2) + '%');
            const audio = getAudio();
            if (audio) {
                applyVolume();
                audio.currentTime = 0;
                audio.play().catch(() => {});
            }
        });
    }

    function wireROITest() {
        const applyBtn = document.getElementById('applyRoiBtn');
        const yInput = document.getElementById('roiYInput');
        const hInput = document.getElementById('roiHInput');
        const wInput = document.getElementById('roiWInput');
        if (!applyBtn) return;

        applyBtn.addEventListener('click', () => {
            const y = parseInt(yInput.value, 10) || 300;
            const h = parseInt(hInput.value, 10) || 140;
            const w = parseInt(wInput.value, 10) || 800;
            currentROI = { width: w, height: h, y: y };
            Detector.setROI(currentROI);
            console.info('[App] ROI 수동 적용:', currentROI);
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        initElements();
        await initModules();
        wireTemplateGrid();
        wireSound();
        wireShare();
        wireDetect();
        wireROITest();
    });
})();

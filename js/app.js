(function () {
    const els = {};
    let detectorReady = false;
    let currentROI = null;
    let previewRAF = null;

    function initElements() {
        const ids = [
            'startShareBtn', 'stopShareBtn',
            'startDetectBtn', 'stopDetectBtn',
            'togglePipBtn',
            'status', 'currentTemplateName',
            'preview', 'previewPlaceholder', 'previewCanvas',
            'templateGrid', 'alertSound',
        ];
        for (const id of ids) els[id] = document.getElementById(id);
    }

    async function initModules() {
        // 저장된 템플릿 복원
        const saved = Storage.load();
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

        if (els.togglePipBtn && !PIP.isSupported()) {
            els.togglePipBtn.disabled = true;
            els.togglePipBtn.title = 'PIP 미지원 브라우저';
        }
    }

    function setStatus(text) {
        if (els.status) els.status.textContent = text;
    }

    // 템플릿 선택 처리
    async function selectTemplate(src, name, rolw, rolh, roly) {
        const ok = await Detector.loadTemplate(src);
        if (!ok) {
            setStatus('⚠️ 템플릿 로드 실패');
            return false;
        }
        currentROI = { width: parseInt(rolw), height: parseInt(rolh), y: parseInt(roly) };
        Detector.setROI(currentROI);
        if (els.currentTemplateName) els.currentTemplateName.textContent = name;

        // 저장
        Storage.save({ templateSrc: src, templateName: name,
                       roiWidth: rolw, roiHeight: rolh, roiY: roly });

        // 선택 시각 표시
        document.querySelectorAll('.template-item').forEach(el => el.classList.remove('selected'));
        const matched = document.querySelector(`.template-item[data-src="${src}"]`);
        if (matched) matched.classList.add('selected');

        console.info('[App] 템플릿 선택:', name);
        return true;
    }

    function wireTemplateGrid() {
        els.templateGrid?.addEventListener('click', async (e) => {
            const item = e.target.closest('.template-item');
            if (!item) return;
            const { src, name, rolw, rolh, roly } = item.dataset;
            await selectTemplate(src, name, rolw, rolh, roly);
        });
    }

    // 버프 영역만 캔버스에 표시하는 프리뷰 루프
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
            try { PIP.close(); } catch (_) {}
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
                setStatus('⚠️ 템플릿을 먼저 선택하세요');
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

        Timer.on('matched', ({ score }) => {
            console.info('[App] 매칭 성공', (score * 100).toFixed(2) + '%');
            // alertSound 재생 (notifier와 별개로 mp3도 재생)
            const audio = els.alertSound;
            if (audio) {
                audio.currentTime = 0;
                audio.play().catch(() => {});
            }
        });

        // PIP 업데이트는 간단히 (Timer.on('tick'))
        Timer.on('tick', ({ score, matched }) => {
            if (PIP.isOpen()) {
                PIP.update({
                    state: matched ? 'MATCHED' : 'DETECTING',
                    remainingSec: 0,
                    ocrSynced: false,
                    alertSeconds: 0,
                });
            }
        });
    }

    function wirePip() {
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

    document.addEventListener('DOMContentLoaded', async () => {
        initElements();
        await initModules();
        wireTemplateGrid();
        wireShare();
        wireDetect();
        wirePip();
    });
})();

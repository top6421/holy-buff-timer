/**
 * 템플릿 매칭 기반 홀리심볼 아이콘 탐지 엔진 (OpenCV.js)
 */
const Detector = (function () {
    const CONFIG = {
        MATCH_THRESHOLD: 0.45,
        INIT_SCAN_SCALES: [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75,
                           3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5],
        // ROI는 화면 오른쪽 끝 고정, 좌측으로 확장.
        // 버프가 추가되며 홀리심볼 위치가 좌로 밀려도 ROI 범위는 안정적.
        ROI_WIDTH_RATIO: 0.28,    // 프레임 너비의 28%를 ROI 가로폭으로 (기존 0.55의 절반)
        ROI_RIGHT_PAD_PX: 10,     // 오른쪽 끝에서 살짝 여유
        ROI_PAD_Y_PX: 20,
        TEMPLATE_PATH: "image/reference/icon.png",
    };

    let ready = false;
    let templateGray = null;
    let templateW = 0;
    let templateH = 0;

    const scaledCache = new Map();

    let frameMatRGBA = null;
    let frameMatGray = null;
    let lastFrameW = 0;
    let lastFrameH = 0;

    function log(...args) { console.log('[Detector]', ...args); }
    function err(...args) { console.error('[Detector]', ...args); }

    function waitForOpenCV(timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const start = performance.now();
            (function poll() {
                if (typeof cv !== 'undefined' && window.__opencvReady === true &&
                    cv.Mat && cv.matchTemplate) {
                    return resolve();
                }
                if (performance.now() - start > timeoutMs) {
                    return reject(new Error('OpenCV.js 로드 타임아웃'));
                }
                setTimeout(poll, 50);
            })();
        });
    }

    function loadTemplateImage() {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(new Error('템플릿 이미지 로드 실패: ' + CONFIG.TEMPLATE_PATH));
            img.src = CONFIG.TEMPLATE_PATH;
        });
    }

    // PNG 알파 채널을 흰색으로 합성 (게임 아이콘 프레임이 흰색)
    function prepareTemplate(img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        const rgba = cv.imread(canvas);
        const gray = new cv.Mat();
        cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
        rgba.delete();

        templateGray = gray;
        templateW = canvas.width;
        templateH = canvas.height;
        log(`템플릿 로드: ${templateW}x${templateH}`);
    }

    function getScaledTemplate(scale) {
        const key = scale.toFixed(3);
        if (scaledCache.has(key)) return scaledCache.get(key);
        const w = Math.max(1, Math.round(templateW * scale));
        const h = Math.max(1, Math.round(templateH * scale));
        const dst = new cv.Mat();
        const interp = scale < 1 ? cv.INTER_AREA : cv.INTER_CUBIC;
        cv.resize(templateGray, dst, new cv.Size(w, h), 0, 0, interp);
        const entry = { mat: dst, w, h };
        scaledCache.set(key, entry);
        return entry;
    }

    function ensureFrameMats(imageData) {
        const { width, height } = imageData;
        if (!frameMatRGBA || lastFrameW !== width || lastFrameH !== height) {
            if (frameMatRGBA) frameMatRGBA.delete();
            if (frameMatGray) frameMatGray.delete();
            frameMatRGBA = new cv.Mat(height, width, cv.CV_8UC4);
            frameMatGray = new cv.Mat();
            lastFrameW = width;
            lastFrameH = height;
        }
        frameMatRGBA.data.set(imageData.data);
        cv.cvtColor(frameMatRGBA, frameMatGray, cv.COLOR_RGBA2GRAY);
        return frameMatGray;
    }

    function matchAtScales(image, scales, offsetX, offsetY) {
        let best = { score: -Infinity, loc: null, size: null, scale: null };
        const imgW = image.cols;
        const imgH = image.rows;

        for (const s of scales) {
            const tpl = getScaledTemplate(s);
            // 20px 미만 템플릿은 매칭 품질 낮음, 프레임보다 크면 스킵
            if (tpl.w < 20 || tpl.w > imgW || tpl.h > imgH) continue;

            const result = new cv.Mat();
            try {
                cv.matchTemplate(image, tpl.mat, result, cv.TM_CCOEFF_NORMED);
                const mm = cv.minMaxLoc(result);
                if (mm.maxVal > best.score) {
                    best = {
                        score: mm.maxVal,
                        loc: [mm.maxLoc.x + offsetX, mm.maxLoc.y + offsetY],
                        size: [tpl.w, tpl.h],
                        scale: s,
                    };
                }
            } finally {
                result.delete();
            }
        }
        return best;
    }

    async function init() {
        if (ready) return true;
        try {
            await waitForOpenCV();
            const img = await loadTemplateImage();
            prepareTemplate(img);
            ready = true;
            log('초기화 완료');
            return true;
        } catch (e) {
            err('init 실패:', e.message || e);
            return false;
        }
    }

    function scanFullFrame(imageData) {
        if (!ready) { err('OpenCV 미준비 — scanFullFrame 거부'); return null; }
        if (!imageData) return null;

        try {
            const gray = ensureFrameMats(imageData);
            const best = matchAtScales(gray, CONFIG.INIT_SCAN_SCALES, 0, 0);
            if (best.score < CONFIG.MATCH_THRESHOLD) return null;
            return best;
        } catch (e) {
            err('scanFullFrame 예외:', e);
            return null;
        }
    }

    function scanROI(imageData, roi, fixedScale) {
        if (!ready) { err('OpenCV 미준비 — scanROI 거부'); return null; }
        if (!imageData || !roi || fixedScale == null) return null;

        const x0 = Math.max(0, roi.x0 | 0);
        const y0 = Math.max(0, roi.y0 | 0);
        const x1 = Math.min(imageData.width, roi.x1 | 0);
        const y1 = Math.min(imageData.height, roi.y1 | 0);
        const rw = x1 - x0;
        const rh = y1 - y0;
        if (rw <= 0 || rh <= 0) return null;

        let roiMat = null;
        try {
            const gray = ensureFrameMats(imageData);
            roiMat = gray.roi(new cv.Rect(x0, y0, rw, rh));
            const best = matchAtScales(roiMat, [fixedScale], x0, y0);
            if (best.loc === null) return null;
            return { score: best.score, loc: best.loc, size: best.size };
        } catch (e) {
            err('scanROI 예외:', e);
            return null;
        } finally {
            if (roiMat) roiMat.delete();
        }
    }

    function computeROI(loc, size, frameSize) {
        // X축: 화면 오른쪽 끝 기준으로 고정. 버프가 추가돼 아이콘이 좌로 밀려도 ROI는 불변.
        const x1 = Math.min(frameSize.width, frameSize.width - CONFIG.ROI_RIGHT_PAD_PX);
        const roiWidth = Math.round(frameSize.width * CONFIG.ROI_WIDTH_RATIO);
        const x0 = Math.max(0, x1 - roiWidth);
        // Y축: 감지된 아이콘의 Y 위치를 중심으로 타이트하게.
        return {
            x0,
            y0: Math.max(0, loc[1] - CONFIG.ROI_PAD_Y_PX),
            x1,
            y1: Math.min(frameSize.height, loc[1] + size[1] + CONFIG.ROI_PAD_Y_PX),
        };
    }

    // 아이콘 영역 평균 밝기(0~255). 회색 오버레이 진행도 측정용.
    // ImageData는 RGBA uint8clamped.
    function measureBrightness(imageData, loc, size) {
        if (!imageData || !loc || !size) return 0;
        const { width: W, data } = imageData;
        const x0 = Math.max(0, loc[0]);
        const y0 = Math.max(0, loc[1]);
        const w = Math.min(size[0], imageData.width - x0);
        const h = Math.min(size[1], imageData.height - y0);
        if (w <= 0 || h <= 0) return 0;
        let sum = 0;
        let count = 0;
        // 4픽셀 간격 샘플링 (성능)
        const step = 2;
        for (let y = 0; y < h; y += step) {
            const row = (y0 + y) * W;
            for (let x = 0; x < w; x += step) {
                const i = (row + x0 + x) * 4;
                // 표준 luminance
                sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                count++;
            }
        }
        return count ? sum / count : 0;
    }

    function getConfig() { return CONFIG; }
    function isReady() { return ready; }

    return { init, scanFullFrame, scanROI, computeROI, measureBrightness, getConfig, isReady };
})();

if (typeof window !== 'undefined') window.Detector = Detector;

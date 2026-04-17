const Detector = (function () {
    const CONFIG = {
        MATCH_THRESHOLD: 0.978,
        DETECTION_INTERVAL: 500,
    };

    let cvReady = false;
    let templateMat = null;
    let roi = null;
    // detect()용 재사용 캔버스
    let cropCanvas = null;
    let cropCtx = null;

    function log(...args) { console.log('[Detector]', ...args); }
    function err(...args) { console.error('[Detector]', ...args); }

    function waitForOpenCV(timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const start = performance.now();
            (function poll() {
                if (typeof cv !== 'undefined' && cv.Mat && cv.matchTemplate) {
                    return resolve();
                }
                if (performance.now() - start > timeoutMs) {
                    return reject(new Error('OpenCV.js 로드 타임아웃'));
                }
                setTimeout(poll, 100);
            })();
        });
    }

    function imgToMat(img) {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, w, h);
        const mat = cv.matFromImageData(imgData);
        const gray = new cv.Mat();
        cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
        mat.delete();
        return gray;
    }

    async function init() {
        if (cvReady) return true;
        try {
            await waitForOpenCV();
            cvReady = true;
            log('OpenCV 초기화 완료');
            return true;
        } catch (e) {
            err('init 실패:', e.message || e);
            return false;
        }
    }

    async function loadTemplate(imgSrc) {
        try {
            if (!cvReady) await init();
            let img;
            if (typeof imgSrc === 'string') {
                img = await new Promise((resolve, reject) => {
                    const el = new Image();
                    el.crossOrigin = 'anonymous';
                    el.onload = () => resolve(el);
                    el.onerror = () => reject(new Error('템플릿 로드 실패: ' + imgSrc));
                    el.src = imgSrc;
                });
            } else {
                img = imgSrc;
            }
            if (templateMat) { templateMat.delete(); templateMat = null; }
            templateMat = imgToMat(img);
            log('템플릿 로드:', templateMat.cols + 'x' + templateMat.rows);
            return true;
        } catch (e) {
            err('loadTemplate 실패:', e.message || e);
            return false;
        }
    }

    function setROI(r) {
        roi = { width: r.width, height: r.height, y: r.y };
    }

    function detect(imageData) {
        const fail = { matched: false, score: 0 };
        if (!templateMat || !roi || !imageData) return fail;

        const fw = imageData.width;
        const fh = imageData.height;
        const rx = Math.max(0, fw - roi.width);
        const ry = Math.max(0, Math.min(roi.y, fh - 1));
        const rw = Math.min(roi.width, fw - rx);
        const rh = Math.min(roi.height, fh - ry);

        if (rw < templateMat.cols || rh < templateMat.rows) return fail;

        if (!cropCanvas) {
            cropCanvas = document.createElement('canvas');
            cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
        }
        if (cropCanvas.width !== rw || cropCanvas.height !== rh) {
            cropCanvas.width = rw;
            cropCanvas.height = rh;
        }

        // ROI 영역만 직접 복사 (putImageData offset 방식보다 빠름)
        const cropped = new ImageData(rw, rh);
        const src = imageData.data;
        const dst = cropped.data;
        for (let row = 0; row < rh; row++) {
            const srcOff = ((ry + row) * fw + rx) * 4;
            const dstOff = row * rw * 4;
            dst.set(src.subarray(srcOff, srcOff + rw * 4), dstOff);
        }

        let roiMat = null;
        let roiGray = null;
        let resultMat = null;
        try {
            roiMat = cv.matFromImageData(cropped);
            roiGray = new cv.Mat();
            cv.cvtColor(roiMat, roiGray, cv.COLOR_RGBA2GRAY);
            resultMat = new cv.Mat();
            cv.matchTemplate(roiGray, templateMat, resultMat, cv.TM_CCOEFF_NORMED);
            const mm = cv.minMaxLoc(resultMat);
            return { matched: mm.maxVal >= CONFIG.MATCH_THRESHOLD, score: mm.maxVal };
        } catch (e) {
            err('detect 예외:', e);
            return fail;
        } finally {
            if (resultMat) resultMat.delete();
            if (roiGray) roiGray.delete();
            if (roiMat) roiMat.delete();
        }
    }

    function isReady() { return cvReady && templateMat !== null; }
    function getMatchThreshold() { return CONFIG.MATCH_THRESHOLD; }
    function setMatchThreshold(val) { CONFIG.MATCH_THRESHOLD = val; }

    return { init, loadTemplate, setROI, detect, isReady, getMatchThreshold, setMatchThreshold };
})();

if (typeof window !== 'undefined') window.Detector = Detector;

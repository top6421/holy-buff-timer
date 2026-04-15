const OCR = (function () {
    let worker = null;
    let ready = false;
    let initPromise = null;

    async function init() {
        if (ready) return true;
        if (initPromise) return initPromise;
        if (typeof Tesseract === 'undefined') {
            console.warn('[OCR] Tesseract not loaded');
            return false;
        }

        initPromise = (async () => {
            try {
                worker = await Tesseract.createWorker('eng');
                // PSM 8 = SINGLE_WORD: 카운트다운 숫자가 1~2자리 단일 토큰이므로 라인 해석보다 정확
                await worker.setParameters({
                    tessedit_char_whitelist: '0123456789',
                    tessedit_pageseg_mode: (typeof Tesseract !== 'undefined' && Tesseract.PSM && Tesseract.PSM.SINGLE_WORD) ? Tesseract.PSM.SINGLE_WORD : '8',
                    classify_bln_numeric_mode: '1',
                });
                ready = true;
                return true;
            } catch (e) {
                console.warn('[OCR] init failed', e);
                worker = null;
                ready = false;
                return false;
            } finally {
                initPromise = null;
            }
        })();

        return initPromise;
    }

    // OpenCV H 범위(0~179) 기준 HSV 변환
    function rgbToHsvOpenCV(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d > 0) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h = h * 30;
            if (h < 0) h += 180;
        }
        const s = max === 0 ? 0 : (d / max) * 255;
        const v = max * 255;
        return { h, s, v };
    }

    // 카운트다운 숫자(주황/빨강/노랑)만 남기고 배경을 흰색으로. 3× 업스케일 + 20px 흰 패딩.
    function preprocForTimerOcr(canvas) {
        if (!canvas) return null;
        const sw = canvas.width | 0;
        const sh = canvas.height | 0;
        if (sw <= 0 || sh <= 0) return null;

        const srcCtx = canvas.getContext('2d');
        const img = srcCtx.getImageData(0, 0, sw, sh);
        const data = img.data;

        // 색상 마스크: 빨강/주황(H≤25 or H≥160) ∪ 노랑(15≤H≤35), S≥100, V≥100
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const { h, s, v } = rgbToHsvOpenCV(r, g, b);
            const keep =
                (((h <= 25) || (h >= 160)) && s >= 100 && v >= 100) ||
                ((h >= 15 && h <= 35) && s >= 100 && v >= 100);
            if (!keep) {
                data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
            }
        }

        const masked = document.createElement('canvas');
        masked.width = sw;
        masked.height = sh;
        masked.getContext('2d').putImageData(img, 0, 0);

        const SCALE = 3;
        const PAD = 20;
        const out = document.createElement('canvas');
        out.width = sw * SCALE + PAD * 2;
        out.height = sh * SCALE + PAD * 2;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(masked, 0, 0, sw, sh, PAD, PAD, sw * SCALE, sh * SCALE);
        return out;
    }

    async function readNumber(imageSource, options) {
        const opts = options || {};
        const preprocess = opts.preprocess !== false; // 기본 true

        if (!ready || !worker) {
            const ok = await init();
            if (!ok) return { text: '', number: null, confidence: 0 };
        }
        try {
            let src = imageSource;
            if (preprocess && imageSource && typeof imageSource.getContext === 'function') {
                const pre = preprocForTimerOcr(imageSource);
                if (pre) src = pre;
            }
            const res = await worker.recognize(src);
            const data = res && res.data ? res.data : {};
            const text = (data.text || '').trim();
            const confidence = typeof data.confidence === 'number' ? data.confidence : 0;
            const m = text.match(/\d+/);
            const number = m ? parseInt(m[0], 10) : null;
            return { text, number, confidence };
        } catch (e) {
            console.warn('[OCR] recognize failed', e);
            return { text: '', number: null, confidence: 0 };
        }
    }

    async function terminate() {
        if (!worker) return;
        try {
            await worker.terminate();
        } catch (e) {
            console.warn('[OCR] terminate failed', e);
        } finally {
            worker = null;
            ready = false;
        }
    }

    function isReady() {
        return ready;
    }

    return { init, readNumber, terminate, isReady, preprocForTimerOcr };
})();

window.OCR = OCR;

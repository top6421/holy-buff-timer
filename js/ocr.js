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
                await worker.setParameters({
                    tessedit_char_whitelist: '0123456789',
                    tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.SINGLE_LINE : '7',
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

    async function readNumber(imageSource) {
        if (!ready || !worker) {
            const ok = await init();
            if (!ok) return { text: '', number: null, confidence: 0 };
        }
        try {
            const res = await worker.recognize(imageSource);
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

    return { init, readNumber, terminate, isReady };
})();

window.OCR = OCR;

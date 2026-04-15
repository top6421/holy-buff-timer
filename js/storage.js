const Storage = (function () {
    const KEY = 'holy_buff_timer';
    const ROI_FIELD = 'roi';

    function save(data) {
        try {
            localStorage.setItem(KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            console.warn('[Storage] save failed', e);
            return false;
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw == null) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.warn('[Storage] load parse error', e);
            return null;
        }
    }

    function saveROI(roi) {
        const cur = load() || {};
        cur[ROI_FIELD] = roi;
        return save(cur);
    }

    function loadROI() {
        const cur = load();
        if (!cur || !cur[ROI_FIELD]) return null;
        return cur[ROI_FIELD];
    }

    function clear() {
        try {
            localStorage.removeItem(KEY);
            return true;
        } catch (e) {
            console.warn('[Storage] clear failed', e);
            return false;
        }
    }

    return { save, load, saveROI, loadROI, clear };
})();

if (typeof window !== 'undefined') window.Storage = Storage;

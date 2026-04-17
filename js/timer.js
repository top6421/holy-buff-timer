const Timer = (function () {
    const CONFIG = {
        DETECTION_INTERVAL_MS: 500,
        ALERT_COOLDOWN_MS: 3000,
    };

    const listeners = { start: [], stop: [], matched: [], tick: [] };
    let intervalId = null;
    let isTicking = false;
    let lastAlertTime = 0;

    function on(event, callback) {
        if (listeners[event] && typeof callback === 'function') {
            listeners[event].push(callback);
        }
    }

    function emit(event, data) {
        const arr = listeners[event];
        if (!arr) return;
        for (const cb of arr) {
            try { cb(data); } catch (_) {}
        }
    }

    async function tick() {
        if (isTicking) return;
        isTicking = true;
        try {
            const frame = Capture.grabFrame();
            if (!frame) return;
            const result = Detector.detect(frame);
            emit('tick', { score: result.score, matched: result.matched });
            if (result.matched && Date.now() - lastAlertTime >= CONFIG.ALERT_COOLDOWN_MS) {
                try { Notifier.alertExpiring(); } catch (_) {}
                emit('matched', { score: result.score });
                lastAlertTime = Date.now();
            }
        } catch (e) {
            console.warn('[Timer] tick error', e);
        } finally {
            isTicking = false;
        }
    }

    function start() {
        if (intervalId) return;
        if (typeof Capture === 'undefined' || !Capture.isSharing()) {
            console.warn('[Timer] Capture not ready');
            return;
        }
        if (typeof Detector === 'undefined' || !Detector.isReady()) {
            console.warn('[Timer] Detector not ready');
            return;
        }
        lastAlertTime = 0;
        intervalId = setInterval(tick, CONFIG.DETECTION_INTERVAL_MS);
        tick();
        emit('start');
    }

    function stop() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        isTicking = false;
        emit('stop');
    }

    function isRunning() {
        return intervalId !== null;
    }

    return { on, start, stop, isRunning };
})();

if (typeof window !== 'undefined') window.Timer = Timer;

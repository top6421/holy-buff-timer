const Notifier = (function () {
    let audioCtx = null;
    let flashTimer = null;

    function ensureAudioCtx() {
        if (audioCtx) return audioCtx;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        try {
            audioCtx = new Ctx();
        } catch (e) {
            audioCtx = null;
        }
        return audioCtx;
    }

    async function init() {
        if (!('Notification' in window)) return 'unsupported';
        if (Notification.permission === 'granted' || Notification.permission === 'denied') {
            return Notification.permission;
        }
        try {
            const p = await Notification.requestPermission();
            return p;
        } catch (e) {
            console.warn('[Notifier] permission error', e);
            return 'denied';
        }
    }

    function playOneBeep(ctx, freq, duration, startTime) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);

        const d = duration / 1000;
        const peak = 0.25;
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.01);
        gain.gain.setValueAtTime(peak, startTime + d - 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + d);

        osc.start(startTime);
        osc.stop(startTime + d + 0.02);
    }

    function beep(count = 3, freq = 880, duration = 200) {
        const ctx = ensureAudioCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
        const gap = 0.08;
        const step = duration / 1000 + gap;
        const now = ctx.currentTime + 0.02;
        for (let i = 0; i < count; i++) {
            playOneBeep(ctx, freq, duration, now + i * step);
        }
    }

    function notify(title, body) {
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;
        try {
            new Notification(title, { body, silent: false });
        } catch (e) {
            console.warn('[Notifier] notify error', e);
        }
    }

    function flash(times = 3) {
        const el = document.getElementById('flashOverlay');
        if (!el) return;
        if (flashTimer) {
            clearInterval(flashTimer);
            flashTimer = null;
        }
        el.style.display = 'block';
        el.style.opacity = '0';

        let ticks = 0;
        const total = times * 2;
        flashTimer = setInterval(() => {
            ticks++;
            el.style.opacity = ticks % 2 === 1 ? '0.6' : '0';
            if (ticks >= total) {
                clearInterval(flashTimer);
                flashTimer = null;
                el.style.opacity = '0';
                el.style.display = 'none';
            }
        }, 180);
    }

    function vibrate() {
        if (navigator.vibrate) {
            try { navigator.vibrate([200, 100, 200]); } catch (e) {}
        }
    }

    function alertExpiring(secondsLeft) {
        beep(3, 880, 200);
        notify('홀리심볼 만료 임박', `${secondsLeft}초 남음 - 갱신하세요`);
        flash(3);
        vibrate();
    }

    return { init, beep, notify, flash, alertExpiring };
})();

if (typeof window !== 'undefined') window.Notifier = Notifier;

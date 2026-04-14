/**
 * 화면 캡처 모듈
 * getDisplayMedia로 화면을 공유받고 프레임을 ImageData/Canvas로 추출합니다.
 */
const Capture = (function () {
    let mediaStream = null;
    let videoEl = null;
    let reusableCanvas = null;
    let reusableCtx = null;

    const callbacks = {
        shareStart: null,
        shareStop: null,
        error: null,
    };

    function on(event, callback) {
        if (event in callbacks) callbacks[event] = callback;
    }

    function emit(event, payload) {
        callbacks[event]?.(payload);
    }

    function ensureCanvas() {
        if (!reusableCanvas) {
            reusableCanvas = document.createElement('canvas');
            reusableCtx = reusableCanvas.getContext('2d', { willReadFrequently: true });
        }
        return reusableCanvas;
    }

    async function startShare(videoElementId = 'preview') {
        if (mediaStream) return mediaStream;

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30 } },
                audio: false,
            });

            const track = stream.getVideoTracks()[0];
            track.addEventListener('ended', () => {
                stopShare();
            });

            const el = document.getElementById(videoElementId);
            if (!el) {
                stream.getTracks().forEach((t) => t.stop());
                throw new Error(`비디오 요소(#${videoElementId})를 찾을 수 없습니다.`);
            }

            el.srcObject = stream;
            el.muted = true;
            el.playsInline = true;
            await el.play().catch(() => {});

            mediaStream = stream;
            videoEl = el;
            emit('shareStart', stream);
            return stream;
        } catch (err) {
            if (err && err.name === 'NotAllowedError') return null;
            emit('error', err);
            throw err;
        }
    }

    function stopShare() {
        if (mediaStream) {
            mediaStream.getTracks().forEach((t) => t.stop());
            mediaStream = null;
        }
        if (videoEl) {
            try { videoEl.pause(); } catch (_) {}
            videoEl.srcObject = null;
            videoEl = null;
        }
        emit('shareStop');
    }

    function grabFrameCanvas() {
        if (!mediaStream || !videoEl) return null;
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        if (!w || !h) return null;

        const canvas = ensureCanvas();
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;

        reusableCtx.drawImage(videoEl, 0, 0, w, h);
        return canvas;
    }

    function grabFrame() {
        const canvas = grabFrameCanvas();
        if (!canvas) return null;
        return reusableCtx.getImageData(0, 0, canvas.width, canvas.height);
    }

    function getVideoSize() {
        if (!videoEl) return null;
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        if (!w || !h) return null;
        return { width: w, height: h };
    }

    function getStream() {
        return mediaStream;
    }

    function isSharing() {
        return !!mediaStream;
    }

    return {
        on,
        startShare,
        stopShare,
        grabFrame,
        grabFrameCanvas,
        getVideoSize,
        getStream,
        isSharing,
    };
})();

if (typeof window !== 'undefined') window.Capture = Capture;

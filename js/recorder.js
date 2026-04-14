/**
 * 화면 공유 + 녹화 모듈
 * getDisplayMedia로 화면을 캡처하고 MediaRecorder로 영상을 녹화합니다.
 */
const Recorder = (function () {
    let mediaStream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordedBlob = null;
    let recordStartTime = null;
    let mimeType = '';

    const callbacks = {
        onShareStart: null,
        onShareStop: null,
        onRecordStart: null,
        onRecordStop: null,
        onChunk: null,
    };

    function on(event, fn) {
        callbacks[event] = fn;
    }

    function pickMimeType() {
        const candidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4',
        ];
        for (const t of candidates) {
            if (MediaRecorder.isTypeSupported(t)) return t;
        }
        return '';
    }

    async function startShare() {
        if (mediaStream) return mediaStream;

        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: 30, max: 60 },
            },
            audio: false,
        });

        stream.getVideoTracks()[0].addEventListener('ended', () => {
            stopShare();
        });

        mediaStream = stream;
        callbacks.onShareStart?.(stream);
        return stream;
    }

    function stopShare() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            stopRecord();
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach((t) => t.stop());
            mediaStream = null;
        }
        callbacks.onShareStop?.();
    }

    function startRecord() {
        if (!mediaStream) throw new Error('화면 공유가 시작되지 않았습니다.');
        if (mediaRecorder && mediaRecorder.state === 'recording') return;

        mimeType = pickMimeType();
        if (!mimeType) throw new Error('이 브라우저에서 지원하는 녹화 포맷이 없습니다.');

        recordedChunks = [];
        recordedBlob = null;

        mediaRecorder = new MediaRecorder(mediaStream, {
            mimeType,
            videoBitsPerSecond: 4_000_000,
        });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordedChunks.push(e.data);
                callbacks.onChunk?.(getTotalSize());
            }
        };

        mediaRecorder.onstop = () => {
            recordedBlob = new Blob(recordedChunks, { type: mimeType });
            callbacks.onRecordStop?.(recordedBlob);
        };

        mediaRecorder.start(1000);
        recordStartTime = Date.now();
        callbacks.onRecordStart?.();
    }

    function stopRecord() {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
        mediaRecorder.stop();
    }

    function getTotalSize() {
        return recordedChunks.reduce((sum, c) => sum + c.size, 0);
    }

    function getRecordDuration() {
        if (!recordStartTime) return 0;
        return Date.now() - recordStartTime;
    }

    function getBlob() {
        return recordedBlob;
    }

    function getExtension() {
        if (mimeType.includes('mp4')) return 'mp4';
        return 'webm';
    }

    function download() {
        if (!recordedBlob) throw new Error('녹화된 영상이 없습니다.');
        const url = URL.createObjectURL(recordedBlob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `buff-capture-${ts}.${getExtension()}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return {
        on,
        startShare,
        stopShare,
        startRecord,
        stopRecord,
        getTotalSize,
        getRecordDuration,
        getBlob,
        download,
        isSharing: () => !!mediaStream,
        isRecording: () => mediaRecorder?.state === 'recording',
    };
})();

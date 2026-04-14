/**
 * 탐지 영역 시각화 오버레이
 * <video> 위에 <canvas>를 겹쳐 아이콘 박스·ROI 박스를 그린다.
 */
const Overlay = (function () {
    let canvas = null;
    let ctx = null;
    let videoEl = null;
    let enabled = false;
    let rafId = null;
    let currentData = null; // {loc, size, roi, videoSize}

    function init(videoElementId = 'preview', canvasId = 'overlayCanvas') {
        videoEl = document.getElementById(videoElementId);
        canvas = document.getElementById(canvasId);
        if (!videoEl || !canvas) return false;
        ctx = canvas.getContext('2d');
        return true;
    }

    function setEnabled(v) {
        enabled = !!v;
        if (!enabled) clear();
        else scheduleDraw();
    }

    function isEnabled() { return enabled; }

    // Timer가 매 틱마다 호출
    function update({ loc, size, roi, videoSize }) {
        currentData = { loc, size, roi, videoSize };
        if (enabled) scheduleDraw();
    }

    function clear() {
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    function scheduleDraw() {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            draw();
        });
    }

    // 원본 프레임 좌표 → 비디오 엘리먼트 표시 좌표 매핑
    // object-fit: contain 고려
    function computeMapping() {
        if (!videoEl) return null;
        const rect = videoEl.getBoundingClientRect();
        const vw = videoEl.videoWidth || 1;
        const vh = videoEl.videoHeight || 1;
        const elW = rect.width;
        const elH = rect.height;

        const videoAspect = vw / vh;
        const elAspect = elW / elH;

        let displayW, displayH, offsetX, offsetY;
        if (videoAspect > elAspect) {
            displayW = elW;
            displayH = elW / videoAspect;
            offsetX = 0;
            offsetY = (elH - displayH) / 2;
        } else {
            displayH = elH;
            displayW = elH * videoAspect;
            offsetY = 0;
            offsetX = (elW - displayW) / 2;
        }
        return {
            scaleX: displayW / vw,
            scaleY: displayH / vh,
            offsetX, offsetY,
            canvasW: elW, canvasH: elH,
        };
    }

    function resizeCanvas(map) {
        if (!canvas) return;
        // 캔버스 크기를 비디오 엘리먼트 실제 크기에 맞춤
        if (canvas.width !== map.canvasW || canvas.height !== map.canvasH) {
            canvas.width = map.canvasW;
            canvas.height = map.canvasH;
        }
    }

    function draw() {
        if (!enabled || !ctx || !canvas || !currentData) { clear(); return; }
        const map = computeMapping();
        if (!map) return;
        resizeCanvas(map);
        clear();

        const { loc, size, roi } = currentData;

        // ROI (노란색 반투명 경계)
        if (roi) {
            const rx = roi.x0 * map.scaleX + map.offsetX;
            const ry = roi.y0 * map.scaleY + map.offsetY;
            const rw = (roi.x1 - roi.x0) * map.scaleX;
            const rh = (roi.y1 - roi.y0) * map.scaleY;
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 4]);
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(250, 204, 21, 0.08)';
            ctx.fillRect(rx, ry, rw, rh);

            ctx.font = '12px "SF Mono", Menlo, monospace';
            ctx.fillStyle = 'rgba(250, 204, 21, 1)';
            ctx.fillText('ROI (탐색 영역)', rx + 6, ry + 16);
        }

        // 아이콘 박스 (초록)
        if (loc && size) {
            const x = loc[0] * map.scaleX + map.offsetX;
            const y = loc[1] * map.scaleY + map.offsetY;
            const w = size[0] * map.scaleX;
            const h = size[1] * map.scaleY;
            ctx.strokeStyle = 'rgba(16, 185, 129, 1)';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, w, h);

            ctx.font = 'bold 13px "SF Mono", Menlo, monospace';
            ctx.fillStyle = 'rgba(16, 185, 129, 1)';
            ctx.fillText('홀리심볼', x, Math.max(14, y - 6));
        }
    }

    return { init, setEnabled, isEnabled, update, clear };
})();

if (typeof window !== 'undefined') window.Overlay = Overlay;

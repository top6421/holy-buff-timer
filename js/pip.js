/**
 * Document Picture-in-Picture 모듈
 * 게임 전체화면 플레이 중에도 타이머를 보이게 하는 플로팅 창.
 */
const PIP = (function () {
    const WIDTH = 280;
    const HEIGHT = 200;
    const BUFF_DURATION = 120;

    const listeners = { open: [], close: [] };
    let pipWindow = null;
    let dom = null; // {badge, time, progress, hint, container}
    let refreshedTimer = null;
    let lastRefreshedAt = 0;

    function on(event, callback) {
        if (!(event in listeners)) return;
        if (typeof callback !== 'function') return;
        listeners[event].push(callback);
    }

    function emit(event, ...args) {
        const arr = listeners[event];
        if (!arr) return;
        for (const cb of arr) {
            try { cb(...args); } catch (e) { console.warn('[PIP] listener error', event, e); }
        }
    }

    function isSupported() {
        return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
    }

    function isOpen() {
        return pipWindow !== null;
    }

    // 잔여 비율별 색상 (50%+ 녹, 20~50% 노랑, <20% 빨강)
    function colorForRatio(ratio) {
        if (ratio >= 0.5) return '#10b981';
        if (ratio >= 0.2) return '#facc15';
        return '#ef4444';
    }

    const STYLE_CSS = `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
            width: 100%; height: 100%;
            background: #0f172a;
            color: #e2e8f0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            overflow: hidden;
            user-select: none;
        }
        .wrap {
            width: 100%; height: 100%;
            padding: 12px 14px;
            display: flex; flex-direction: column;
            gap: 6px;
            transition: background-color 0.2s;
        }
        .wrap.critical { animation: blink 0.5s infinite alternate; }
        @keyframes blink {
            from { background: #0f172a; }
            to   { background: #7f1d1d; }
        }
        .title {
            font-size: 12px; font-weight: 600;
            color: #94a3b8; letter-spacing: 0.3px;
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            font-size: 11px; font-weight: 600;
            border-radius: 999px;
            background: #334155; color: #e2e8f0;
            align-self: flex-start;
        }
        .badge.waiting  { background: #475569; color: #cbd5e1; }
        .badge.counting { background: #1e40af; color: #dbeafe; }
        .badge.alert    { background: #b91c1c; color: #fef2f2; }
        .badge.refreshed { background: #166534; color: #dcfce7; }
        .time {
            font-size: 2.8em;
            font-weight: 700;
            font-family: "SF Mono", Menlo, Consolas, monospace;
            text-align: center;
            line-height: 1;
            margin: 2px 0;
            color: #10b981;
            font-variant-numeric: tabular-nums;
        }
        .bar {
            width: 100%; height: 8px;
            background: #1e293b;
            border-radius: 4px;
            overflow: hidden;
        }
        .bar-fill {
            height: 100%; width: 0%;
            background: #10b981;
            transition: width 0.3s ease, background-color 0.3s;
        }
        .hint {
            font-size: 10px;
            color: #64748b;
            text-align: center;
            margin-top: 2px;
        }
    `;

    const BODY_HTML = `
        <div class="wrap" id="pipWrap">
            <div class="title">🔔 홀리심볼</div>
            <span class="badge waiting" id="pipBadge">대기 중</span>
            <div class="time" id="pipTime">--</div>
            <div class="bar"><div class="bar-fill" id="pipBarFill"></div></div>
            <div class="hint">Space = 갱신</div>
        </div>
    `;

    function buildDom() {
        if (!pipWindow) return;
        const doc = pipWindow.document;
        doc.title = '홀리심볼 타이머';

        const styleEl = doc.createElement('style');
        styleEl.textContent = STYLE_CSS;
        doc.head.appendChild(styleEl);

        const root = doc.createElement('div');
        root.innerHTML = BODY_HTML;
        while (root.firstChild) doc.body.appendChild(root.firstChild);

        dom = {
            container: doc.getElementById('pipWrap'),
            badge: doc.getElementById('pipBadge'),
            time: doc.getElementById('pipTime'),
            barFill: doc.getElementById('pipBarFill'),
        };
    }

    async function open() {
        if (pipWindow) return true;
        if (!isSupported()) {
            console.warn('[PIP] documentPictureInPicture 미지원 브라우저');
            try { alert('이 브라우저는 PIP 기능을 지원하지 않습니다 (Chrome/Edge 116+ 필요).'); } catch (_) {}
            return false;
        }
        try {
            pipWindow = await window.documentPictureInPicture.requestWindow({
                width: WIDTH,
                height: HEIGHT,
            });
        } catch (e) {
            console.warn('[PIP] requestWindow 실패', e);
            try { alert('PIP 창을 열지 못했습니다. 버튼 클릭 직후에만 열 수 있습니다.'); } catch (_) {}
            pipWindow = null;
            return false;
        }

        buildDom();

        // 사용자가 X로 닫거나 원본 탭 종료 시
        pipWindow.addEventListener('pagehide', handlePageHide);

        emit('open');
        return true;
    }

    function handlePageHide() {
        pipWindow = null;
        dom = null;
        if (refreshedTimer) {
            clearTimeout(refreshedTimer);
            refreshedTimer = null;
        }
        emit('close');
    }

    function close() {
        if (!pipWindow) return;
        try { pipWindow.close(); } catch (_) {}
        // pagehide 핸들러가 정리
    }

    async function toggle() {
        if (pipWindow) {
            close();
            return false;
        }
        return await open();
    }

    // 갱신 이벤트용 — 1초간 "갱신됨" 배지 표시
    function markRefreshed() {
        lastRefreshedAt = Date.now();
        if (refreshedTimer) clearTimeout(refreshedTimer);
        refreshedTimer = setTimeout(() => {
            refreshedTimer = null;
            lastRefreshedAt = 0;
        }, 1000);
    }

    // payload: {state, remainingSec, ocrSynced, alertSeconds}
    function update(payload) {
        if (!pipWindow || !dom) return;
        const state = payload && payload.state;
        const remaining = payload && Number(payload.remainingSec) || 0;
        const ocrSynced = payload && payload.ocrSynced;
        const alertSec = (payload && Number(payload.alertSeconds)) || 5;

        const showRefreshed = lastRefreshedAt > 0 && (Date.now() - lastRefreshedAt) < 1000;
        const remainingInt = Math.ceil(remaining);

        // 배지·시간 텍스트
        let badgeText = '대기 중';
        let badgeClass = 'waiting';
        let timeText = '--';

        if (showRefreshed) {
            badgeText = '🔄 갱신됨';
            badgeClass = 'refreshed';
            timeText = '120';
        } else if (state === 'IDLE') {
            badgeText = '대기 중';
            badgeClass = 'waiting';
            timeText = '--';
        } else if (state === 'SCANNING') {
            badgeText = '탐지 중';
            badgeClass = 'waiting';
            timeText = '--';
        } else if (state === 'TRACKING' || state === 'ALERTING') {
            if (!ocrSynced) {
                badgeText = '대기 중';
                badgeClass = 'waiting';
                timeText = '--';
            } else if (remainingInt <= alertSec && remainingInt > 0) {
                badgeText = `⚠️ ${remainingInt}초!`;
                badgeClass = 'alert';
                timeText = `${remainingInt}`;
            } else if (remainingInt <= 0) {
                badgeText = '만료';
                badgeClass = 'alert';
                timeText = '0';
            } else {
                badgeText = `${remainingInt}초`;
                badgeClass = 'counting';
                timeText = `${remainingInt}`;
            }
        }

        if (dom.badge.textContent !== badgeText) dom.badge.textContent = badgeText;
        if (dom.badge.className !== `badge ${badgeClass}`) dom.badge.className = `badge ${badgeClass}`;
        if (dom.time.textContent !== timeText) dom.time.textContent = timeText;

        // 프로그레스·색상
        const ratio = ocrSynced && remaining > 0
            ? Math.max(0, Math.min(1, remaining / BUFF_DURATION))
            : (showRefreshed ? 1 : 0);
        const color = colorForRatio(ratio);
        const widthPct = `${(ratio * 100).toFixed(1)}%`;

        if (dom.barFill.style.width !== widthPct) dom.barFill.style.width = widthPct;
        if (dom.barFill.style.backgroundColor !== color) dom.barFill.style.backgroundColor = color;
        if (dom.time.style.color !== color) dom.time.style.color = color;

        // 임박 시 빨간 점멸 배경
        const critical = ocrSynced && remainingInt > 0 && remainingInt <= alertSec;
        if (dom.container) {
            if (critical && !dom.container.classList.contains('critical')) {
                dom.container.classList.add('critical');
            } else if (!critical && dom.container.classList.contains('critical')) {
                dom.container.classList.remove('critical');
            }
        }
    }

    // Timer 'refreshed' 이벤트가 있을 때 외부에서 호출하도록 노출
    function notifyRefreshed() {
        if (!pipWindow) return;
        markRefreshed();
    }

    return { on, isSupported, toggle, open, close, isOpen, update, notifyRefreshed };
})();

if (typeof window !== 'undefined') window.PIP = PIP;

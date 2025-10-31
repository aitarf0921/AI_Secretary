(function () {
  // ---------------- helpers ----------------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function getLoaderScript() {
    if (document.currentScript) return document.currentScript;
    const list = document.getElementsByTagName('script');
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i];
      if (!el) continue;
      if (el.dataset && (el.dataset.widget || el.getAttribute('data-widget'))) return el;
      if ((el.src || '').includes('ai-helper-loader')) return el;
    }
    return null;
  }

  function toAbsURL(u) {
    try {
      return new URL(u, window.location.href).toString();
    } catch (_) {
      return null;
    }
  }

  const HEX3_6 = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const RGBA = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(\s*,\s*((0|1|0?\.\d+)))?\s*\)$/;
  function isValidColor(v) {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (HEX3_6.test(s)) return true;
    if (RGBA.test(s)) {
      const m = s.match(RGBA);
      const r = +m[1], g = +m[2], b = +m[3];
      return r <= 255 && g <= 255 && b <= 255;
    }
    return false;
  }
  function sanitizeColor(input) {
    const def = '#25d366';
    return isValidColor(input) ? input.trim() : def;
  }

  function normalizePos(p) {
    const validPositions = [
      'bottom-right', 'bottom-left',
      'top-right',    'top-left',
      'middle-right', 'middle-left'
    ];
    return validPositions.includes(p) ? p : 'bottom-right';
  }

  function isPositiveInt(n) {
    return Number.isInteger(n) && n > 0;
  }
  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }
  function isValidZ(z) {
    const s = String(z ?? '').trim();
    if (!/^-?\d+$/.test(s)) return false;
    const n = parseInt(s, 10);
    return Number.isFinite(n);
  }
  function isValidSite(s) {
    if (s == null) return true;
    if (typeof s !== 'string') return false;
    return /^[A-Za-z0-9_-]{0,64}$/.test(s);
  }
  function isLikelyURL(u) {
    try {
      const x = new URL(u, window.location.href);
      return x.protocol === 'http:' || x.protocol === 'https:';
    } catch {
      return false;
    }
  }
  function isValidPlaceholder(p) {
    if (typeof p !== 'string') return false;
    const s = p.trim();
    return s.length > 0 && s.length <= 120;
  }

  // ---------------- main ----------------
  onReady(function () {
    try {
      const S = getLoaderScript();
      if (!S) {
        console.error('[ai-helper] Loader <script> not found.');
        return;
      }

      const raw = {
        widget: 'https://chatbot.aitarf.us/widget',
        endpoint: 'https://chatbot.aitarf.us/query',
        placeholder: 'send msg to AI support...',
        position: S.getAttribute('data-position') || 'bottom-right',
        accent: S.getAttribute('data-accent') || '#0055ff',
        site: S.getAttribute('data-site') || '',
        width: parseInt(S.getAttribute('data-width') || '360', 10),
        height: parseInt(S.getAttribute('data-height') || '520', 10),
        z: String(S.getAttribute('data-z') || '2147483000'),
      };

      const cfg = {
        widget: toAbsURL(raw.widget),
        endpoint: toAbsURL(raw.endpoint),
        placeholder: isValidPlaceholder(raw.placeholder) ? raw.placeholder.trim() : 'send a message to AI support…',
        position: normalizePos(raw.position),
        accent: sanitizeColor(raw.accent),
        site: isValidSite(raw.site) ? raw.site : '',
        width: isPositiveInt(raw.width) ? clamp(raw.width, 240, 800) : 360,
        height: isPositiveInt(raw.height) ? clamp(raw.height, 320, 1000) : 520,
        z: isValidZ(raw.z) ? String(raw.z).trim() : '2147483000',
      };

      if (!cfg.widget) {
        console.error('[ai-helper] Widget URL is missing or malformed.');
        return;
      }
      const widgetOrigin = new URL(cfg.widget).origin;

      // host 填滿螢幕，但不阻擋點擊
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.inset = '0';
      host.style.zIndex = cfg.z;
      host.style.width = '100vw';
      host.style.height = '100vh';
      host.style.pointerEvents = 'none';

      (document.body || document.documentElement).appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });

      const isLeft = cfg.position.includes('left');
      const isRight = cfg.position.includes('right');
      const isTop = cfg.position.startsWith('top-');
      const isBottom = cfg.position.startsWith('bottom-');
      const isMiddle = cfg.position.startsWith('middle-');

      // 樣式
      const style = document.createElement('style');
      style.textContent = `
        *, *::before, *::after {
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", Arial, "PingFang TC", "Microsoft JhengHei", sans-serif;
        }

        /* FAB 按鈕 */
        .fab {
          position: fixed;
          width: 56px;
          height: 56px;
          border: 0;
          border-radius: 50%;
          background: ${cfg.accent};
          color: #fff;
          cursor: pointer;
          box-shadow: 0 6px 20px rgba(0,0,0,.15);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2147483646;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          pointer-events: auto;
          ${isLeft ? 'left: 20px;' : 'right: 20px;'}
          ${isTop ? 'top: 20px;' : ''}
          ${isBottom ? 'bottom: 20px;' : ''}
          ${isMiddle ? 'top: 50%; transform: translateY(-50%);' : ''}
        }
        .fab:hover { box-shadow: 0 8px 24px rgba(0,0,0,.2); }
        .fab:active { transform: translateY(2px); }

        /* 聊天面板 */
        .panel {
          position: fixed;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%) scale(0.95);
          width: ${cfg.width}px;
          height: ${cfg.height}px;
          max-width: 92vw;
          max-height: 80vh;
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 10px 40px rgba(0,0,0,.2);
          overflow: hidden;
          z-index: 2147483647;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.25s ease, transform 0.25s ease;
          pointer-events: none;
          padding: 0;
        }
        .panel.open {
          opacity: 1;
          visibility: visible;
          transform: translate(-50%, -50%) scale(1);
          pointer-events: auto;
        }

        /* 右上角 X 關閉按鈕 */
        .close-btn {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(0,0,0,0.15);
          border: none;
          color: #fff;
          font-size: 18px;
          font-weight: bold;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 2147483648;
          transition: all 0.2s ease;
          backdrop-filter: blur(4px);
          pointer-events: auto;
        }
        .close-btn:hover,
        .close-btn:active {
          background: rgba(0,0,0,0.3);
          transform: scale(1.1);
        }

        iframe {
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
        }

        @media (max-width: 480px) {
          .fab {
            width: 50px;
            height: 50px;
            ${isLeft ? 'left: 4vw;' : 'right: 4vw;'}
            ${isTop ? 'top: 8px;' : ''}
            ${isBottom ? 'bottom: 8px;' : ''}
            ${isMiddle ? 'top: 50%; transform: translateY(-50%);' : ''}
          }
          .panel {
            width: 92vw !important;
            height: 70vh !important;
            border-radius: 16px;
          }
          .close-btn {
            top: 10px;
            right: 10px;
            width: 30px;
            height: 30px;
            font-size: 16px;
          }
        }
      `;
      shadow.appendChild(style);

      // FAB
      const fab = document.createElement('button');
      fab.className = 'fab';
      fab.setAttribute('aria-label', 'Open AI Support');
      fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';

      // Panel
      const panel = document.createElement('div');
      panel.className = 'panel';

      // X 按鈕
      const closeBtn = document.createElement('button');
      closeBtn.className = 'close-btn';
      closeBtn.innerHTML = '×';
      closeBtn.setAttribute('aria-label', 'Close AI Support');

      // iframe
      const url = new URL(cfg.widget);
      url.searchParams.set('placeholder', cfg.placeholder);
      url.searchParams.set('accent', cfg.accent);
      url.searchParams.set('endpoint', cfg.endpoint);
      if (cfg.site) url.searchParams.set('site', cfg.site);

      const iframe = document.createElement('iframe');
      iframe.src = url.toString();
      iframe.setAttribute('title', 'AI Support');
      iframe.setAttribute('allow', 'clipboard-write');
      panel.appendChild(iframe);
      panel.appendChild(closeBtn);

      shadow.appendChild(panel);
      shadow.appendChild(fab);

      // 開關邏輯 + debounce
      let isBusy = false;
      function toggle() {
        if (isBusy) return;
        isBusy = true;
        panel.classList.toggle('open');
        setTimeout(() => isBusy = false, 300);
      }

      fab.addEventListener('click', toggle);
      fab.addEventListener('touchstart', toggle, { passive: true });
      closeBtn.addEventListener('click', () => {
        if (panel.classList.contains('open')) toggle();
      });
      closeBtn.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        if (panel.classList.contains('open')) toggle();
      }, { passive: true });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.classList.contains('open')) toggle();
      });

      window.addEventListener('message', (ev) => {
        if (ev.origin !== widgetOrigin) return;
        const msg = ev.data;
        if (msg.type === 'ai-helper:resize' && typeof msg.height === 'number') {
          panel.style.height = Math.max(320, Math.min(900, msg.height)) + 'px';
        }
      });

    } catch (err) {
      console.error('[ai-helper] Init failed:', err);
    }
  });
})();

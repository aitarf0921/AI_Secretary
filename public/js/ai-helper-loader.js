(function(){
  // ---------------- helpers ----------------
  function onReady(fn){
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  function getLoaderScript(){
    if (document.currentScript) return document.currentScript;
    const list = document.getElementsByTagName('script');
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i];
      if (!el) continue;
      if (el.dataset && (el.dataset.widget || el.getAttribute('data-widget'))) return el;
      if ((el.src || '').indexOf('ai-helper-loader') !== -1) return el;
    }
    return null;
  }

  function toAbsURL(u){
    try { return new URL(u, window.location.href).toString(); }
    catch(_) { return null; }
  }

  // color validators
  const HEX3_6 = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const RGBA   = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(\s*,\s*((0|1|0?\.\d+)))?\s*\)$/;
  function isValidColor(v){
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
  function sanitizeColor(input){
    const def = '#25d366'; // default green
    return isValidColor(input) ? input.trim() : def;
  }

  function normalizePos(p){ return p === 'bottom-left' ? 'bottom-left' : 'bottom-right'; }
  function isPositiveInt(n){ return Number.isInteger(n) && n > 0; }
  function clamp(n, min, max){ return Math.min(max, Math.max(min, n)); }
  function isValidZ(z){
    const s = String(z ?? '').trim();
    if (!/^-?\d+$/.test(s)) return false;
    const n = parseInt(s, 10);
    return Number.isFinite(n);
  }
  function isValidSite(s){
    if (s == null) return true;
    if (typeof s !== 'string') return false;
    return /^[A-Za-z0-9_-]{0,64}$/.test(s);
  }
  function isLikelyURL(u){
    try {
      const x = new URL(u, window.location.href);
      return x.protocol === 'http:' || x.protocol === 'https:';
    } catch { return false; }
  }
  function isValidPlaceholder(p){
    if (typeof p !== 'string') return false;
    const s = p.trim();
    return s.length > 0 && s.length <= 120;
  }

  // ---------------- main ----------------
  onReady(function(){
    try{
      const S = getLoaderScript();
      if (!S) { console.error('[ai-helper] Loader <script> not found.'); return; }

      // raw attributes (your current defaults)
      const raw = {
        widget:      'https://chatbot.aitarf.us/widget',
        endpoint:    'https://chatbot.aitarf.us/query',
        placeholder: 'send msg to AI support...',
        position:    S.getAttribute('data-position')  || 'bottom-right',
        accent:      S.getAttribute('data-accent') || '#0055ff',
        site:        S.getAttribute('data-site')  || '',
        width:       parseInt(S.getAttribute('data-width')  || '360', 10),
        height:      parseInt(S.getAttribute('data-height') || '520', 10),
        z:           String(S.getAttribute('data-z') || '2147483000'),
      };

      // validate + normalize
      const cfg = {
        widget:      toAbsURL(raw.widget),
        endpoint:    toAbsURL(raw.endpoint),
        placeholder: isValidPlaceholder(raw.placeholder) ? raw.placeholder.trim() : 'send a message to AI support…',
        position:    normalizePos(raw.position),
        accent:      sanitizeColor(raw.accent),
        site:        isValidSite(raw.site) ? raw.site : '',
        width:       isPositiveInt(raw.width)  ? clamp(raw.width, 240, 800)  : 360,
        height:      isPositiveInt(raw.height) ? clamp(raw.height, 320, 1000) : 520,
        z:           isValidZ(raw.z) ? String(raw.z).trim() : '2147483000',
      };

      // non-blocking warnings
      if (!isLikelyURL(cfg.widget))  console.warn('[ai-helper] Invalid widget URL; ensure it is http(s).');
      if (!isLikelyURL(cfg.endpoint)) console.warn('[ai-helper] Invalid endpoint URL; requests may fail.');
      if (!isValidColor(cfg.accent))  console.warn('[ai-helper] Accent color invalid; using fallback.');
      if (!isValidSite(raw.site))     console.warn('[ai-helper] "data-site" contains invalid characters; ignoring.');
      if (!isValidPlaceholder(raw.placeholder)) console.warn('[ai-helper] Placeholder invalid; using default.');
      if (!isPositiveInt(raw.width) || !isPositiveInt(raw.height)) console.warn('[ai-helper] Width/Height invalid; using defaults.');
      if (!isValidZ(cfg.z)) console.warn('[ai-helper] z-index invalid; using default.');

      if (!cfg.widget) { console.error('[ai-helper] Widget URL is missing or malformed.'); return; }
      const widgetOrigin = new URL(cfg.widget).origin;

      // host container
      const host = document.createElement('div');
      host.style.all = 'initial';
      host.style.position = 'fixed';
      host.style.bottom = '20px';
      host.style[cfg.position === 'bottom-left' ? 'left' : 'right'] = '20px';
      host.style.zIndex = cfg.z;
      (document.body || document.documentElement).appendChild(host);

      const shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

      // styles
      const style = document.createElement('style');
      style.textContent = `
        *,*::before,*::after{ box-sizing:border-box; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans TC",Arial,"PingFang TC","Microsoft JhengHei",sans-serif; }
        .fab{ width:56px; height:56px; border:0; border-radius:50%; background:${cfg.accent}; color:#fff; cursor:pointer; box-shadow:0 6px 20px rgba(0,0,0,.15); display:inline-flex; align-items:center; justify-content:center; }
        .fab:active{ transform: translateY(1px); }
        .panel{ position:fixed; bottom:90px; ${cfg.position === 'bottom-left' ? 'left' : 'right'}:20px; width:${cfg.width}px; height:${cfg.height}px; background:#fff; border-radius:14px; box-shadow:0 10px 40px rgba(0,0,0,.18); overflow:hidden; display:none; }
        iframe{ width:100%; height:100%; border:0; display:block; }
        @media (max-width: 480px){ .panel{ width:92vw; height:70vh; ${cfg.position === 'bottom-left' ? 'left' : 'right'}:4vw; bottom:82px; } }
      `;
      shadow.appendChild(style);

      // FAB
      const fab = document.createElement('button');
      fab.className = 'fab';
      fab.setAttribute('aria-label', 'Open AI Support');
      fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';

      // panel + iframe
      const panel = document.createElement('div');
      panel.className = 'panel';

      const url = new URL(cfg.widget);
      url.searchParams.set('placeholder', cfg.placeholder);
      url.searchParams.set('accent', cfg.accent);
      url.searchParams.set('endpoint', cfg.endpoint);
      if (cfg.site) url.searchParams.set('site', cfg.site);

      const frame = document.createElement('iframe');
      frame.src = url.toString();
      frame.setAttribute('title', 'AI Support');

      panel.appendChild(frame);
      shadow.appendChild(panel);
      shadow.appendChild(fab);

      function open(){ panel.style.display = 'block'; try{ frame.contentWindow && frame.focus(); }catch(_){} }
      function close(){ panel.style.display = 'none'; }

      fab.addEventListener('click', () => { panel.style.display === 'block' ? close() : open(); });

      // ESC to close (accessibility)
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.style.display === 'block') close(); });

      // secure resize messages from widget
      window.addEventListener('message', (ev) => {
        try{
          if (!ev || !ev.data) return;
          if (ev.origin !== widgetOrigin) return;
          const msg = ev.data;
          if (msg.type === 'ai-helper:resize' && typeof msg.height === 'number') {
            const h = Math.max(320, Math.min(900, msg.height));
            panel.style.height = h + 'px';
          }
        }catch(_){ /* ignore */ }
      });

    }catch(err){
      console.error('[ai-helper] Initialization failed:', err);
    }
  });
})();

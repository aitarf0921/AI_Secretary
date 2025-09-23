(function(){
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

  function sanitizeColor(input){
    const def = '#25d366'; // 預設綠
    if (typeof input !== 'string') return def;
    const s = input.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
    if (/^rgba?\((\s*\d+\s*,){2}\s*\d+(\s*,\s*(0|0?\.\d+|1))?\)$/.test(s)) return s;
    return def;
  }

  function normalizePos(p){ return (p === 'bottom-left') ? 'bottom-left' : 'bottom-right'; }

  onReady(function(){
    try{
      const S = getLoaderScript();
      if (!S) { console.error('[ai-helper] 找不到載入器 <script>。'); return; }

      const cfg = {
        widget:      'http://ec2-13-213-0-131.ap-southeast-1.compute.amazonaws.com:3000/widget',
        endpoint:    'http://ec2-13-213-0-131.ap-southeast-1.compute.amazonaws.com:3000/query',
        placeholder: '輸入訊息給AI客服…',
        position:    normalizePos('bottom-right'),
        accent:      sanitizeColor(S.getAttribute('data-accent') || '#0055ff'),
        site:        S.getAttribute('data-site')  || '',
        width:       Math.max(240, parseInt(S.getAttribute('data-width') || '360', 10) || 360),
        height:      Math.max(320, parseInt(S.getAttribute('data-height') || '520', 10) || 520),
        z:           String(S.getAttribute('data-z') || '2147483000'),
      };

      const widgetURL = toAbsURL(cfg.widget);
      if (!widgetURL) { console.error('[ai-helper] data-widget URL 非法或缺失。'); return; }
      const widgetOrigin = new URL(widgetURL).origin;

      // 宿主容器
      const host = document.createElement('div');
      host.style.all = 'initial';
      host.style.position = 'fixed';
      host.style.bottom = '20px';
      host.style[cfg.position === 'bottom-left' ? 'left' : 'right'] = '20px';
      host.style.zIndex = cfg.z;
      (document.body || document.documentElement).appendChild(host);

      const shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host; // 退化處理

      // 樣式
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

      // 浮動按鈕（FAB）
      const fab = document.createElement('button');
      fab.className = 'fab';
      fab.setAttribute('aria-label', '打開 AI Support');
      fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';

      // 面板 + iframe（不再加入右上角 X）
      const panel = document.createElement('div');
      panel.className = 'panel';

      const url = new URL(widgetURL);
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

      // 仍保留 ESC 可關閉（無 X 但有鍵盤可用性）
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.style.display === 'block') close(); });

      // 僅接受來自 widget 的安全訊息（高度自適應等）
      window.addEventListener('message', (ev) => {
        try{
          if (!ev || !ev.data) return;
          if (ev.origin !== widgetOrigin) return; // 僅允許 widget 原點
          const msg = ev.data;
          if (msg.type === 'ai-helper:resize' && typeof msg.height === 'number') {
            const h = Math.max(320, Math.min(900, msg.height));
            panel.style.height = h + 'px';
          }
        }catch(_){ /* ignore */ }
      });
    }catch(err){
      console.error('[ai-helper] 初始化失敗：', err);
    }
  });
})();

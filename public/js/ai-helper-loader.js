/*
  ai-helper-loader.js — iframe 版載入器（穩定版 v2）
  修正/強化：
  - 兼容 document.currentScript 可能為 null（async/動態插入）
  - DOM Ready 後再掛載，避免 head 早期執行出錯
  - 檢查並正規化參數（URL/顏色/尺寸/位置）
  - 僅接受來自 widget 原點的 postMessage（安全）
  - 在不支援 Shadow DOM 的環境自動退化

  必填 data-*：
  - data-widget   ：你的 widget.html 完整或相對 URL
  推薦 data-*：
  - data-endpoint ：你的 /query API
  - data-title    ：面板標題
  - data-placeholder ：輸入框提示
  - data-position ：bottom-right | bottom-left（預設 bottom-right）
  - data-accent   ：主色（#0055ff） 允許 #RRGGBB / rgb()/rgba()
  - data-brand    ：副標文字
  - data-width    ：面板寬（預設 340）
  - data-height   ：面板高（預設 520）
  - data-z        ：z-index（預設 2147483000）
*/
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
    const def = '#0055ff';
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
        title:       'AI 小幫手',
        placeholder: '請輸入您的問題…',
        position:    normalizePos(S.getAttribute('data-position') || 'bottom-right'),
        accent:      sanitizeColor(S.getAttribute('data-accent') || '#0055ff'),
        brand:       S.getAttribute('data-brand') || '',
        site:        S.getAttribute('data-site')  || '',
        width:       Math.max(240, parseInt(S.getAttribute('data-width') || '340', 10) || 340),
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
        *,*::before,*::after{ box-sizing:border-box; font-family: Arial, sans-serif; }
        .fab{ width:56px; height:56px; border:0; border-radius:50%; background:${cfg.accent}; color:#fff; cursor:pointer; box-shadow:0 6px 20px rgba(0,0,0,.15); display:inline-flex; align-items:center; justify-content:center; }
        .fab:active{ transform: translateY(1px); }
        .panel{ position:fixed; bottom:90px; ${cfg.position === 'bottom-left' ? 'left' : 'right'}:20px; width:${cfg.width}px; height:${cfg.height}px; background:#fff; border-radius:14px; box-shadow:0 10px 40px rgba(0,0,0,.18); overflow:hidden; display:none; }
        .close{ position:absolute; top:6px; ${cfg.position === 'bottom-left' ? 'left' : 'right'}:8px; background:rgba(0,0,0,.06); border:0; border-radius:8px; padding:4px 8px; cursor:pointer; }
        iframe{ width:100%; height:100%; border:0; display:block; }
        @media (max-width: 480px){ .panel{ width:92vw; height:70vh; ${cfg.position === 'bottom-left' ? 'left' : 'right'}:4vw; bottom:82px; } }
      `;
      shadow.appendChild(style);

      // FAB
      const fab = document.createElement('button');
      fab.className = 'fab';
      fab.setAttribute('aria-label', cfg.title);
      fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';

      // 面板 + iframe
      const panel = document.createElement('div');
      panel.className = 'panel';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'close';
      closeBtn.textContent = '×';
      closeBtn.setAttribute('aria-label','關閉');

      const url = new URL(widgetURL);
      url.searchParams.set('title', cfg.title);
      url.searchParams.set('placeholder', cfg.placeholder);
      url.searchParams.set('accent', cfg.accent);
      url.searchParams.set('brand', cfg.brand);
      url.searchParams.set('endpoint', cfg.endpoint);

      const frame = document.createElement('iframe');
      frame.src = url.toString();
      frame.allow = 'clipboard-write';
      frame.setAttribute('title', cfg.title);

      panel.appendChild(closeBtn);
      panel.appendChild(frame);
      shadow.appendChild(panel);
      shadow.appendChild(fab);

      function open(){ panel.style.display = 'block'; try{ frame.contentWindow && frame.focus(); }catch(_){} }
      function close(){ panel.style.display = 'none'; }

      fab.addEventListener('click', () => { panel.style.display === 'block' ? close() : open(); });
      closeBtn.addEventListener('click', close);
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

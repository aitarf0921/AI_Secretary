/*
  widget.js — iframe 小幫手（穩定版 v2）
  改善點：
  - 更穩健的初始化（DOM Ready 保護）
  - 兼容三種回應：JSON（{answer}）、純文字、串流（SSE / NDJSON）
  - 串流模式邊收邊顯，並持續回報高度給父頁面（loader）
  - 更友善的錯誤顯示與防呆（避免重複送出、空字串等）
*/
(function(){
  function onReady(fn){
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  onReady(function(){
    const qs = new URLSearchParams(location.search);
    const title = qs.get('title') || 'AI 小幫手';
    const placeholder = qs.get('placeholder') || '請輸入您的問題…';
    const accent = qs.get('accent') || '#0055ff';
    const brand = qs.get('brand') || 'AI 小幫手';
    const endpoint = qs.get('endpoint') || '/query';
    const site = qs.get('site') || '';

    // 應用 UI 文案 / 主題色
    document.documentElement.style.setProperty('--accent', accent);
    const titleEl = document.getElementById('title');
    if (titleEl) titleEl.textContent = title;
    const brandEl = document.getElementById('brand');
    if (brand && brandEl){ brandEl.style.display = 'block'; brandEl.textContent = brand; }

    const input = document.getElementById('q');
    const chat = document.getElementById('chat');
    const sendBtn = document.getElementById('send');
    if (input) input.placeholder = placeholder;

    function resizeNotify(){
      try{ parent.postMessage({ type: 'ai-helper:resize', height: document.body.scrollHeight }, '*'); }catch(_){/* ignore */}
    }

    function appendMsg(role, text){
      const wrap = document.createElement('div');
      wrap.className = 'msg';
      const who = document.createElement('div');
      who.className = 'role ' + (role === 'user' ? 'user' : 'ai');
      who.textContent = role === 'user' ? '你' : 'AI';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      wrap.appendChild(who);
      wrap.appendChild(bubble);
      chat.appendChild(wrap);
      chat.scrollTop = chat.scrollHeight;
      requestAnimationFrame(resizeNotify);
      return bubble; // 回傳泡泡，串流時可更新內容
    }

    function setLoading(loading){
      if (sendBtn) sendBtn.disabled = loading;
      if (input) input.disabled = loading;
    }

    // 將文字追加到同一個氣泡（用於串流）
    function appendToBubble(bubble, chunk){
      if (!bubble) return;
      bubble.textContent = bubble.textContent + chunk;
      chat.scrollTop = chat.scrollHeight;
      requestAnimationFrame(resizeNotify);
    }

    // 解析 SSE：以 "\n\n" 做事件邊界，抽出以 "data:" 開頭的行
    async function consumeSSE(res, bubble){
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while(true){
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\n\n/);
        buffer = parts.pop() || '';
        for (const evt of parts){
          const lines = evt.split(/\n/);
          for (const line of lines){
            if (line.startsWith('data:')){
              const payload = line.slice(5).trimStart();
              if (payload === '[DONE]' || payload === '__DONE__') return; // 結束信號（習慣用法）
              appendToBubble(bubble, payload);
            }
          }
        }
      }
    }

    // 解析 NDJSON（每行一個 JSON 或純文字）
    async function consumeNDJSON(res, bubble){
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while(true){
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while((idx = buffer.indexOf('\n')) >= 0){
          const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1);
          const trimmed = line.trim();
          if (!trimmed) continue;
          try{
            const obj = JSON.parse(trimmed);
            const s = obj.answer || obj.delta || obj.text || obj.data || trimmed;
            appendToBubble(bubble, String(s));
          }catch(_){
            appendToBubble(bubble, trimmed);
          }
        }
      }
    }

    async function send(){
      const q = (input && input.value || '').trim();
      if (!q) return;
      const userBubble = appendMsg('user', q);
      if (input) input.value = '';
      setLoading(true);

      // 先放一個空的 AI 氣泡，之後可串流累加
      const aiBubble = appendMsg('ai', '');

      try{
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, site })
        });

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok){
          const errText = await res.text().catch(()=>'');
          const msg = errText || `HTTP ${res.status}`;
          appendToBubble(aiBubble, `抱歉，出錯了：${msg}`);
          return;
        }

        if (res.body && (ct.includes('text/event-stream'))){
          await consumeSSE(res, aiBubble);
          return;
        }
        if (res.body && (ct.includes('ndjson') || ct.includes('jsonl'))){
          await consumeNDJSON(res, aiBubble);
          return;
        }

        // 一般 JSON 或純文字
        if (ct.includes('application/json')){
          const data = await res.json().catch(()=>({}));
          const answer = data.answer || data.result || data.message || data.error || '';
          appendToBubble(aiBubble, answer ? String(answer) : '（無內容）');
        } else {
          const text = await res.text().catch(()=> '');
          appendToBubble(aiBubble, text ? text : '（無內容）');
        }
      }catch(e){
        appendToBubble(aiBubble, '抱歉，出錯了！');
      }finally{
        setLoading(false);
      }
    }

    if (sendBtn) sendBtn.addEventListener('click', send);
    if (input) input.addEventListener('keypress', (e) => { if (e.key === 'Enter') send(); });

    setTimeout(() => { try{ input && input.focus(); }catch(_){} }, 0);
  });
})();

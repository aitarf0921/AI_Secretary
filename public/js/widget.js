/*
  widget.js — 精簡對話樣式（不顯示角色標籤） + 打字中（三條小長條）+ RWD
  - 支援 JSON（{answer}）、純文字、SSE、NDJSON
  - 送出後顯示「AI 正在輸入…」的條狀動畫，直到接到回覆為止
*/
(function(){
  function onReady(fn){
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  onReady(function(){
    const qs = new URLSearchParams(location.search);
    const placeholder = qs.get('placeholder') || '輸入訊息給 AI 客服…';
    const accent = qs.get('accent') || '#10b981';
    const endpoint = qs.get('endpoint') || '/query';
    const site = qs.get('site') || '';

    document.documentElement.style.setProperty('--accent', accent);

    const chat = document.getElementById('chat');
    const input = document.getElementById('q');
    const sendBtn = document.getElementById('send');
    if (input) input.placeholder = placeholder;

    let typingEl = null;

    function resizeNotify(){
      try{ parent.postMessage({ type: 'ai-helper:resize', height: document.body.scrollHeight }, '*'); }catch(_){}
    }

    // 建立訊息（不顯示角色標籤）
    function appendMsg(role, text){
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + (role === 'user' ? 'user' : 'ai');

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;

      wrap.appendChild(bubble);
      chat.appendChild(wrap);
      chat.scrollTop = chat.scrollHeight;
      requestAnimationFrame(resizeNotify);
      return bubble;
    }

    function showTyping(){
      if (typingEl) return;
      const wrap = document.createElement('div');
      wrap.className = 'msg ai typing';

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.innerHTML = '<span class="bar"></span><span class="bar"></span><span class="bar"></span>';

      wrap.appendChild(bubble);
      chat.appendChild(wrap);
      chat.scrollTop = chat.scrollHeight;
      typingEl = wrap;
      requestAnimationFrame(resizeNotify);
    }
    function clearTyping(){
      if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
      typingEl = null;
      requestAnimationFrame(resizeNotify);
    }

    function setLoading(loading){
      if (sendBtn) sendBtn.disabled = loading;
      if (input) input.disabled = loading;
    }

    function appendToBubble(bubble, chunk){
      if (!bubble) return;
      bubble.textContent = bubble.textContent + chunk;
      chat.scrollTop = chat.scrollHeight;
      requestAnimationFrame(resizeNotify);
    }

    async function consumeSSE(res, bubble){
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while(true){
        const { value, done } = await reader.read();
        if (done) break;
        if (typingEl) clearTyping();

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\n\n/);
        buffer = parts.pop() || '';
        for (const evt of parts){
          const lines = evt.split(/\n/);
          for (const line of lines){
            if (line.startsWith('data:')){
              const payload = line.slice(5).trimStart();
              if (payload === '[DONE]' || payload === '__DONE__') return;
              appendToBubble(bubble, payload);
            }
          }
        }
      }
    }

    async function consumeNDJSON(res, bubble){
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while(true){
        const { value, done } = await reader.read();
        if (done) break;
        if (typingEl) clearTyping();

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

      appendMsg('user', q);
      input.value = '';
      setLoading(true);
      showTyping(); // 顯示 AI 正在輸入…

      let aiBubble = null;

      try{
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, site })
        });

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok){
          clearTyping();
          const errText = await res.text().catch(()=> '');
          appendMsg('ai', `抱歉，出錯了：${errText || ('HTTP ' + res.status)}`);
          return;
        }

        clearTyping();
        aiBubble = appendMsg('ai', '');

        if (res.body && (ct.includes('text/event-stream'))){
          await consumeSSE(res, aiBubble);
          return;
        }
        if (res.body && (ct.includes('ndjson') || ct.includes('jsonl'))){
          await consumeNDJSON(res, aiBubble);
          return;
        }

        if (ct.includes('application/json')){
          const data = await res.json().catch(()=> ({}));
          const answer = data.answer || data.result || data.message || data.error || '';
          appendToBubble(aiBubble, answer ? String(answer) : '（無內容）');
        } else {
          const text = await res.text().catch(()=> '');
          appendToBubble(aiBubble, text ? text : '（無內容）');
        }
      }catch(e){
        clearTyping();
        appendMsg('ai', '抱歉，出錯了！');
      }finally{
        setLoading(false);
      }
    }

    if (sendBtn) sendBtn.addEventListener('click', send);
    if (input) input.addEventListener('keypress', (e) => { if (e.key === 'Enter') send(); });

    setTimeout(() => { try{ input && input.focus(); }catch(_){} }, 0);
  });
})();

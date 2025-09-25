const helmet = require('koa-helmet');
const http = require('http');
const Koa = require('koa');
const views = require('koa-views');
const cors = require('koa2-cors');
const Router = require('koa-router');
const json = require('koa-json');
const bodyParser = require('koa-bodyparser');
const RateLimit = require('koa2-ratelimit').RateLimit;
const staticServe = require('koa-static');
const sanitizeHtml = require('sanitize-html');
const cache = require('memory-cache');
const path = require('path');

const app = new Koa();
const router = new Router();

// ====== 環境設定 ======
const PORT = 3000;
// 允許第三方嵌入 widget 的網域（逗號分隔）。例如： "https://a.com,https://b.com"
const ALLOWED_EMBED_ORIGINS = (process.env.ALLOWED_EMBED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
// CORS 白名單（允許呼叫 /query 的網域；可與上面同值或不同）
const CORS_WHITELIST = (process.env.CORS_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean);

// ====== 啟動流程 ======
require("./start")().then(() => {

  app.proxy = true;

  // Helmet 全域安全（先用安全預設）
  app.use(helmet({
    // 預設 frameguard: SAMEORIGIN，會擋 iframe。先關閉，改用 CSP frame-ancestors 在下方微調
    frameguard: false
  }));

  // 針對 widget.html 設 frame-ancestors 白名單（允許被哪些站點 iframe）
  app.use(async (ctx, next) => {
    await next();

    // 只對 widget.html（或自訂 widget 路徑）設定開放規則
    // 假設你的 widget.html 對外 URL 為 /widget.html（放在 /public/widget.html）
    if (ctx.path === '/widget.html') {
      // 如果未設定白名單，預設允許任何站點嵌入（你也可以改為僅允許同源）
      if (ALLOWED_EMBED_ORIGINS.length === 0) {
        // 開放所有（風險較高；建議正式環境設定白名單）
        ctx.set('Content-Security-Policy', `frame-ancestors *`);
      } else {
        ctx.set('Content-Security-Policy', `frame-ancestors ${ALLOWED_EMBED_ORIGINS.join(' ')}`);
      }
      // 移除 X-Frame-Options（避免被上一層/Proxy 插入）
      ctx.set('X-Frame-Options', 'ALLOWALL');
    }
  });

  // 解析 JSON Body（適度提高限制，避免過早 413）
  app.use(bodyParser({
    enableTypes: ['json'],
    jsonLimit: '1mb'
  }));

  app.use(json());

  // 靜態資源：提供 /public 下的檔案（含 widget.html、widget.js、ai-helper-loader.js）
  app.use(staticServe(path.join(__dirname, 'public'), {
    // 你可以視需要加上快取控制
    maxage: 1000 * 60 * 5, // 5 分鐘
  }));

  // 範例視圖（如不需要可移除）
  app.use(views(path.join(__dirname, 'views'), {
    extension: 'html',
    map: { html: 'ejs' }
  }));

  // Rate limit（每分鐘最多 1 萬次；可調小）
  const limiter = RateLimit.middleware({
    interval: { min: 1 },
    max: 10000,
  });
  app.use(limiter);

  // CORS：允許第三方網站呼叫 /query
  app.use(cors({
    origin:'*',
    allowHeaders: ['Content-Type'],
    exposeHeaders: [],
    credentials: false, // 若要帶 cookie，必須改為 true、且 origin 不能是 *（要回傳具體來源）
    methods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204
  }));

  // 健康檢查
  router.get('/healthz', async (ctx) => {
    ctx.status = 200;
    ctx.body = { ok: true };
  });

  // 首頁（可有可無）
  router.get('/', async (ctx) => {
    ctx.status = 200;
    await ctx.render('index');
  });

  router.get('/widget', async (ctx) => {
    ctx.status = 200;
    await ctx.render('widget');
  });

  // 供 widget.js 呼叫的 AI 端點
  router.options('/query', (ctx) => { ctx.status = 204; }); // 額外保險的預檢處理
  router.post('/query', async (ctx) => {

    console.log('query');
    try {
      const { query, site } = ctx.request.body || {};

      console.log('site',site);

      // 針對 AWS CloudFront/CDN 優化 IP 擷取：優先 X-Forwarded-For 的第一個 IP（客戶端 IP），支援 IPv4/IPv6
      let forwardedFor = ctx.get('X-Forwarded-For');
      let ip;
      if (forwardedFor) {
        // 取第一個 IP（CloudFront 會把客戶端 IP 放在最前面）
        ip = forwardedFor.split(',')[0].trim();
      } else {
        // 後備：X-Real-IP 或 ctx.ip
        ip = ctx.get('X-Real-IP') || ctx.ip || 'unknown';
      }




      console.log('ip',ip);

      if (!query || typeof query !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'Query is required' };
        return;
      }

      if (!site || typeof site !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'Query is required' };
        return;
      }

      // 清理輸入，避免 XSS 等
      const cleanQuery = sanitizeHtml(query.trim(), { allowedTags: [], allowedAttributes: {} });
      if (!cleanQuery) {
        ctx.status = 400;
        ctx.body = { error: 'Query is empty' };
        return;
      }

      // 簡單快取（1 小時）
      const cacheKey = `${site}:${cleanQuery}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        ctx.status = 200;
        ctx.body = { answer: cached };
        return;
      }

      // 呼叫你的 LLM / Prompt 程式（保持你的寫法）
      const answer = await require('./prompt')(cleanQuery);

      // 萬一 answer 不是字串，做個保護
      const safeAnswer = (typeof answer === 'string') ? answer : String(answer ?? '');



      cache.put(cacheKey, safeAnswer, 3600000*24*24);
      ctx.status = 200;
      ctx.body = { answer: safeAnswer };

    } catch (e) {
      console.error('[QUERY ERROR]', e);
      // 回傳 JSON 錯誤，讓 widget.js 可以顯示
      ctx.status = 500;
      ctx.body = { error: 'Internal Server Error' };
    }
  });

  app.use(router.routes()).use(router.allowedMethods());

  http.createServer(app.callback()).listen(PORT);

});

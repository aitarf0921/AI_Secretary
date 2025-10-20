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
const AWS = require('aws-sdk');
const CryptoJS = require('crypto-js');

const ses = new AWS.SES({ region: 'ap-southeast-1' });

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

  app.use(async (ctx, next) => {

    if (ctx.path === '/nowpayments-ipn') {
        const hasSignature = ctx.get('x-nowpayments-sig');
        if (hasSignature) {
            console.log('NOWPayments IPN allowed via signature check'); // 加 log 確認
            return await next(); // 允許通過
        } else {
            console.log('Invalid NOWPayments IPN request: No signature');
            ctx.status = 403;
            ctx.body = { error: 'Forbidden: No signature' };
            return;
        }
    }

    const token = ctx.get('X-Origin-Verify');
    // 注意：這裡做簡單相等比較即可；如需更嚴謹可實作 constant-time compare
    if (!token || token !== 'aitarf') {
      ctx.status = 403;
      ctx.body = { error: 'Forbidden' };
      return;
    }
    await next();
  });

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

  const limiter = RateLimit.middleware({
    interval: { min: 1 },
    max: 60*10,
  });

  const queryLimiter = RateLimit.middleware({
    interval: { sec: 1 },
    max: 1,
    keyGenerator: (ctx) => ctx.get('CF-Connecting-IP') || ctx.ip,
    message: 'Too many requests',
  });

  app.use(limiter);

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

  app.use(views(path.join(__dirname, 'views'), {
    extension: 'html',
    map: { html: 'ejs' }
  }));


  // CORS：允許第三方網站呼叫 /query
  app.use(cors({
    origin:'*',
    allowHeaders: ['Content-Type'],
    exposeHeaders: [],
    credentials: false, // 若要帶 cookie，必須改為 true、且 origin 不能是 *（要回傳具體來源）
    methods: ['GET', 'POST'],
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204
  }));

  router.get('/', async (ctx) => {
    ctx.status = 200;
    await ctx.render('index');
  });

  router.get('/widget', async (ctx) => {
    ctx.status = 200;
    await ctx.render('widget');
  });

  router.post('/email',queryLimiter, async (ctx) => {
      ctx.status = 200;
      const { email } = ctx.request.body;

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(email)) {
        ctx.body = { code: '0' };
        return;
      }

      const cacheKey = `email:${email}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        ctx.body = { code: '2' };
        return;
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      const message = `
      To complete your registration with AI Chatbot, use this verification code:

      Verification Code: ${otp}

      For security purposes, do not share this code. If you did not request this, please ignore this email.

      Note: This is an automated message. Please do not reply.

      Regards,
      The AI Chatbot Support Team`.trim();

      try {
          await ses.sendEmail({
              Destination: { ToAddresses: [email] }, // 允許發送給未驗證的 Email 地址
              Message: {
                  Body: { Text: { Data: message } }, // 郵件正文，包含訊息
                  Subject: { Data: `Verification Code for AI Chatbot` } // 郵件標題
              },
              Source: 'contact-us@aitarf.us' // 寄件者 Email，需替換為已驗證的地址
          }).promise();
          cache.put(cacheKey, otp, 65000);
          ctx.body = { code: '1' };
      } catch (err) {
        ctx.body = { code: '0' };
      }
  });

  // 新增路由：驗證 OTP
    router.post('/verify-code',queryLimiter, async (ctx) => {
      ctx.status = 200;
      const { email, code } = ctx.request.body;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !code || !emailRegex.test(email)) {
        ctx.body = { code: '2' };
        return;
      }

      const cacheKey = `email:${email}`;

      const otp = cache.get(cacheKey);
      if (!otp) {
        console.log('Code expired or not found');
        ctx.body = { code: '0' };
        return;
      }
      if (otp !== code) {
        console.log(`otp:${otp} code:${code}`)
        console.log('Code error');
        ctx.body = { code: '0' };
        return;
      }
      const check = await Lib.mongoDB.Client.collection('ai_secretary')
  		.findOne({ 'email':`${email}` })
  		.then(d=>d);

      let knowledgeContext = '';

      if(!check){
        const siteId = require("./Fn/grp")();
       	await Lib.mongoDB.Client.collection('ai_secretary')
    		.insertOne({
       	'email':`${email}`,
   			'siteId':siteId,
   			'knowledgeContext':'',
   			'creatTime':new Date(),
    		}).then(d=>d);
      }else{
        knowledgeContext = check.knowledgeContext;
      }

      cache.del(cacheKey);
      ctx.body = { code: '1',knowledgeContext:knowledgeContext };
    });


    router.post('/site-id',queryLimiter, async (ctx) => {
      console.log('site-id');
      ctx.status = 200;
      const { email, knowledge } = ctx.request.body;

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!email || !emailRegex.test(email)) {
        ctx.body = { code: '0', message: 'Invalid email' };
        return;
      }
      if (!knowledge || knowledge.trim().length < 20) {
        ctx.body = { code: '0' };
        return;
      }

      const check = await Lib.mongoDB.Client.collection('ai_secretary')
  		.findOne({ 'email':`${email}` })
  		.then(d=>d);

      if(!check){
        ctx.body = { code: '0', message: 'Invalid email' };
        return;
      }

      await Lib.mongoDB.Client.collection("ai_secretary")
        .updateOne(
          {
            '_id':check._id
          },
          {
            $set: {
              'knowledgeContext':knowledge
            },
          },
        );

      ctx.body = { siteId:check.siteId,code: '3' };
      // ctx.body = { siteId:check.siteId };

    });

    router.post('/nowpayments-ipn', async (ctx) => {
        ctx.status = 200;
        const receivedSig = ctx.get('x-nowpayments-sig');
        const body = ctx.request.body;

      console.log('nowpayments-ipn');

        // 驗證 IPN 簽名
        const sortedBody = JSON.stringify(body, Object.keys(body).sort());
        const pen_key = 'nGL2B9c9JxKzjGh7iqc9d6KO474y1VFj';
        const computedSig = CryptoJS.HmacSHA512(sortedBody, pen_key).toString(CryptoJS.enc.Hex);

        if (receivedSig !== computedSig) {
            console.log('Invalid IPN signature');
            ctx.status = 401;
            ctx.body = { error: 'Invalid signature' };
            return;
        }

        // 提取付款資料
        const {
            payment_id,
            payment_status,
            price_amount,
            pay_currency,
            order_id,
            payee_email,
            ip_address
        } = body;

        if (!payee_email || !payment_id || !payment_status) {
            console.log('Missing required fields');
            ctx.status = 400;
            ctx.body = { error: 'Missing required fields' };
            return;
        }

      console.log('nowpayments-ipn',JSON.stringify(body));
      ctx.body = 'OK';

        // try {
        //     // 查找對應的 siteId
        //     const user = await Lib.mongoDB.Client.collection('ai_secretary')
        //         .findOne({ email: payee_email });

        //     if (!user) {
        //         console.log('User not found for email:', payee_email);
        //         ctx.status = 400;
        //         ctx.body = { error: 'User not found' };
        //         return;
        //     }

        //     // 儲存捐款記錄
        //     await Lib.mongoDB.Client.collection('donations').insertOne({
        //         email: payee_email,
        //         siteId: user.siteId,
        //         paymentId: payment_id,
        //         amount: price_amount,
        //         currency: pay_currency,
        //         status: payment_status,
        //         ipAddress: ip_address,
        //         createdAt: new Date()
        //     });

        //     console.log(`Donation recorded: ${payee_email}, ${payment_id}, ${payment_status}`);
        //     ctx.status = 200;
        //     ctx.body = 'OK';
        // } catch (err) {
        //     console.error('IPN processing error:', err);
        //     ctx.status = 500;
        //     ctx.body = { error: 'Internal Server Error' };
        // }
    });

  router.post('/query', queryLimiter,async (ctx) => {

    console.log('query');
    ctx.status = 200;

    try {
      const { query, site } = ctx.request.body || {};

      console.log('site',site);

      console.log('clientIP',ctx.ip);

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


      const cacheKey = `${site}:${cleanQuery}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        ctx.status = 200;
        ctx.body = { answer: cached };
        return;
      }

      const knowledge= await Lib.mongoDB.Client.collection('ai_secretary')
  		.findOne({	'siteId':`${site}`	})
  		.then(d=>d);

      if(!knowledge || !knowledge.knowledgeContext || knowledge.knowledgeContext.length == 0){
        ctx.status = 400;
        ctx.body = { error: 'Query is required' };
        return;
      }

      console.log(`knowledge.knowledgeContext`,knowledge.knowledgeContext);

      // 呼叫你的 LLM / Prompt 程式（保持你的寫法）
      const answer = await require('./prompt')(cleanQuery,knowledge.knowledgeContext);

      // 萬一 answer 不是字串，做個保護
      const safeAnswer = (typeof answer === 'string') ? answer : String(answer ?? '');



      cache.put(cacheKey, safeAnswer, 3600000*24*24);
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

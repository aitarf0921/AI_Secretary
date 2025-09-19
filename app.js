// app.js
'use strict';

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

const {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
} = require('@aws-sdk/client-bedrock-agent-runtime');

const app = new Koa();
const router = new Router();

/** ===== 基本設定（可用環境變數覆寫） ===== */
const region = process.env.AWS_REGION || 'us-east-1';
const knowledgeBaseId = process.env.KB_ID || 'CXPSZMAOXM';
const port = Number(process.env.PORT || 3000);

// ✅ 使用「模型 ID」而非 ARN（且放在 knowledgeBaseConfiguration 內）
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'arn:aws:aoss:us-east-1:688538633553:collection/y95dgm9q0su5aqf9d2v5';

/** ===== 建立 Bedrock Agent Runtime Client ===== */
const bedrockClient = new BedrockAgentRuntimeClient({ region });

/** ===== Koa Middlewares ===== */
app.proxy = true;
app.use(helmet());
app.use(bodyParser({ enableTypes: ['json', 'form'], jsonLimit: '1mb' }));
app.use(json());
app.use(staticServe(__dirname + '/public'));
app.use(views(__dirname + '/views', { extension: 'html', map: { html: 'ejs' } }));

const limiter = RateLimit.middleware({ interval: { min: 1 }, max: 10000 });
app.use(limiter);

app.use(
  cors({
    origin: '*',
    methods: 'GET,POST,OPTIONS',
    credentials: true,
    preflightContinue: false,
    maxAge: 5,
  })
);

/** ===== Routes ===== */
router.get('/', async (ctx) => {
  ctx.status = 200;
  await ctx.render('index');
});

router.post('/query', async (ctx) => {
  const { query } = ctx.request.body || {};
  if (!query || typeof query !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'Query is required' };
    return;
  }

  const cleanQuery = sanitizeHtml(query.trim(), { allowedTags: [], allowedAttributes: {} });
  if (!cleanQuery) {
    ctx.status = 400;
    ctx.body = { error: 'Query is empty after sanitization' };
    return;
  }

  // 簡單快取（1 小時）
  const cacheKey = `query:${cleanQuery}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    ctx.status = 200;
    ctx.body = { answer: cached, cached: true };
    return;
  }

  try {
    // ✅ 最小可行結構：KB 模式 + 內層使用模型「ID」
    const params = {
      input: { text: cleanQuery },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId,
          modelArn: MODEL_ID, // ← 注意：這裡放「模型 ID」不是 ARN
        },
      },
    };

    const resp = await bedrockClient.send(new RetrieveAndGenerateCommand(params));
    const answer = resp?.output?.text || '（知識庫沒有找到可用內容）';

    cache.put(cacheKey, answer, 60 * 60 * 1000);
    ctx.status = 200;
    ctx.body = { answer, modelIdUsed: MODEL_ID, cached: false };
  } catch (error) {
    console.error('Bedrock RetrieveAndGenerate error ->', {
      name: error?.name,
      message: error?.message,
      metadata: error?.$metadata,
    });
    ctx.status = 500;
    ctx.body = { error: 'Failed to process query', code: error?.name || 'BedrockError' };
  }
});

app.use(router.routes()).use(router.allowedMethods());

http.createServer(app.callback()).listen(port, () => {
  console.log(`Dinosaur AI Helper started on port ${port}`);
  console.log(`Region: ${region}`);
  console.log(`KB ID : ${knowledgeBaseId}`);
  console.log(`Model : ${MODEL_ID} (model ID, not ARN)`);
});

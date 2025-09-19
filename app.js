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

/** ===== 基本設定 ===== */
const region = process.env.AWS_REGION || 'us-east-1'; // 確認 KB 與 S3 都在這區
const knowledgeBaseId = process.env.KB_ID || 'CXPSZMAOXM'; // 你的 KB ID
const port = Number(process.env.PORT || 3000);

// ✅ Claude 3 Haiku (us-east-1) → 成本最低且支援 KB
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

// 建立 Bedrock Agent Runtime Client
const bedrockClient = new BedrockAgentRuntimeClient({ region });

/** ===== Koa Middlewares ===== */
app.proxy = true;
app.use(helmet());
app.use(bodyParser({ enableTypes: ['json', 'form'], jsonLimit: '1mb' }));
app.use(json());
app.use(staticServe(__dirname + '/public'));
app.use(views(__dirname + '/views', { extension: 'html', map: { html: 'ejs' } }));
app.use(RateLimit.middleware({ interval: { min: 1 }, max: 10000 }));
app.use(cors({ origin: '*', methods: 'GET,POST,OPTIONS', credentials: true }));

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

  const cacheKey = `query:${cleanQuery}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    ctx.status = 200;
    ctx.body = { answer: cached, cached: true };
    return;
  }

  try {
    const params = {
      input: { text: cleanQuery },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId,
          modelArn: MODEL_ID, // ✅ 使用 Claude 3 Haiku
          retrievalConfiguration: {
            vectorSearchConfiguration: { numberOfResults: 4 }, // 建議 4~8
          },
          generationConfiguration: {
            promptTemplate: {
              textPromptTemplate: `你是一個恐龍歷史 AI 小幫手，回答必須嚴格根據知識庫內容：
$search_results$

問題：$query$
請用繁體中文簡潔回答：`,
            },
          },
        },
      },
    };

    const resp = await bedrockClient.send(new RetrieveAndGenerateCommand(params));
    const answer = resp?.output?.text || '（知識庫沒有找到相關內容）';

    cache.put(cacheKey, answer, 60 * 60 * 1000); // 快取 1 小時
    ctx.status = 200;
    ctx.body = { answer, cached: false, modelIdUsed: MODEL_ID };
  } catch (error) {
    console.error('Bedrock RetrieveAndGenerate error ->', {
      name: error?.name,
      message: error?.message,
      httpStatus: error?.$metadata?.httpStatusCode,
    });
    ctx.status = 500;
    ctx.body = { error: 'Failed to process query', code: error?.name || 'BedrockError' };
  }
});

app.use(router.routes()).use(router.allowedMethods());

http.createServer(app.callback()).listen(port, () => {
  console.log(`🚀 Dinosaur AI Helper started on http://localhost:${port}`);
  console.log(`📍 Region: ${region}`);
  console.log(`📚 KB ID : ${knowledgeBaseId}`);
  console.log(`🤖 Model : ${MODEL_ID}`);
});

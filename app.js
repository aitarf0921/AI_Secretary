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
const region = 'us-east-1';
const knowledgeBaseId = 'CXPSZMAOXM';

// 成本最低 & 支援 KB 的模型（us-east-1）
const modelArn = 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0';

const port = 3000;

/** ===== Bedrock Agent Runtime Client ===== */
const bedrockClient = new BedrockAgentRuntimeClient({ region });

/** ===== Koa Middlewares ===== */
app.proxy = true;
app.use(helmet());
app.use(bodyParser());
app.use(json());
app.use(staticServe(__dirname + '/public'));
app.use(views(__dirname + '/views', { extension: 'html', map: { html: 'ejs' } }));

const limiter = RateLimit.middleware({ interval: { min: 1 }, max: 10000 });
app.use(limiter);

app.use(
  cors({
    origin: '*',
    methods: 'GET,POST',
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

  const cacheKey = `query:${cleanQuery}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    ctx.status = 200;
    ctx.body = { answer: cached, cached: true };
    return;
  }

  try {
    // **重點：modelArn 與 generationConfiguration 在最外層**
    const params = {
      input: { text: cleanQuery },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId,
          // ※ 必填：放在 knowledgeBaseConfiguration 內
          modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0',
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 6,     // 想更省可以降到 4
            },
          },
          // （可省略）如果你的 KB 有設定「文件/欄位過濾」則在這裡放 filter
          // knowledgeBaseRetrievalConfiguration: { ... }
        },
      },
      // 生成參數放最外層是 OK 的（官方允許）
      generationConfiguration: {
        // maxOutputTokens: 400, // 要更省可以打開
        promptTemplate: {
          textPromptTemplate:
    `你是一個恐龍歷史 AI 小幫手，只能回答與恐龍相關的問題，並嚴格根據知識庫的內容作答。
    以下為與問題最相關的知識：
    $search_results$

    問題：$query$
    請用中文簡潔回答：`,
        },
      },
    };
    const response = await bedrockClient.send(new RetrieveAndGenerateCommand(params));
    const answer = response?.output?.text || '（知識庫沒有找到可用內容）';

    cache.put(cacheKey, answer, 60 * 60 * 1000); // 快取 1 小時
    ctx.status = 200;
    ctx.body = { answer, cached: false };
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


http.createServer(app.callback()).listen(port);

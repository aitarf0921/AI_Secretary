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
const region = process.env.AWS_REGION || 'us-east-1';
const knowledgeBaseId = process.env.KB_ID || 'CXPSZMAOXM';
const port = Number(process.env.PORT || 3000);

// 依序嘗試的模型（由便宜到較貴），你也可用 BEDROCK_MODEL_ARN 覆蓋
const CANDIDATE_MODELS = [
  process.env.BEDROCK_MODEL_ARN, // 若手動指定就用這個（若空會被過濾）
  'arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-text-lite-v1:0',
  'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0',
  'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0',
].filter(Boolean);

const bedrockClient = new BedrockAgentRuntimeClient({ region });

/** ===== Middlewares ===== */
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

  const cacheKey = `query:${cleanQuery}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    ctx.status = 200;
    ctx.body = { answer: cached, cached: true };
    return;
  }

  // 嘗試多個模型直到成功
  let lastErr;
  for (const modelArn of CANDIDATE_MODELS) {
    try {
      const params = {
        input: { text: cleanQuery },
        retrieveAndGenerateConfiguration: {
          type: 'KNOWLEDGE_BASE',
          knowledgeBaseConfiguration: {
            knowledgeBaseId,
            // **重點：modelArn 在 knowledgeBaseConfiguration 內，且必填**
            modelArn,
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: 4, // 更省
              },
            },
          },
        },
        generationConfiguration: {
          // maxOutputTokens: 300, // 如需更省可打開
          promptTemplate: {
            textPromptTemplate:
`你是一個恐龍歷史 AI 小幫手，只能回答與恐龍相關的問題，並嚴格根據知識庫內容作答。
以下為與問題最相關的知識：
$search_results$

問題：$query$
請用中文簡潔回答：`,
          },
        },
        // 可選：對話需要可加 sessionId
        // sessionId: 'kb-demo-session',
      };

      const resp = await bedrockClient.send(new RetrieveAndGenerateCommand(params));
      const answer = resp?.output?.text || '（知識庫沒有找到可用內容）';

      cache.put(cacheKey, answer, 60 * 60 * 1000);
      ctx.status = 200;
      ctx.body = { answer, modelArnUsed: modelArn, cached: false };
      return; // 成功就結束
    } catch (e) {
      lastErr = e;
      // 只做精簡日誌，避免洩漏
      console.error('Bedrock RnG attempt failed =>', {
        modelArnTried: modelArn,
        name: e?.name,
        message: e?.message,
        httpStatus: e?.$metadata?.httpStatusCode,
      });
      // 下一個模型
    }
  }

  // 若全部模型都失敗
  ctx.status = 500;
  ctx.body = {
    error: 'Failed to process query with all candidate models.',
    lastError: {
      name: lastErr?.name,
      message: lastErr?.message,
      httpStatus: lastErr?.$metadata?.httpStatusCode,
    },
    hints: [
      '到 Bedrock Console → Model access，開啟 amazon.titan-text-lite-v1、amazon.nova-lite-v1、anthropic.claude-3-haiku（至少 Titan 或 Nova 其一）',
      '確認 Knowledge Base 狀態為 ACTIVE，資料來源已完成 Sync',
      '區域統一使用 us-east-1（KB、OSSL、S3、程式與 modelArn）',
    ],
  };
});

app.use(router.routes()).use(router.allowedMethods());

http.createServer(app.callback()).listen(port, () => {
  console.log(`Dinosaur AI Helper started on port ${port}`);
  console.log(`Region: ${region}`);
  console.log(`KB ID : ${knowledgeBaseId}`);
  console.log('Model candidates (in order):');
  CANDIDATE_MODELS.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
});

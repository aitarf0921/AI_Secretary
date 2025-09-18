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
const { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } = require('@aws-sdk/client-bedrock-agent-runtime');

const app = new Koa();
const router = new Router();

// 硬編碼環境變數
const region = 'ap-southeast-1'; // 確保與你的 S3 和 Bedrock 區域一致
const knowledgeBaseId = 'S4A4PJIIW2'; // 替換為你的實際 Knowledge Base ID

const bedrockClient = new BedrockAgentRuntimeClient({ region });

app.proxy = true;
app.use(helmet());
app.use(bodyParser());
app.use(json());
app.use(staticServe(__dirname + '/public'));
app.use(views(__dirname + '/views', { extension: 'html', map: { html: 'ejs' } }));

const limiter = RateLimit.middleware({
  interval: { min: 1 },
  max: 10000,
});
app.use(limiter);

app.use(cors({
  origin: '*',
  methods: 'GET,POST',
  credentials: true,
  preflightContinue: false,
  maxAge: 5,
}));

router.get('/', async (ctx) => {
  ctx.status = 200;
  await ctx.render('index');
});

router.post('/query', async (ctx) => {
  const { query } = ctx.request.body;
  if (!query) {
    ctx.status = 400;
    ctx.body = { error: 'Query is required' };
    return;
  }
  const cleanQuery = sanitizeHtml(query.trim(), { allowedTags: [], allowedAttributes: {} });
  const cacheKey = `query:${cleanQuery}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    ctx.body = { answer: cached };
    ctx.status = 200;
    return;
  }
  try {
    const response = await bedrockClient.send(new RetrieveAndGenerateCommand({
      input: { text: cleanQuery },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: knowledgeBaseId,
          modelArn: 'arn:aws:bedrock:ap-southeast-1::foundation-model/anthropic.claude-v2',
          generationConfiguration: {
            promptTemplate: {
              textPromptTemplate: `你是一個恐龍歷史 AI 小幫手，只能回答與恐龍相關的問題。以下是相關內容：
              $search_results$
              問題：$query$
              回答：`
            }
          }
        }
      }
    }));
    const answer = response.output.text;
    cache.put(cacheKey, answer, 3600000); // 快取 1 小時
    ctx.body = { answer };
    ctx.status = 200;
  } catch (error) {
    console.error('Bedrock error:', error);
    ctx.body = { error: 'Failed to process query' };
    ctx.status = 500;
  }
});

app.use(router.routes()).use(router.allowedMethods());

http.createServer(app.callback()).listen(3000, () => {
  console.log('Dinosaur AI Helper started on port 3000');
});

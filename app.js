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

const app = new Koa();
const router = new Router();

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

  ctx.status = 200;

  const cleanQuery = sanitizeHtml(query.trim(), { allowedTags: [], allowedAttributes: {} });
  const cacheKey = `query:${cleanQuery}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    ctx.body = { answer: cached };
    return;
  }
  await require('./prompt')(`${cleanQuery}`)
    .then(answer => {
      cache.put(cacheKey, answer, 3600000); // 快取 1 小時
      ctx.body = { answer };
    })
    .catch(e=>{
      console.log('e', e);
    });

});

app.use(router.routes()).use(router.allowedMethods());

http.createServer(app.callback()).listen(3000);

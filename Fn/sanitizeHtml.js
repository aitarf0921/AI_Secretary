const helmet = require('koa-helmet');
const http = require('http');
const koa = require('koa');
const views = require('koa-views');
const cors = require('koa2-cors');
const app = new koa();
const Router = require('koa-router');
const router = new Router();
const json = require('koa-json');
const bodyParser = require('koa-bodyparser');
const RateLimit = require('koa2-ratelimit').RateLimit;

require("./start")().then(() => {
  app.proxy = true;
  console.log('Da Lue start');

  app.use(helmet());
  app.use(bodyParser());
  app.use(json());

  app.use(require('koa-static')(__dirname + '/public'));
  app.use(views(__dirname + '/views', {
    "extension": 'html'
  }));
  const limiter = RateLimit.middleware({
    interval: { min: 1 },
    max: 10000,
  });

  app.use(limiter);

  app.use(cors({
    'origin': '*',
    'methods': 'GET',
    'credentials': true,
    'preflightContinue': false,
    'maxAge': 5
  }));


  router.get('/', async (ctx) => {
    ctx.status = 200;
    await ctx.render('index');
  });

  app.use(router.routes(), router.allowedMethods());

  http.createServer(app.callback()).listen(3000);
});

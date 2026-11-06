'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Store } = require('./lib/store.cjs');
const { Campaigns, isID } = require('./lib/campaigns.cjs');
const { OpenAIDM, DemoDM } = require('./lib/dm.cjs');
const { AppError } = require('./lib/errors.cjs');
const { BACKGROUNDS, SKILLS } = require('./lib/rules.cjs');
const ROOT = path.resolve(__dirname, '..');
const STATIC = {
  '/adventure/': ['adventure/public/index.html', 'text/html; charset=utf-8'],
  '/adventure/app.js': ['adventure/public/app.js', 'text/javascript; charset=utf-8'],
  '/adventure/style.css': ['adventure/public/style.css', 'text/css; charset=utf-8'],
  '/arena/': ['index.html', 'text/html; charset=utf-8']
};
function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError(415, 'JSON_REQUIRED', '请求须使用 application/json。');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16384) throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过长。');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError(400, 'BAD_JSON', '请求 JSON 无效。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'BAD_JSON', '请求须为 JSON 对象。');
  return value;
}
function protectLocalRequest(req, port) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const host = (req.headers.host || '').toLowerCase();
  if (!allowed.has(host)) throw new AppError(403, 'BAD_HOST', '只允许通过本机地址访问。');
  const origin = req.headers.origin;
  if ((origin && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
    throw new AppError(403, 'CROSS_ORIGIN', '不接受跨站请求。');
  }
  if (req.headers.referer && !origin) {
    let ref;
    try { ref = new URL(req.headers.referer); } catch { throw new AppError(403, 'CROSS_ORIGIN', '请求来源无效。'); }
    if (ref.origin !== `http://${host}`) throw new AppError(403, 'CROSS_ORIGIN', '不接受跨站请求。');
  }
}
function createApp({ dbPath = path.join(ROOT, 'data/campaigns.sqlite'), dm, logger = console } = {}) {
  const store = new Store(dbPath);
  dm ||= new OpenAIDM({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL });
  const campaigns = new Campaigns(store, dm);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      protectLocalRequest(req, server.address().port);
      const url = new URL(req.url, 'http://127.0.0.1');
      const route = url.pathname;
      if (req.method === 'GET' && route === '/') {
        res.writeHead(302, { Location: '/adventure/' }); return res.end();
      }
      if (req.method === 'GET' && route === '/api/health') return json(res, 200, { mode: dm.mode, ready: dm.ready, backgrounds: BACKGROUNDS, skills: SKILLS });
      if (route === '/api/campaigns') {
        if (req.method === 'GET') return json(res, 200, { campaigns: store.list() });
        if (req.method === 'POST') return json(res, 201, campaigns.create(await body(req)));
      }
      const match = route.match(/^\/api\/campaigns\/([^/]+)(?:\/(turns|export|pending))?$/);
      if (match && isID(match[1])) {
        const [, id, operation] = match;
        if (!operation && req.method === 'GET') return json(res, 200, campaigns.view(id));
        if (operation === 'turns' && req.method === 'POST') return json(res, 200, await campaigns.advance(id, await body(req)));
        if (operation === 'turns' && req.method === 'GET') {
          store.get(id);
          const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : Number.MAX_SAFE_INTEGER;
          if (!Number.isSafeInteger(before) || before < 1) throw new AppError(400, 'BAD_INPUT', '回合分页参数无效。');
          const turns = store.turns(id, before);
          return json(res, 200, { turns, hasEarlier: turns.length > 0 && turns[0].turn > 1 });
        }
        if (operation === 'pending' && req.method === 'DELETE') {
          const input = await body(req);
          if (!isID(input.requestId)) throw new AppError(400, 'BAD_INPUT', '请求编号无效。');
          return json(res, 200, await campaigns.cancel(id, input.requestId));
        }
        if (operation === 'export' && req.method === 'GET') return json(res, 200, campaigns.export(id), {
          'Content-Disposition': `attachment; filename="campaign-${id}.json"`
        });
      }
      if (req.method === 'GET' && Object.hasOwn(STATIC, route)) {
        const [file, type] = STATIC[route];
        if (route.startsWith('/adventure/')) res.setHeader('Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(await fs.readFile(path.join(ROOT, file)));
      }
      throw new AppError(404, 'NOT_FOUND', '没有这个页面或接口。');
    } catch (err) {
      const status = err instanceof AppError ? err.status : 500;
      if (status === 500) logger.error('Request failed:', err.code || err.name);
      if (!res.headersSent) json(res, status, { error: {
        code: err instanceof AppError ? err.code : 'INTERNAL',
        message: err instanceof AppError ? err.message : '存档或服务发生错误，请保留当前数据并检查服务端。'
      } });
      else res.end();
    }
  });
  return { server, store, campaigns };
}
function integerEnv(name, fallback, min, max) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}
if (require.main === module) {
  const port = integerEnv('PORT', 3000, 1024, 65535);
  const demo = process.argv.includes('--demo');
  const dm = demo ? new DemoDM() : new OpenAIDM({ apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL, timeoutMs: integerEnv('OPENAI_TIMEOUT_MS', 60000, 1000, 180000),
    maxOutputTokens: integerEnv('OPENAI_MAX_OUTPUT_TOKENS', 4000, 512, 16000) });
  // Demo and real campaigns use separate databases by default.
  const dbPath = process.env.SAVE_DB ? path.resolve(ROOT, process.env.SAVE_DB) : path.join(ROOT, demo ? 'data/demo.sqlite' : 'data/campaigns.sqlite');
  const app = createApp({ dbPath, dm });
  app.server.listen(port, '127.0.0.1', () => {
    console.log(`Name Arena adventure: http://127.0.0.1:${port}/adventure/`);
    console.log(demo ? 'DEMO MODE: scripted offline fixture; no API calls.' : dm.ready ? 'OpenAI DM configured. Credentials stay on the server.' : 'Set OPENAI_API_KEY and OPENAI_MODEL in .env, or run npm run demo.');
  });
  app.server.on('error', err => { console.error('Server could not start:', err.code); app.store.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.server.close(() => { app.store.close(); process.exit(0); }));
}
module.exports = { createApp };

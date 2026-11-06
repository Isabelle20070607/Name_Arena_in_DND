'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('../server.cjs');
const { Store } = require('../lib/store.cjs');
const { Campaigns, relevantFacts } = require('../lib/campaigns.cjs');
const { DemoDM, OpenAIDM } = require('../lib/dm.cjs');
const rules = require('../lib/rules.cjs');
const { Character } = require('../lib/arena.cjs');
const { validatePlan, validate, NARRATION_SCHEMA } = require('../lib/contracts.cjs');
const ROOT = path.resolve(__dirname, '../..');
const plain = value => JSON.parse(JSON.stringify(value));
const actionRequest = (c, action, requestId = randomUUID()) => ({ requestId, expectedRevision: c.revision, kind: c.status === 'draft' ? 'start' : 'action', action });
const plan = overrides => ({ kind:'check', ability:'int', skill:'investigation', dc:13, mode:'normal', opponent:'bandit', opponentName:'', reason:'调查线索', ...overrides });
function stateFor(name = '测试旅人') {
  return { seed:'fixed-test-campaign-seed', revision:3, character:rules.createCharacter(name, 'scholar') };
}
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-dm-test-'));
  const dbPath = path.join(directory, 'save.sqlite');
  const app = createApp({ dbPath, dm:options.dm || new DemoDM(), logger:{ error() {} } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let closed = false;
  const close = async () => {
    if (!closed) { closed = true; await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
  };
  t.after(async () => { await close(); fs.rmSync(directory, { recursive:true, force:true }); });
  const call = async (url, input, method = input === undefined ? 'GET' : 'POST', headers = {}) => {
    const response = await fetch(base + url, { method, headers:{ 'Content-Type':'application/json', ...headers },
      body:input === undefined ? undefined : JSON.stringify(input) });
    return { status:response.status, body:await response.json() };
  };
  return { ...app, base, dbPath, close, call };
}

test('extracted characters match the actual original code across 120 names', () => {
  const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const original = source.slice(source.indexOf('const LANG = {'), source.indexOf('/* =====================================================================\n   DAMAGE TYPE LABELS'));
  const legacy = vm.runInNewContext(`${original}\n({Character, CombatEngine});`, { localStorage:{ getItem:() => 'zh' } });
  const fields = ['name','str','dex','con','int','wis','cha','classKey','subclassKey','level','maxHP','ac','attackBonus','spellSaveDC','damageDie','damageBonus','title','alignment'];
  for (let i = 0; i < 120; i++) {
    const name = `旅人-${i}🙂`;
    const a = new legacy.Character(name), b = new Character(name);
    for (const key of fields) assert.deepEqual(b[key], a[key], `${name}: ${key}`);
  }
  // Compare existing automatic combat behavior too, excluding the documented monk RNG adaptation.
  let compared = 0;
  for (let i = 0; compared < 12; i++) {
    const a = new legacy.Character(`勇者${i}`), b = new legacy.Character(`对手${i}`);
    if ([a, b].some(c => c.classKey === 'monk')) continue;
    const old = new legacy.CombatEngine(a, b).fight();
    const { CombatEngine } = require('../lib/arena.cjs');
    const next = new CombatEngine(new Character(a.name), new Character(b.name)).fight();
    assert.deepEqual(plain(next.events), plain(old.events)); compared++;
  }
});

test('checks apply background proficiency, DC boundary, advantage and disadvantage', () => {
  const s = rules.createCharacter('调查员', 'scholar');
  const sheet = rules.characterSheet(s);
  const normal = rules.resolveCheck(s, plan(), () => 0.5);
  assert.equal(normal.raw, 11); assert.equal(normal.proficiency, 3);
  assert.equal(normal.total, 11 + sheet.stats.int.modifier + 3);
  assert.equal(rules.resolveCheck(s, plan({ dc:normal.total }), () => 0.5).success, true);
  for (const [mode, raw] of [['advantage', 19], ['disadvantage', 3]]) {
    const values = [0.1, 0.9];
    assert.equal(rules.resolveCheck(s, plan({ mode }), () => values.shift()).raw, raw);
  }
  assert.equal(rules.resolveCheck(s, plan({ ability:'dex', skill:'stealth' }), () => 0.5).proficiency, 0);
});

test('natural 20/1 are not automatic ability-check success/failure', () => {
  const s = rules.createCharacter('调查员', 'wanderer');
  assert.equal(rules.resolveCheck(s, plan({ dc:25 }), () => 0.999).success, false);
  let strong;
  for (let i = 0; i < 100; i++) {
    const candidate = rules.createCharacter(`学者${i}`, 'scholar');
    if (rules.characterSheet(candidate).stats.int.modifier >= 1) { strong = candidate; break; }
  }
  assert.ok(strong);
  assert.equal(rules.resolveCheck(strong, plan({ dc:5 }), () => 0).success, true);
});

test('combat preserves initial HP/resources and deterministic monk rolls; rest restores resources', () => {
  let monk;
  for (let i = 0; i < 500; i++) if (rules.characterSheet(rules.createCharacter(`武僧${i}`)).classKey === 'monk') { monk = `武僧${i}`; break; }
  assert.ok(monk);
  const s = stateFor(monk); s.character.hp = 9;
  s.character.resources.class._ki = 1;
  s.character.resources.skills[0].left = 0;
  const copy = structuredClone(s);
  const r = rules.resolveMechanics(s, plan({ kind:'combat', opponent:'guardian' }));
  const r2 = rules.resolveMechanics(copy, plan({ kind:'combat', opponent:'guardian' }));
  assert.deepEqual(r, r2);
  assert.equal(r.events[0]._hp[monk].hp, 9);
  assert.equal(s.character.resources.skills[0].left, 0);
  assert.ok(s.character.resources.class._ki <= 1);
  assert.equal(rules.restore(s.character).currentHP, s.character.hp);
  rules.resolveMechanics(s, { kind:'rest', reason:'安全休整' });
  assert.deepEqual(s.character, rules.createCharacter(monk, 'scholar'));
});

test('invalid model plans and malformed world patches are rejected', () => {
  assert.throws(() => validatePlan(plan({ ability:'cha' })), /不匹配/);
  for (const bad of [{ dc:999 }, { kind:'execute_shell' }, { mode:'always_win' }, { opponent:'dragon' }, { hp:1000 }]) {
    assert.throws(() => validatePlan(plan(bad)));
  }
  assert.throws(() => rules.createCharacter('name', 'toString'));
  assert.throws(() => validate({ narrative:'伪造', hp:999 }, NARRATION_SCHEMA));
  const s = stateFor(); s.character.hp = 0;
  assert.throws(() => rules.resolveMechanics(s, plan()), /失去行动能力/);
});

test('HTTP multi-turn adventure, saved transcript, pagination, export and process restart', async t => {
  const app = await fixture(t);
  let result = await app.call('/api/campaigns', { name:'阿澜', background:'scholar', title:'旧桥来信' });
  assert.equal(result.status, 201); let c = result.body;
  assert.equal(c.status, 'draft');
  const advance = async action => {
    const r = await app.call(`/api/campaigns/${c.id}/turns`, actionRequest(c, action));
    assert.equal(r.status, 200, JSON.stringify(r.body)); c = r.body; return c.turns.at(-1);
  };
  assert.equal((await advance('')).resolution.kind, 'start');
  assert.equal((await advance('检查石碑')).resolution.kind, 'check');
  assert.equal((await advance('攻击拦路强盗')).resolution.kind, 'combat');
  assert.equal((await advance('在旅店休息')).resolution.kind, 'rest');
  assert.equal(c.character.hp, c.character.maxHP);
  assert.ok(c.world.inventory.includes('铜钥匙'));
  assert.ok(c.memory.summary.includes('林恩'));
  const exported = await app.call(`/api/campaigns/${c.id}/export`);
  assert.equal(exported.body.turns.length, 4); assert.ok(exported.body.facts.length >= 1);
  const old = await app.call(`/api/campaigns/${c.id}/turns?before=4`);
  assert.equal(old.body.turns.length, 3);
  await app.close();
  const reopened = createApp({ dbPath:app.dbPath, dm:new DemoDM() });
  t.after(() => reopened.store.close());
  const loaded = reopened.campaigns.view(c.id);
  assert.deepEqual(loaded, c);
  const continued = await reopened.campaigns.advance(c.id, actionRequest(c, '继续与林恩交谈'));
  assert.equal(continued.revision, 5);
});

test('completed requests are idempotent even after later turns; stale writes are rejected', async t => {
  const app = await fixture(t);
  let c = app.campaigns.create({ name:'旅人' });
  const opening = actionRequest(c, '');
  c = await app.campaigns.advance(c.id, opening);
  const original = actionRequest(c, '调查石碑');
  c = await app.campaigns.advance(c.id, original);
  c = await app.campaigns.advance(c.id, actionRequest(c, '交谈'));
  const replayed = await app.campaigns.advance(c.id, original);
  assert.equal(replayed.replayed, true); assert.equal(replayed.revision, 3);
  assert.equal(app.store.allTurns(c.id).length, 3);
  await assert.rejects(app.campaigns.advance(c.id, { ...original, action:'另一行动' }), /请求编号/);
  await assert.rejects(app.campaigns.advance(c.id, { ...actionRequest(c, '行动'), expectedRevision:1 }), /存档已更新/);
});

test('narration failure survives restart and retries the exact same prepared roll without re-planning', async t => {
  class FailingDM extends DemoDM {
    calls = 0; fail = false; resolutions = [];
    async plan(context) { this.calls++; return super.plan(context); }
    async narrate(context) {
      this.resolutions.push(context.authoritativeResolution);
      if (this.fail) throw new Error('Simulated upstream outage');
      return super.narrate(context);
    }
  }
  const dm = new FailingDM(), app = await fixture(t, { dm });
  let c = app.campaigns.create({ name:'重试旅人', background:'scholar' });
  c = await app.campaigns.advance(c.id, actionRequest(c, ''));
  dm.fail = true;
  const request = actionRequest(c, '调查石碑');
  await assert.rejects(app.campaigns.advance(c.id, request));
  assert.equal(app.store.get(c.id).revision, 1); assert.equal(app.store.allTurns(c.id).length, 1);
  assert.equal(app.campaigns.view(c.id).pending.requestId, request.requestId);
  const expected = dm.resolutions.at(-1);
  await assert.rejects(app.campaigns.advance(c.id, actionRequest(c, '别的行动')), /先重试或取消/);
  await app.close();
  const reopenedStore = new Store(app.dbPath), campaigns = new Campaigns(reopenedStore, dm);
  t.after(() => reopenedStore.close()); dm.fail = false;
  c = await campaigns.advance(c.id, request);
  assert.equal(dm.calls, 1); assert.deepEqual(dm.resolutions.at(-1), expected);
  assert.equal(c.revision, 2); assert.equal(c.pending, null);
});

test('cancelling an unfinished turn leaves the last completed state intact', async t => {
  const dm = new DemoDM(), app = await fixture(t, { dm });
  let c = app.campaigns.create({ name:'取消旅人' });
  c = await app.campaigns.advance(c.id, actionRequest(c, ''));
  const narrate = dm.narrate.bind(dm); dm.narrate = async () => { throw new Error('failure'); };
  const request = actionRequest(c, '攻击');
  await assert.rejects(app.campaigns.advance(c.id, request));
  const cancelled = await app.campaigns.cancel(c.id, request.requestId);
  assert.equal(cancelled.revision, c.revision); assert.equal(cancelled.character.hp, c.character.hp);
  assert.equal(cancelled.pending, null); dm.narrate = narrate;
  await assert.rejects(app.campaigns.advance(c.id, request), /已取消/);
  const next = await app.campaigns.advance(c.id, actionRequest(c, '交谈'));
  assert.equal(next.revision, 2);
});

test('simultaneous submissions cannot both advance one campaign', async t => {
  const dm = new DemoDM(); let release;
  const baseNarrate = dm.narrate.bind(dm);
  dm.narrate = async context => { await new Promise(resolve => { release = resolve; }); return baseNarrate(context); };
  const app = await fixture(t, { dm });
  const c = app.campaigns.create({ name:'并发旅人' });
  const first = app.campaigns.advance(c.id, actionRequest(c, ''));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(app.campaigns.advance(c.id, actionRequest(c, '')), /正在处理/);
  release(); await first; assert.equal(app.store.get(c.id).revision, 1);
});

test('60 turns retain all facts and transcript while loading recent context plus relevant older memory', async t => {
  class MemoryDM extends DemoDM {
    contexts = [];
    async plan(context) { this.contexts.push(context); return super.plan(context); }
    async narrate(context) {
      const result = await super.narrate(context);
      result.newFacts = [context.turn === 20 ? '艾文承诺在雪港等待玩家归还银戒指。' : `旅程事实 ${context.turn}：路边里程碑有编号 ${context.turn}。`];
      return result;
    }
  }
  const dm = new MemoryDM(), app = await fixture(t, { dm });
  let c = app.campaigns.create({ name:'长旅人' });
  for (let i = 0; i < 60; i++) c = await app.campaigns.advance(c.id, actionRequest(c, i === 59 ? '我要去雪港找艾文' : '继续交谈'));
  assert.equal(c.revision, 60); assert.equal(c.turns.length, 50); assert.equal(c.hasEarlier, true);
  assert.equal(app.store.allTurns(c.id).length, 60); assert.equal(app.store.facts(c.id).length, 60);
  assert.equal(dm.contexts.at(-1).recentTurns.length, 8);
  assert.ok(dm.contexts.at(-1).facts.some(f => f.text.includes('归还银戒指')));
  assert.ok(relevantFacts(app.store.facts(c.id), '雪港').some(f => f.turn === 20));
});

test('HTTP rejects cross-site writes, forged hosts, oversized/invalid input and secret file reads', async t => {
  const app = await fixture(t);
  for (const headers of [{ Origin:'https://evil.example' }, { 'Sec-Fetch-Site':'cross-site' }]) {
    assert.equal((await app.call('/api/campaigns', { name:'forged' }, 'POST', headers)).status, 403, JSON.stringify(headers));
  }
  // fetch normalizes Host itself; use raw HTTP so this tests the actual hostile header.
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = http.request(app.base + '/api/campaigns', { headers:{ Host:'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(forgedHostStatus, 403);
  for (const name of ['/.env', '/data/campaigns.sqlite', '/adventure/lib/dm.cjs', '/package.json', '/api/../.env']) {
    assert.equal((await app.call(name)).status, 404, name);
  }
  assert.equal((await app.call('/api/campaigns', { name:'x'.repeat(20000) })).status, 413);
  assert.equal((await app.call('/api/campaigns', { name:'' })).status, 400);
  assert.equal((await app.call('/api/campaigns', { name:'xx', background:'toString' })).status, 400);
  assert.equal((await app.call('/api/campaigns', { name:'xx' }, 'POST', { 'Content-Type':'text/plain' })).status, 415);
});

test('OpenAI adapter sends credentials only to fixed server-side endpoint and parses a real Responses envelope', async () => {
  let captured;
  const payload = plan();
  const dm = new OpenAIDM({ apiKey:'unit-test-secret', model:'test-model', fetchImpl:async (url, options) => {
    captured = { url, options, body:JSON.parse(options.body) };
    return new Response(JSON.stringify({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(payload) }] }] }));
  } });
  assert.deepEqual(await dm.plan({ action:'调查' }), payload);
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(captured.options.headers.Authorization, 'Bearer unit-test-secret');
  assert.equal(captured.body.text.format.strict, true);
  assert.equal(captured.body.text.format.type, 'json_schema');
  assert.equal(captured.body.store, false);
  assert.ok(!captured.body.input[0].content.includes('unit-test-secret'));
});

test('OpenAI failures never expose upstream response bodies or credentials', async () => {
  for (const fetchImpl of [
    async () => new Response('unit-test-secret in provider error', { status:401 }),
    async () => new Response('{}', { status:429 }),
    async () => new Response(JSON.stringify({ status:'incomplete', output:[] })),
    async () => new Response(JSON.stringify({ status:'completed', output:[{ content:[{ type:'refusal' }] }] })),
    async () => new Response(JSON.stringify({ status:'completed', output:[{ content:[{ type:'output_text', text:'broken json' }] }] })),
    async () => { throw new Error('unit-test-secret in network exception'); }
  ]) {
    const dm = new OpenAIDM({ apiKey:'unit-test-secret', model:'test-model', fetchImpl });
    await assert.rejects(dm.plan({ action:'test' }), error => !error.message.includes('unit-test-secret'));
  }
  await assert.rejects(new OpenAIDM({}).plan({}), /配置/);
});

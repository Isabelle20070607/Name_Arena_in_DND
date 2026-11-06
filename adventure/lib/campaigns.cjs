'use strict';
const { randomUUID, randomBytes } = require('node:crypto');
const { AppError } = require('./errors.cjs');
const { createCharacter, characterSheet, resolveMechanics, RULES_VERSION } = require('./rules.cjs');
const { validate, validatePlan, NARRATION_SCHEMA } = require('./contracts.cjs');

function textInput(value, name, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new AppError(400, 'BAD_INPUT', `${name}不能为空，且最多 ${max} 字符。`);
  }
  return value.trim();
}
const isID = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function terms(text) {
  const result = new Set(text.toLowerCase().match(/[a-z0-9_]{2,}|[\p{Script=Han}]{2,}/gu) || []);
  for (const word of [...result]) if (/\p{Script=Han}/u.test(word)) {
    for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
  }
  return [...result];
}
function relevantFacts(facts, query) {
  const tokens = terms(query);
  const ranked = facts.map((f, i) => ({ ...f, i, score: tokens.reduce((s, token) => s + (f.text.toLowerCase().includes(token) ? token.length : 0), 0) }))
    .filter(f => f.score > 0).sort((a, b) => b.score - a.score || b.i - a.i).slice(0, 12);
  // Keep origin facts and recent facts even when keywords do not match. All facts remain in SQLite.
  return [...new Map([...facts.slice(0, 4), ...ranked, ...facts.slice(-6)].map(f => [f.text, { turn: f.turn, text: f.text }])).values()];
}
function compactResolution(r) {
  const { events, ...compact } = r;
  return compact;
}
class Campaigns {
  constructor(store, dm) { this.store = store; this.dm = dm; this.busy = new Set(); }
  create(input) {
    const name = textInput(input.name, '角色名字', 80);
    const title = textInput(input.title, '战役名称', 80, `${name}的冒险`.slice(0, 80));
    const premise = textInput(input.premise, '冒险设定', 1200, '一座旧桥每晚响起无人敲击的钟声，你来到附近旅店寻找原因。');
    const character = createCharacter(name, input.background);
    const now = new Date().toISOString();
    const state = { schemaVersion: 1, rulesVersion: RULES_VERSION, id: randomUUID(), title, premise,
      seed: randomBytes(16).toString('hex'), character, dmMode: this.dm.mode,
      revision: 0, status: 'draft', world: { location: '尚未开始', goal: premise,
        inventory: [characterSheet(character).equipment], elapsedHours: 0 },
      memory: { summary: '' }, createdAt: now, updatedAt: now };
    this.store.create(state);
    return this.view(state.id);
  }
  view(id) {
    const s = this.store.get(id);
    const turns = this.store.turns(id);
    return { id: s.id, title: s.title, premise: s.premise, revision: s.revision, status: s.status,
      mode: s.dmMode, rulesVersion: s.rulesVersion, character: characterSheet(s.character),
      world: s.world, memory: s.memory, createdAt: s.createdAt, updatedAt: s.updatedAt,
      turns, hasEarlier: turns.length > 0 && turns[0].turn > 1, pending: this.store.pending(id) };
  }
  context(state, action) {
    return { premise: state.premise, turn: state.revision + 1, action,
      character: characterSheet(state.character), world: state.world, memory: state.memory,
      facts: relevantFacts(this.store.facts(state.id), `${action} ${state.world.location}`),
      recentTurns: this.store.turns(state.id, Number.MAX_SAFE_INTEGER, 8).map(t => ({ turn: t.turn,
        action: t.action, narrative: t.narrative, resolution: compactResolution(t.resolution) })) };
  }
  async locked(id, fn) {
    if (this.busy.has(id)) throw new AppError(409, 'TURN_BUSY', '此战役正在处理另一个请求，请稍后重新载入。');
    this.busy.add(id);
    try { return await fn(); } finally { this.busy.delete(id); }
  }
  async advance(id, input) {
    if (!isID(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new AppError(400, 'BAD_INPUT', 'requestId 或存档版本无效。');
    }
    if (!['start', 'action'].includes(input.kind)) throw new AppError(400, 'BAD_INPUT', '回合类型无效。');
    const action = input.kind === 'start' ? '' : textInput(input.action, '行动', 2000);
    return this.locked(id, async () => {
      const state = this.store.get(id);
      let request = this.store.request(id, input.requestId);
      if (request) {
        if (request.action !== action || request.kind !== input.kind || request.base_revision !== input.expectedRevision) {
          throw new AppError(409, 'REQUEST_ID_REUSED', '同一个请求编号不能用于另一项行动。');
        }
        if (request.status === 'done') return { ...this.view(id), replayed: true };
        if (request.status === 'cancelled') throw new AppError(409, 'REQUEST_CANCELLED', '这项请求已取消，请提交新行动。');
      }
      if (state.dmMode !== this.dm.mode) throw new AppError(409, 'MODE_MISMATCH', '请用与这份存档相同的 DM 模式启动服务。');
      if (state.revision !== input.expectedRevision) throw new AppError(409, 'STALE_REVISION', '存档已更新，请重新载入后再行动。');
      if (!request) {
        if (this.store.pending(id)) throw new AppError(409, 'PENDING_TURN', '请先重试或取消尚未完成的回合。');
        if ((input.kind === 'start') !== (state.status === 'draft')) {
          throw new AppError(409, 'BAD_PHASE', state.status === 'draft' ? '请先生成开场。' : '此战役已开始。');
        }
        const plan = input.kind === 'start' ? { kind: 'start', reason: '生成冒险开场。' } :
          validatePlan(await this.dm.plan(this.context(state, action)));
        const nextState = structuredClone(state);
        const resolution = resolveMechanics(nextState, plan);
        this.store.prepare(id, input.requestId, action, input.kind, state.revision, { nextState, plan, resolution });
        request = this.store.request(id, input.requestId);
      }
      const { nextState, plan, resolution } = request.prepared;
      const dmTurn = validate(await this.dm.narrate({ ...this.context(nextState, action), plan,
        authoritativeResolution: compactResolution(resolution) }), NARRATION_SCHEMA);
      const removed = new Set(dmTurn.removeItems.map(x => x.trim()));
      const inventory = [...new Set([...nextState.world.inventory.filter(x => !removed.has(x)), ...dmTurn.addItems.map(x => x.trim())])];
      if (inventory.length > 100) throw new AppError(502, 'INVENTORY_LIMIT', '物品记录超过原型上限，请取消本回合并整理物品后继续。');
      nextState.world = { location: dmTurn.location.trim(), goal: dmTurn.goal.trim(), inventory,
        elapsedHours: nextState.world.elapsedHours + (resolution.kind === 'rest' ? resolution.hours : 0) };
      nextState.memory.summary = dmTurn.summary.trim();
      nextState.revision++;
      nextState.status = 'active';
      nextState.updatedAt = new Date().toISOString();
      const turn = { turn: nextState.revision, requestId: input.requestId, kind: input.kind, action,
        narrative: dmTurn.narrative.trim(), plan, resolution, createdAt: nextState.updatedAt };
      this.store.commit(id, input.requestId, nextState, turn, [...new Set(dmTurn.newFacts.map(f => f.trim()))]);
      return this.view(id);
    });
  }
  cancel(id, requestId) { return this.locked(id, () => { this.store.cancel(id, requestId); return this.view(id); }); }
  export(id) { return { format: 'name-arena-adventure-archive', version: 1, exportedAt: new Date().toISOString(),
    campaign: this.store.get(id), turns: this.store.allTurns(id), facts: this.store.facts(id) }; }
}
module.exports = { Campaigns, isID, relevantFacts };

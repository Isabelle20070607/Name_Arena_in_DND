'use strict';
const $ = id => document.getElementById(id);
const ABILITIES = { str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力' };
const SKILL_NAMES = { athletics:'运动', acrobatics:'杂技', sleight_of_hand:'巧手', stealth:'隐匿', arcana:'奥秘', history:'历史', investigation:'调查', nature:'自然', religion:'宗教', animal_handling:'驯兽', insight:'洞悉', medicine:'医药', perception:'察觉', survival:'求生', deception:'欺瞒', intimidation:'威吓', performance:'表演', persuasion:'游说', none:'属性检定' };
let current = null, busy = false, health = null;
const signed = n => n >= 0 ? `+${n}` : String(n);
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `请求失败（${response.status}）`);
  return result;
}
function status(text) { $('status').textContent = text; }
function error(text) { $('error').textContent = text || ''; $('error').hidden = !text; }
function setBusy(value) {
  busy = value;
  for (const el of document.querySelectorAll('button,input,select,textarea')) el.disabled = value;
  $('action-form').setAttribute('aria-busy', String(value));
}
function remember(id) { try { localStorage.setItem('adventure_last_campaign', id); } catch {} }
async function refreshList() {
  const result = await api('/api/campaigns');
  $('saved').replaceChildren(node('option', '选择战役…'));
  $('saved').firstChild.value = '';
  for (const s of result.campaigns) {
    const option = node('option', `${s.title} · ${s.name} · ${s.revision} 回合${s.mode === 'demo' ? '（演示）' : ''}`);
    option.value = s.id; $('saved').append(option);
  }
  if (current) $('saved').value = current.id;
}
function ruleLabel(r) {
  if (r.kind === 'check') return `${ABILITIES[r.ability]} · ${SKILL_NAMES[r.skill]}：${r.success ? '成功' : '失败'}（${r.total} / DC ${r.dc}）`;
  if (r.kind === 'combat') return `遭遇${{ victory:'胜利', defeat:'败北', standoff:'僵持' }[r.outcome]} · ${r.rounds} 轮 · 剩余 ${r.hp} HP`;
  if (r.kind === 'rest') return `安全休整八小时 · HP ${r.beforeHP} → ${r.hp}`;
  return r.kind === 'start' ? '冒险开场' : '无需检定';
}
function combatLine(event) {
  const d = event.data || {}, actor = event.actor || '';
  if (event.type === 'round_start') return `第 ${d.round} 轮`;
  if (event.type === 'attack' || event.type === 'beam') {
    const roll = typeof d.roll === 'object' ? d.roll : d;
    return `${actor} → ${event.target}：${roll.hit ? `命中${d.dmg !== undefined ? `，${d.dmg} 点伤害` : ''}${roll.crit ? '（暴击）' : ''}` : '未命中'}${d.skill ? ` · ${d.skill}` : ''}`;
  }
  if (event.type === 'spell') return `${actor}施放 ${d.spell}：${d.final ?? d.dmg ?? 0} 点伤害${d.saved ? '（豁免成功）' : ''}`;
  if (event.type === 'heal') return `${actor}恢复生命${d.amount !== undefined ? ` ${d.amount}` : ''}`;
  if (event.type === 'skill' || event.type === 'condition' || event.type === 'stun') return `${actor} · ${d.skill || d.effect || '状态变化'}`;
  if (event.type === 'dot') return `${actor} · ${d.effect} · ${d.dmg} 点伤害`;
  return null;
}
function renderTurn(turn) {
  const article = node('article', undefined, 'turn');
  article.append(node('p', `TURN ${String(turn.turn).padStart(2, '0')} · ${turn.kind === 'start' ? '旅程开始' : '继续前行'}`, 'turn-label'));
  if (turn.action) article.append(node('div', turn.action, 'player-action'));
  article.append(node('p', turn.narrative, 'narrative'));
  const details = node('details', undefined, 'resolution');
  details.append(node('summary', ruleLabel(turn.resolution)));
  const r = turn.resolution;
  details.append(node('p', r.reason));
  if (r.kind === 'check') details.append(node('p', `d20：${r.rolls.join('、')}；取 ${r.raw}。属性 ${signed(r.modifier)}，熟练 ${signed(r.proficiency)}，合计 ${r.total}。${r.mode === 'advantage' ? '优势取高' : r.mode === 'disadvantage' ? '劣势取低' : '正常检定'}。`));
  if (r.kind === 'combat') {
    const list = node('ol', undefined, 'combat-log');
    for (const event of r.events) { const line = combatLine(event); if (line) list.append(node('li', line)); }
    details.append(list);
  }
  article.append(details);
  return article;
}
function render() {
  if (!current) return;
  const c = current.character;
  $('campaign-title').textContent = current.title;
  $('scene').textContent = `${current.world.location} · 已保存 ${current.revision} 回合`;
  $('character-panel').hidden = false;
  $('character-name').textContent = c.name;
  $('character-class').textContent = `Lv.${c.level} ${c.className} · ${c.subclass}`;
  $('hp').textContent = `${c.hp} / ${c.maxHP} HP${c.tempHP ? ` + ${c.tempHP} 临时` : ''}`;
  $('ac').textContent = `AC ${c.ac}`;
  $('stats').replaceChildren();
  for (const [a, value] of Object.entries(c.stats)) {
    const div = node('div'); div.append(node('dt', ABILITIES[a]), node('dd', `${value.score} (${signed(value.modifier)})`)); $('stats').append(div);
  }
  $('background-info').textContent = `${c.background} · 熟练：${c.proficientSkills.map(s => SKILL_NAMES[s]).join('、')}`;
  $('resources').replaceChildren(...c.resources.skills.filter(s => s.left !== null).map(s => node('li', `${s.name}：剩余 ${s.left} 次`)));
  $('inventory').replaceChildren(...current.world.inventory.map(item => node('li', item)));
  $('transcript').replaceChildren(...current.turns.map(renderTurn));
  $('older').hidden = !current.hasEarlier;
  $('empty').hidden = true;
  $('new-campaign').open = false;
  $('export').href = `/api/campaigns/${current.id}/export`; $('export').hidden = false;
  $('memory').hidden = false; $('summary').textContent = current.memory.summary || '开场后，DM 会记录旅程中的人物、约定与线索。';
  $('goal').textContent = `当前目标：${current.world.goal}`;
  $('pending-box').hidden = !current.pending;
  $('pending-description').textContent = current.pending ? `这项行动的规则结算已暂存，等待 DM 续写。重试会沿用同一结果。${current.pending.action ? `\n行动：${current.pending.action}` : ''}` : '';
  $('start').hidden = current.status !== 'draft' || Boolean(current.pending);
  $('action-form').hidden = current.status !== 'active' || Boolean(current.pending);
  if (current.mode !== health?.mode) status('这份存档来自另一种 DM 模式。请以对应模式重启服务后继续。');
}
async function load(id) {
  current = await api(`/api/campaigns/${id}`); remember(id); render();
  status(`已恢复 ${current.revision} 个回合。${current.character.hp <= 0 ? '角色需要救援或安全休整。' : ''}`);
  if (current.mode !== health?.mode) status('这份存档来自另一种 DM 模式，请用对应模式重启服务。');
}
async function submitTurn(request) {
  setBusy(true); error(''); status('DM 正在处理行动并续写，完成后会自动保存…');
  try {
    current = await api(`/api/campaigns/${current.id}/turns`, { method:'POST', body:JSON.stringify(request) });
    $('action').value = ''; render(); await refreshList(); status(`第 ${current.revision} 回合已保存。`);
    $('action').focus();
  } catch (err) {
    error(err.message); status('本次请求未完成，正在确认存档。');
    try {
      await load(current.id);
      if (current.turns.some(t => t.requestId === request.requestId)) {
        error(''); $('action').value = ''; status('已确认该回合保存成功。');
      } else status(current.pending ? '检定结果已暂存，可重试续写或取消此回合。' : '当前进度已保留，可以重新提交行动。');
    } catch { status('暂时无法读取服务，请保持服务运行并重新载入。'); }
  } finally { setBusy(false); }
}
function nextRequest(kind, action = '') { return { requestId:crypto.randomUUID(), expectedRevision:current.revision, kind, action }; }
$('create-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  setBusy(true); error(''); status('正在生成角色…');
  try {
    const input = { name:$('name').value, background:$('background').value };
    if ($('title').value.trim()) input.title = $('title').value;
    if ($('premise').value.trim()) input.premise = $('premise').value;
    current = await api('/api/campaigns', { method:'POST', body:JSON.stringify(input) });
    remember(current.id); render(); await refreshList();
  } catch (err) { error(err.message); status('角色尚未创建。'); setBusy(false); return; }
  setBusy(false); await submitTurn(nextRequest('start'));
});
$('action-form').addEventListener('submit', event => { event.preventDefault(); if (!busy && current) submitTurn(nextRequest('action', $('action').value)); });
$('start').addEventListener('click', () => { if (!busy && current) submitTurn(nextRequest('start')); });
$('retry').addEventListener('click', () => { if (!busy && current?.pending) submitTurn(current.pending); });
$('load').addEventListener('click', async () => {
  if (busy || !$('saved').value) return; setBusy(true); error('');
  try { await load($('saved').value); $('action').value = ''; } catch (err) { error(err.message); }
  finally { setBusy(false); }
});
$('cancel').addEventListener('click', async () => {
  if (busy || !current?.pending) return; setBusy(true); error('');
  try {
    const action = current.pending.action;
    current = await api(`/api/campaigns/${current.id}/pending`, { method:'DELETE', body:JSON.stringify({ requestId:current.pending.requestId }) });
    render(); $('action').value = action; status('未完成回合已取消，恢复到上一份已完成存档。');
  } catch (err) { error(err.message); } finally { setBusy(false); }
});
$('older').addEventListener('click', async () => {
  if (busy || !current?.turns.length) return; setBusy(true); error('');
  try {
    const result = await api(`/api/campaigns/${current.id}/turns?before=${current.turns[0].turn}`);
    current.turns = [...result.turns, ...current.turns]; current.hasEarlier = result.hasEarlier; render();
  } catch (err) { error(err.message); } finally { setBusy(false); }
});
(async () => {
  setBusy(true);
  try {
    health = await api('/api/health');
    $('mode').textContent = health.mode === 'demo' ? '离线演示 · 固定剧情' : health.ready ? 'AI DM' : 'AI DM · 待配置';
    await refreshList();
    let last; try { last = localStorage.getItem('adventure_last_campaign'); } catch {}
    if (last && [...$('saved').options].some(o => o.value === last)) await load(last);
    else status(health.ready ? health.mode === 'demo' ? '离线演示可测试调查、潜行、攻击和休息。此模式不调用 AI。' : 'DM 已就绪，创建角色即可开始。' : '请在服务端 .env 填写 API 密钥与模型，或运行 npm run demo。');
  } catch (err) { error(err.message); status('请确认本机 Node 服务正在运行。'); }
  finally { setBusy(false); }
})();

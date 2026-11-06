'use strict';
const { Character, CombatEngine, NameHasher, CLASSES } = require('./arena.cjs');
const { AppError } = require('./errors.cjs');

const RULES_VERSION = 'arena-adventure-v1';
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILLS = Object.freeze({
  athletics: 'str', acrobatics: 'dex', sleight_of_hand: 'dex', stealth: 'dex',
  arcana: 'int', history: 'int', investigation: 'int', nature: 'int', religion: 'int',
  animal_handling: 'wis', insight: 'wis', medicine: 'wis', perception: 'wis', survival: 'wis',
  deception: 'cha', intimidation: 'cha', performance: 'cha', persuasion: 'cha'
});
// Explicit prototype backgrounds: original Character.skills contains combat abilities, not skill proficiencies.
const BACKGROUNDS = Object.freeze({
  wanderer: { name: '旅人', skills: ['perception', 'survival'] },
  scholar: { name: '学者', skills: ['arcana', 'investigation'] },
  diplomat: { name: '使者', skills: ['insight', 'persuasion'] }
});
const RESOURCES = ['_smiteUses', '_shieldCharges', '_fireball_used', '_ki', '_agathysDone',
  '_cwCharges', '_twinReady', '_twinUsed'];
const ENEMIES = Object.freeze({
  bandit: { label: '拦路强盗', hp: 18, ac: 12, attack: 3, die: 6, bonus: 1 },
  scout: { label: '遗迹斥候', hp: 24, ac: 13, attack: 4, die: 6, bonus: 2 },
  guardian: { label: '遗迹守卫', hp: 36, ac: 15, attack: 5, die: 8, bonus: 3 }
});

function snapshot(character, background = 'wanderer') {
  return {
    name: character.name, background,
    hp: character.currentHP, tempHP: character.tempHP,
    resources: {
      skills: character.skills.map(s => ({ id: s.id, left: s._usesLeft === Infinity ? null : s._usesLeft })),
      class: Object.fromEntries(RESOURCES.filter(k => k in character).map(k => [k, character[k]]))
    }
  };
}
function createCharacter(name, background = 'wanderer') {
  if (!Object.hasOwn(BACKGROUNDS, background)) throw new AppError(400, 'BAD_BACKGROUND', '请选择有效背景。');
  return snapshot(new Character(name), background);
}
function restore(saved) {
  const c = new Character(saved.name);
  c.currentHP = Math.max(0, Math.min(c.maxHP, saved.hp));
  c.tempHP = saved.tempHP;
  for (const resource of saved.resources.skills) {
    const sk = c.skills.find(s => s.id === resource.id);
    if (sk) sk._usesLeft = resource.left === null ? Infinity : resource.left;
  }
  for (const key of RESOURCES) if (key in saved.resources.class) c[key] = saved.resources.class[key];
  return c;
}
function characterSheet(saved) {
  const c = restore(saved);
  return {
    name: c.name, classKey: c.classKey, className: c.className.zh,
    subclass: c.subclassName.zh, level: c.level, hp: c.currentHP, maxHP: c.maxHP,
    tempHP: c.tempHP, ac: c.ac, attackBonus: c.attackBonus, proficiencyBonus: c.proficiencyBonus,
    stats: Object.fromEntries(ABILITIES.map(a => [a, { score: c[a], modifier: c[a + 'Mod'] }])),
    background: BACKGROUNDS[saved.background].name,
    proficientSkills: BACKGROUNDS[saved.background].skills,
    equipment: c.classDef.equipment.zh,
    resources: { ...saved.resources, skills: saved.resources.skills.map(resource => ({ ...resource,
      name: c.skills.find(sk => sk.id === resource.id)?.name.zh || resource.id })) }
  };
}
function turnRNG(state) {
  return NameHasher.seededRNG(NameHasher.hash(`${state.seed}|turn|${state.revision + 1}`));
}
function resolveCheck(saved, plan, rng) {
  const c = restore(saved);
  const rolls = [NameHasher.rollD(rng, 20)];
  if (plan.mode !== 'normal') rolls.push(NameHasher.rollD(rng, 20));
  const raw = plan.mode === 'advantage' ? Math.max(...rolls) :
    plan.mode === 'disadvantage' ? Math.min(...rolls) : rolls[0];
  const proficient = plan.skill !== 'none' && BACKGROUNDS[saved.background].skills.includes(plan.skill);
  const modifier = c[plan.ability + 'Mod'];
  const proficiency = proficient ? c.proficiencyBonus : 0;
  const total = raw + modifier + proficiency;
  return { kind: 'check', ability: plan.ability, skill: plan.skill, reason: plan.reason,
    mode: plan.mode, rolls, raw, modifier, proficiency, total, dc: plan.dc,
    success: total >= plan.dc };
}
function enemyCharacter(key, name, heroName) {
  const template = ENEMIES[key];
  const enemy = new Character(name || template.label);
  if (enemy.name === heroName) enemy.name += '（对手）';
  // A small, server-owned opponent stat block. Player class mechanics still use the original engine.
  enemy.classKey = 'fighter';
  enemy.classDef = { ...CLASSES.fighter, extraAttacks: 0 };
  enemy.skills = [];
  enemy.maxHP = enemy.currentHP = template.hp;
  enemy.tempHP = 0;
  enemy.ac = template.ac;
  enemy.attackBonus = template.attack;
  enemy.damageDie = template.die;
  enemy.damageBonus = template.bonus;
  enemy.initiative = 1;
  enemy.conditions.clear();
  return enemy;
}
class AdventureCombatEngine extends CombatEngine {
  // Preserve HP and limited-use resources. CombatEngine.fight() resets both actors for arena duels.
  fightEncounter() {
    const hero = this.char1, enemy = this.char2;
    const init = [this.rollD20() + hero.initiative, this.rollD20() + enemy.initiative];
    this.log({ type: 'initiative', data: { [hero.name]: init[0], [enemy.name]: init[1] } });
    const order = init[0] >= init[1] ? [hero, enemy] : [enemy, hero];
    let rounds = 0;
    for (this.round = 1; this.round <= 20 && hero.isAlive && enemy.isAlive; this.round++) {
      rounds = this.round;
      this.log({ type: 'round_start', data: { round: this.round } });
      for (const active of order) {
        const opponent = active === hero ? enemy : hero;
        if (!active.isAlive || !opponent.isAlive) break;
        active.startOfTurn();
        const skip = this.processStartOfTurn(active, opponent);
        if (active.isAlive && opponent.isAlive && !skip) this.chooseAndAct(active, opponent);
      }
    }
    // A timeout is a standoff in an adventure, not a forced death/victory.
    const outcome = !hero.isAlive ? 'defeat' : !enemy.isAlive ? 'victory' : 'standoff';
    this.log({ type: 'encounter_end', data: { outcome, heroHP: hero.currentHP, enemyHP: enemy.currentHP } });
    return { outcome, rounds, events: this.events };
  }
}
function resolveMechanics(state, plan) {
  if (plan.kind === 'start') return { kind: 'start', reason: '创建冒险开场。' };
  if (plan.kind === 'narrate') return { kind: 'narrate', reason: plan.reason };
  if (plan.kind === 'rest') {
    const before = state.character.hp;
    state.character = createCharacter(state.character.name, state.character.background);
    return { kind: 'rest', reason: plan.reason, beforeHP: before, hp: state.character.hp,
      hours: 8, resourcesRestored: true };
  }
  if (state.character.hp <= 0) throw new AppError(422, 'HERO_DOWN', '角色已失去行动能力，请先安排安全休整或叙事救援。');
  const rng = turnRNG(state);
  if (plan.kind === 'check') return resolveCheck(state.character, plan, rng);
  const hero = restore(state.character);
  const enemy = enemyCharacter(plan.opponent, plan.opponentName, hero.name);
  const beforeHP = hero.currentHP;
  const engine = new AdventureCombatEngine(hero, enemy);
  engine.rng = rng;
  const result = engine.fightEncounter();
  state.character = snapshot(hero, state.character.background);
  return { kind: 'combat', opponent: enemy.name, template: plan.opponent, reason: plan.reason,
    beforeHP, hp: hero.currentHP, tempHP: hero.tempHP, enemyHP: enemy.currentHP, ...result };
}
module.exports = { RULES_VERSION, ABILITIES, SKILLS, BACKGROUNDS, ENEMIES,
  createCharacter, restore, characterSheet, resolveCheck, resolveMechanics, AdventureCombatEngine };

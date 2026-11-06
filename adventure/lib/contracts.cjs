'use strict';
const { AppError } = require('./errors.cjs');
const { ABILITIES, SKILLS, ENEMIES } = require('./rules.cjs');
const object = properties => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const string = (minLength, maxLength) => ({ type: 'string', minLength, maxLength });
const enumeration = values => ({ type: 'string', enum: values });
const strings = (maxItems, maxLength) => ({ type: 'array', maxItems, items: string(1, maxLength) });
const PLAN_SCHEMA = object({
  kind: enumeration(['narrate', 'check', 'combat', 'rest']),
  ability: enumeration(ABILITIES), skill: enumeration(['none', ...Object.keys(SKILLS)]),
  dc: { type: 'integer', minimum: 5, maximum: 25 },
  mode: enumeration(['normal', 'advantage', 'disadvantage']),
  opponent: enumeration(Object.keys(ENEMIES)), opponentName: string(0, 60), reason: string(1, 400)
});
const NARRATION_SCHEMA = object({
  narrative: string(1, 5000), summary: string(1, 3000), location: string(1, 120),
  goal: string(1, 500), addItems: strings(8, 100), removeItems: strings(8, 100), newFacts: strings(6, 400)
});
// Validate locally as well as using OpenAI strict schemas. No model output is executable code.
function validate(value, schema, location = 'output') {
  const fail = () => { throw new AppError(502, 'INVALID_DM_OUTPUT', `DM 返回的数据不符合约定（${location}），请重试。`); };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    if (Object.keys(value).length !== schema.required.length) fail();
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) fail();
      validate(value[key], schema.properties[key], `${location}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) fail();
    value.forEach((item, i) => validate(item, schema.items, `${location}[${i}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail();
    if (schema.enum && !schema.enum.includes(value)) fail();
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) fail();
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail();
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) fail();
  }
  return value;
}
function validatePlan(plan) {
  validate(plan, PLAN_SCHEMA);
  if (plan.kind === 'check' && plan.skill !== 'none' && SKILLS[plan.skill] !== plan.ability) {
    throw new AppError(502, 'INVALID_DM_OUTPUT', 'DM 的技能与属性不匹配，请重试。');
  }
  return plan;
}
module.exports = { PLAN_SCHEMA, NARRATION_SCHEMA, validate, validatePlan };

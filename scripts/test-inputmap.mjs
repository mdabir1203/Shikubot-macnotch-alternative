// Test inputmap.js validation logic in Node (no browser needed).
// Mocks the StateMachineInstance with the right inputCount/input(i)/name/type.

import { INPUTMAP, STATE_NAMES, triggerForState, validateInputs } from '../shikubot/src/inputmap.js';

// Mock the SMIInput class with static number/bool/trigger constants
// (matches the real @rive-app/canvas-advanced API).
class SMIInput {
  static bool = 0;
  static number = 1;
  static trigger = 2;
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// ─── Test 1: triggerForState ─────────────────────────────────────
console.log('Test 1: triggerForState');
assert(triggerForState('idle') === 'goIdle', 'idle → goIdle');
assert(triggerForState('startled') === 'goStartled', 'startled → goStartled');
assert(triggerForState('sleepy') === 'goSleepy', 'sleepy → goSleepy');
assert(triggerForState('confused') === 'goConfused', 'confused → goConfused');
try {
  triggerForState('unknown');
  assert(false, 'unknown state should throw');
} catch (e) {
  assert(true, 'unknown state throws');
}

// ─── Test 2: validateInputs with a perfectly-matching SM ────────
console.log('Test 2: validateInputs (matching SM)');
{
  const mockInputs = [];
  for (const [name, spec] of Object.entries(INPUTMAP)) {
    mockInputs.push({
      name,
      type: spec.type === 'number' ? SMIInput.number : SMIInput.trigger,
      value: spec.default ?? 0,
      fire() { /* noop */ },
    });
  }
  const mockSM = {
    inputCount: () => mockInputs.length,
    input: (i) => mockInputs[i],
  };
  const cache = validateInputs(mockSM, SMIInput);
  assert(typeof cache === 'object', 'returns a cache object');
  assert(cache.gazeX.name === 'gazeX', 'cache.gazeX has right name');
  assert(cache.goStartled.type === SMIInput.trigger, 'cache.goStartled is trigger');
  assert(cache.lidL.type === SMIInput.number, 'cache.lidL is number');
}

// ─── Test 3: validateInputs fails LOUDLY on missing input ───────
console.log('Test 3: validateInputs fails on missing input');
{
  const mockInputs = [];
  for (const [name, spec] of Object.entries(INPUTMAP)) {
    if (name === 'gazeX') continue;
    mockInputs.push({ name, type: spec.type === 'number' ? SMIInput.number : SMIInput.trigger });
  }
  const mockSM = { inputCount: () => mockInputs.length, input: (i) => mockInputs[i] };
  try {
    validateInputs(mockSM, SMIInput);
    assert(false, 'should have thrown');
  } catch (e) {
    assert(/missing input: "gazeX"/.test(e.message), `error names missing input: ${e.message.slice(0, 80)}`);
  }
}

// ─── Test 4: validateInputs fails on wrong type ─────────────────
console.log('Test 4: validateInputs fails on wrong type');
{
  const mockInputs = [];
  for (const [name, spec] of Object.entries(INPUTMAP)) {
    let type = spec.type === 'number' ? SMIInput.number : SMIInput.trigger;
    if (name === 'blink') type = SMIInput.number;
    mockInputs.push({ name, type });
  }
  const mockSM = { inputCount: () => mockInputs.length, input: (i) => mockInputs[i] };
  try {
    validateInputs(mockSM, SMIInput);
    assert(false, 'should have thrown');
  } catch (e) {
    assert(/blink.*wrong type/.test(e.message), `error names wrong-type input: ${e.message.slice(0, 80)}`);
  }
}

// ─── Test 5: validateInputs fails on unexpected extra input ────
console.log('Test 5: validateInputs fails on unexpected runtime input');
{
  const mockInputs = [];
  for (const [name, spec] of Object.entries(INPUTMAP)) {
    mockInputs.push({ name, type: spec.type === 'number' ? SMIInput.number : SMIInput.trigger });
  }
  mockInputs.push({ name: 'extraInput', type: SMIInput.number });
  const mockSM = { inputCount: () => mockInputs.length, input: (i) => mockInputs[i] };
  try {
    validateInputs(mockSM, SMIInput);
    assert(false, 'should have thrown');
  } catch (e) {
    assert(/unexpected input.*extraInput/.test(e.message), `error names unexpected input: ${e.message.slice(0, 80)}`);
  }
}

// ─── Test 6: contract sanity ─────────────────────────────────────
console.log('Test 6: contract sanity');
let numCount = 0, trigCount = 0;
for (const [name, spec] of Object.entries(INPUTMAP)) {
  if (spec.type === 'number') {
    numCount++;
    assert(spec.min < spec.max, `${name}: min < max`);
    assert(spec.default >= spec.min && spec.default <= spec.max, `${name}: default in range`);
  } else {
    trigCount++;
  }
}
assert(numCount === 12, `12 number inputs (got ${numCount})`);
assert(trigCount === 7, `7 trigger inputs (got ${trigCount})`);
assert(STATE_NAMES.length === 6, `6 state names (got ${STATE_NAMES.length})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

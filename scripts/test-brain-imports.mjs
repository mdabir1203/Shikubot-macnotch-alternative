// Quick smoke test: verify brain.js's imports from inputmap.js resolve,
// and that the Brain class structure is sound (no syntax/import errors).
// Can't fully test Brain (needs browser APIs), but can verify the module
// graph + class shape.

import * as brainModule from '../shikubot/src/brain.js';
import * as inputmapModule from '../shikubot/src/inputmap.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('Test: brain.js exports');
assert(typeof brainModule.createBrain === 'function', 'createBrain is exported');
assert(typeof brainModule.createBrain === 'function', 'createBrain is a function');

console.log('Test: inputmap.js exports');
assert(typeof inputmapModule.INPUTMAP === 'object', 'INPUTMAP is exported');
assert(typeof inputmapModule.STATE_NAMES === 'object', 'STATE_NAMES is exported');
assert(typeof inputmapModule.triggerForState === 'function', 'triggerForState is exported');
assert(typeof inputmapModule.validateInputs === 'function', 'validateInputs is exported');

console.log('Test: inputmap contract shape');
const keys = Object.keys(inputmapModule.INPUTMAP);
assert(keys.length === 19, `19 inputs total (got ${keys.length})`);
const numKeys = keys.filter(k => inputmapModule.INPUTMAP[k].type === 'number');
const trigKeys = keys.filter(k => inputmapModule.INPUTMAP[k].type === 'trigger');
assert(numKeys.length === 12, `12 numbers (got ${numKeys.length})`);
assert(trigKeys.length === 7, `7 triggers (got ${trigKeys.length})`);

// Spot-check that all master-prompt names are present
const expectedNums = ['gazeX','gazeY','headTilt','earL','earR','lidL','lidR','mouthOpen','smile','wagSpeed','glassesLift','glassesCrooked'];
const expectedTrigs = ['blink','goIdle','goCurious','goExcited','goStartled','goSleepy','goConfused'];
for (const n of expectedNums) assert(inputmapModule.INPUTMAP[n]?.type === 'number', `${n} is number`);
for (const t of expectedTrigs) assert(inputmapModule.INPUTMAP[t]?.type === 'trigger', `${t} is trigger`);

console.log('Test: state name → trigger name mapping');
assert(inputmapModule.triggerForState('idle') === 'goIdle', 'idle → goIdle');
assert(inputmapModule.triggerForState('curious') === 'goCurious', 'curious → goCurious');
assert(inputmapModule.triggerForState('excited') === 'goExcited', 'excited → goExcited');
assert(inputmapModule.triggerForState('startled') === 'goStartled', 'startled → goStartled');
assert(inputmapModule.triggerForState('sleepy') === 'goSleepy', 'sleepy → goSleepy');
assert(inputmapModule.triggerForState('confused') === 'goConfused', 'confused → goConfused');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

// src/inputmap.js — THE single source of truth for every Rive input
// name, type, and range. Per master prompt contract.
//
// If a name must change, update this file + scene.rml in the same commit.
// Runtime validates all inputs exist on init (see validateInputs below).

/**
 * @typedef {Object} InputSpec
 * @property {'number'|'trigger'} type
 * @property {number} [min]           — for numbers, the minimum value
 * @property {number} [max]           — for numbers, the maximum value
 * @property {number} [default]      — for numbers, the default value
 * @property {string} [note]          — optional note (e.g. "1=closed")
 */

/**
 * The verbatim contract from the master prompt.
 * Numbers map to StateMachineNumber; triggers map to StateMachineTrigger.
 * Order doesn't matter; runtime inputs are looked up by name.
 */
export const INPUTMAP = Object.freeze({
  // ── NUMBER inputs (per-frame values the brain writes) ──────────────
  gazeX:          { type: 'number', min: -1, max:  1, default:  0 },
  gazeY:          { type: 'number', min: -1, max:  1, default:  0 },
  headTilt:       { type: 'number', min: -1, max:  1, default:  0 },
  earL:           { type: 'number', min: -1, max:  1, default:  0 },
  earR:            { type: 'number', min: -1, max:  1, default:  0 },
  lidL:           { type: 'number', min:  0, max:  1, default:  0, note: '1=closed' },
  lidR:           { type: 'number', min:  0, max:  1, default:  0, note: '1=closed' },
  mouthOpen:      { type: 'number', min:  0, max:  1, default:  0 },
  smile:          { type: 'number', min: -1, max:  1, default:  0 },
  wagSpeed:       { type: 'number', min:  0, max:  1, default: 0.3, note: 'blend TailIdle→TailWag' },
  glassesLift:    { type: 'number', min: -1, max:  1, default:  0 },
  glassesCrooked: { type: 'number', min:  0, max:  1, default:  0 },

  // ── TRIGGER inputs (fired by brain.shiku.go(name) + blink schedule) ─
  blink:          { type: 'trigger' },
  goIdle:         { type: 'trigger' },
  goCurious:      { type: 'trigger' },
  goExcited:      { type: 'trigger' },
  goStartled:     { type: 'trigger' },
  goSleepy:       { type: 'trigger' },
  goConfused:     { type: 'trigger' },
});

/**
 * The 6 states the Brain state machine can be in. Matches scene.rml's
 * StateSequencing layer AnimationState ids.
 */
export const STATE_NAMES = Object.freeze([
  'idle', 'curious', 'excited', 'startled', 'sleepy', 'confused',
]);

/**
 * Convert a state name to its trigger input name.
 *   'startled' → 'goStartled'
 *   'idle'     → 'goIdle'
 * Throws on unknown states (defensive — should never happen).
 */
export function triggerForState(stateName) {
  if (!STATE_NAMES.includes(stateName)) {
    throw new Error(`[inputmap] unknown state: ${stateName}`);
  }
  const cap = stateName[0].toUpperCase() + stateName.slice(1);
  return `go${cap}`;
}

/**
 * Validate that the runtime exposes every input declared in INPUTMAP,
 * with the correct type. Throws on mismatch — per master prompt:
 *   "Changing any name in inputmap.js breaks loudly (runtime validates
 *    all inputs exist)"
 *
 * @param {object} sm - StateMachineInstance from `new rive.StateMachineInstance(sm, artboard)`
 * @param {object} SMIInput - the SMIInput class from the rive instance (rive.SMIInput)
 * @returns {Object<string, object>} - map of input name → SMIInput reference, for caching
 */
export function validateInputs(sm, SMIInput) {
  if (!sm) throw new Error('[inputmap] stateMachineInstance is required');
  if (!SMIInput || typeof SMIInput.number !== 'number') {
    throw new Error('[inputmap] SMIInput class is required (pass rive.SMIInput)');
  }

  const count = sm.inputCount();
  const found = new Map();
  for (let i = 0; i < count; i++) {
    const input = sm.input(i);
    found.set(input.name, input);
  }

  const errors = [];

  // 1. Every input in INPUTMAP must exist on the runtime with the right type.
  for (const [name, spec] of Object.entries(INPUTMAP)) {
    const input = found.get(name);
    if (!input) {
      errors.push(`missing input: "${name}" (expected ${spec.type})`);
      continue;
    }
    const expectedType = spec.type === 'number' ? SMIInput.number : SMIInput.trigger;
    if (input.type !== expectedType) {
      errors.push(
        `input "${name}" has wrong type: expected ${spec.type} (${expectedType}), got ${input.type}`,
      );
    }
    // Range check for numbers (default must be within min..max)
    if (spec.type === 'number') {
      if (spec.default < spec.min || spec.default > spec.max) {
        errors.push(
          `input "${name}" default ${spec.default} outside range [${spec.min}, ${spec.max}]`,
        );
      }
    }
  }

  // 2. Runtime inputs not declared in INPUTMAP are a contract drift — fail loudly.
  for (const [name] of found) {
    if (!INPUTMAP[name]) {
      errors.push(`unexpected input on runtime: "${name}" (not in inputmap.js)`);
    }
  }

  if (errors.length > 0) {
    const msg = `[inputmap] contract mismatch:\n  ${errors.join('\n  ')}`;
    console.error(msg);
    throw new Error(msg);
  }

  // Return a name→input map for the brain to cache.
  const cache = {};
  for (const [name] of Object.entries(INPUTMAP)) {
    cache[name] = found.get(name);
  }
  console.log(
    `[inputmap] ✓ ${count} inputs match contract ` +
    `(${Object.keys(INPUTMAP).length} declared, ${count} on runtime)`,
  );
  return cache;
}

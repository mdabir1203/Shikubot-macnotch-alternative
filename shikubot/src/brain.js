// src/brain.js — the mind. Per master prompt:
//   "JS owns the mind: springs, gaze, state machine, particles"
//   "Rive owns the body: bones, joysticks, anims, states (shiku.riv)"
//
// Hybrid physics (per Phase 1 decision):
//   - Ease-outs for body/ears/head-tilt/gaze (per bloub's measured physics:
//     transitions are exponential ease-outs, body never overshoots).
//   - Critically-damped springs for glasses wobble on startle (1.2s recovery,
//     ω=13 ζ=1 per master prompt) + sparkle particle decay.
//   - Sinusoidal oscillation for tail wag (0.7s cycle).
//
// Layered perception (per master prompt):
//   "ears ω=14 → headTilt ω=8 → gaze ω=10 with 90ms delay (attention forming)"
//   Mouse sweep → ears move first, head tilts second, gaze settles last.
//
// Pointer perception (per bloub):
//   - window 'pointermove' + document 'pointerleave' (no Rive listener)
//   - Re-read getBoundingClientRect each frame (NaN guard)
//   - Normalize against half-WINDOW, not avatar size (gaze saturates at screen edge)
//   - Reject touch input (would freeze gaze)
//   - yaw/pitch are ABSOLUTE (state changes don't drag eyes)

import { INPUTMAP, STATE_NAMES, triggerForState, validateInputs } from './inputmap.js';

// ── helpers ────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// Exponential ease-out per bloub's measured physics:
//   x += (target - x) * (1 - exp(-ω * dt))
// Critically-damped feel, NEVER overshoots.
// Settling time ≈ 4/ω (so ω=13 → ~0.31s, matches master prompt "0.3s settle").
function expEase(current, target, omega, dt) {
  const k = 1 - Math.exp(-omega * dt);
  return current + (target - current) * k;
}

// Deterministic PRNG (mulberry32) — per bloub's particle pattern.
// Same seed → same sequence. Useful for reproducible particle effects.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── particles ──────────────────────────────────────────────────────────

// Star burst (startled state): 5 particles spiraling inward, per bloub's
// `burst` state. Spiral: rho *= 0.75^(u*10), angle += 100°/s.
class StarParticle {
  constructor({ angle, rho, birth = 0, life = 0.62 }) {
    this.angle = angle;
    this.rho = rho;
    this.life = life;
    this.age = -birth; // negative = not yet visible (staggered birth)
    this.cx = 256; // artboard center, where the burst originates
    this.cy = 256;
    this.scale = 256; // normalize rho (0..1) → pixels
  }
  update(dt) {
    this.age += dt;
    if (this.age < 0) return;
    this.rho *= Math.pow(0.75, dt * 10);
    this.angle += (100 * Math.PI / 180) * dt;
  }
  render(ctx) {
    if (this.age < 0) return;
    const fadeIn = clamp(this.age / 0.06, 0, 1);
    const fadeOut = clamp((this.life - this.age) / 0.08, 0, 1);
    const alpha = fadeIn * fadeOut;
    const r = (4 + 6 * clamp(this.age / 0.55, 0, 1));
    const x = this.cx + Math.cos(this.angle) * this.rho * this.scale;
    const y = this.cy + Math.sin(this.angle) * this.rho * this.scale;
    ctx.fillStyle = `rgba(255, 220, 100, ${alpha})`;
    ctx.beginPath();
    // 5-point star
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
}

// Sparkles (excited state): small bright dots that drift outward + fade.
class SparkleParticle {
  constructor({ x, y, vx, vy, life = 0.8 }) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.age = 0;
  }
  update(dt) {
    this.age += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 0.3 * dt; // slight gravity
  }
  render(ctx) {
    const fadeIn = clamp(this.age / 0.1, 0, 1);
    const fadeOut = clamp((this.life - this.age) / 0.2, 0, 1);
    const alpha = fadeIn * fadeOut;
    const cx = 256 + this.x * 256;
    const cy = 256 + this.y * 256;
    ctx.fillStyle = `rgba(255, 240, 180, ${alpha})`;
    ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  }
}

// Z-z-z (sleepy state): floating "z" letters that drift up + fade.
class ZParticle {
  constructor({ x, y, life = 2.5, offset = 0 }) {
    this.x = x;
    this.y = y;
    this.life = life;
    this.age = -offset; // staggered
    this.driftX = 0.05 + Math.random() * 0.03;
  }
  update(dt) {
    this.age += dt;
    if (this.age < 0) return;
    this.x += this.driftX * dt;
    this.y -= 0.08 * dt; // drift up
  }
  render(ctx) {
    if (this.age < 0) return;
    const fadeIn = clamp(this.age / 0.3, 0, 1);
    const fadeOut = clamp((this.life - this.age) / 0.5, 0, 1);
    const alpha = fadeIn * fadeOut * 0.8;
    const cx = 256 + this.x * 256;
    const cy = 256 + this.y * 256;
    const size = 10 + this.age * 4;
    ctx.fillStyle = `rgba(180, 220, 255, ${alpha})`;
    ctx.font = `${size}px sans-serif`;
    ctx.fillText('z', cx, cy);
  }
}

// Confetti (wake from sleepy): brief burst when waking up.
class ConfettiParticle {
  constructor({ angle, speed, life = 1.5 }) {
    this.x = 0;
    this.y = 0;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.life = life;
    this.age = 0;
    this.rot = Math.random() * TAU;
    this.vrot = (Math.random() - 0.5) * 8;
    const palette = ['#D95B2B', '#F08A3F', '#A9B44E', '#8E9A3B', '#FFFFFF'];
    this.color = palette[Math.floor(Math.random() * palette.length)];
  }
  update(dt) {
    this.age += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 0.8 * dt; // gravity
    this.rot += this.vrot * dt;
  }
  render(ctx) {
    const fadeIn = clamp(this.age / 0.05, 0, 1);
    const fadeOut = clamp((this.life - this.age) / 0.3, 0, 1);
    const alpha = fadeIn * fadeOut;
    const cx = 256 + this.x * 256;
    const cy = 256 + this.y * 256;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }
}

// ── the brain ──────────────────────────────────────────────────────────

class Brain {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.riveCanvas - the canvas Rive renders to
   * @param {HTMLCanvasElement} opts.particlesCanvas - the overlay canvas (on top)
   * @param {Object} opts.rive - the rive instance from `await Rive({ locateFile })`
   * @param {Object} opts.file - the loaded Rive File from `rive.load(bytes)`
   * @param {Object} opts.artboard - artboard instance from `file.defaultArtboard()`
   * @param {Object} opts.stateMachineInstance - StateMachineInstance from `new rive.StateMachineInstance(sm, artboard)`
   */
  constructor({ riveCanvas, particlesCanvas, rive, file, artboard, stateMachineInstance: sm }) {
    this.riveCanvas = riveCanvas;
    this.particlesCanvas = particlesCanvas;
    this.rive = rive;
    this.file = file;
    this.artboard = artboard;
    this.sm = sm;

    // 1. Validate the runtime exposes all 19 contract inputs (throws on mismatch).
    this.inputs = validateInputs(sm, rive.SMIInput);

    // 2. Look up artboard shapes by name (for direct per-frame writes).
    //    Per Phase 1 decision: boneless + direct writes (no bones for v1).
    this.shapes = this.lookupShapes();

    // 3. Pointer perception state (ease-outs, layered ω per master prompt).
    this.pointer = null; // {x, y} in window coords, or null
    this.perception = {
      ears: { x: 0 },         // ω=14, fastest
      headTilt: { x: 0 },    // ω=8, medium
      gaze: { x: 0, y: 0 },  // ω=10, slowest (90ms delay approximated by slower ω)
    };

    // 4. Spring state (only for glasses wobble + recovery on startle).
    // Critically-damped: x'' = -ω²(x - target) - 2ωx'  with ω=13, ζ=1.
    // Master prompt: "head-tilt settle 0.3s (ω≈13, ζ=1)" — repurposed for glasses.
    this.glassesSpring = { pos: 0, vel: 0, target: 0 };

    // 5. Current target values (the brain's per-frame "what should be").
    // These are written to inputs (contract) + artboard shapes (visual).
    this.target = {
      gazeX: 0, gazeY: 0, headTilt: 0,
      earL: 0, earR: 0,
      lidL: 0, lidR: 0,
      mouthOpen: 0, smile: 0,
      wagSpeed: 0.3, // idle default
      glassesLift: 0, glassesCrooked: 0,
    };

    // 6. State tracking.
    this.state = 'idle';
    this.stateChangedAt = 0;
    this.lastBlinkAt = 0;
    this.blinkInterval = 3.0; // seconds between blinks

    // 7. Poke counter (for dizzy acceptance test).
    this.pokeCount = 0;
    this.lastPokeAt = -1;

    // 8. Particles.
    this.particles = [];
    this.particleRng = mulberry32(0x5EED);

    // 9. rAF loop state (per bloub: bounded dt, single loop).
    this.raf = 0;
    this.clock = 0;
    this.lastFrame = 0;
    this.tabHiddenSince = 0;

    // Bind handlers (so removeEventListener works).
    this.tick = this.tick.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);

    // Start.
    this.start();
  }

  lookupShapes() {
    // Direct lookup via artboard.node(name). Per Phase 1 RML, the shape names are:
    //   head, body, earL, earR, hairTuft, glasses, mouth,
    //   eyeL_sclera, eyeL_pupil, eyeL_lid, eyeR_sclera, eyeR_pupil, eyeR_lid,
    //   tail1..tail6.
    const names = [
      'head', 'body', 'earL', 'earR', 'hairTuft', 'glasses', 'mouth',
      'eyeL_sclera', 'eyeL_pupil', 'eyeL_lid',
      'eyeR_sclera', 'eyeR_pupil', 'eyeR_lid',
      'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6',
    ];
    const shapes = {};
    for (const name of names) {
      const node = this.artboard.node(name);
      if (!node) {
        console.warn(`[brain] artboard.node("${name}") returned null — direct writes will be skipped`);
      }
      shapes[name] = node;
    }
    return shapes;
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  start() {
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.raf = requestAnimationFrame(this.tick);
    console.log('[brain] started. window.shiku = { go, poke, pet }');
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  // ── pointer perception (per bloub) ────────────────────────────────

  onPointerMove(e) {
    // Touch has no hover: a lifted finger would freeze gaze on last touch.
    if (e.pointerType === 'touch') return;
    this.pointer = { x: e.clientX, y: e.clientY };
  }

  onPointerLeave() {
    this.pointer = null;
  }

  onVisibilityChange() {
    if (document.hidden) {
      this.tabHiddenSince = this.clock;
      // Per master prompt: "tab hidden → sleepy state within 2s"
      setTimeout(() => {
        if (document.hidden && this.state !== 'sleepy') {
          this.go('sleepy');
        }
      }, 2000);
    } else {
      // Tab regained focus — wake from sleepy if we were asleep.
      if (this.state === 'sleepy') {
        this.spawnConfetti();
        this.go('curious');
      }
      this.tabHiddenSince = 0;
    }
  }

  // ── public API ────────────────────────────────────────────────────

  /**
   * Transition to a named state. Fires the corresponding goXxx trigger
   * on the Rive state machine, then sets up state-specific springs/particles.
   */
  go(name) {
    if (!STATE_NAMES.includes(name)) {
      console.warn(`[shiku.go] unknown state: "${name}". Valid: ${STATE_NAMES.join(', ')}`);
      return;
    }
    const triggerName = triggerForState(name);
    const input = this.inputs[triggerName];
    if (!input) {
      console.error(`[shiku.go] trigger input not found: ${triggerName}`);
      return;
    }
    input.fire();
    const prevState = this.state;
    this.state = name;
    this.stateChangedAt = this.clock;
    console.log(`[shiku.go] ${prevState} → ${name} (fired ${triggerName})`);

    // State-specific setup (springs + particles, per master prompt states spec).
    switch (name) {
      case 'startled':
        // Glasses knock-up + crooked, then critically-damped spring recover
        // over 1.2s. Per master prompt: "startled→recovery 1.2s ... own
        // spring recovers ~1.2s wobble".
        this.glassesSpring.target = 0;
        this.glassesSpring.pos = 1.5;     // knocked up to +1.5
        this.glassesSpring.vel = 0;
        this.spawnStarBurst();
        break;
      case 'excited':
        // Wide eyes + sparkles + fast wag.
        this.spawnSparkles(8);
        break;
      case 'sleepy':
        // Z-z-z particles spawn periodically in tick() while in this state.
        break;
      case 'curious':
        // Ears radar pose + double-blink handled in computePerception.
        break;
      case 'confused':
        // Dizzy state — slow spin particles?
        break;
      case 'idle':
        // Default — no special setup.
        break;
    }
  }

  /**
   * Poke the bot. 3 pokes within 1 second → dizzy (confused state).
   * Otherwise just a small startled reaction.
   * Per master prompt acceptance test: "shiku.poke() ×3 → dizzy".
   */
  poke() {
    const now = this.clock;
    if (now - this.lastPokeAt > 1.0) this.pokeCount = 0;
    this.pokeCount++;
    this.lastPokeAt = now;

    if (this.pokeCount >= 3) {
      this.go('confused'); // dizzy
      this.pokeCount = 0;
    } else {
      // Small reaction: brief startled with weaker glasses knock.
      this.glassesSpring.target = 0;
      this.glassesSpring.pos = Math.max(this.glassesSpring.pos, 0.8);
      this.spawnStarBurst();
    }
  }

  /**
   * Pet the bot. Calms it down — from startled or sleepy → curious.
   */
  pet() {
    if (this.state === 'startled' || this.state === 'sleepy' || this.state === 'confused') {
      this.go('curious');
    }
  }

  // ── main loop (single rAF, bounded dt per bloub) ──────────────────

  tick(ms) {
    this.raf = requestAnimationFrame(this.tick);
    // Bounded dt: an inactive tab doesn't jump forward on refocus.
    // (rAF is suspended while hidden, but the first frame after refocus
    // would otherwise have a huge dt.)
    const dt = this.lastFrame ? Math.min((ms - this.lastFrame) / 1000, 0.064) : 0;
    this.lastFrame = ms;
    this.clock += dt;

    // 1. Compute per-frame perception (ease-outs, layered ω).
    this.computePerception(dt);

    // 2. Update springs (glasses wobble) with fixed 1/120s substep.
    this.updateSprings(dt);

    // 3. Update + spawn particles.
    this.updateParticles(dt);
    this.maybeSpawnStateParticles();

    // 4. Advance Rive state machine + artboard.
    //    The SM plays the current state's animation; the artboard applies
    //    any animation keyframes. Our per-frame writes (in writeArtboard)
    //    happen AFTER this and override for the current frame.
    this.sm.advance(dt);
    this.artboard.advance(dt);

    // 5. Write per-frame values to StateMachineNumber inputs (for the contract).
    this.writeInputs();

    // 6. Write per-frame values directly to artboard shapes (for visual).
    //    These override any state animation keyframes for the same properties.
    this.writeArtboard();

    // 7. Render particle overlay.
    this.renderParticles();
  }

  // ── perception (ease-outs, layered ω per master prompt) ───────────

  computePerception(dt) {
    // Convert pointer → normalized -1..1 relative to canvas center,
    // divided by half-WINDOW (not avatar size) per bloub. Saturates at screen edge.
    let nx = 0, ny = 0;
    if (this.pointer) {
      const box = this.riveCanvas.getBoundingClientRect();
      // NaN guard: getBoundingClientRect on a hidden pane returns 0/0,
      // and the perception KEEPS the last target — one NaN poisons it forever.
      if (box.width > 0 && box.height > 0) {
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const halfW = Math.max(1, window.innerWidth / 2);
        const halfH = Math.max(1, window.innerHeight / 2);
        nx = clamp((this.pointer.x - cx) / halfW, -1, 1);
        ny = clamp((this.pointer.y - cy) / halfH, -1, 1);
      }
    }

    // Layered perception (master prompt: ears ω=14 → headTilt ω=8 → gaze ω=10).
    // Mouse sweep → ears move first, head tilts second, gaze settles last.
    const earTarget = nx * 0.7;
    this.perception.ears.x = expEase(this.perception.ears.x, earTarget, 14, dt);

    const tiltTarget = nx * 0.5;
    this.perception.headTilt.x = expEase(this.perception.headTilt.x, tiltTarget, 8, dt);

    const gazeTargetX = nx * 1.0;
    const gazeTargetY = ny * 1.0;
    this.perception.gaze.x = expEase(this.perception.gaze.x, gazeTargetX, 10, dt);
    this.perception.gaze.y = expEase(this.perception.gaze.y, gazeTargetY, 10, dt);

    // Default targets = perception output.
    this.target.gazeX = this.perception.gaze.x;
    this.target.gazeY = this.perception.gaze.y;
    this.target.headTilt = this.perception.headTilt.x;
    this.target.earL = this.perception.ears.x;
    this.target.earR = this.perception.ears.x;
    this.target.lidL = 0;
    this.target.lidR = 0;
    this.target.mouthOpen = 0;
    this.target.smile = 0;
    this.target.wagSpeed = 0.3;

    // State-specific overrides (per master prompt states spec).
    switch (this.state) {
      case 'idle':
        // Blink cycle (every blinkInterval seconds, 100ms blink).
        if (this.clock - this.lastBlinkAt > this.blinkInterval) {
          this.lastBlinkAt = this.clock;
        }
        const sinceBlink = this.clock - this.lastBlinkAt;
        if (sinceBlink < 0.1) {
          this.target.lidL = 1;
          this.target.lidR = 1;
        }
        this.target.smile = 0.3;
        this.target.wagSpeed = 0.3;
        break;
      case 'curious':
        // Pupils big + double-blink + small o + ears radar + tail still.
        this.target.earL = 1;  // alert
        this.target.earR = 1;
        this.target.wagSpeed = 0;  // tail still
        this.target.mouthOpen = 0.2; // small o
        // Double-blink: faster blink cycle for 1 second after entering
        const sinceEntered = this.clock - this.stateChangedAt;
        if (sinceEntered < 1.0) {
          const phase = sinceEntered % 0.35;
          if (phase < 0.1) {
            this.target.lidL = 1;
            this.target.lidR = 1;
          }
        }
        break;
      case 'excited':
        // Wide eyes + glasses push-up + glint + mouth open + fast wag + sparkles.
        this.target.lidL = 0;
        this.target.lidR = 0;
        this.target.glassesLift = 1;  // pushed up (brain's spring would override this in real impl, but for excited we set it directly)
        this.target.mouthOpen = 0.8;
        this.target.wagSpeed = 1.0;
        // Talk flap: 6Hz mouthOpen oscillation per master prompt.
        this.target.mouthOpen = 0.4 + 0.4 * Math.sin(this.clock * 6 * TAU);
        break;
      case 'confused':
        // Squint over rims + glasses slide down + wavy mouth + one ear folds.
        this.target.lidL = 0.3;
        this.target.lidR = 0.3;
        this.target.glassesLift = -0.5;
        this.target.earL = -1;  // one ear folds
        this.target.smile = -0.5;  // wavy/frown
        break;
      case 'startled':
        // Huge eyes + glasses knocked up+crooked (spring handles wobble)
        // + ears flat + tail puff + star burst.
        this.target.lidL = 0;
        this.target.lidR = 0;
        this.target.earL = -1;  // ears flat
        this.target.earR = -1;
        // glassesLift is driven by the spring (see updateSprings).
        break;
      case 'sleepy':
        // Lids 70% + glasses at nose tip + yawn loop + z-z-z.
        this.target.lidL = 0.7;
        this.target.lidR = 0.7;
        this.target.glassesLift = -1;  // at nose tip
        this.target.wagSpeed = 0;  // tail still
        // Yawn: mouthOpen slowly oscillates 0 → 0.6 → 0 over 2.5s
        const yawnPhase = (this.clock * 0.4) % 1;
        this.target.mouthOpen = Math.sin(yawnPhase * Math.PI) * 0.6;
        break;
    }
  }

  // ── springs (only for glasses wobble on startle) ───────────────────

  updateSprings(dt) {
    // Critically-damped spring for glasses wobble recovery on startle.
    // Master prompt: ω≈13, ζ=1. Fixed 1/120s substep for stability.
    const substeps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const subDt = dt / substeps;
    const ω = 13;
    const ω2 = ω * ω;
    for (let i = 0; i < substeps; i++) {
      // x'' = -ω²(x - target) - 2ωx'  (critically-damped: ζ=1)
      const accel = -ω2 * (this.glassesSpring.pos - this.glassesSpring.target)
                  - 2 * ω * this.glassesSpring.vel;
      this.glassesSpring.vel += accel * subDt;
      this.glassesSpring.pos += this.glassesSpring.vel * subDt;
    }
    // The spring's position IS the glassesLift value.
    // Only write to target.glassesLift if we're in (or recovering from) startled.
    // Otherwise let the state-specific overrides win.
    if (this.state === 'startled' ||
        Math.abs(this.glassesSpring.pos) > 0.01 ||
        Math.abs(this.glassesSpring.vel) > 0.01) {
      this.target.glassesLift = this.glassesSpring.pos;
      this.target.glassesCrooked = clamp(Math.abs(this.glassesSpring.pos) * 0.3, 0, 1);
    }
  }

  // ── particles ──────────────────────────────────────────────────────

  spawnStarBurst() {
    // 5 particles spiraling inward (per bloub's `burst` state).
    for (let i = 0; i < 5; i++) {
      this.particles.push(new StarParticle({
        angle: (i / 5) * TAU,
        rho: 0.58 + this.particleRng() * 0.18,
        birth: i * 0.05,
        life: 0.62,
      }));
    }
  }

  spawnSparkles(count = 8) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new SparkleParticle({
        x: (this.particleRng() - 0.5) * 0.6,
        y: (this.particleRng() - 0.5) * 0.6,
        vx: (this.particleRng() - 0.5) * 0.4,
        vy: -this.particleRng() * 0.3,
        life: 0.6 + this.particleRng() * 0.4,
      }));
    }
  }

  spawnZParticles() {
    this.particles.push(new ZParticle({
      x: 0.2 + this.particleRng() * 0.1,
      y: 0.2 + this.particleRng() * 0.1,
      life: 2.5,
      offset: 0,
    }));
  }

  spawnConfetti() {
    for (let i = 0; i < 30; i++) {
      const angle = this.particleRng() * TAU;
      const speed = 0.3 + this.particleRng() * 0.4;
      this.particles.push(new ConfettiParticle({
        angle, speed,
        life: 1.0 + this.particleRng() * 0.5,
      }));
    }
  }

  updateParticles(dt) {
    // Update existing particles; cull expired.
    const next = [];
    for (const p of this.particles) {
      p.update(dt);
      if (p.age < p.life) next.push(p);
    }
    this.particles = next;
  }

  maybeSpawnStateParticles() {
    // Sleepy state spawns periodic Z particles.
    if (this.state === 'sleepy') {
      // Spawn a new Z every ~1.2s
      if (!this._lastZAt || this.clock - this._lastZAt > 1.2) {
        this._lastZAt = this.clock;
        this.spawnZParticles();
      }
    }
  }

  renderParticles() {
    const ctx = this.particlesCanvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);
    for (const p of this.particles) p.render(ctx);
  }

  // ── write to runtime inputs (contract) ─────────────────────────────

  writeInputs() {
    // Write all 12 number values to StateMachineNumber inputs.
    // These don't drive blend states in Phase 1, but the contract requires
    // them to be written per-frame (future SM conditions may consume them).
    for (const [name, spec] of Object.entries(INPUTMAP)) {
      if (spec.type !== 'number') continue;
      const input = this.inputs[name];
      if (!input) continue;
      const val = this.target[name] ?? spec.default;
      // Clamp to declared range (defensive — prevents NaN / out-of-range writes).
      input.value = clamp(val, spec.min, spec.max);
    }
  }

  // ── write to artboard shapes (visual) ──────────────────────────────

  writeArtboard() {
    const s = this.shapes;
    if (!s.head) return; // lookup failed; nothing to write.

    // ── Gaze: pupil position (±4px) + 2px head parallax ──────────────
    // Per master prompt: "Gaze ±1 maps eyes+pupil+2px head parallax"
    if (s.eyeL_pupil) {
      s.eyeL_pupil.x = 226 + this.target.gazeX * 4;
      s.eyeL_pupil.y = 180 + this.target.gazeY * 4;
    }
    if (s.eyeR_pupil) {
      s.eyeR_pupil.x = 286 + this.target.gazeX * 4;
      s.eyeR_pupil.y = 180 + this.target.gazeY * 4;
    }

    // ── Head tilt: ±12° rotation + 2px parallax ──────────────────────
    // Per master prompt: "Tilt ±12° head rot"
    s.head.rotation = this.target.headTilt * (12 * Math.PI / 180);
    s.head.x = 256 + this.target.gazeX * 2; // 2px parallax

    // ── Ears: ±20° (±0.35 rad) for alert/droop ───────────────────────
    // Per master prompt: "EarL/R −1 droop..+1 alert"
    if (s.earL) s.earL.rotation = this.target.earL * 0.35;
    if (s.earR) s.earR.rotation = this.target.earR * 0.35;

    // ── Lids: scaleY 0..1 (1=closed) ──────────────────────────────────
    // Lid is a rectangle that covers the eye when scaleY=1.
    // Anchor is the top of the lid, so scaleY closes downward.
    // (For Phase 1 we use simple scale; could refine with anchor later.)
    if (s.eyeL_lid) s.eyeL_lid.scaleY = this.target.lidL;
    if (s.eyeR_lid) s.eyeR_lid.scaleY = this.target.lidR;

    // ── Mouth: scaleY for open, rotation for smile ────────────────────
    if (s.mouth) {
      s.mouth.scaleY = 1 + this.target.mouthOpen * 1.5;
      s.mouth.rotation = this.target.smile * 0.2;
    }

    // ── Glasses: ±10px y lift, ±0.2 rad crooked ───────────────────────
    // Per master prompt: glassesLift -1..1, glassesCrooked 0..1.
    if (s.glasses) {
      s.glasses.y = 180 - this.target.glassesLift * 10;
      s.glasses.rotation = this.target.glassesCrooked * 0.2;
    }

    // ── Tail wag: 6 segments oscillating with phase offset ───────────
    // Per master prompt: "tail wag cycle 0.7s" → ω = 2π/0.7 ≈ 8.98 rad/s
    // Master prompt: "wagSpeed 0..1 (blend TailIdle→TailWag)" — 0=still, 1=fast.
    const wagFreq = TAU / 0.7; // rad/s
    const wagAmp = 0.3 + this.target.wagSpeed * 0.5; // 0.3..0.8 rad
    for (let i = 1; i <= 6; i++) {
      const shape = s[`tail${i}`];
      if (!shape) continue;
      const phase = (i - 1) * 0.2; // chain delay per segment
      shape.rotation = Math.sin(this.clock * wagFreq - phase) * wagAmp * (i / 6);
    }
  }
}

// ── public factory ─────────────────────────────────────────────────────

/**
 * Create a Brain instance and expose window.shiku = { go, poke, pet }.
 * @param {Object} opts — see Brain constructor.
 * @returns {Brain}
 */
export function createBrain(opts) {
  const brain = new Brain(opts);
  // Public API on window (per master prompt acceptance tests).
  window.shiku = {
    go: (name) => brain.go(name),
    poke: () => brain.poke(),
    pet: () => brain.pet(),
    // Debug access (not in contract but useful):
    brain,
    get state() { return brain.state; },
    get clock() { return brain.clock; },
  };
  return brain;
}

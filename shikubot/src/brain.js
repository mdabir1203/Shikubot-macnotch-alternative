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

// ── funky extended particles (Phase 4) ────────────────────────────────

// OrbitRing: a 3D circle in orthographic projection. The z-component splits
// each arc into a front + back half — back half drawn first (occluded by
// body), front half drawn after (on top of body). Per bloub's orbit state.
class OrbitRing {
  constructor({ tilt, speed, phase, sweep, hue, cx = 256, cy = 256, scale = 200 }) {
    this.tilt = tilt;       // rotation of the ring's plane around X axis
    this.speed = speed;     // rad/s (around Y axis)
    this.phase = phase;     // starting angle
    this.sweep = sweep;     // arc length (0..1) of the visible portion
    this.hue = hue;         // HSL hue (0..360)
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;     // base radius in pixels
    this.radius = 0.85;     // ring radius (fraction of scale)
    this.flattening = 0.18; // orthographic flattening (0 = circle, 1 = line)
    this.alpha = 1;
  }
  update(dt) {
    this.phase += this.speed * dt;
  }
  // Draw the BACK half (z<0) — called BEFORE the body is drawn.
  renderBack(ctx) {
    this._renderHalf(ctx, true);
  }
  // Draw the FRONT half (z>0) — called AFTER the body is drawn.
  renderFront(ctx) {
    this._renderHalf(ctx, false);
  }
  _renderHalf(ctx, isBack) {
    const N = 32;
    const r = this.radius * this.scale;
    const flat = this.flattening;
    const sin = Math.sin(this.tilt);
    const cos = Math.cos(this.tilt);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= N; i++) {
      const a = this.phase + (i / N) * TAU * this.sweep;
      // 3D point on a circle of radius r in the XY plane
      const x3 = Math.cos(a) * r;
      const y3 = Math.sin(a) * r;
      // Rotate around X axis by `tilt`
      const yr = y3 * cos - 0 * sin;
      const zr = y3 * sin + 0 * cos;
      // Orthographic project (drop z)
      const px = this.cx + x3;
      const py = this.cy + yr * flat;
      // Depth test: isBack = z < 0, !isBack = z >= 0
      if ((isBack && zr < 0) || (!isBack && zr >= 0)) {
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      } else if (started) {
        // segment break — stroke what we have, start fresh
        ctx.strokeStyle = `hsla(${this.hue}, 55%, 60%, ${this.alpha})`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.beginPath();
        started = false;
      }
    }
    if (started) {
      ctx.strokeStyle = `hsla(${this.hue}, 55%, 60%, ${this.alpha})`;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
}

// CometRibbon: 4 flat arcs spinning at 210°/s around a stationary dot.
// Per bloub's comet state: the dot stays put, the trail orbits it.
class CometRibbon {
  constructor({ angle, tilt, speed = 210 * Math.PI / 180, phase, hue, cx = 256, cy = 256, scale = 200 }) {
    this.angle = angle;       // base angle around the dot
    this.tilt = tilt;         // rotation of the ribbon's plane
    this.speed = speed;
    this.phase = phase;
    this.hue = hue;
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
    this.radius = 0.85;
    this.flattening = 0.176;
    this.sweep = 0.6;        // arc length
    this.alpha = 1;
    this.life = 2.4;
    this.age = 0;
  }
  update(dt) {
    this.age += dt;
    this.phase += this.speed * dt;
  }
  render(ctx) {
    if (this.age > this.life) return;
    const fadeOut = clamp((this.life - this.age) / 0.3, 0, 1);
    const alpha = fadeOut * this.alpha;
    const N = 24;
    const r = this.radius * this.scale;
    const flat = this.flattening;
    const sin = Math.sin(this.tilt);
    const cos = Math.cos(this.tilt);
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = this.phase + this.angle + (i / N) * TAU * this.sweep;
      const x3 = Math.cos(a) * r;
      const y3 = Math.sin(a) * r;
      const yr = y3 * cos;
      const px = this.cx + x3;
      const py = this.cy + yr * flat;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `hsla(${this.hue}, 70%, 65%, ${alpha})`;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// SpiralParticle: for burst state — spirals inward with depth fog.
// rho *= 0.75^(dt*10), angle += 100°/s, depth-fogs toward background.
class SpiralParticle {
  constructor({ angle, rho, hue = 30, birth = 0, life = 0.62, cx = 256, cy = 256, scale = 200 }) {
    this.angle = angle;
    this.rho = rho;
    this.hue = hue;
    this.life = life;
    this.age = -birth;
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
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
    // Depth fog: closer to center = brighter, further = darker
    const depth = clamp(1 - this.rho / 0.8, 0, 1);
    const light = 40 + depth * 30;
    const r = (5 + 8 * clamp(this.age / 0.55, 0, 1));
    const x = this.cx + Math.cos(this.angle) * this.rho * this.scale;
    const y = this.cy + Math.sin(this.angle) * this.rho * this.scale;
    ctx.fillStyle = `hsla(${this.hue}, 80%, ${light}%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}

// RainbowTrail: for disco state — leaves a hue-cycling trail behind Shiku.
// Each trail segment has a different hue; the whole trail shifts over time.
class RainbowTrail {
  constructor({ x, y, hue, life = 0.8, cx = 256, cy = 256, scale = 200 }) {
    this.x = x;  // normalized -1..1 relative to artboard center
    this.y = y;
    this.hue = hue;
    this.life = life;
    this.age = 0;
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
    this.size = 6 + Math.random() * 4;
  }
  update(dt) {
    this.age += dt;
    this.size *= Math.pow(0.6, dt * 2);  // shrink over time
  }
  render(ctx) {
    const fadeIn = clamp(this.age / 0.05, 0, 1);
    const fadeOut = clamp((this.life - this.age) / 0.2, 0, 1);
    const alpha = fadeIn * fadeOut * 0.85;
    const x = this.cx + this.x * this.scale;
    const y = this.cy + this.y * this.scale;
    // Glow effect: 3 concentric circles with decreasing alpha
    for (let i = 0; i < 3; i++) {
      const r = this.size * (1 + i * 0.5);
      const a = alpha * (1 - i * 0.25);
      ctx.fillStyle = `hsla(${(this.hue + i * 30) % 360}, 90%, 60%, ${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }
}

// FlameParticle: for rocket state — orange/red flame trail that drifts
// downward + fades (rocket goes up, trail falls back).
class FlameParticle {
  constructor({ x, y, hue = 25, life = 0.6, cx = 256, cy = 256, scale = 200 }) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 0.4;
    this.vy = 0.3 + Math.random() * 0.3;  // drift downward
    this.hue = hue;
    this.life = life;
    this.age = 0;
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
    this.size = 8 + Math.random() * 6;
  }
  update(dt) {
    this.age += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.size *= Math.pow(0.4, dt * 2);  // shrink fast
  }
  render(ctx) {
    const fadeIn = clamp(this.age / 0.05, 0, 1);
    const fadeOut = clamp((this.life - this.age) / 0.15, 0, 1);
    const alpha = fadeIn * fadeOut * 0.85;
    const x = this.cx + this.x * this.scale;
    const y = this.cy + this.y * this.scale;
    // Flame: orange-yellow center + red outer
    ctx.fillStyle = `hsla(${this.hue + 20}, 100%, 70%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, this.size * 0.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `hsla(${this.hue}, 100%, 50%, ${alpha * 0.7})`;
    ctx.beginPath();
    ctx.arc(x, y, this.size, 0, TAU);
    ctx.fill();
  }
}

// HypnoSwirl: for hypno state — concentric spinning spiral that fills the
// glasses lens area.
class HypnoSwirl {
  constructor({ x, y, life = 5, cx = 256, cy = 256, scale = 200 }) {
    this.x = x;  // relative to eye center
    this.y = y;
    this.life = life;
    this.age = 0;
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
    this.phase = 0;
  }
  update(dt) {
    this.age += dt;
    this.phase += dt * 4;  // 4 rad/s spin
  }
  render(ctx) {
    const fadeIn = clamp(this.age / 0.3, 0, 1);
    const fadeOut = clamp((this.life - this.age) / 0.5, 0, 1);
    const alpha = fadeIn * fadeOut * 0.9;
    const x = this.cx + this.x * this.scale;
    const y = this.cy + this.y * this.scale;
    // Spiral: 3 arms, 2 turns each, color cycles through hue wheel
    for (let arm = 0; arm < 3; arm++) {
      ctx.beginPath();
      const armPhase = this.phase + arm * (TAU / 3);
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const r = t * 22;
        const a = armPhase + t * TAU * 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      const hue = (arm * 120 + this.age * 180) % 360;
      ctx.strokeStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
}

// ── spatial design particles (Phase 5: layered depth + atmosphere) ────

// AmbientDust: slow-floating background dust particles for atmospheric
// perspective. Different depth layers — closer dust is bigger + moves
// faster, farther dust is smaller + slower + dimmer (atmospheric fade).
class AmbientDust {
  constructor({ x, y, depth, hue = 200, cx = 256, cy = 256, scale = 200 }) {
    this.x = x;             // normalized -1..1
    this.y = y;
    this.depth = depth;     // 0..1 (0 = far, 1 = near)
    this.hue = hue;
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
    this.vx = (0.02 + depth * 0.05) * (Math.random() < 0.5 ? -1 : 1);
    this.vy = (0.01 + depth * 0.03) * (Math.random() < 0.5 ? -1 : 1);
    this.phase = Math.random() * TAU;
    this.size = 0.5 + depth * 1.5;  // closer = bigger
    this.life = Infinity;  // ambient dust never dies
    this.age = 0;
  }
  update(dt) {
    this.age += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Wrap around (toroidal)
    if (this.x > 1) this.x = -1;
    if (this.x < -1) this.x = 1;
    if (this.y > 1) this.y = -1;
    if (this.y < -1) this.y = 1;
    this.phase += dt * 0.5;
  }
  render(ctx) {
    // 2026 trend: BOKEH — larger, softer, more blurred dust particles.
    // Twinkle: subtle alpha oscillation
    const twinkle = 0.4 + 0.3 * Math.sin(this.phase);
    // Atmospheric perspective: farther = dimmer
    const alpha = twinkle * (0.20 + this.depth * 0.45);
    const r = this.size * 2.5;  // 2026: larger bokeh circles
    const x = this.cx + this.x * this.scale;
    const y = this.cy + this.y * this.scale;
    // Bokeh: radial gradient (soft edges, not hard circle)
    const dustGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
    dustGrad.addColorStop(0, `hsla(${this.hue}, 40%, 85%, ${alpha})`);
    dustGrad.addColorStop(0.5, `hsla(${this.hue}, 40%, 85%, ${alpha * 0.4})`);
    dustGrad.addColorStop(1, `hsla(${this.hue}, 40%, 85%, 0)`);
    ctx.fillStyle = dustGrad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}

// CursorTrailDot: fading dot that follows the cursor, leaving a trail.
// Connects user input visually to the character.
class CursorTrailDot {
  constructor({ x, y, life = 0.4, hue = 25, cx = 256, cy = 256, scale = 200 }) {
    this.x = x;  // normalized -1..1 (relative to artboard center)
    this.y = y;
    this.life = life;
    this.age = 0;
    this.hue = hue;
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
  }
  update(dt) {
    this.age += dt;
  }
  render(ctx) {
    const fadeOut = clamp((this.life - this.age) / this.life, 0, 1);
    const alpha = fadeOut * 0.4;
    const r = 3 * fadeOut;
    const x = this.cx + this.x * this.scale;
    const y = this.cy + this.y * this.scale;
    ctx.fillStyle = `hsla(${this.hue}, 70%, 60%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
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
  constructor({ riveCanvas, particlesCanvas, backgroundCanvas, rive, file, artboard, stateMachineInstance: sm, externalAdvance = true }) {
    this.riveCanvas = riveCanvas;
    this.particlesCanvas = particlesCanvas;
    this.backgroundCanvas = backgroundCanvas;  // Phase 5: behind-rive layer for shadow + dust + tint
    this.rive = rive;
    this.file = file;
    this.artboard = artboard;
    this.sm = sm;
    this.externalAdvance = externalAdvance;

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

    // 4b. Ear spring state (Phase 5: follow-through). Ears lag behind headTilt
    // with critically-damped spring — gives secondary motion + "alive" feel.
    // ω=6 (slower than glasses, ~0.67s settle) — ears are heavier, lag more.
    this.earSpringL = { pos: 0, vel: 0, target: 0 };
    this.earSpringR = { pos: 0, vel: 0, target: 0 };

    // 4c. Ambient motion state (Phase 5: lively realtime feel).
    // Gaze drift when no pointer (layered sines for organic feel, not random).
    // Breathing: ±1.5% scale at 0.3Hz (universal "alive" signal).
    this.ambientGaze = { x: 0, y: 0 };
    this.breathPhase = 0;

    // 4d. Cursor trail (Phase 5: connect user input visually to the character).
    this.cursorTrail = [];  // array of recent pointer positions (normalized -1..1)
    this._lastCursorTrailAt = 0;

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
    this.blinkInterval = 6.0; // LOGO MODE: blink every 6s (calmer, less distracting)

    // 7. Poke counter (for dizzy acceptance test).
    this.pokeCount = 0;
    this.lastPokeAt = -1;

    // 4e. Autonomous mood cycling (Phase 6: studio production).
    // Shiku cycles through moods every 8-15s without manual input.
    // Weighted random: idle=30%, curious=20%, excited=15%, confused=10%,
    // startled=8%, sleepy=5%, orbit=4%, comet=3%, burst=2%, disco=2%, rocket=0.5%, hypno=0.5%.
    this._moodTimer = Infinity;  // LOGO MODE: no autonomous cycling — logo is calm + consistent
    this._moodWeights = [
      { state: 'idle',     w: 30 },
      { state: 'curious',  w: 20 },
      { state: 'excited',  w: 15 },
      { state: 'confused', w: 10 },
      { state: 'startled', w: 8 },
      { state: 'sleepy',   w: 5 },
      { state: 'orbit',    w: 4 },
      { state: 'comet',    w: 3 },
      { state: 'burst',    w: 2 },
      { state: 'disco',    w: 2 },
      { state: 'rocket',   w: 0.5 },
      { state: 'hypno',    w: 0.5 },
    ];

    // 4f. Touch/click interaction state (Phase 6: mobile clicks).
    // tap=poke, double-tap=excited, long-press=pet, swipe=random funky.
    this._pointerDownAt = 0;
    this._pointerDownPos = null;
    this._lastTapAt = 0;
    this._pointerMoveDist = 0;

    // 8. Particles.
    this.particles = [];
    this.particleRng = mulberry32(0x5EED);

    // 9. rAF loop state (per bloub: bounded dt, single loop).
    this.raf = 0;
    this.clock = 0;
    this.lastFrame = 0;
    this.tabHiddenSince = 0;

    // 4e. Autonomous mood cycling (Phase 6: Shiku lives on its own).
    // After 5 seconds of no user interaction, Shiku starts cycling through
    // moods automatically via a Markov chain. Each state has a natural
    // duration range; the next state is picked probabilistically.
    this.lastInteractionAt = 0;
    this.autonomousDelay = 5.0;
    this.stateDuration = 0;
    this.nextTransitionAt = Infinity;

    // 4f. Click/tap interaction state (Phase 6: mobile clicks).
    this._clickTimer = null;
    this._clickCount = 0;
    this._pressStart = 0;
    this._pressTimer = null;

    // 4g. Markov transition table — probabilities for each state's likely
    // next state. Organic feel — not a fixed sequence, but weighted random.
    this.markov = {
      idle:     [['curious', 30], ['excited', 20], ['sleepy', 15], ['orbit', 10], ['confused', 10], ['disco', 8], ['comet', 7]],
      curious:  [['idle', 30], ['excited', 25], ['orbit', 15], ['confused', 10], ['hypno', 10], ['burst', 10]],
      excited:  [['idle', 35], ['curious', 20], ['burst', 15], ['disco', 15], ['comet', 10], ['startled', 5]],
      startled: [['curious', 60], ['idle', 30], ['confused', 10]],
      sleepy:   [['confused', 30], ['idle', 30], ['curious', 20], ['hypno', 20]],
      confused: [['idle', 40], ['curious', 30], ['sleepy', 15], ['hypno', 15]],
      orbit:    [['idle', 30], ['comet', 25], ['burst', 15], ['excited', 15], ['curious', 15]],
      comet:    [['idle', 30], ['orbit', 25], ['burst', 15], ['confused', 15], ['curious', 15]],
      burst:    [['curious', 40], ['idle', 30], ['excited', 20], ['orbit', 10]],
      disco:    [['idle', 25], ['excited', 20], ['orbit', 20], ['comet', 15], ['hypno', 10], ['burst', 10]],
      rocket:   [['idle', 50], ['excited', 20], ['curious', 15], ['confused', 15]],
      hypno:    [['sleepy', 30], ['confused', 25], ['idle', 20], ['orbit', 15], ['curious', 10]],
    };

    // 4h. Natural duration range for each state (seconds).
    this.stateDurations = {
      idle: [5, 12], curious: [3, 8], excited: [2, 5],
      startled: [1.5, 1.5], sleepy: [8, 15], confused: [3, 6],
      orbit: [3, 5], comet: [2, 3], burst: [2.5, 2.5],
      disco: [4, 8], rocket: [3, 3], hypno: [5, 10],
    };

    // Bind handlers (so removeEventListener works).
    this.tick = this.tick.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
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

  // ── Phase 5: spawn ambient dust (background atmosphere layer) ──────
  spawnAmbientDust() {
    // 25 dust particles across 3 depth layers (far/mid/near).
    // Far: small + slow + dim. Near: bigger + faster + brighter.
    this._ambientDust = [];
    for (let i = 0; i < 25; i++) {
      const depth = i / 25;  // 0..1, evenly distributed
      this._ambientDust.push(new AmbientDust({
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        depth,
        hue: 200 + Math.random() * 40,  // blue-ish haze
      }));
    }
  }

  // ── Phase 5: ambient motion (lively realtime feel) ────────────────
  // Per bloub: "Avatar doesn't float at rest. Life = gaze drift + blinking."
  // When no pointer, eyes wander naturally via layered sines (deterministic,
  // organic — not random). Breathing: ±1.5% scale at 0.3Hz (universal "alive").
  computeAmbientMotion(dt) {
    // Gaze drift: 3 layered sines at different frequencies for organic feel.
    // Output clamped to ±0.5 (subtler than pointer-driven gaze).
    const t = this.clock;
    // LOGO MODE: slower, subtler drift (0.15-0.4 freq range — calmer than demo)
    const driftX = Math.sin(t * 0.15) * 0.20
                 + Math.sin(t * 0.37 + 1.2) * 0.10
                 + Math.sin(t * 0.09 + 2.5) * 0.08;
    const driftY = Math.sin(t * 0.13 + 0.5) * 0.15
                 + Math.sin(t * 0.31 + 3.1) * 0.08
                 + Math.sin(t * 0.07 + 1.7) * 0.05;
    this.ambientGaze.x = clamp(driftX, -0.35, 0.35);  // clamped tighter for subtlety
    this.ambientGaze.y = clamp(driftY, -0.35, 0.35);

    // Breathing phase advances at 0.3Hz (3.33s period — calm, relaxed breathing)
    this.breathPhase += dt * 0.2;  // LOGO MODE: 0.2Hz (5s period — calmer breathing)

    // Cursor trail: push current pointer position every 30ms (if pointer exists)
    if (this.pointer) {
      if (t - this._lastCursorTrailAt > 0.03) {
        this._lastCursorTrailAt = t;
        const box = this.riveCanvas.getBoundingClientRect();
        if (box.width > 0) {
          const cx = box.left + box.width / 2;
          const cy = box.top + box.height / 2;
          const halfW = Math.max(1, window.innerWidth / 2);
          const halfH = Math.max(1, window.innerHeight / 2);
          this.cursorTrail.push({
            x: clamp((this.pointer.x - cx) / halfW, -1.5, 1.5),
            y: clamp((this.pointer.y - cy) / halfH, -1.5, 1.5),
            age: 0,
          });
        }
      }
    }
    // Age + cull trail dots
    this.cursorTrail = this.cursorTrail.filter(d => {
      d.age += dt;
      return d.age < 0.4;
    });
  }

  // ── Phase 5: renderBackground (behind-rive layer) ──────────────────
  // Draws to the background canvas (z-index 0, behind the rive canvas).
  // Layers (back to front):
  //   1. State-reactive background tint (subtle color shift based on state)
  //   2. Soft drop shadow below Shiku (grounds the character)
  //   3. Ambient dust particles (atmospheric perspective)
  renderBackground() {
    if (!this.backgroundCanvas) return;
    const ctx = this.backgroundCanvas.getContext('2d');
    // Phase 6: 4K-quality rendering — canvas is 1024×1024, scale context 2x
    // so all 512-based coordinates map to 1024 internal pixels for crisp edges.
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 512, 512);

    // 1. LOGO MODE: soft spotlight gradient behind Shiku (boutique presentation).
    // Radial gradient: brighter center → darker edges (like a studio spotlight).
    const spotlightGrad = ctx.createRadialGradient(256, 280, 50, 256, 280, 350);
    spotlightGrad.addColorStop(0, 'rgba(60, 70, 65, 0.40)');
    spotlightGrad.addColorStop(0.5, 'rgba(35, 40, 38, 0.25)');
    spotlightGrad.addColorStop(1, 'rgba(10, 10, 10, 0)');
    ctx.fillStyle = spotlightGrad;
    ctx.fillRect(0, 0, 512, 512);

    // LOGO MODE: consistent premium dark background (no state-reactive tint).
    // The spotlight above provides the "alive" feel without distracting color shifts.

    // 2. Ambient dust (atmospheric perspective layer).
    if (this._ambientDust) {
      for (const dust of this._ambientDust) dust.render(ctx);
    }

    // 3. Soft drop shadow below Shiku. Grounds the character.
    // Shadow position: BELOW the body (body spans y=240-440, so shadow at y=465
    // is 25px below the body's bottom edge — visible through the transparent
    // rive canvas).
    // Shadow scales with body state (compressed when burst/comet, normal otherwise)
    // Shadow moves with rocket offset (rises with Shiku, gets dimmer)
    const bodyY = 340 + (this._rocketOffsetY || 0);
    const shadowY = bodyY + 125;  // 125px below body center = below the body's bottom edge
    const shadowX = 256;
    let shadowScale = 1;
    if (this.state === 'burst' && this._burstScale) shadowScale = this._burstScale;
    if (this.state === 'comet') shadowScale = 0.3;
    // Shadow size: ellipse 100×16, scaled (wider than body for grounding effect)
    const shadowW = 100 * shadowScale;
    const shadowH = 16 * shadowScale;
    // Shadow alpha: dimmer when Shiku is "up" (rocket), normal when grounded.
    // Phase 5: boosted from 0.30 to 0.50 for visibility.
    const shadowAlpha = (this.state === 'rocket') ? 0.15 : 0.50;
    // Soft shadow via radial gradient
    const grad = ctx.createRadialGradient(shadowX, shadowY, 0, shadowX, shadowY, shadowW);
    grad.addColorStop(0, `rgba(0, 0, 0, ${shadowAlpha})`);
    grad.addColorStop(0.7, `rgba(0, 0, 0, ${shadowAlpha * 0.4})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(shadowX, shadowY, shadowW, shadowH, 0, 0, TAU);
    ctx.fill();
  }

  // ── Phase 6: renderStudioShading (multi-layer gradient system) ────
  // Replaces the simple 3D shading with a full studio-production gradient
  // system: base color gradient + key light + fill light + rim light +
  // ambient occlusion + subsurface scattering. Each layer uses the global
  // light direction (top-left) + a slow hue cycle for surreal quality.
  // Drawn on the particles canvas (in front of the flat-colored Rive shapes).
  render3DShading() {
    if (!this.particlesCanvas) return;
    const ctx = this.particlesCanvas.getContext('2d');
    const s = this.shapes;
    if (!s.head || !s.body) return;

    const rocketY = this._rocketOffsetY || 0;
    const burstScale = (this.state === 'burst' && this._burstScale) ? this._burstScale : 1;
    const cometScale = (this.state === 'comet') ? 0.3 : 1;

    // LOGO MODE: simplified to 3 clean layers (base + key + rim).
    // Removed: fill light, ambient occlusion, SSS, bloom — too busy for a logo.
    // Subtle hue shift (±8° over 30s — barely perceptible, adds life)
    const hueShift = Math.sin(this.clock * 0.033) * 8;

    // Light direction: top-left (consistent, premium studio lighting)
    const lightDX = -0.5, lightDY = -0.5;

    // Helper: draw multi-layer gradient on a circular shape
    const drawSphere = (cx, cy, radius, baseHue, baseSat, baseLight) => {
      // 1. BASE GRADIENT — radial, warm center → cool edge (volumetric sphere)
      const baseGrad = ctx.createRadialGradient(
        cx + lightDX * radius * 0.3, cy + lightDY * radius * 0.3, radius * 0.1,
        cx, cy, radius
      );
      const centerL = Math.min(baseLight + 25, 75);
      const edgeL = Math.max(baseLight - 20, 10);
      baseGrad.addColorStop(0, `hsla(${baseHue + hueShift}, ${baseSat}%, ${centerL}%, 0.45)`);
      baseGrad.addColorStop(0.6, `hsla(${baseHue + hueShift}, ${baseSat}%, ${baseLight}%, 0.30)`);
      baseGrad.addColorStop(1, `hsla(${baseHue + hueShift - 10}, ${baseSat + 10}%, ${edgeL}%, 0.40)`);
      ctx.fillStyle = baseGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.fill();

      // 2. KEY LIGHT — small bright highlight at top-left (specular)
      const keyX = cx + lightDX * radius * 0.5;
      const keyY = cy + lightDY * radius * 0.5;
      const keyGrad = ctx.createRadialGradient(keyX, keyY, 0, keyX, keyY, radius * 0.4);
      keyGrad.addColorStop(0, `hsla(${baseHue + hueShift + 20}, 40%, 95%, 0.55)`);
      keyGrad.addColorStop(0.5, `hsla(${baseHue + hueShift + 10}, 30%, 80%, 0.15)`);
      keyGrad.addColorStop(1, `hsla(${baseHue + hueShift}, 30%, 80%, 0)`);
      ctx.fillStyle = keyGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.fill();

      // 3. RIM LIGHT — thin bright crescent at bottom-right edge (backlight)
      const rimGrad = ctx.createRadialGradient(
        cx - lightDX * radius * 0.8, cy - lightDY * radius * 0.8, radius * 0.7,
        cx - lightDX * radius * 0.8, cy - lightDY * radius * 0.8, radius
      );
      rimGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      rimGrad.addColorStop(0.8, `hsla(${baseHue + hueShift + 180}, 40%, 85%, 0)`);
      rimGrad.addColorStop(0.95, `hsla(${baseHue + hueShift + 180}, 50%, 90%, 0.25)`);
      rimGrad.addColorStop(1, `hsla(${baseHue + hueShift + 180}, 60%, 95%, 0.10)`);
      ctx.fillStyle = rimGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.fill();
    };

    // LOGO MODE: simplified — removed SSS + bloom (too busy for a logo).
    // Apply to HEAD (premium emerald: hue=155, sat=45, light=35)
    const headR = 100 * (burstScale !== 1 ? burstScale : 1) * (cometScale !== 1 ? cometScale : 1);
    // 2026 trend: sage green palette (hue=85) matching the reference image.
    drawSphere(256, 200 + rocketY, headR, 85, 35, 35);

    // Apply to BODY (sage green: hue=80, slightly different from head for depth)
    const bodyR = 95 * (burstScale !== 1 ? burstScale : 1) * (cometScale !== 1 ? cometScale : 1);
    drawSphere(256, 340 + rocketY, bodyR, 80, 40, 40);

    // 2026 trend: GLASSMORPHISM — translucent white sweep across the body
    // that creates a "glossy, reflective surface—like glass, plastic, or wet
    // ceramic—giving it a 'gummy' or 'jelly-like' material quality."
    // Positioned on the right side (2→5 o'clock) per the reference image.
    const glassGrad = ctx.createLinearGradient(
      256 + headR * 0.3, 200 + rocketY - headR * 0.5,
      256 + headR * 0.8, 200 + rocketY + headR * 0.3
    );
    glassGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    glassGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.12)');
    glassGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.18)');
    glassGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.08)');
    glassGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glassGrad;
    ctx.beginPath();
    ctx.arc(256, 200 + rocketY, headR, 0, TAU);
    ctx.fill();

    // Same glass sweep on body
    const bodyGlassGrad = ctx.createLinearGradient(
      256 + bodyR * 0.3, 340 + rocketY - bodyR * 0.5,
      256 + bodyR * 0.8, 340 + rocketY + bodyR * 0.3
    );
    bodyGlassGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    bodyGlassGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.10)');
    bodyGlassGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
    bodyGlassGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.06)');
    bodyGlassGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = bodyGlassGrad;
    ctx.beginPath();
    ctx.arc(256, 340 + rocketY, bodyR, 0, TAU);
    ctx.fill();
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  start() {
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp, { passive: true });
    document.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // Phase 5: spawn ambient dust for atmospheric perspective (background layer).
    this.spawnAmbientDust();
    this.raf = requestAnimationFrame(this.tick);
    console.log('[brain] started. window.shiku = { go, poke, pet, orbit, comet, burst, dance, spin, hypnotize, surprise }');
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  // ── Phase 6: autonomous mood cycling ──────────────────────────────
  // Every 8-15s, Shiku picks a new mood via weighted random.
  // The current mood persists until the timer expires OR a touch
  // interaction overrides it.
  computeMood(dt) {
    this._moodTimer -= dt;
    if (this._moodTimer <= 0) {
      // Reset timer: 8-15s
      this._moodTimer = 8 + Math.random() * 7;
      // Weighted random state selection
      const totalW = this._moodWeights.reduce((s, m) => s + m.w, 0);
      let r = Math.random() * totalW;
      let chosen = 'idle';
      for (const m of this._moodWeights) {
        r -= m.w;
        if (r <= 0) { chosen = m.state; break; }
      }
      // Don't repeat the same state (pick again if same)
      if (chosen === this.state) {
        const alts = this._moodWeights.filter(m => m.state !== this.state);
        const altTotal = alts.reduce((s, m) => s + m.w, 0);
        let r2 = Math.random() * altTotal;
        for (const m of alts) {
          r2 -= m.w;
          if (r2 <= 0) { chosen = m.state; break; }
        }
      }
      console.log(`[shiku] mood cycle: ${this.state} → ${chosen}`);
      this.go(chosen);
    }
  }

  // ── Phase 6: touch/click interactions ──────────────────────────────
  // tap = poke, double-tap = excited, long-press (>500ms) = pet,
  // swipe (>50px move) = random funky state.

  onPointerDown(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'mouse') {
      this._pointerDownAt = this.clock;
      this._pointerDownPos = { x: e.clientX, y: e.clientY };
      this._pointerMoveDist = 0;
    }
  }

  onPointerUp(e) {
    if (!this._pointerDownPos) return;
    const dt = this.clock - this._pointerDownAt;
    const dx = e.clientX - this._pointerDownPos.x;
    const dy = e.clientY - this._pointerDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this._pointerDownPos = null;

    // Swipe (>50px move): random funky state
    if (dist > 50) {
      this.surprise();
      return;
    }
    // Long press (>500ms): pet
    if (dt > 0.5) {
      this.pet();
      return;
    }
    // Double-tap (<300ms since last tap): excited
    if (this.clock - this._lastTapAt < 0.3) {
      this.go('excited');
      this._lastTapAt = 0;
      return;
    }
    // Single tap: poke (3 pokes → dizzy)
    this._lastTapAt = this.clock;
    this.poke();
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

      // ── FUNKY EXTENDED STATES (Phase 4) ─────────────────────────────
      case 'orbit':
        // Spawn 6 depth-sorted orbit rings + clear old funky particles.
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        this.spawnOrbitRings();
        break;
      case 'comet':
        // Spawn 4 comet ribbons. Body collapses to a dot.
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        this.spawnCometRibbons();
        break;
      case 'burst':
        // Spawn 5 spiral particles spiraling inward (occluded by body).
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        this.spawnBurstParticles();
        this._burstScale = 1;  // reset burst scale
        break;
      case 'disco':
        // Hue-cycling body + rainbow trail + sparkle storm.
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        this._lastRainbowAt = 0;  // reset spawn timer
        break;
      case 'rocket':
        // Continuous flame trail spawned in maybeSpawnStateParticles.
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        this._lastFlameAt = 0;
        break;
      case 'hypno':
        // 2 hypno swirls (one per eye).
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        this.spawnHypnoSwirls();
        break;

      // ── TASK STATES (Novra case study) ────────────────────────────
      case 'working':
        // Focused, subtle typing motion, slow wag. No funky particles.
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        break;
      case 'upload':
        // Looking up, eyes wide, watching progress.
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        break;
      case 'error':
        // Startled-held, glasses crooked, grimace. Brief red flash.
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        this.glassesSpring.pos = 1.2;  // glasses knocked up
        this.glassesSpring.target = 0;
        this.glassesSpring.vel = 0;
        this.spawnStarBurst();  // brief error flash
        break;
      case 'finished':
        // Big smile, satisfied, sparkles.
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        this.spawnSparkles(12);  // celebration sparkles
        break;
      case 'greeting':
        // Ear wiggle wave, happy smile, slight bounce.
        this._orbitRings = null;
        this._cometRibbons = null;
        this._hypnoSwirls = null;
        break;
    }
    // Clear funky extended state when leaving them.
    if (!['orbit', 'comet', 'burst', 'disco', 'rocket', 'hypno'].includes(name)) {
      this._orbitRings = null;
      this._cometRibbons = null;
      this._hypnoSwirls = null;
      this._burstScale = 1;
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
    // Note: main.js owns the rAF loop and calls brain.tick(ms) each frame.
    // When used with the basic @rive-app/canvas package (autoplay:true),
    // the basic package owns SM/artboard advancement + canvas rendering;
    // the brain only does perception + springs + particles + writes.
    // The `externalAdvance` flag (default true) controls whether the brain
    // calls sm.advance/artboard.advance itself.

    // Bounded dt: an inactive tab doesn't jump forward on refocus.
    const dt = this.lastFrame ? Math.min((ms - this.lastFrame) / 1000, 0.064) : 0;
    this.lastFrame = ms;
    this.clock += dt;

    // 0. Ambient motion (Phase 5: gaze drift when idle + breathing + cursor trail).
    //    Runs FIRST so the perception layer can blend ambient drift with pointer.
    this.computeAmbientMotion(dt);

    // 0b. Phase 6: autonomous mood cycling — every 8-15s, Shiku picks a
    //     new mood via weighted random. Touch/click interactions can override.
    this.computeMood(dt);

    // 1. Compute per-frame perception (ease-outs, layered ω).
    this.computePerception(dt);

    // 2. Update springs (glasses wobble + ear follow-through) with fixed 1/120s substep.
    this.updateSprings(dt);

    // 3. Update + spawn particles.
    this.updateParticles(dt);
    this.maybeSpawnStateParticles();

    // 4. Advance Rive SM + artboard (ONLY if no external renderer is doing it).
    if (!this.externalAdvance) {
      this.sm.advance(dt);
      this.artboard.advance(dt);
    }

    // 5. Write per-frame values to StateMachineNumber inputs (for the contract).
    this.writeInputs();

    // 6. Write per-frame values directly to artboard shapes (for visual).
    this.writeArtboard();

    // 7. Render background layer (behind rive: shadow + dust + tint).
    this.renderBackground();

    // 8. Render particle overlay (in front of rive: cursor trail + 3D shading +
    //    orbit rings + comet ribbons + regular particles + hypno swirls).
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

    // Gaze target: pointer-driven if pointer exists, else ambient drift.
    // Per bloub: "Life = gaze drift + blinking" — when no pointer, eyes
    // wander naturally via layered sines (deterministic, organic).
    const gazeTargetX = this.pointer ? nx * 1.0 : this.ambientGaze.x;
    const gazeTargetY = this.pointer ? ny * 1.0 : this.ambientGaze.y;
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

      // ── FUNKY EXTENDED STATES (Phase 4) ─────────────────────────────
      case 'orbit':
        // 6 depth-sorted orbit rings, eyes whip around the sphere at 1.25 turns/s.
        // Per bloub's orbit state: triangle→ball morph, 6 rings 1.25 turns/s,
        // eyes whip ~3× faster. The orbit rings are particles (OrbitRing class).
        this.target.lidL = 0;  // wide eyes for the spin
        this.target.lidR = 0;
        this.target.earL = 0.5;  // ears slightly alert
        this.target.earR = 0.5;
        this.target.wagSpeed = 0.8;  // fast wag during orbit
        // Override gaze to spin: 1.25 turns/s = 1.25 * 2π rad/s
        // Use the clock to drive a circular motion of the gaze target.
        const orbitSpin = this.clock * 1.25 * TAU;
        this.target.gazeX = Math.cos(orbitSpin);
        this.target.gazeY = Math.sin(orbitSpin);
        // Also tilt the head slightly with the orbit
        this.target.headTilt = Math.sin(orbitSpin) * 0.3;
        break;

      case 'comet':
        // Body collapses to a dot, 4 ribbons orbit at 210°/s.
        // The ribbons are particles (CometRibbon class).
        // Body collapse: scale head + body down to ~16%
        // (Visual collapse handled in writeArtboard via state check.)
        this.target.lidL = 0;  // eyes still visible (collapsed but watching)
        this.target.lidR = 0;
        this.target.wagSpeed = 0;
        break;

      case 'burst':
        // Body collapses to 0.166 then regrows, 5 particles spiral inward.
        // The spiral particles are spawned once on state enter (see go()).
        this.target.lidL = 0;
        this.target.lidR = 0;
        this.target.wagSpeed = 0;
        // Body scale is animated based on time-in-state
        const burstPhase = (this.clock - this.stateChangedAt) / 2.6;  // 0..1 over 2.6s
        if (burstPhase < 0.5) {
          // Collapse phase: scale shrinks to 0.166
          this._burstScale = 1 - (1 - 0.166) * (burstPhase * 2);
        } else {
          // Regrow phase: scale grows back to 1
          this._burstScale = 0.166 + (1 - 0.166) * ((burstPhase - 0.5) * 2);
        }
        break;

      case 'disco':
        // Body hue-cycles, glasses flash rainbow, sparkle storm.
        // Hue cycling handled in writeArtboard via state check.
        this.target.lidL = 0;  // wide open, party mode
        this.target.lidR = 0;
        this.target.earL = 1;  // ears alert (dancing)
        this.target.earR = 1;
        this.target.wagSpeed = 1.0;  // fastest wag
        this.target.mouthOpen = 0.5 + 0.5 * Math.sin(this.clock * 8 * TAU);  // mouth flapping
        // Hue cycle: drive gaze in a circle for dance motion
        const discoSpin = this.clock * 2 * TAU;
        this.target.gazeX = Math.cos(discoSpin) * 0.6;
        this.target.gazeY = Math.sin(discoSpin) * 0.6;
        break;

      case 'rocket':
        // Shiku shoots upward with flame trail, then falls back.
        // The flame particles are spawned in tick() (continuous).
        this.target.lidL = 0;  // wide eyes (excited/terrified)
        this.target.lidR = 0;
        this.target.earL = -0.5;  // ears back (wind resistance)
        this.target.earR = -0.5;
        this.target.mouthOpen = 0.9;  // screaming
        this.target.wagSpeed = 0;  // tail straight back
        break;

      case 'hypno':
        this.target.lidL = 0;
        this.target.lidR = 0;
        this.target.earL = 0;
        this.target.earR = 0;
        this.target.wagSpeed = 0.2;
        this.target.gazeX = 0;
        this.target.gazeY = 0;
        break;

      // ── TASK STATES (Novra case study: functional app status) ─────
      case 'working':
        // Focused, subtle typing motion, slow wag. Per Novra: "A character
        // needs more than working and done."
        this.target.lidL = 0.15;  // slightly squinting (focused)
        this.target.lidR = 0.15;
        this.target.earL = 0.3;  // ears slightly perked (alert)
        this.target.earR = 0.3;
        this.target.wagSpeed = 0.2;  // slow thoughtful wag
        this.target.mouthOpen = 0.1 + 0.08 * Math.sin(this.clock * 4 * TAU);  // subtle typing motion (4Hz)
        this.target.smile = 0.1;  // slight focused smile
        break;

      case 'upload':
        // Looking up, eyes wide, watching progress. Per Novra: "Upload" state.
        this.target.lidL = 0;  // wide eyes
        this.target.lidR = 0;
        this.target.gazeY = -0.6;  // looking up
        this.target.earL = 0.5;
        this.target.earR = 0.5;
        this.target.wagSpeed = 0;  // tail still (waiting)
        this.target.mouthOpen = 0.3;  // small "ooh"
        break;

      case 'error':
        // Startled-held, glasses crooked, grimace. Per Novra: "Error" state.
        this.target.lidL = 0;  // wide eyes (shock)
        this.target.lidR = 0;
        this.target.earL = -0.8;  // ears back
        this.target.earR = -0.8;
        this.target.wagSpeed = 0;
        this.target.smile = -0.5;  // grimace
        this.target.mouthOpen = 0.4;  // open in shock
        break;

      case 'finished':
        // Big smile, satisfied, sparkles. Per Novra: "Finished" state.
        this.target.lidL = 0;  // bright eyes
        this.target.lidR = 0;
        this.target.earL = 0.8;  // ears up (happy)
        this.target.earR = 0.8;
        this.target.wagSpeed = 0.6;  // happy wag
        this.target.smile = 0.8;  // big smile
        this.target.mouthOpen = 0.2;  // slight open (content)
        break;

      case 'greeting':
        // Ear wiggle wave, happy smile, slight bounce. Per Novra: "Greeting" state.
        this.target.lidL = 0;
        this.target.lidR = 0;
        // Ear wiggle: alternate L/R at 3Hz (wave-like)
        const wavePhase = this.clock * 3 * TAU;
        this.target.earL = Math.sin(wavePhase) * 0.6;
        this.target.earR = Math.sin(wavePhase + Math.PI) * 0.6;
        this.target.wagSpeed = 0.5;  // happy wag
        this.target.smile = 0.6;  // happy smile
        this.target.mouthOpen = 0.15;
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

    // ── Phase 5: ear follow-through springs ─────────────────────────
    // Ears lag behind headTilt with critically-damped spring (ω=6, slower
    // than glasses — ears are heavier, lag more). Gives secondary motion.
    // Target = the brain's target.earL/earR values (set by state overrides).
    // The spring's pos drives the actual ear rotation in writeArtboard.
    const earω = 4;  // LOGO MODE: slower ear spring (calmer, more deliberate)
    const earω2 = earω * earω;
    this.earSpringL.target = this.target.earL;
    this.earSpringR.target = this.target.earR;
    for (let i = 0; i < substeps; i++) {
      const accelL = -earω2 * (this.earSpringL.pos - this.earSpringL.target)
                   - 2 * earω * this.earSpringL.vel;
      this.earSpringL.vel += accelL * subDt;
      this.earSpringL.pos += this.earSpringL.vel * subDt;

      const accelR = -earω2 * (this.earSpringR.pos - this.earSpringR.target)
                   - 2 * earω * this.earSpringR.vel;
      this.earSpringR.vel += accelR * subDt;
      this.earSpringR.pos += this.earSpringR.vel * subDt;
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

  // ── funky extended spawn methods (Phase 4) ─────────────────────────

  spawnOrbitRings() {
    // 6 orbit rings with random tilt/speed/phase/hue, per bloub's orbit state.
    // The rings have depth-sorted back/front halves (renderBack/renderFront).
    this._orbitRings = [];
    for (let i = 0; i < 6; i++) {
      const ring = new OrbitRing({
        tilt: (i / 6) * Math.PI + this.particleRng() * 0.5,
        speed: 3 + this.particleRng() * 0.7,  // ~3.3 turns/s
        phase: this.particleRng() * TAU,
        sweep: 0.6 + this.particleRng() * 0.25,
        hue: (i * 60 + this.particleRng() * 30) % 360,
      });
      this._orbitRings.push(ring);
    }
  }

  spawnCometRibbons() {
    // 4 ribbons at ~210°/s around the stationary dot, per bloub's comet state.
    this._cometRibbons = [];
    for (let i = 0; i < 4; i++) {
      const ribbon = new CometRibbon({
        angle: (i / 4) * TAU,
        tilt: Math.PI / 4 + this.particleRng() * 0.3,  // ~45° + jitter
        phase: this.particleRng() * TAU,
        hue: (i * 90 + this.particleRng() * 30) % 360,
      });
      this._cometRibbons.push(ribbon);
    }
  }

  spawnBurstParticles() {
    // 5 spiral particles spiraling inward (behind body, occluded).
    for (let i = 0; i < 5; i++) {
      this.particles.push(new SpiralParticle({
        angle: (i / 5) * TAU,
        rho: 0.58 + this.particleRng() * 0.18,
        hue: 30 + this.particleRng() * 30,
        birth: i * 0.05,
        life: 0.62,
      }));
    }
  }

  spawnRainbowTrail() {
    // Rainbow trail at Shiku's current position (around the head/body center).
    const angle = this.particleRng() * TAU;
    const r = 0.1 + this.particleRng() * 0.15;
    this.particles.push(new RainbowTrail({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      hue: (this.clock * 180) % 360,  // hue shifts with time
      life: 0.5 + this.particleRng() * 0.4,
    }));
  }

  spawnFlame() {
    // Flame particle below Shiku (rocket goes up, flame trails down).
    this.particles.push(new FlameParticle({
      x: (this.particleRng() - 0.5) * 0.15,
      y: 0.2 + this.particleRng() * 0.1,  // below body
      hue: 15 + this.particleRng() * 15,  // red-orange range
      life: 0.4 + this.particleRng() * 0.3,
    }));
  }

  spawnHypnoSwirls() {
    // 2 hypno swirls — one per eye (left + right).
    // Positioned at the eye centers (relative to artboard center).
    this._hypnoSwirls = [
      new HypnoSwirl({ x: -30 / 200, y: -20 / 200, life: 5 }),  // left eye (226,180) → (-30, -76) from (256, 256)
      new HypnoSwirl({ x:  30 / 200, y: -20 / 200, life: 5 }),  // right eye (286,180) → (30, -76) from (256, 256)
    ];
  }

  updateParticles(dt) {
    // Update existing particles; cull expired.
    const next = [];
    for (const p of this.particles) {
      p.update(dt);
      if (p.age < p.life) next.push(p);
    }
    this.particles = next;
    // Update funky extended particles (kept separate for depth-sort calls).
    if (this._orbitRings) for (const r of this._orbitRings) r.update(dt);
    if (this._cometRibbons) for (const r of this._cometRibbons) r.update(dt);
    if (this._hypnoSwirls) for (const s of this._hypnoSwirls) s.update(dt);
    // Cull expired comet ribbons + hypno swirls
    if (this._cometRibbons) this._cometRibbons = this._cometRibbons.filter(r => r.age < r.life);
  }

  maybeSpawnStateParticles() {
    // Sleepy state spawns periodic Z particles.
    if (this.state === 'sleepy') {
      if (!this._lastZAt || this.clock - this._lastZAt > 1.2) {
        this._lastZAt = this.clock;
        this.spawnZParticles();
      }
    }
    // Disco state spawns rainbow trails continuously.
    if (this.state === 'disco') {
      if (!this._lastRainbowAt || this.clock - this._lastRainbowAt > 0.05) {
        this._lastRainbowAt = this.clock;
        this.spawnRainbowTrail();
        this.spawnSparkles(2);  // sparkle storm
      }
    }
    // Rocket state spawns flame trail continuously.
    if (this.state === 'rocket') {
      if (!this._lastFlameAt || this.clock - this._lastFlameAt > 0.03) {
        this._lastFlameAt = this.clock;
        this.spawnFlame();
      }
    }
  }

  renderParticles() {
    const ctx = this.particlesCanvas.getContext('2d');
    // Phase 6: 4K-quality rendering — canvas is 1024×1024, scale context 2x
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 512, 512);

    // ── Phase 5: 3D shading overlay (drawn FIRST, behind everything else
    // on the particles canvas). Radial gradient highlights on body + head
    // give the 3D sphere look. The Rive canvas (with the flat-colored body)
    // is BEHIND this canvas, so the shading applies ON TOP of the body.
    this.render3DShading();

    // ── Phase 5: cursor trail (behind the foreground particles).
    // Fading dots that follow the cursor — connects user input visually.
    for (const dot of this.cursorTrail) {
      const alpha = clamp((0.4 - dot.age) / 0.4, 0, 1) * 0.5;
      const r = 4 * (1 - dot.age / 0.4);
      ctx.fillStyle = `hsla(25, 70%, 60%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(256 + dot.x * 200, 256 + dot.y * 200, r, 0, TAU);
      ctx.fill();
    }

    // For orbit state: render BACK halves of orbit rings first (behind body).
    // The Rive canvas (with the body) is drawn between this renderParticles
    // call and the next frame's renderParticles — but since the overlay
    // canvas is on TOP of the rive canvas, the back halves won't actually
    // be occluded. We work around this by drawing back-half rings slightly
    // darker + thinner so they read as "behind" even without true occlusion.
    if (this._orbitRings) {
      for (const ring of this._orbitRings) {
        // Back halves: dimmer
        const origAlpha = ring.alpha;
        ring.alpha = 0.35;
        ring.renderBack(ctx);
        ring.alpha = origAlpha;
      }
    }
    // Comet ribbons: render all (no depth sort — they're all in front).
    if (this._cometRibbons) {
      for (const ribbon of this._cometRibbons) ribbon.render(ctx);
    }

    // Regular particles (StarParticle, SparkleParticle, etc.)
    for (const p of this.particles) p.render(ctx);

    // For orbit state: render FRONT halves of orbit rings on top (in front).
    if (this._orbitRings) {
      for (const ring of this._orbitRings) ring.renderFront(ctx);
    }
    // Hypno swirls render on top of eyes (always in front).
    if (this._hypnoSwirls) {
      for (const swirl of this._hypnoSwirls) swirl.render(ctx);
    }
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

    // ── 3D eye rotation: pupils on a sphere (orthographic 3D projection)
    // Per bloub's measured physics: eyes live on a sphere; yaw/pitch drive
    // a 3D rotation; near-edge pupils self-shrink. This gives the 3D-quality
    // "look around" feel instead of a flat 2D offset.
    // yaw = gazeX * max_yaw (~30°), pitch = gazeY * max_pitch (~20°)
    // 3D position on sphere of radius PUPIL_R:
    //   x = sin(yaw) * cos(pitch) * R
    //   y = sin(pitch) * R
    //   z = cos(yaw) * cos(pitch) * R  (used for scale only)
    // Orthographic project: drop z, but use it to compute perspective scale.
    const MAX_YAW = 0.52;    // ~30°
    const MAX_PITCH = 0.35;  // ~20°
    const PUPIL_R = 12;      // pupil travel radius on the sphere
    const yaw = this.target.gazeX * MAX_YAW;
    const pitch = this.target.gazeY * MAX_PITCH;
    const cosP = Math.cos(pitch);
    const x3 = Math.sin(yaw) * cosP * PUPIL_R;
    const y3 = Math.sin(pitch) * PUPIL_R;
    const z3 = cosP * Math.cos(yaw) * PUPIL_R;  // depth (positive = toward viewer)
    // Perspective scale: pupil shrinks at the sphere's edge (z near 0).
    // z ranges from 0 (edge) to PUPIL_R (center, toward viewer).
    // scale = 0.6 + 0.4 * (z / PUPIL_R) → 0.6 at edge, 1.0 at center.
    const pupilScale = 0.6 + 0.4 * (z3 / PUPIL_R);

    if (s.eyeL_pupil) {
      s.eyeL_pupil.x = 226 + x3;
      s.eyeL_pupil.y = 180 + y3;
      s.eyeL_pupil.scaleX = pupilScale;
      s.eyeL_pupil.scaleY = pupilScale;
    }
    if (s.eyeR_pupil) {
      s.eyeR_pupil.x = 286 + x3;
      s.eyeR_pupil.y = 180 + y3;
      s.eyeR_pupil.scaleX = pupilScale;
      s.eyeR_pupil.scaleY = pupilScale;
    }

    // ── Head tilt: ±12° rotation + 2px parallax ──────────────────────
    s.head.rotation = this.target.headTilt * (12 * Math.PI / 180);
    s.head.x = 256 + this.target.gazeX * 2; // 2px parallax

    // ── Rocket state: Shiku shoots upward then falls back (3s oneShot).
    // Phase 0..0.4: rise, 0.4..0.6: hang, 0.6..1.0: fall back.
    // Override head + body y position with rocket offset.
    let rocketOffsetY = 0;
    if (this.state === 'rocket') {
      const phase = (this.clock - this.stateChangedAt) / 3.0;  // 0..1
      if (phase < 0.4) {
        rocketOffsetY = -(phase / 0.4) * 60;  // rise 60px up
      } else if (phase < 0.6) {
        rocketOffsetY = -60;  // hang at peak
      } else if (phase < 1.0) {
        rocketOffsetY = -60 + ((phase - 0.6) / 0.4) * 60;  // fall back
      }
    }
    // Stash the rocket offset so renderBackground can use it (for shadow position).
    this._rocketOffsetY = rocketOffsetY;
    s.head.y = 200 + rocketOffsetY;
    if (s.body) s.body.y = 340 + rocketOffsetY;

    // ── Ears: ±20° (±0.35 rad) for alert/droop ───────────────────────
    // Phase 5: use the EAR SPRING position (lagged follow-through) instead
    // of the raw target. The spring's critically-damped lag gives secondary
    // motion — ears trail behind head rotation, like real ears would.
    if (s.earL) {
      s.earL.rotation = this.earSpringL.pos * 0.35;
      s.earL.y = 110 + rocketOffsetY;
    }
    if (s.earR) {
      s.earR.rotation = this.earSpringR.pos * 0.35;
      s.earR.y = 110 + rocketOffsetY;
    }
    if (s.hairTuft) s.hairTuft.y = 95 + rocketOffsetY;
    if (s.glasses) s.glasses.y = 180 - this.target.glassesLift * 10 + rocketOffsetY;
    if (s.eyeL_sclera) s.eyeL_sclera.y = 180 + rocketOffsetY;
    if (s.eyeR_sclera) s.eyeR_sclera.y = 180 + rocketOffsetY;
    if (s.eyeL_lid) s.eyeL_lid.y = 180 + rocketOffsetY;
    if (s.eyeR_lid) s.eyeR_lid.y = 180 + rocketOffsetY;
    if (s.eyeL_pupil) s.eyeL_pupil.y = 180 + y3 + rocketOffsetY;
    if (s.eyeR_pupil) s.eyeR_pupil.y = 180 + y3 + rocketOffsetY;
    if (s.mouth) s.mouth.y = 270 + rocketOffsetY;

    // ── Lids: scaleY 0..1 (1=closed) ──────────────────────────────────
    if (s.eyeL_lid) s.eyeL_lid.scaleY = this.target.lidL;
    if (s.eyeR_lid) s.eyeR_lid.scaleY = this.target.lidR;

    // ── Mouth: scaleY for open, rotation for smile ────────────────────
    if (s.mouth) {
      s.mouth.scaleY = 1 + this.target.mouthOpen * 1.5;
      s.mouth.rotation = this.target.smile * 0.2;
    }

    // ── Glasses: ±10px y lift, ±0.2 rad crooked ───────────────────────
    if (s.glasses) {
      s.glasses.rotation = this.target.glassesCrooked * 0.2;
    }

    // ── Phase 5: breathing motion (universal "alive" signal).
    // ±1.5% scale at 0.3Hz (3.33s period — calm, relaxed breathing).
    // Applied to head + body in non-special states (not burst/comet/disco
    // which have their own scale overrides).
    const breathing = 1 + 0.015 * Math.sin(this.breathPhase);

    // ── Burst state: body + head collapse to 0.166 then regrow ────────
    // _burstScale is computed in computePerception() for the burst state.
    const burstScale = (this.state === 'burst' && this._burstScale) ? this._burstScale : 1;
    if (burstScale !== 1) {
      s.head.scaleX = burstScale;
      s.head.scaleY = burstScale;
      if (s.body) {
        s.body.scaleX = burstScale;
        s.body.scaleY = burstScale;
      }
    } else {
      // Apply breathing to head + body when not in a special-scale state
      s.head.scaleX = breathing;
      s.head.scaleY = breathing;
      if (s.body) {
        s.body.scaleX = breathing;
        s.body.scaleY = breathing;
      }
    }

    // ── Comet state: collapse head + body to a small dot ─────────────
    if (this.state === 'comet') {
      s.head.scaleX = 0.3;
      s.head.scaleY = 0.3;
      if (s.body) {
        s.body.scaleX = 0.2;
        s.body.scaleY = 0.2;
      }
    }

    // ── Disco state: hue-cycling body via... we can't change SolidColor
    //    at runtime through the runtime API (no exposed setter for colorValue
    //    on SolidColor). We work around this by scaling the body slightly
    //    (a "dance bounce") — the rainbow trail + sparkles carry the
    //    color-shifting effect via the overlay canvas.
    if (this.state === 'disco') {
      const bounce = 1 + 0.05 * Math.sin(this.clock * 8 * TAU);  // subtle 8Hz bounce
      s.head.scaleX = bounce;
      s.head.scaleY = bounce;
      if (s.body) {
        s.body.scaleX = bounce;
        s.body.scaleY = bounce;
      }
    }

    // ── Tail wag: 6 segments oscillating with phase offset ───────────
    const wagFreq = TAU / 0.7; // rad/s
    const wagAmp = 0.05 + this.target.wagSpeed * 0.10; // LOGO MODE: subtle (0.05..0.15 rad)
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
    // ── Funky extended API (Phase 4) ─────────────────────────────────
    // Convenience methods for the 6 new states — these read naturally:
    //   shiku.orbit()    → orbit state (3D rings, eyes whip around sphere)
    //   shiku.comet()    → comet state (4 ribbons, body collapses to dot)
    //   shiku.burst()    → burst state (body collapses + regrows, spiral particles)
    //   shiku.dance()    → disco state (rainbow trail + sparkle storm)
    //   shiku.spin()     → rocket state (Shiku shoots upward with flame trail)
    //   shiku.hypnotize()→ hypno state (eyes become swirling spirals)
    orbit:      () => brain.go('orbit'),
    comet:      () => brain.go('comet'),
    burst:      () => brain.go('burst'),
    dance:      () => brain.go('disco'),
    spin:       () => brain.go('rocket'),
    hypnotize:  () => brain.go('hypno'),
    // ── TASK STATE API (Novra case study: functional app status) ──────
    // These make Shiku a functional status indicator, not just a cute logo.
    //   shiku.working()  → focused, typing motion (app is processing)
    //   shiku.upload()   → looking up, watching progress (uploading)
    //   shiku.error()    → startled-held, grimace (something went wrong)
    //   shiku.finished() → big smile, sparkles (task complete)
    //   shiku.greet()    → ear wiggle wave, happy bounce (welcome)
    working:    () => brain.go('working'),
    upload:     () => brain.go('upload'),
    error:      () => brain.go('error'),
    finished:   () => brain.go('finished'),
    greet:      () => brain.go('greeting'),
    // Random funky state — for "surprise me" button
    surprise: () => {
      const funky = ['orbit', 'comet', 'burst', 'disco', 'rocket', 'hypno'];
      const next = funky[Math.floor(Math.random() * funky.length)];
      brain.go(next);
      return next;
    },
    // Debug access (not in contract but useful):
    brain,
    get state() { return brain.state; },
    get clock() { return brain.clock; },
  };
  return brain;
}

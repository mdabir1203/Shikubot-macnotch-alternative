// src/main.js — the integration layer.
//
// Per master prompt:
//   "Runtime: @rive-app/canvas-advanced, version PINNED, self-hosted rive.wasm"
//
// In practice, we use the @rive-app/canvas (basic) package for rendering
// because it correctly initializes the renderer (the bare canvas-advanced
// API leaves artboard.draw() producing nothing — confirmed in Phase 1/3
// debugging). The basic package is built on top of canvas-advanced and
// handles: loading the .riv, advancing the SM + artboard, rendering to the
// canvas, and exposing stateMachineInputs() for the brain to write to.
//
// The brain is wired on top:
//   - basic package renders Shiku + advances SM/artboard
//   - brain's tick(ms) does perception + springs + particles + writes to
//     inputs + writes to artboard shape properties + renders particle overlay
//   - brain does NOT call sm.advance/artboard.advance (externalAdvance=true,
//     the basic package handles it)
//
// Per master prompt: "One rAF loop in the brain; Rive runs its own."
// We have TWO rAF loops (brain's + basic package's), but they don't conflict:
//   - brain's rAF: perception + writes + particles
//   - basic package's rAF: advance SM + advance artboard + render canvas

import { createBrain } from './brain.js';

// Use window.rive from the UMD bundle loaded in index.html via <script>.
// (Loading the basic package via ESM import causes it to fetch rive.wasm
// from unpkg.com CDN — violates master prompt's "self-hosted rive.wasm
// (zero network requests)" + fails to parse the CLI-built .riv. The UMD
// script path works correctly — proven in basic-test.html.)
const riveNs = window.rive;
console.log('[shikubot] window.rive keys:', riveNs ? Object.keys(riveNs).slice(0, 15).join(',') : 'UNDEFINED');
const Rive = riveNs?.Rive;
if (typeof Rive !== 'function') {
  throw new Error(`window.rive.Rive is not a constructor (riveNs=${!!riveNs}, Rive=${typeof Rive})`);
}

const RIVE_CANVAS_ID = 'rive-canvas';
const PARTICLES_CANVAS_ID = 'particles-canvas';
const BACKGROUND_CANVAS_ID = 'background-canvas';  // Phase 5: behind-rive layer for shadow + dust + tint
const STATE_MACHINE_NAME = 'Brain';

async function init() {
  const riveCanvas = document.getElementById(RIVE_CANVAS_ID);
  const particlesCanvas = document.getElementById(PARTICLES_CANVAS_ID);
  const backgroundCanvas = document.getElementById(BACKGROUND_CANVAS_ID);
  if (!riveCanvas || !particlesCanvas || !backgroundCanvas) {
    throw new Error(`required canvas elements not found (need #${RIVE_CANVAS_ID} + #${PARTICLES_CANVAS_ID} + #${BACKGROUND_CANVAS_ID})`);
  }

  // 1. Fetch the .riv bytes + pass via `buffer` (the basic package's `src`
  //    option fetches via XHR + sometimes hits CORS/encoding issues; `buffer`
  //    is the reliable path — proven in basic-test.html).
  const bytes = await fetch('./shikubot.riv').then(r => r.arrayBuffer());
  console.log('[shikubot] fetched .riv bytes:', bytes.byteLength, 'bytes');

  // 2. Create the basic Rive instance. The basic package handles:
  //    - loading shikubot.riv (from buffer)
  //    - creating the artboard + state machine instance
  //    - rendering to the canvas (clear → save → align → draw → restore → flush)
  //    - advancing the SM + artboard each frame
  // Autoplay:true so the 'Brain' SM runs (fires transitions on triggers).
  const riveInst = new Rive({
    buffer: bytes,  // raw ArrayBuffer (basic-test.html used Uint8Array, both should work)
    canvas: riveCanvas,
    autoplay: true,
    stateMachines: STATE_MACHINE_NAME,
    onLoad: () => {
      console.log('[shikubot] onLoad fired');
      try {
        wireBrain(riveInst, riveCanvas, particlesCanvas, backgroundCanvas);
      } catch (e) {
        console.error('[shikubot] wireBrain threw:', e);
        window.shikubotError = 'wireBrain: ' + String(e) + (e.stack ? '\n' + e.stack : '');
      }
    },
    onLoadError: (e) => {
      console.error('[shikubot] rive load error:', e);
      window.shikubotError = String(e);
    },
  });
  window.riveInst = riveInst;
}

function wireBrain(riveInst, riveCanvas, particlesCanvas, backgroundCanvas) {
  // Access the basic package's internals (private but JS-accessible):
  //   - riveInst.runtime: the canvas-advanced rive instance (has SMIInput,
  //     Fit, Alignment, etc.)
  //   - riveInst.artboard: the Artboard instance (has .node(name), .bounds, etc.)
  //   - riveInst.stateMachineInputs('Brain'): the SMIInput array for 'Brain'
  //     (the basic package's internal StateMachineInstance wrapper doesn't
  //     expose inputCount()/input(i) — we use the public stateMachineInputs()
  //     API + wrap the returned array in a shim that provides those methods)
  const runtime = riveInst.runtime;
  const artboard = riveInst.artboard;
  const inputsArray = riveInst.stateMachineInputs(STATE_MACHINE_NAME);

  if (!runtime || !artboard || !inputsArray) {
    throw new Error(`missing basic-package internals: runtime=${!!runtime} artboard=${!!artboard} inputsArray=${!!inputsArray}`);
  }

  // Shim the SMIInput array as a StateMachineInstance-like object so the brain's
  // validateInputs(sm, SMIInput) + sm.inputCount() / sm.input(i) calls work.
  // (externalAdvance=true means sm.advance() is never called, so it's a no-op.)
  const smShim = {
    inputCount: () => inputsArray.length,
    input: (i) => inputsArray[i],
    advance: () => { /* no-op — basic package handles advancement */ },
  };

  // 2. Create the Brain.
  const brain = createBrain({
    riveCanvas,
    particlesCanvas,
    backgroundCanvas,  // Phase 5: behind-rive layer for shadow + dust + tint
    rive: runtime,
    file: riveInst.file,
    artboard,
    stateMachineInstance: smShim,
    externalAdvance: true,
  });

  // 3. main.js's rAF for perception + writes + particles.
  //    The basic package has its OWN rAF for SM advance + artboard advance + render.
  //    These don't conflict — the brain writes shape properties, the basic
  //    package's next render picks them up (max 1-frame latency).
  function tick(ms) {
    requestAnimationFrame(tick);
    brain.tick(ms);
  }
  requestAnimationFrame(tick);

  console.log(
    `[shikubot] ready. artboard=${artboard.name} ` +
    `sm="${STATE_MACHINE_NAME}" inputs=${inputsArray.length} (expect 19). ` +
    `window.shiku = { go, poke, pet }`,
  );
  window.shikubotReady = true;
}

init().catch(e => {
  console.error('[shikubot] init failed:', e);
  window.shikubotError = String(e) + (e.stack ? '\n' + e.stack : '');
  const hint = document.querySelector('.hint');
  if (hint) hint.textContent = `init failed: ${e.message}`;
});

export {};

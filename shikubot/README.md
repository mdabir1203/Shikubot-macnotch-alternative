# Shiku — Dynamic Logo Mascot

> Interactive character system that communicates app activity through character states. Built with Rive (CLI-authored `.riv`) + vanilla JS brain with hybrid spring/ease-out physics. Inspired by [Novra Design's GrokBot case study](https://www.novra.design/case-studies/grokbot).

## What is this?

Shiku is a dynamic logo mascot — a fox-like character that reacts to app activity, user interaction, and time. Instead of a static logo, Shiku **lives**: it breathes, blinks, follows your cursor, and changes expression based on what the app is doing.

- **App loading?** Shiku focuses, subtle typing motion
- **Upload in progress?** Shiku looks up, eyes wide
- **Error occurred?** Shiku startles, glasses go crooked
- **Task complete?** Shiku smiles, sparkles appear
- **App backgrounded?** Shiku gets sleepy
- **User returns?** Shiku gets curious, ears perk up

Tap, double-tap, long-press, or swipe to interact directly.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    JS "BRAIN" (src/brain.js)                │
│  • Hybrid physics: ease-outs for body/gaze (per bloub)      │
│  • Critically-damped springs for glasses wobble + ears      │
│  • Layered perception: ears ω=14 → tilt ω=8 → gaze ω=10   │
│  • 3D pupils on a sphere (orthographic projection)          │
│  • Particle system (stars, sparkles, flames, z-z-z, etc.)   │
│  • Autonomous mood cycling (Markov chain, configurable)    │
│  • App activity API (setActivity maps app → Shiku state)    │
└──────────────────────────┬──────────────────────────────────┘
                           │ 19 contract inputs (12 numbers + 7+ triggers)
                           │ via src/inputmap.js (single source of truth)
┌──────────────────────────┴──────────────────────────────────┐
│              RIVE "BODY" (scene.rml → shikubot.riv)          │
│  • Authored via Rive CLI (no GUI editor needed)              │
│  • 17-state machine "Brain" with trigger-only transitions    │
│  • 19 shapes (head, body, curved ears, glasses, eyes, etc.) │
│  • Built with: rive . --once → build/shikubot.riv          │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Vector body | Rive CLI 1.1.1 + RML | Authored `.riv` file (no GUI editor) |
| Runtime | @rive-app/canvas 2.23.0 | Renders `.riv` to canvas |
| Brain | Vanilla ES modules | Physics, perception, state machine, particles |
| Build | Vite 5.4 | Dev server + production bundler |
| Self-hosted | rive_fallback.wasm | Zero CDN dependency (local file) |

## 17 States

### Mood States (12)
| State | Trigger | Visual |
|-------|---------|--------|
| `idle` | `goIdle` | Calm breathing, gaze drift, blink every 6s |
| `curious` | `goCurious` | Ears alert, double-blink, small "ooh" mouth |
| `excited` | `goExcited` | Wide eyes, glasses push-up, fast wag, sparkles |
| `startled` | `goStartled` | Glasses knocked up+crooked (spring wobble), star burst |
| `sleepy` | `goSleepy` | Lids 70% closed, glasses at nose tip, yawn, z-z-z |
| `confused` | `goConfused` | Squint, glasses slide down, wavy mouth, one ear folds |
| `orbit` | `goOrbit` | 6 depth-sorted 3D orbit rings, eyes whip around sphere |
| `comet` | `goComet` | Body collapses to dot, 4 ribbons orbit at 210°/s |
| `burst` | `goBurst` | Body collapses + regrows, 5 spiral particles inward |
| `disco` | `goDisco` | Rainbow trail, sparkle storm, body bounces at 8Hz |
| `rocket` | `goRocket` | Shoots upward with flame trail, falls back |
| `hypno` | `goHypno` | 3-arm rainbow spiral swirls in each eye |

### Task States (5, Novra case study)
| State | Trigger | App Activity |
|-------|---------|-------------|
| `working` | `goWorking` | `setActivity('loading')` — focused, typing motion at 4Hz |
| `upload` | `goUpload` | `setActivity('uploading')` — looking up, wide eyes |
| `error` | `goError` | `setActivity('error')` — startled-held, glasses crooked |
| `finished` | `goFinished` | `setActivity('complete')` — big smile, sparkles |
| `greeting` | `goGreeting` | `setActivity('startup')` — ear wiggle wave, happy bounce |

## API

```js
// App activity integration (main entry point for dynamic logo use)
shiku.setActivity('loading')      // → working (focused typing)
shiku.setActivity('uploading')    // → upload (looking up)
shiku.setActivity('error')        // → error (startled grimace)
shiku.setActivity('complete')     // → finished (big smile + sparkles)
shiku.setActivity('startup')      // → greeting (ear wiggle wave)
shiku.setActivity('background')  // → sleepy (gets drowsy)
shiku.setActivity('notification') // → excited (perks up)
shiku.setActivity('returning')    // → curious (ears alert)

// Demo showcase (auto-cycles through all states)
shiku.demo()      // starts auto-cycling for presentations
shiku.demoStop()  // stops, returns to idle

// Direct state control
shiku.go('startled')    // any of 17 states by name
shiku.poke()            // poke (3 pokes → dizzy)
shiku.pet()             // calms down
shiku.surprise()        // random funky state

// Funky state shortcuts
shiku.orbit()  shiku.comet()  shiku.burst()
shiku.dance()  shiku.spin()  shiku.hypnotize()

// Task state shortcuts
shiku.working()  shiku.upload()  shiku.error()
shiku.finished()  shiku.greet()

// Getters
shiku.state     // current state name
shiku.activity  // current activity
shiku.clock     // elapsed seconds
```

## Touch Interactions

| Gesture | Effect |
|---------|--------|
| Tap | Poke (3 pokes → dizzy) |
| Double-tap | Excited |
| Long-press (>500ms) | Pet (calms down) |
| Swipe (>50px) | Surprise (random funky state) |

## Spatial Design (2026 Trends)

- **3-layer depth**: background (shadow + dust + spotlight) → Rive body (transparent) → particles (3D shading + glassmorphism + cursor trail)
- **Multi-layer gradient shading**: base sphere gradient + key light specular + rim light crescent + glassmorphism sweep
- **Glassmorphism**: translucent white sweep on body (glossy "jelly" material quality)
- **Bokeh dust**: 25 soft-focus radial gradient particles with atmospheric perspective
- **Soft drop shadow**: grounds the character, scales with body state
- **Curved ears**: CubicMirroredVertex PointsPath (not straight triangles)
- **Sage green palette**: hue=85, matching the reference aesthetic
- **4K rendering**: 1024×1024 canvas (2× DPR), image-rendering: crisp-edges
- **PWA-installable**: manifest.json, apple-mobile-web-app-capable

## Physics

| System | Type | Parameters |
|--------|------|-----------|
| Body/ears/gaze perception | Exponential ease-out | ω=14 (ears) → ω=8 (tilt) → ω=10 (gaze) |
| Glasses wobble on startle | Critically-damped spring | ω=13, ζ=1, 1/120s substep |
| Ear follow-through | Critically-damped spring | ω=4 (slower, heavier) |
| Tail wag | Sinusoidal oscillation | 0.05-0.15 rad amplitude, 0.7s cycle |
| Breathing | Sine | 0.2Hz (5s period) |
| Gaze drift (idle) | Layered sines | 0.15-0.37 freq, ±0.35 clamp |
| Pupils | 3D sphere projection | yaw ±30°, pitch ±20°, perspective scale |

## File Structure

```
shikubot/
├── scene.rml              # RML spec (the body — 17 states, 19 shapes)
├── rive.yaml              # Rive CLI config (512×512 artboard)
├── build/shikubot.riv     # Built .riv (PRIVATE — gitignored)
├── public/
│   ├── shikubot.riv       # Runtime copy of .riv
│   ├── rive.wasm          # Self-hosted WASM (no CDN)
│   ├── rive-basic.js      # UMD bundle for @rive-app/canvas
│   └── manifest.json      # PWA manifest
├── src/
│   ├── inputmap.js        # Contract (19 inputs — single source of truth)
│   ├── brain.js           # The mind (physics, perception, states, particles)
│   └── main.js            # Integration (loads .riv, wires brain, rAF loop)
├── index.html             # Mobile-first, PWA-ready, activity badge
├── package.json           # Vite + @rive-app/canvas 2.23.0
├── vite.config.js         # COOP/COEP for WASM, .riv/.wasm as assets
├── LICENSE                # Private educational showcase (no commercial use)
└── AGENTS.md / CLAUDE.md  # Rive CLI agent instructions
```

## Getting Started

### Prerequisites
- Node.js 18+
- Rive CLI 1.1.1+ (optional — only needed to rebuild the `.riv`)

### Install & Run

```bash
npm install
npm run dev          # Vite dev server → http://localhost:5173
```

### Production Build

```bash
npm run build        # → dist/ (static files, deploy anywhere)
npx serve dist       # Serve the production build
```

### Rebuild the .riv (if you modify scene.rml)

```bash
npm run rive:build   # rive . --once → build/shikubot.riv
npm run rive:verify  # rive . --verify (compile check)
npm run rive:inspect # rive inspect . --summary (structure check)
```

### Install Rive CLI

```bash
curl -fsSL https://releases.rive.app/cli/install.sh | bash
# Then rebuild: rive . --once
```

## Integrating with Your App

1. Copy the `dist/` folder to your static assets
2. Include `rive-basic.js` before your app's JS
3. Access the API via `window.shiku`

```html
<script src="/path/to/rive-basic.js"></script>
<script type="module" src="/path/to/main.js"></script>
<script>
  // Your app code
  function onAppStart() { shiku.setActivity('startup'); }
  function onLoading() { shiku.setActivity('loading'); }
  function onError() { shiku.setActivity('error'); }
  function onComplete() { shiku.setActivity('complete'); }
  function onBackground() { shiku.setActivity('background'); }
</script>
```

## IP Notice

Shiku is inspired by the fox puppet from Sisimpur (Sesame Workshop, Bangladesh). The `.riv` file, frame captures, and any traced assets are **private** and excluded from this repository via `.gitignore`. The MIT-licensed code covers the brain, inputmap, and build configuration only — not the artwork.

## Credits

- **Architecture**: Rive CLI body + JS brain (per bloub's measured physics)
- **Case study reference**: [Novra Design — GrokBot](https://www.novra.design/case-studies/grokbot)
- **Physics reference**: [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub) (exponential ease-outs, no overshoot)
- **Rive CLI**: [rive.app/docs/cli](https://rive.app/docs/cli/overview)

## License

Private educational showcase. No commercial use. See [LICENSE](./LICENSE).

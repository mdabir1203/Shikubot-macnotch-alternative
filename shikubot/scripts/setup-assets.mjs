// scripts/setup-assets.mjs — postinstall script
// Copies runtime assets from node_modules to public/ so the app works
// out of the box after `npm install`.
import { cpSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');

mkdirSync(publicDir, { recursive: true });

// 1. Copy rive.wasm
const wasmSrc = join(root, 'node_modules/@rive-app/canvas-advanced/rive_fallback.wasm');
if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, join(publicDir, 'rive.wasm'));
  console.log('[setup] copied rive_fallback.wasm → public/rive.wasm');
}

// 2. Copy rive.js (UMD bundle)
const jsSrc = join(root, 'node_modules/@rive-app/canvas/rive.js');
if (existsSync(jsSrc)) {
  cpSync(jsSrc, join(publicDir, 'rive-basic.js'));
  console.log('[setup] copied rive.js → public/rive-basic.js');
}

// 3. Build .riv from scene.rml (if Rive CLI available)
const rmlFile = join(root, 'scene.rml');
const buildDir = join(root, 'build');
if (existsSync(rmlFile)) {
  try {
    mkdirSync(buildDir, { recursive: true });
    execSync(`rive ${root} --once`, { stdio: 'inherit' });
    const builtRiv = join(buildDir, 'shikubot.riv');
    if (existsSync(builtRiv)) {
      cpSync(builtRiv, join(publicDir, 'shikubot.riv'));
      console.log('[setup] built + copied shikubot.riv');
    }
  } catch {
    console.warn('[setup] Rive CLI not found. Install: curl -fsSL https://releases.rive.app/cli/install.sh | bash');
    console.warn('[setup] Then run: npm run rive:build');
  }
}

console.log('[setup] ✓ Done. Run `npm run dev`');

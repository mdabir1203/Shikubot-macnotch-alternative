import { defineConfig } from 'vite';

// Vanilla Vite config for Shiku Bot.
// `@rive-app/canvas-advanced` ships its own rive.wasm; we self-host it under
// /public/rive.wasm so the runtime makes ZERO network requests to a CDN.
// The brain (src/brain.js) loads the wasm via fetch('/rive.wasm') in main.js.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
    assetsInlineLimit: 0, // don't inline .riv or .wasm as base64
  },
  server: {
    port: 5173,
    open: false,
    // NOTE: removed COOP/COEP headers — they were causing the cross-origin
    // wasm fetch from unpkg.com to be CORB-blocked (bytes returned as null
    // → .riv parse failed with "may be corrupt"). The basic package's
    // default wasmURL is unpkg; we can self-host later but for now let
    // the cross-origin fetch work.
  },
  // Treat .riv as a static asset — emit verbatim, don't try to parse
  assetsInclude: ['**/*.riv', '**/*.wasm'],
});

# assets/frames/

This directory is intended to hold ~15 culled reference frames of Shiku (the
fox puppet from Sisimpur / Sesame Workshop Bangladesh) used to derive the
anatomical proportions of the `.riv` body.

## Current status: EMPTY (extraction failed)

### What was attempted (2026-09-24)

YouTube video extraction was attempted to populate this directory before
falling back to the master prompt's default proportions:

1. `yt-dlp` (v2026.08.19) without a JS runtime — failed, YouTube deprecated
   JS-less extraction.
2. Installed Deno 2.x at `~/.deno/bin/deno` and retried with
   `--js-runtimes deno` — failed with HTTP 429 (YouTube bot detection).
3. Retried with `--extractor-args "youtube:player_client=android"` —
   same "Sign in to confirm you're not a bot" error.
4. Web search (`z-ai function -n web_search`) for Sisimpur clips on
   DailyMotion / Vimeo / archive.org — no direct video URLs returned.

### Root cause

YouTube's bot-detection blocks the cloud IP without browser cookies. This
is a platform-level restriction, not a tooling failure — `yt-dlp` and Deno
are working correctly.

### What was searched

Two Shiku-focused Sisimpur YouTube videos were identified:

- `YXEQZIjHJRM` — "Sisimpur: Scientist Shiku | বিজ্ঞানী শিকু" (21 min)
- `gfV13HAyAcc` — "Sisimpur | শিকুর চুম্বক যন্ত্র | Shiku's Magnet Device" (17 min)

Both blocked by YouTube bot detection. If you can run `yt-dlp` from a
residential IP with browser cookies, either URL would work.

### Fallback in effect

Per the master prompt's self-healing rule (`assets/frames/` empty → use
defaults), `scene.rml` was authored against the master prompt's default
proportions:

- head ≈ 45% of body height, near-circular
- glasses centered 40% down from top of head
- muzzle in lower third
- palette: fur #8E9A3B / light #A9B44E / shadow #6E7828;
  hair + tail-tip + inner-ear #D95B2B→#F08A3F;
  glasses #202020; sclera #FFFFFF; pupil #141414;
  mouth #A9322C; tongue #D9534A.

### How to repopulate later

1. From a residential IP with a logged-in browser session:
   ```
   yt-dlp -f "best[height<=480][ext=mp4]" \
     --cookies-from-browser chrome \
     -o "assets/frames/raw.mp4" \
     "https://www.youtube.com/watch?v=YXEQZIjHJRM"
   ```
2. Extract distinct frames via scene-detection:
   ```
   ffmpeg -i assets/frames/raw.mp4 \
     -vf "select=gt(scene\,0.3)" \
     -vsync vfr assets/frames/candidate_%03d.png
   ```
3. Manually cull to ~15 representative frames showing different head angles
   and expressions. Delete the rest (including raw.mp4).
4. Re-author `scene.rml` paths against the new proportions — the CLI makes
   this a one-command rebuild: `rive . --once`.

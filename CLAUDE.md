# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start                    # real Arduinos, kiosk fullscreen
npm run sim                  # no hardware: electron . --sim (keys S/A/L/T)
npx electron . --sim --windowed   # windowed; --fullscreen forces fullscreen
npm test                     # node test/game.test.js (plain node, no framework)
npm run build:win            # portable + nsis (x64) -> dist/
npm run build:mac            # dmg, arm64 + x64 -> dist/ (both builds can run on macOS)
```

There is no lint step and no way to run a single test; `test/game.test.js` is one script that runs every case.

## Product rules (decided with the user; not obvious from code)

- It is an EMG (forearm muscle sensor) two-player contest. Larger sensor value = stronger contraction.
- One match = 5 seconds: 50 samples per player at 0.1 s each. There is **no judging phase**; the result appears immediately when both sides have 50 samples (or after the 8 s timeout).
- Final score = the **maximum** of the 50 samples, not the last or the average. The big number and level meter during measurement show the **current** force, smoothly animated; the max is shown in the small "측정 n / 50 · 최고" line.
- Hall of fame (top 5): both players are checked independently, so a loser can enter. 0 points never enters. Ties keep the earlier record on top. New entries are named `ㅇㅇㅇ`; admin only renames.
- Admin screen shortcut is `Ctrl+D` on Windows and `Control+D` on macOS (not Cmd). Keys are matched by `e.code` so they work with a Korean IME active.
- Bump the `package.json` version on every user-visible change (the user checks for this).
- The user communicates in Korean; keep UI text and replies in Korean.

## Architecture

Electron app, two processes, no bundler. UI is fixed at 1440×900 design pixels and scaled to the window by `fit()` in `src/renderer/app.js`.

- **Main process** (`src/main/`) owns all state and timing. `main.js` wires everything: it ticks the game every 50 ms and pushes a single `payload` (`game, hall, ports, settings, sim, platform, fullscreen, ...`) to the renderer only when it changed. The renderer holds no authoritative state.
- `serial.js` opens every USB serial port at 9600 baud, rescans every 2 s, and routes by line prefix (`P1 <int>`, `P2 <int>`, `START`), not by port. Non-USB ports (Bluetooth etc.) are skipped. A player is "connected" if a line arrived in the last 2 s. Unmatched lines are ignored.
- `game.js` is a pure state machine (IDLE → MEASURING → RESULT) that takes `now` as an argument so tests can drive the clock. Calibration factor is applied per sample in `toScore`.
- `sim.js` generates fake `P1`/`P2` values and START to replace the hardware; it feeds the same path as `serial.js`.
- `hall.js` holds the pure ranking rules; `store.js` persists `settings.json` and `hall-of-fame.json` in `userData` with write-temp → fsync → rename, retrying on Windows EPERM/EBUSY, and moving unreadable files to `*.corrupt-<time>`.
- **Renderer** (`src/renderer/`) is plain HTML/JS under a strict CSP (`self` only). It talks to main only through `window.api` defined in `src/preload.js` (contextIsolation + sandbox). Adding a feature that needs main usually means: IPC handler in `main.js` + method in `preload.js` + call in `app.js`.
- A `requestAnimationFrame` loop in `app.js` exponentially smooths displayed numbers (`SMOOTH_MS`); the 7-segment digits come from `segments.js`.

## Build notes

- `serialport` ships N-API prebuilds, so `npmRebuild: false` is set in the electron-builder config (rebuilding fails on machines without node-gyp/distutils). `@serialport/bindings-cpp` must stay in `asarUnpack`.
- Only one app instance runs (single-instance lock) so two copies never fight over serial ports.
- Do Hyeon font is bundled in `src/renderer/fonts/` (OFL); the app must work offline.

## Gotchas

- The renderer rebuilds admin rows from each pushed payload; `renderAdminRows` preserves what the user is typing, so keep that when changing it.
- The banner text is fixed at 980 px with `nowrap` because it previously wrapped the last Korean character onto a second line.
- `design/` and `design/claude-code-prompt.md` are the **initial** spec; the behavior above (immediate result, max score, Ctrl+D, app name) supersedes them.
- Not yet verified: real Arduino/EMG hardware, running the exe on real Windows, the fullscreen/window toggle in a live run.

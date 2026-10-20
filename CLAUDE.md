# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current status: migrating v1.2.0 → v2.0.0

The project is moving from a 2-player Arduino contest (v1.2.0, what the code still does) to a **1-player record mode fed by a SpikerBox** (v2.0.0). `PLAN.md` holds the full plan, the SpikerBox protocol notes, and 5 phases (backend first, screen design in Phase 4) with an 11-step checklist. Work one phase at a time; read it before changing anything. Tick its checkboxes as steps land and update it first when a decision changes. Sections below marked **(v2)** describe the target; until the matching PLAN step is done, the code still behaves like v1.

## Commands

```bash
npm install
npm start                    # real hardware, kiosk fullscreen
npm run sim                  # no hardware: electron . --sim
npx electron . --sim --windowed   # windowed; --fullscreen forces fullscreen
npm test                     # node test/game.test.js (plain node, no framework)
npm run build:win            # portable + nsis (x64) -> dist/
npm run build:mac            # dmg, arm64 + x64 -> dist/ (both builds can run on macOS)
```

There is no lint step and no way to run a single test. `test/game.test.js` is one script that runs every case, and new tests go in it too. Sim keys: v1 uses `S` (start), `A`/`L` (P1/P2 force), `T` (tie). In v2 only `S` and `A` remain.

## Product rules (decided with the user; not obvious from code)

- **(v2) Hardware**: EMG sensor → **SpikerBox** → laptop over USB (binary waveform). A **separate Arduino** carries only the START button (`START` line at 9600 baud, plus an `ALIVE` heartbeat every 1 s). Reading EMG directly on the Arduino was abandoned because its raw values saturated at 1/1023.
- **(v2) One player**, punch-machine style: no opponent, no winner/draw. The goal is setting a record.
- One measurement = 5 seconds from the START signal: 50 samples at 0.1 s each. There is **no judging phase**. The result appears as soon as 50 samples are in (or after the 8 s timeout).
- **(v2) One sample** = the RMS of the SpikerBox signal over a 100 ms window (time-based, not sample-count-based), after removing the moving-average baseline and subtracting the resting-noise RMS, times the calibration factor, clamped to 0–9999. FFT is not used. Spike Recorder's FFT is only a display feature.
- Final score = the **maximum** of the 50 samples, not the last or the average. During measurement the big number shows the **current** force, smoothly animated. The max appears in the small `측정 n / 50 · 최고` line.
- Hall of fame (top 5): 0 points never enters. Ties keep the earlier record on top. New entries are named `ㅇㅇㅇ`; admin only renames.
- **(v2) Main screen layout**: the P2 panel is removed. The P1 panel and the hall of fame keep their sizes and are centered as a pair. The top banner drops "WINNER" and shows the 7-segment score in its center; those digits moved there from the P1 panel.
- Admin screen shortcut is `Ctrl+D` on Windows and `Control+D` on macOS (not Cmd). Keys are matched by `e.code` so they work with a Korean IME active.
- Bump the `package.json` version on every user-visible change (the user checks for this). The v2 migration ships as `2.0.0`.
- The user communicates in Korean; keep UI text and replies in Korean.

## Architecture

Electron app, two processes, no bundler. UI is fixed at 1440×900 design pixels and scaled to the window by `fit()` in `src/renderer/app.js`.

- **Main process** (`src/main/`) owns all state and timing. `main.js` wires everything. It ticks the game every 50 ms and pushes a single `payload` (`game, hall, ports, settings, sim, platform, fullscreen, ...`) to the renderer only when it changed. The renderer holds no authoritative state.
- `serial.js` opens every USB serial port, rescans every 2 s, and skips non-USB ports (Bluetooth etc.). It never routes by port name.
  - v1: every port opens at 9600 baud and lines are routed by prefix (`P1 <int>`, `P2 <int>`, `START`).
  - **(v2)**: each new port is first probed as a SpikerBox: 222222 then 500000 baud, sending `b:;` and looking for an `HWT` message or valid frames. If both fail, the port opens as a 9600 text port (`START`, `ALIVE`). Port roles can also be fixed by hand in the admin screen.
- **(v2)** `spikerbox.js` parses the SpikerBox stream. A frame-start byte has bit 0x80 set, and the value is `((b0&0x7F)<<7)|(b1&0x7F)` per channel. Messages sit between escape markers `FF FF 01 01 80 FF` … `FF FF 01 01 81 FF` as `type:value;`. `emg.js` turns samples into the 100 ms score. Both are pure and testable, and PLAN.md §1–2 has the details.
- `game.js` is a pure state machine (IDLE → MEASURING → RESULT) that takes `now` as an argument so tests can drive the clock. The calibration factor is applied per sample in `toScore`.
- `sim.js` replaces the hardware.
  - v1: it emits fake `P1`/`P2` values.
  - **(v2)**: it emits a fake SpikerBox byte stream, so it exercises the real parser and RMS path.
- `hall.js` holds the pure ranking rules. `store.js` persists `settings.json` and `hall-of-fame.json` in `userData`: write temp → fsync → rename, retry on Windows EPERM/EBUSY, and move unreadable files to `*.corrupt-<time>`. **(v2)** `normalizeSettings` must migrate the v1 `calibration: {p1, p2}`, and `normalizeHall` must keep reading v1 entries that have a `player` field.
- **Renderer** (`src/renderer/`) is plain HTML/JS under a strict CSP (`self` only). It talks to main only through `window.api` defined in `src/preload.js` (contextIsolation + sandbox). Adding a feature that needs main usually means three edits: an IPC handler in `main.js`, a method in `preload.js`, and a call in `app.js`.
- A `requestAnimationFrame` loop in `app.js` exponentially smooths displayed numbers (`SMOOTH_MS`). The 7-segment digits come from `segments.js`.
- **(v2)** `arduino/start_button/start_button.ino` is the START button sketch (INPUT_PULLUP, debounced, `START` on press, `ALIVE` every 1 s).

## Reference code

- https://github.com/dohye0508/Spike-Recorder is a fork of Backyard Brains' Spike Recorder (C++/SDL). Only the README translation differs from upstream. It is a reference for the SpikerBox protocol only: `src/engine/ArduinoSerial.cpp` (frame parser around line 1950, sample rates by device in `setSampleRateAndNumberOfChannelsBasedOnType`, `HWT` names around line 2590, commands around line 2910). Do not vendor or build it.
- Spike Recorder and this app cannot hold the same serial port at once.

## Build notes

- `serialport` ships N-API prebuilds, so `npmRebuild: false` is set in the electron-builder config (rebuilding fails on machines without node-gyp/distutils). `@serialport/bindings-cpp` must stay in `asarUnpack`.
- Only one app instance runs (single-instance lock) so two copies never fight over serial ports.
- Do Hyeon font is bundled in `src/renderer/fonts/` (OFL); the app must work offline.

## Gotchas

- The renderer rebuilds admin rows from each pushed payload. `renderAdminRows` preserves what the user is typing, so keep that when changing it.
- The banner text is fixed at 980 px with `nowrap` because it previously wrapped the last Korean character onto a second line.
- `design/` and `design/claude-code-prompt.md` are the **initial** spec. The behavior above (immediate result, max score, Ctrl+D, app name, and v2's single player and SpikerBox) supersedes them.
- Non-standard baud 222222 on macOS through node `serialport` is unverified (PLAN.md §9).
- Not yet verified: real SpikerBox/EMG hardware, the START Arduino, running the exe on real Windows, the fullscreen/window toggle in a live run.

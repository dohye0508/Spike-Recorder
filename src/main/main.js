'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker } = require('electron');
const { Game } = require('./game');
const hall = require('./hall');
const { Store, normalizeSettings } = require('./store');
const { SerialManager } = require('./serial');
const { EmgWindow, RestMeter, strengthOf } = require('./emg');
const { Simulator } = require('./sim');

const argv = process.argv.slice(1);
const START_SIM = argv.includes('--sim');
// 시작 화면: --windowed / --fullscreen 이 있으면 그걸 따르고, 없으면 마지막으로 고른 방식(settings.fullscreen)
const FORCE_WINDOWED = argv.includes('--windowed');
const FORCE_FULLSCREEN = argv.includes('--fullscreen');

if (!app.requestSingleInstanceLock()) {
  // 두 개가 뜨면 시리얼 포트를 서로 뺏으므로 하나만 실행
  app.quit();
}

let win = null;
let store, settings, records, history, lastResult = null, game, serial, sim;
const emgWin = new EmgWindow();
const rest = new RestMeter(3000);
let live = { rms: 0, strength: 0 };
let zeroStartedAt = 0;
const EMG_WINDOW_MS = 100;
const ZERO_TIMEOUT_MS = 10000;
const SIM_PORT = '시뮬레이션';
let lastSaveError = null;
let lastPayload = '';

function now() {
  return Date.now();
}

function saveHall() {
  try {
    store.saveHall(records);
    lastSaveError = null;
  } catch (err) {
    lastSaveError = '명예의 전당 저장 실패: ' + err.message;
    console.error('[main]', lastSaveError);
  }
}

function saveHistory() {
  try {
    store.saveHistory(history);
  } catch (err) {
    lastSaveError = '기록 저장 실패: ' + err.message;
    console.error('[main]', lastSaveError);
  }
}

function payload() {
  const t = now();
  return {
    game: game.snapshot(t),
    result: lastResult,
    hall: records,
    ports: serial.status(t),
    emg: { rms: Math.round(live.rms * 10) / 10, strength: Math.round(live.strength * 10) / 10, restRms: settings.emg.restRms, zeroing: rest.running },
    settings,
    sim: sim.enabled,
    platform: process.platform,
    fullscreen: isFullscreen(),
    saveError: lastSaveError,
    dataDir: store.dir,
  };
}

function push(force) {
  if (!win || win.isDestroyed()) return;
  const p = payload();
  const s = JSON.stringify(p);
  if (!force && s === lastPayload) return;
  lastPayload = s;
  win.webContents.send('state', p);
}

function isFullscreen() {
  return !!win && !win.isDestroyed() && (win.isKiosk() || win.isFullScreen());
}

function saveSettings() {
  try {
    store.saveSettings(settings);
    lastSaveError = null;
  } catch (err) {
    lastSaveError = '설정 저장 실패: ' + err.message;
  }
}

/** 전체화면(kiosk) ↔ 창 모드. 고른 방식은 다음 실행 때도 유지된다. */
function setFullscreen(on) {
  if (!win || win.isDestroyed()) return;
  if (on) {
    win.setKiosk(true);
  } else {
    win.setKiosk(false);
    win.setFullScreen(false);
  }
  settings = { ...settings, fullscreen: !!on };
  saveSettings();
  push();
}

function createWindow(full) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 450,
    center: true,
    backgroundColor: '#140A09',
    kiosk: full,
    fullscreen: full,
    autoHideMenuBar: true,
    show: false,
    title: 'raibitScoreboard',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => push(true));
  // macOS 초록 버튼 등으로 바뀐 경우도 화면에 반영
  win.on('enter-full-screen', () => push());
  win.on('leave-full-screen', () => push());
  win.on('closed', () => { win = null; });
}

function setupMenu() {
  if (process.platform === 'darwin') {
    // kiosk 상태에서도 Cmd+Q 로 끌 수 있게 최소 메뉴만 둔다
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu', submenu: [{ role: 'quit' }] },
      { role: 'editMenu' },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

function setupIpc() {
  ipcMain.handle('state:get', () => payload());
  ipcMain.handle('game:start', () => { if (game.start(now())) lastResult = null; push(); });
  ipcMain.handle('game:stop', () => { game.stop(); push(); });
  ipcMain.handle('hall:saveNames', (_e, names) => {
    if (!names || typeof names !== 'object') return false;
    records = hall.renameEntries(records, names);
    saveHall();
    push();
    return !lastSaveError;
  });
  ipcMain.handle('hall:reset', () => {
    if (game.phase === 'measuring') return false;
    try {
      store.resetRecords();
      records = [];
      history = [];
      lastResult = null;
      lastSaveError = null;
      game.clear();
    } catch (err) {
      lastSaveError = '기록 삭제 실패: ' + err.message;
    }
    push();
    return !lastSaveError;
  });
  ipcMain.handle('serial:reconnect', () => { serial.reconnect(); push(); });
  ipcMain.handle('settings:save', (_e, next) => {
    settings = normalizeSettings({ ...settings, ...next, emg: { ...settings.emg, ...(next && next.emg) } });
    saveSettings();
    push();
    return settings;
  });
  ipcMain.handle('emg:zero', () => { rest.start(now()); zeroStartedAt = now(); push(); });
  ipcMain.handle('serial:setRole', (_e, p, role) => {
    if (typeof p !== 'string' || !['auto', 'spikerbox', 'start'].includes(role)) return false;
    const roles = { ...settings.portRoles };
    if (role === 'auto') delete roles[p]; else roles[p] = role;
    settings = normalizeSettings({ ...settings, portRoles: roles });
    saveSettings();
    serial.reopen(p);
    push();
    return true;
  });
  ipcMain.handle('sim:set', (_e, on) => {
    sim.setEnabled(on);
    if (!on) serial.dropVirtual(SIM_PORT);
    push();
  });
  ipcMain.handle('sim:key', (_e, key, down) => {
    if (!sim.enabled) return;
    if (key === 's') {
      if (down) { if (game.start(now())) lastResult = null; push(); }
    } else if (key === 'release') {
      sim.releaseAll();
    } else {
      sim.key(key, down);
    }
  });
  ipcMain.handle('window:toggleFullscreen', () => setFullscreen(!isFullscreen()));
  ipcMain.handle('app:quit', () => app.quit());
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  settings = store.loadSettings();
  records = hall.normalizeHall(store.loadHall());
  history = hall.normalizeHistory(store.loadHistory());

  game = new Game({
    getSettings: () => settings,
    onResult: ({ score }) => {
      // RESULT 확정 즉시 자동 저장. rank = 명예의 전당 순위, place/total = 전체 기록 중 순위
      const r = hall.applyResult(records, score, new Date());
      if (r.changed) {
        records = r.hall;
        saveHall();
      }
      const place = hall.placeOf(history, score);
      if (score > 0) {
        history = hall.pushHistory(history, score);
        saveHistory();
      }
      lastResult = { score, rank: r.rank, place, total: history.length };
    },
  });

  serial = new SerialManager({ getSettings: () => settings });
  serial.on('emg', (values) => emgWin.add(values));
  serial.on('start', () => { if (game.start(now())) lastResult = null; push(); });

  sim = new Simulator((buf) => serial.feedSpikerBox(SIM_PORT, buf));

  setupMenu();
  setupIpc();
  createWindow(FORCE_WINDOWED ? false : FORCE_FULLSCREEN ? true : settings.fullscreen);
  serial.start();
  if (START_SIM) sim.setEnabled(true);

  // 100 ms 마다: 그 사이 들어온 SpikerBox 샘플을 한 구간 세기로 만들어 게임에 넣는다
  setInterval(() => {
    const w = emgWin.take();
    const t = now();
    if (!w) {
      live = { rms: 0, strength: 0 }; // SpikerBox 끊김: 이 구간은 건너뛴다
      if (rest.running && t - zeroStartedAt > ZERO_TIMEOUT_MS) rest.stop();
      return;
    }
    live = { rms: w.rms, strength: strengthOf(w.rms, settings.emg.restRms) };
    if (rest.running && rest.add(w.rms, t)) {
      settings = normalizeSettings({ ...settings, emg: { ...settings.emg, restRms: rest.result() } });
      saveSettings();
    }
    game.sample('p1', live.strength, t);
  }, EMG_WINDOW_MS);

  // 시간 흐름(측정 제한 8초)과 연결 상태 갱신
  setInterval(() => { game.tick(now()); push(); }, 50);

  powerSaveBlocker.start('prevent-display-sleep');
  console.log('[main] 데이터 폴더:', store.dir);
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.on('window-all-closed', () => {
  if (serial) serial.stopAll();
  app.quit();
});

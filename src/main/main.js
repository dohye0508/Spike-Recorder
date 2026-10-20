'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker } = require('electron');
const { Game } = require('./game');
const hall = require('./hall');
const { Store, normalizeSettings } = require('./store');
const { SerialManager } = require('./serial');
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
let store, settings, records, game, serial, sim;
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

function payload() {
  const t = now();
  return {
    game: game.snapshot(t),
    hall: records,
    ports: serial.status(t),
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
  ipcMain.handle('game:start', () => { game.start(now()); push(); });
  ipcMain.handle('game:stop', () => { game.stop(); push(); });
  ipcMain.handle('hall:saveNames', (_e, names) => {
    if (!names || typeof names !== 'object') return false;
    records = hall.renameEntries(records, names);
    saveHall();
    push();
    return !lastSaveError;
  });
  ipcMain.handle('serial:reconnect', () => { serial.reconnect(); push(); });
  ipcMain.handle('settings:save', (_e, next) => {
    settings = normalizeSettings({ ...settings, ...next, calibration: { ...settings.calibration, ...(next && next.calibration) } });
    saveSettings();
    push();
    return settings;
  });
  ipcMain.handle('sim:set', (_e, on) => { sim.setEnabled(on); push(); });
  ipcMain.handle('sim:key', (_e, key, down) => {
    if (!sim.enabled) return;
    if (key === 's') {
      if (down) { game.start(now()); push(); }
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

  game = new Game({
    getSettings: () => settings,
    onResult: (result) => {
      // RESULT 확정 즉시 자동 저장 (패자·무승부도 각각 검사)
      const r = hall.applyResult(records, result, new Date());
      if (r.changed) {
        records = r.hall;
        saveHall();
      }
    },
  });

  serial = new SerialManager();
  serial.on('start', () => { game.start(now()); push(); });
  serial.on('sample', (player, value) => { game.sample(player, value, now()); push(); });

  sim = new Simulator((player, value) => {
    serial.markSeen(player, '시뮬레이션');
    game.sample(player, value, now());
    push();
  });

  setupMenu();
  setupIpc();
  createWindow(FORCE_WINDOWED ? false : FORCE_FULLSCREEN ? true : settings.fullscreen);
  serial.start();
  if (START_SIM) sim.setEnabled(true);

  // 시간 흐름(측정 제한 8초, 판정 카운트다운)과 연결 상태 갱신
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

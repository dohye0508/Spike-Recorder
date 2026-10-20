'use strict';

// userData 폴더의 JSON 저장. 임시 파일에 쓰고 fsync 후 rename 해서 저장 도중 꺼져도 원본이 깨지지 않는다.

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  calibration: { p1: 1.0, p2: 1.0 },
  fullscreen: true, // 앱을 켤 때 전체화면(kiosk)으로 시작할지
};

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Windows에서는 백신 등이 파일을 잠깐 잡고 있으면 rename이 EPERM/EBUSY로 실패할 수 있어 몇 번 재시도
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (i >= 9 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(50);
    }
  }
}

function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    // 손상된 파일은 지우지 않고 옆으로 치워 둔다
    const bad = file + '.corrupt-' + Date.now();
    try { fs.renameSync(file, bad); } catch (_) { /* ignore */ }
    console.error('[store] JSON 파싱 실패, 기본값 사용:', file, '→', bad);
    return fallback;
  }
}

function clampNum(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const cal = s.calibration && typeof s.calibration === 'object' ? s.calibration : {};
  return {
    calibration: {
      p1: clampNum(cal.p1, 0.001, 1000, DEFAULT_SETTINGS.calibration.p1),
      p2: clampNum(cal.p2, 0.001, 1000, DEFAULT_SETTINGS.calibration.p2),
    },
    fullscreen: typeof s.fullscreen === 'boolean' ? s.fullscreen : DEFAULT_SETTINGS.fullscreen,
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.settingsFile = path.join(dir, 'settings.json');
    this.hallFile = path.join(dir, 'hall-of-fame.json');
  }

  loadSettings() {
    const settings = normalizeSettings(readJson(this.settingsFile, DEFAULT_SETTINGS));
    // 처음 실행이면 파일을 만들어서 직접 고칠 수 있게 한다
    if (!fs.existsSync(this.settingsFile)) this.saveSettings(settings);
    return settings;
  }

  saveSettings(settings) {
    writeJsonAtomic(this.settingsFile, settings);
  }

  loadHall() {
    const data = readJson(this.hallFile, { records: [] });
    return Array.isArray(data) ? data : data.records;
  }

  saveHall(records) {
    writeJsonAtomic(this.hallFile, { records });
  }
}

module.exports = { Store, DEFAULT_SETTINGS, normalizeSettings, writeJsonAtomic, readJson };

'use strict';

// userData 폴더의 JSON 저장. 임시 파일에 쓰고 fsync 후 rename 해서 저장 도중 꺼져도 원본이 깨지지 않는다.

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  calibration: 1.0, // 보정계수 (원시 세기 × 계수 → 점수)
  emg: { channel: 1, restRms: 0 }, // SpikerBox 채널(1|2), 휴식 RMS(영점)
  portRoles: {}, // { [path]: 'spikerbox' | 'start' }, 없는 path는 자동 판별
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
  // v1 설정은 {p1, p2} 객체였다 → p1 값을 가져온다
  const cal = s.calibration && typeof s.calibration === 'object' ? s.calibration.p1 : s.calibration;
  const emg = s.emg && typeof s.emg === 'object' ? s.emg : {};
  const portRoles = {};
  if (s.portRoles && typeof s.portRoles === 'object') {
    Object.keys(s.portRoles).forEach((k) => {
      if (s.portRoles[k] === 'spikerbox' || s.portRoles[k] === 'start') portRoles[k] = s.portRoles[k];
    });
  }
  return {
    calibration: clampNum(cal, 0.001, 1000, DEFAULT_SETTINGS.calibration),
    emg: {
      channel: Number(emg.channel) === 2 ? 2 : 1,
      restRms: clampNum(emg.restRms, 0, 100000, 0),
    },
    portRoles,
    fullscreen: typeof s.fullscreen === 'boolean' ? s.fullscreen : DEFAULT_SETTINGS.fullscreen,
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.settingsFile = path.join(dir, 'settings.json');
    this.recordsFile = path.join(dir, 'records.json');
    // v2.0.x 파일: records.json 이 없을 때 한 번만 읽어서 옮긴다
    this.hallFile = path.join(dir, 'hall-of-fame.json');
    this.historyFile = path.join(dir, 'score-history.json');
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

  /** 모든 기록 [{id, name, score, at}]. records.json 이 아직 없으면 null (→ 옛 파일에서 옮겨야 함) */
  loadRecords() {
    if (!fs.existsSync(this.recordsFile)) return null;
    const data = readJson(this.recordsFile, { records: [] });
    return Array.isArray(data) ? data : data.records;
  }

  saveRecords(records) {
    writeJsonAtomic(this.recordsFile, { records });
  }

  /** v2.0.x 의 명예의 전당 파일 */
  loadLegacyHall() {
    const data = readJson(this.hallFile, { records: [] });
    return Array.isArray(data) ? data : data.records;
  }

  /** v2.0.x 의 전체 점수 파일 */
  loadLegacyHistory() {
    const data = readJson(this.historyFile, { scores: [] });
    return Array.isArray(data) ? data : data.scores;
  }

  /** 기록 전체 삭제: 지우기 전 파일은 *.bak-<시각> 으로 남겨 두고 빈 목록으로 저장 */
  resetRecords(stamp = Date.now()) {
    if (fs.existsSync(this.recordsFile)) fs.copyFileSync(this.recordsFile, this.recordsFile + '.bak-' + stamp);
    this.saveRecords([]);
  }
}

module.exports = { Store, DEFAULT_SETTINGS, normalizeSettings, writeJsonAtomic, readJson };

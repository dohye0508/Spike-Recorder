'use strict';

// node test/game.test.js — 아두이노·Electron 없이 경기 로직, 명예의 전당, 저장, 줄 파싱을 검사한다.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game, toScore } = require('../src/main/game');
const hall = require('../src/main/hall');
const { Store, normalizeSettings } = require('../src/main/store');

// serial.js 는 serialport 를 불러오므로 parseLine 만 따로 검사
const { parseLine, classifyProbe } = require('../src/main/serial');
const { Simulator } = require('../src/main/sim');

const { SpikerBoxParser, parseMessageText, encodeFrames, encodeMessage } = require('../src/main/spikerbox');
const { EmgWindow, strengthOf, RestMeter } = require('../src/main/emg');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('FAIL  ' + name);
    throw err;
  }
}

function makeGame(settings) {
  const results = [];
  const s = settings || { calibration: 1 };
  const g = new Game({ getSettings: () => s, onResult: (r) => results.push(r) });
  return { g, results, s };
}

/** 0.1초 간격으로 값을 넣는다 */
function feed(g, t0, n, f) {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += 100;
    g.sample('p1', f(i), t);
  }
  return t;
}

console.log('경기 흐름');

test('IDLE → MEASURING → 50개 차면 바로 RESULT, 현재 값과 최댓값 따로', () => {
  const { g, results } = makeGame();
  assert.strictEqual(g.phase, 'idle');
  assert.ok(g.start(0));
  assert.strictEqual(g.phase, 'measuring');
  let t = feed(g, 0, 49, (i) => (i === 10 ? 4270 : 100));
  assert.strictEqual(g.phase, 'measuring');
  const snap = g.snapshot();
  assert.strictEqual(snap.p1.samples, 49);
  assert.strictEqual(snap.p1.score, 4270); // 최댓값
  assert.strictEqual(snap.p1.current, 100); // 방금 들어온 값
  assert.strictEqual(snap.p2, undefined);
  assert.strictEqual(snap.winner, undefined);
  feed(g, t, 1, () => 1);
  assert.strictEqual(g.phase, 'result'); // 판정 대기 없이 바로
  assert.deepStrictEqual(results, [{ score: 4270 }]);
});

test('50개 넘게 들어온 값은 무시, p1 이 아닌 입력도 무시', () => {
  const { g } = makeGame();
  g.start(0);
  g.sample('p2', 5000, 50);
  assert.strictEqual(g.p1.samples, 0);
  feed(g, 0, 50, () => 100);
  g.sample('p1', 9000, 5100);
  assert.strictEqual(g.p1.score, 100);
  assert.strictEqual(g.p1.samples, 50);
  assert.strictEqual(g.phase, 'result');
});

test('MEASURING 중 START 무시, RESULT 에서 START 하면 0으로 비우고 재측정', () => {
  const { g } = makeGame();
  g.start(0);
  feed(g, 0, 10, () => 500);
  assert.strictEqual(g.start(1500), false);
  assert.strictEqual(g.p1.samples, 10);
  const t = feed(g, 1000, 40, () => 500);
  assert.strictEqual(g.phase, 'result');
  assert.ok(g.start(t + 100));
  assert.strictEqual(g.phase, 'measuring');
  assert.strictEqual(g.p1.score, 0);
  assert.strictEqual(g.p1.current, 0);
  assert.strictEqual(g.p1.samples, 0);
});

test('8초 안전장치: 신호가 끊겨도 받은 것까지로 확정', () => {
  const { g, results } = makeGame();
  g.start(0);
  feed(g, 0, 12, () => 200);
  g.tick(7999);
  assert.strictEqual(g.phase, 'measuring');
  g.tick(8000);
  assert.strictEqual(g.phase, 'result');
  assert.deepStrictEqual(results, [{ score: 200 }]);
});

test('경기 중지: 기록 없이 IDLE, IDLE/RESULT 에서는 아무 일 없음', () => {
  const { g, results } = makeGame();
  assert.strictEqual(g.stop(), false);
  g.start(0);
  const t = feed(g, 0, 30, () => 300);
  assert.ok(g.stop());
  assert.strictEqual(g.phase, 'idle');
  g.tick(t + 10000);
  assert.strictEqual(results.length, 0);
  assert.strictEqual(g.p1.score, 0);
  g.start(t + 20000);
  feed(g, t + 20000, 50, () => 300);
  assert.strictEqual(g.phase, 'result');
  assert.strictEqual(g.stop(), false);
});

test('보정계수는 숫자 하나, 0~9999 로 자름', () => {
  const { g } = makeGame({ calibration: 0.5 });
  g.start(0);
  feed(g, 0, 50, () => 1001);
  assert.strictEqual(g.p1.score, 501); // round(500.5)
  assert.strictEqual(toScore(-5, 1), 0);
  assert.strictEqual(toScore(6000, 2), 9999);
});

console.log('명예의 전당');

const D = new Date('2026-10-19T12:00:00Z');

test('기록 5개 미만이면 들어가고 순위를 돌려준다', () => {
  let r = hall.applyResult([], 3815, D);
  assert.ok(r.changed);
  assert.strictEqual(r.rank, 1);
  r = hall.applyResult(r.hall, 4270, D);
  assert.strictEqual(r.rank, 1);
  assert.deepStrictEqual(r.hall.map((e) => [e.score, e.name]), [[4270, 'ㅇㅇㅇ'], [3815, 'ㅇㅇㅇ']]);
  assert.strictEqual(r.hall[0].at, D.toISOString());
  assert.ok(!('player' in r.hall[0]));
});

test('5위보다 높아야 들어감(rank null), 0점은 안 들어감', () => {
  let h = [];
  for (const s of [9000, 8000, 7000, 6000, 5000]) h = hall.insert(h, { id: String(s), score: s, name: 'x', at: '' });
  let r = hall.applyResult(h, 5000, D);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.rank, null);
  r = hall.applyResult(h, 9500, D);
  assert.strictEqual(r.rank, 1);
  assert.deepStrictEqual(r.hall.map((e) => e.score), [9500, 9000, 8000, 7000, 6000]);
  r = hall.applyResult([], 0, D);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.rank, null);
});

test('같은 점수면 먼저 세운 기록이 위', () => {
  const h = [{ id: 'old', score: 6000, name: '선배', at: '2026-01-01T00:00:00Z' }];
  const r = hall.applyResult(h, 6000, D);
  assert.strictEqual(r.rank, 2);
  assert.deepStrictEqual(r.hall.map((e) => e.name), ['선배', 'ㅇㅇㅇ']);
});

test('전체 기록 중 순위(5위 밖도): 동점이면 먼저 세운 쪽이 위', () => {
  assert.strictEqual(hall.placeOf([], 100), 1);
  assert.strictEqual(hall.placeOf([900, 500, 100, 50], 300), 3);
  assert.strictEqual(hall.placeOf([900, 500, 300], 300), 4);
  assert.strictEqual(hall.placeOf([900, 500], 0), null);
  assert.deepStrictEqual(hall.pushHistory([1, 2], 3), [1, 2, 3]);
  assert.deepStrictEqual(hall.normalizeHistory([5, 'x', -1, 20000, '7']), [5, 9999, 7]);
  assert.deepStrictEqual(hall.normalizeHistory('bad'), []);
});

test('이름 수정, 빈 이름은 ㅇㅇㅇ', () => {
  let r = hall.applyResult([], 100, D);
  r = hall.applyResult(r.hall, 50, D);
  const ids = r.hall.map((e) => e.id);
  const h = hall.renameEntries(r.hall, { [ids[0]]: '  김 철수  ', [ids[1]]: '   ' });
  assert.deepStrictEqual(h.map((e) => e.name), ['김 철수', 'ㅇㅇㅇ']);
});

console.log('저장');

const DEFAULTS = { calibration: 1, emg: { channel: 1, restRms: 0 }, portRoles: {}, fullscreen: true };

test('저장 후 다시 읽어도 유지 (앱 재시작 흉내), 손상 파일은 기본값', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'punch-'));
  const store = new Store(dir);
  assert.deepStrictEqual(store.loadSettings(), DEFAULTS);
  assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
  const custom = normalizeSettings({ calibration: 1.25, emg: { channel: 2, restRms: 12.5 }, portRoles: { '/dev/a': 'start' }, fullscreen: false });
  store.saveSettings(custom);
  let r = hall.applyResult([], 3815, D);
  r = hall.applyResult(r.hall, 4270, D);
  store.saveHall(hall.renameEntries(r.hall, { [r.hall[0].id]: '홍길동' }));
  store.saveHistory([3815, 4270]);

  const again = new Store(dir);
  assert.deepStrictEqual(again.loadSettings(), custom);
  assert.strictEqual(custom.emg.channel, 2);
  const loaded = hall.normalizeHall(again.loadHall());
  assert.deepStrictEqual(loaded.map((e) => e.name + ' ' + e.score), ['홍길동 4270', 'ㅇㅇㅇ 3815']);
  assert.deepStrictEqual(again.loadHistory(), [3815, 4270]);
  assert.ok(!fs.existsSync(path.join(dir, 'hall-of-fame.json.tmp')));

  fs.writeFileSync(path.join(dir, 'hall-of-fame.json'), '{ broken');
  assert.deepStrictEqual(hall.normalizeHall(again.loadHall()), []);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('hall-of-fame.json.corrupt-')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('설정값 범위 정리, v1 설정(calibration {p1,p2}) 이전', () => {
  assert.deepStrictEqual(normalizeSettings({ calibration: 'abc', fullscreen: 'yes' }), DEFAULTS);
  assert.deepStrictEqual(normalizeSettings({ calibration: { p1: 2, p2: 3 } }), { ...DEFAULTS, calibration: 2 });
  const s = normalizeSettings({ calibration: -1, emg: { channel: 9, restRms: -4 }, portRoles: { a: 'start', b: 'x', c: 'spikerbox' } });
  assert.strictEqual(s.calibration, 0.001);
  assert.deepStrictEqual(s.emg, { channel: 1, restRms: 0 });
  assert.deepStrictEqual(s.portRoles, { a: 'start', c: 'spikerbox' });
});

test('v1 명예의 전당 파일(player 있음)을 읽으면 player 는 버린다', () => {
  const h = hall.normalizeHall([{ id: 'a', name: '옛날', score: 123, player: 'PLAYER 2', at: '2026-01-01T00:00:00Z' }]);
  assert.strictEqual(h.length, 1);
  assert.ok(!('player' in h[0]));
  assert.strictEqual(h[0].score, 123);
});

console.log('시리얼 줄 형식');

test('START/ALIVE 파싱, 나머지는 무시', () => {
  assert.deepStrictEqual(parseLine('START'), { type: 'start' });
  assert.deepStrictEqual(parseLine(' start\r'), { type: 'start' });
  assert.deepStrictEqual(parseLine('ALIVE'), { type: 'alive' });
  for (const bad of ['P1 100', '', 'STARTX', 'hello']) assert.strictEqual(parseLine(bad), null, bad);
});

test('classifyProbe: HWT 가 있거나 프레임 20개 이상이면 SpikerBox', () => {
  assert.strictEqual(classifyProbe({ messages: [{ type: 'HWT', value: 'MUSCLESS' }], frameCount: 0 }), true);
  assert.strictEqual(classifyProbe({ messages: [], frameCount: 25 }), true);
  assert.strictEqual(classifyProbe({ messages: [{ type: 'EVNT', value: '1' }], frameCount: 5 }), false);
});

console.log('SpikerBox 파서 · 근전도 신호');

const F1 = [[0], [8191], [16383], [512]];
const F2 = [[1, 2], [8192, 100], [16383, 0]];
const flat = (frames) => [].concat.apply([], frames);

test('1채널·2채널 프레임 왕복', () => {
  assert.deepStrictEqual(new SpikerBoxParser({ channels: 1 }).push(encodeFrames(F1)).frames, F1);
  assert.deepStrictEqual(new SpikerBoxParser({ channels: 2 }).push(encodeFrames(F2)).frames, F2);
});

test('1바이트씩 나눠 넣어도 결과가 같다', () => {
  const buf = Buffer.concat([encodeFrames(F1), encodeMessage('HWT:MUSCLESS;'), encodeFrames(F1)]);
  const whole = new SpikerBoxParser({ channels: 1 }).push(buf);
  const p = new SpikerBoxParser({ channels: 1 });
  const frames = [];
  const messages = [];
  for (const byte of buf) {
    const r = p.push([byte]);
    frames.push.apply(frames, r.frames);
    messages.push.apply(messages, r.messages);
  }
  assert.deepStrictEqual(frames, whole.frames);
  assert.deepStrictEqual(messages, whole.messages);
  assert.strictEqual(frames.length, 8);
});

test('프레임 중간의 0x80 바이트는 그 프레임만 버린다', () => {
  const a = encodeFrames([[100, 200], [300, 400]]);
  const bad = Buffer.from([0x81]); // 2채널 프레임 중간에 새 시작 바이트
  const buf = Buffer.concat([a.slice(0, 2), bad, a.slice(4)]);
  // a[0..1] ch1 of frame1, 끼워 넣은 0x81 로 프레임 재시작 → 이후 a[4..] 는 새 프레임으로 정상 해석되지 않고 버려짐
  const r = new SpikerBoxParser({ channels: 2 }).push(Buffer.concat([buf, encodeFrames([[7, 8]])]));
  assert.deepStrictEqual(r.frames[r.frames.length - 1], [7, 8]);
  assert.ok(r.frames.length < 3);
});

test('기기 메시지는 frames 에 섞이지 않고, 청크를 중간에서 잘라도 같다', () => {
  const buf = Buffer.concat([encodeFrames(F1), encodeMessage('HWT:MUSCLESS;'), encodeFrames(F1)]);
  for (let cut = 1; cut < buf.length; cut++) {
    const p = new SpikerBoxParser({ channels: 1 });
    const a = p.push(buf.slice(0, cut));
    const b = p.push(buf.slice(cut));
    assert.deepStrictEqual(a.frames.concat(b.frames), F1.concat(F1), 'cut ' + cut);
    assert.deepStrictEqual(a.messages.concat(b.messages), [{ type: 'HWT', value: 'MUSCLESS' }], 'cut ' + cut);
  }
});

test('너무 긴 이스케이프는 버리고 끝낸다', () => {
  const junk = Buffer.concat([Buffer.from([0xFF, 0xFF, 0x01, 0x01, 0x80, 0xFF]), Buffer.alloc(100, 0x41)]);
  const r = new SpikerBoxParser({ channels: 1 }).push(Buffer.concat([junk, encodeFrames([[5]])]));
  assert.deepStrictEqual(r.messages, []);
  assert.deepStrictEqual(r.frames[r.frames.length - 1], [5]);
});

test("channels:'auto' 는 2채널을 알아낸다", () => {
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push([100 + i, 200 + i]);
  const p = new SpikerBoxParser();
  assert.strictEqual(p.channels, null);
  const r = p.push(encodeFrames(frames));
  assert.strictEqual(p.channels, 2);
  assert.ok(r.frames.length > 0);
  assert.deepStrictEqual(r.frames[r.frames.length - 1], frames[39]);
  r.frames.forEach((f) => assert.strictEqual(f[1] - f[0], 100));
});

test('parseMessageText', () => {
  assert.deepStrictEqual(parseMessageText('HWT:MUSCLESS;EVNT:3;'), [{ type: 'HWT', value: 'MUSCLESS' }, { type: 'EVNT', value: '3' }]);
  assert.deepStrictEqual(parseMessageText(''), []);
  assert.deepStrictEqual(parseMessageText('abc;;:x;HWT:A'), [{ type: 'HWT', value: 'A' }]);
});

test('EmgWindow RMS', () => {
  const w = new EmgWindow();
  assert.strictEqual(w.take(), null);
  w.add(new Array(100).fill(512));
  assert.strictEqual(w.take().rms, 0);
  const A = 200;
  const vals = [];
  for (let i = 0; i < 1000; i++) vals.push(512 + A * Math.sin((2 * Math.PI * i) / 100)); // 10주기
  w.add(vals);
  const t = w.take();
  assert.ok(Math.abs(t.rms - A / Math.SQRT2) / (A / Math.SQRT2) < 0.01);
  assert.strictEqual(t.count, 1000);
  assert.strictEqual(w.take(), null);
});

test('strengthOf', () => {
  assert.strictEqual(strengthOf(100, 30), 70);
  assert.strictEqual(strengthOf(10, 30), 0);
});

test('RestMeter 는 3초 평균', () => {
  const m = new RestMeter(3000);
  m.start(0);
  assert.strictEqual(m.running, true);
  assert.strictEqual(m.add(10, 100), false);
  assert.strictEqual(m.add(20, 1500), false);
  assert.strictEqual(m.add(30, 3000), true);
  assert.strictEqual(m.running, false);
  assert.strictEqual(m.result(), 20);
});

test('가짜 SpikerBox: A 를 누른 구간의 RMS 가 뗀 구간보다 10배 이상', () => {
  const chunks = [];
  const sim = new Simulator((buf) => chunks.push(buf));
  sim.setEnabled(true); // HWT 메시지 한 번
  sim.setEnabled(false);
  const parser = new SpikerBoxParser({ channels: 1 });
  const win = new EmgWindow();
  const measure = (ticks) => {
    let rms = 0;
    for (let i = 0; i < ticks; i++) {
      sim.tick();
      const r = parser.push(chunks.splice(0).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0)));
      win.add(r.frames.map((f) => f[0]));
      if ((i + 1) % 10 === 0) rms = win.take().rms; // 10틱 = 100 ms
    }
    return rms;
  };
  assert.ok(chunks.length === 1 && chunks[0].includes(Buffer.from('HWT:MUSCLESS;')));
  chunks.length = 0;
  const rest = measure(100);
  sim.key('a', true);
  const held = measure(200);
  assert.ok(rest > 1, 'rest ' + rest);
  assert.ok(held > rest * 10, held + ' vs ' + rest);
});

test('기록 전체 삭제: 빈 목록으로 저장하고 지우기 전 파일은 백업', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'punch-'));
  const store = new Store(dir);
  store.saveHall([{ id: 'a', name: '홍길동', score: 7812, at: new Date().toISOString() }]);
  store.saveHistory([7812, 300]);
  store.resetRecords(123);
  const again = new Store(dir);
  assert.deepStrictEqual(again.loadHall(), []);
  assert.deepStrictEqual(again.loadHistory(), []);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'hall-of-fame.json.bak-123'), 'utf8')).records[0].score, 7812);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'score-history.json.bak-123'), 'utf8')).scores, [7812, 300]);
  // 파일이 없을 때도 실패하지 않는다
  const { g } = makeGame({ calibration: 1 });
  g.start(0);
  assert.strictEqual(g.clear(), false); // 측정 중에는 비우지 않는다
  g.tick(9000);
  assert.strictEqual(g.clear(), true);
  assert.strictEqual(g.snapshot().phase, 'idle');
  const empty = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'punch-')));
  empty.resetRecords(1);
  assert.deepStrictEqual(empty.loadHall(), []);
});

console.log(`\n${passed}개 통과`);

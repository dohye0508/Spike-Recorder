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
const { parseLine } = require('../src/main/serial');

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
  const s = settings || { calibration: { p1: 1, p2: 1 } };
  const g = new Game({ getSettings: () => s, onResult: (r) => results.push(r) });
  return { g, results, s };
}

/** 0.1초 간격으로 양쪽에 값을 넣는다 */
function feed(g, t0, n, f1, f2) {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += 100;
    if (f1) g.sample('p1', f1(i), t);
    if (f2) g.sample('p2', f2(i), t);
  }
  return t;
}

console.log('경기 흐름');

test('IDLE → MEASURING → 50개 차면 바로 RESULT (P1 승), 현재 값과 최댓값 따로', () => {
  const { g, results } = makeGame();
  assert.strictEqual(g.phase, 'idle');
  assert.ok(g.start(0));
  assert.strictEqual(g.phase, 'measuring');
  let t = feed(g, 0, 49, (i) => (i === 10 ? 4270 : 100), (i) => (i === 20 ? 3815 : 100));
  assert.strictEqual(g.phase, 'measuring');
  const snap = g.snapshot();
  assert.strictEqual(snap.p1.samples, 49);
  assert.strictEqual(snap.p1.score, 4270); // 최댓값
  assert.strictEqual(snap.p1.current, 100); // 방금 들어온 값
  t = feed(g, t, 1, () => 1, () => 1);
  assert.strictEqual(g.phase, 'result'); // 판정 대기 없이 바로
  assert.strictEqual(g.winner, 'p1');
  assert.deepStrictEqual(results, [{ winner: 'p1', p1: 4270, p2: 3815 }]);
});

test('50개 넘게 들어온 값은 무시', () => {
  const { g } = makeGame();
  g.start(0);
  feed(g, 0, 50, () => 100, null);
  g.sample('p1', 9000, 5100);
  assert.strictEqual(g.p1.score, 100);
  assert.strictEqual(g.p1.samples, 50);
  assert.strictEqual(g.phase, 'measuring'); // P2 가 아직
});

test('P2 승, DRAW', () => {
  let { g } = makeGame();
  g.start(0);
  feed(g, 0, 50, () => 10, () => 20);
  assert.strictEqual(g.winner, 'p2');
  ({ g } = makeGame());
  g.start(0);
  feed(g, 0, 50, () => 777, () => 777);
  assert.strictEqual(g.winner, 'draw');
});

test('MEASURING 중 START 무시, RESULT 에서 START 하면 0으로 비우고 재측정', () => {
  const { g } = makeGame();
  g.start(0);
  feed(g, 0, 10, () => 500, () => 500);
  assert.strictEqual(g.start(1500), false);
  assert.strictEqual(g.p1.samples, 10);
  const t = feed(g, 1000, 40, () => 500, () => 400);
  assert.strictEqual(g.phase, 'result');
  assert.ok(g.start(t + 100));
  assert.strictEqual(g.phase, 'measuring');
  assert.strictEqual(g.p1.score, 0);
  assert.strictEqual(g.p1.current, 0);
  assert.strictEqual(g.p2.samples, 0);
});

test('8초 안전장치: 한쪽 케이블이 빠져도 받은 것까지로 확정', () => {
  const { g, results } = makeGame();
  g.start(0);
  feed(g, 0, 50, () => 300, null);
  feed(g, 0, 12, null, () => 200);
  g.tick(7999);
  assert.strictEqual(g.phase, 'measuring');
  g.tick(8000);
  assert.strictEqual(g.phase, 'result');
  assert.deepStrictEqual(results, [{ winner: 'p1', p1: 300, p2: 200 }]);
});

test('경기 중지: 기록 없이 IDLE, IDLE/RESULT 에서는 아무 일 없음', () => {
  const { g, results } = makeGame();
  assert.strictEqual(g.stop(), false);
  g.start(0);
  const t = feed(g, 0, 30, () => 300, () => 100);
  assert.ok(g.stop());
  assert.strictEqual(g.phase, 'idle');
  g.tick(t + 10000);
  assert.strictEqual(results.length, 0);
  assert.strictEqual(g.p1.score, 0);
  g.start(t + 20000);
  feed(g, t + 20000, 50, () => 300, () => 100);
  assert.strictEqual(g.phase, 'result');
  assert.strictEqual(g.stop(), false);
});

test('보정계수 P1/P2 따로, 0~9999 로 자름', () => {
  const { g } = makeGame({ calibration: { p1: 0.5, p2: 2 } });
  g.start(0);
  feed(g, 0, 50, () => 1001, () => 6000);
  assert.strictEqual(g.p1.score, 501); // round(500.5)
  assert.strictEqual(g.p2.score, 9999);
  assert.strictEqual(toScore(-5, 1), 0);
});

console.log('명예의 전당');

const D = new Date('2026-10-19T12:00:00Z');

test('기록 5개 미만이면 들어가고, 패자도 들어감', () => {
  const r = hall.applyResult([], { winner: 'p1', p1: 4270, p2: 3815 }, D);
  assert.ok(r.changed);
  assert.deepStrictEqual(r.hall.map((e) => [e.score, e.player, e.name]), [
    [4270, 'PLAYER 1', 'ㅇㅇㅇ'],
    [3815, 'PLAYER 2', 'ㅇㅇㅇ'],
  ]);
  assert.strictEqual(r.hall[0].at, D.toISOString());
});

test('5위보다 높아야 들어감, 같으면 안 들어감, 0점은 안 들어감', () => {
  let h = [];
  for (const s of [9000, 8000, 7000, 6000, 5000]) h = hall.insert(h, { id: String(s), score: s, name: 'x', player: 'PLAYER 1', at: '' });
  let r = hall.applyResult(h, { winner: 'p1', p1: 5000, p2: 4000 }, D);
  assert.strictEqual(r.changed, false);
  r = hall.applyResult(h, { winner: 'p2', p1: 5001, p2: 9500 }, D);
  assert.deepStrictEqual(r.hall.map((e) => e.score), [9500, 9000, 8000, 7000, 6000]); // 5001 은 9500 에 밀려남
  r = hall.applyResult([], { winner: 'draw', p1: 0, p2: 0 }, D);
  assert.strictEqual(r.changed, false);
});

test('DRAW 는 두 기록 모두, 같은 점수면 먼저 세운 기록이 위', () => {
  let h = [{ id: 'old', score: 6000, name: '선배', player: 'PLAYER 1', at: '2026-01-01T00:00:00Z' }];
  const r = hall.applyResult(h, { winner: 'draw', p1: 6000, p2: 6000 }, D);
  assert.deepStrictEqual(r.hall.map((e) => e.name + '/' + e.player), ['선배/PLAYER 1', 'ㅇㅇㅇ/PLAYER 1', 'ㅇㅇㅇ/PLAYER 2']);
});

test('이름 수정, 빈 이름은 ㅇㅇㅇ', () => {
  const r = hall.applyResult([], { winner: 'p1', p1: 100, p2: 50 }, D);
  const ids = r.hall.map((e) => e.id);
  const h = hall.renameEntries(r.hall, { [ids[0]]: '  김 철수  ', [ids[1]]: '   ' });
  assert.deepStrictEqual(h.map((e) => e.name), ['김 철수', 'ㅇㅇㅇ']);
});

console.log('저장');

test('저장 후 다시 읽어도 유지 (앱 재시작 흉내), 손상 파일은 기본값', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'punch-'));
  const store = new Store(dir);
  assert.deepStrictEqual(store.loadSettings(), { calibration: { p1: 1, p2: 1 }, fullscreen: true });
  assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
  store.saveSettings(normalizeSettings({ calibration: { p1: 1.25, p2: 0.8 }, fullscreen: false }));
  const r = hall.applyResult([], { winner: 'p1', p1: 4270, p2: 3815 }, D);
  store.saveHall(hall.renameEntries(r.hall, { [r.hall[0].id]: '홍길동' }));

  const again = new Store(dir);
  assert.deepStrictEqual(again.loadSettings(), { calibration: { p1: 1.25, p2: 0.8 }, fullscreen: false });
  const loaded = hall.normalizeHall(again.loadHall());
  assert.deepStrictEqual(loaded.map((e) => e.name + ' ' + e.score), ['홍길동 4270', 'ㅇㅇㅇ 3815']);
  assert.ok(!fs.existsSync(path.join(dir, 'hall-of-fame.json.tmp')));

  fs.writeFileSync(path.join(dir, 'hall-of-fame.json'), '{ broken');
  assert.deepStrictEqual(hall.normalizeHall(again.loadHall()), []);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('hall-of-fame.json.corrupt-')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('설정값 범위 정리', () => {
  assert.deepStrictEqual(normalizeSettings({ calibration: { p1: 'abc', p2: -1 }, fullscreen: 'yes' }), { calibration: { p1: 1, p2: 0.001 }, fullscreen: true });
});

console.log('시리얼 줄 형식');

test('P1/P2/START 파싱, 형식에 안 맞는 줄은 무시', () => {
  assert.deepStrictEqual(parseLine('P1 523\r'), { type: 'sample', player: 'p1', value: 523 });
  assert.deepStrictEqual(parseLine('  p2   80 '), { type: 'sample', player: 'p2', value: 80 });
  assert.deepStrictEqual(parseLine('START\r'), { type: 'start' });
  for (const bad of ['', 'P1', 'P3 10', 'P1 1.5', 'P1 abc', 'STARTX', 'hello P1 5', 'P1 5 6']) {
    assert.strictEqual(parseLine(bad), null, bad);
  }
});

console.log(`\n${passed}개 통과`);

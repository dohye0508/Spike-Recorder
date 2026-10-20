'use strict';

// 경기 상태 기계. 시간은 항상 인자로 받아서(now, ms) 테스트에서 시계를 마음대로 돌릴 수 있게 한다.
//   IDLE --start--> MEASURING --양쪽 50개(0.1초 × 50 = 5초) 또는 8초--> RESULT
//   RESULT --start--> MEASURING
// 측정이 끝나면 판정 대기 없이 바로 결과. 최종 점수는 각자 50개 값 중 최댓값.

const PHASE = { IDLE: 'idle', MEASURING: 'measuring', RESULT: 'result' };
const SAMPLES_NEEDED = 50;
const MEASURE_TIMEOUT_MS = 8000;
const MAX_SCORE = 9999;

function toScore(raw, factor) {
  const v = Math.round(Number(raw) * Number(factor));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(MAX_SCORE, v));
}

function emptyPlayer() {
  // current: 방금 들어온 값(현재 힘), score: 지금까지의 최댓값(= 최종 점수)
  return { score: 0, current: 0, samples: 0 };
}

class Game {
  /**
   * @param {object} opts
   * @param {() => {calibration: {p1: number, p2: number}}} opts.getSettings
   * @param {(result: {winner: string, p1: number, p2: number}) => void} [opts.onResult]
   */
  constructor({ getSettings, onResult }) {
    this.getSettings = getSettings;
    this.onResult = onResult || (() => {});
    this.phase = PHASE.IDLE;
    this.winner = null;
    this.p1 = emptyPlayer();
    this.p2 = emptyPlayer();
    this.measureStartedAt = 0;
  }

  /** START 버튼(물리 / 관리자 / 시뮬레이션). MEASURING 중에는 무시. */
  start(now) {
    if (this.phase === PHASE.MEASURING) return false;
    this.phase = PHASE.MEASURING;
    this.winner = null;
    this.p1 = emptyPlayer();
    this.p2 = emptyPlayer();
    this.measureStartedAt = now;
    return true;
  }

  /** 경기 중지 · 기록하지 않음. MEASURING 중일 때만 동작. */
  stop() {
    if (this.phase !== PHASE.MEASURING) return false;
    this.phase = PHASE.IDLE;
    this.winner = null;
    this.p1 = emptyPlayer();
    this.p2 = emptyPlayer();
    return true;
  }

  /** 아두이노에서 들어온 0.1초 피크값 하나. which = 'p1' | 'p2' */
  sample(which, raw, now) {
    if (this.phase !== PHASE.MEASURING) return;
    const p = this[which];
    if (!p || p.samples >= SAMPLES_NEEDED) return;
    const factor = this.getSettings().calibration[which] ?? 1;
    const v = toScore(raw, factor);
    p.samples += 1;
    p.current = v;
    p.score = Math.max(p.score, v);
    this.tick(now);
  }

  tick(now) {
    if (this.phase !== PHASE.MEASURING) return;
    const full = this.p1.samples >= SAMPLES_NEEDED && this.p2.samples >= SAMPLES_NEEDED;
    const timedOut = now - this.measureStartedAt >= MEASURE_TIMEOUT_MS;
    if (!full && !timedOut) return;
    this.phase = PHASE.RESULT;
    const a = this.p1.score, b = this.p2.score;
    this.winner = a > b ? 'p1' : b > a ? 'p2' : 'draw';
    this.onResult({ winner: this.winner, p1: a, p2: b });
  }

  snapshot() {
    return {
      phase: this.phase,
      winner: this.winner,
      samplesNeeded: SAMPLES_NEEDED,
      p1: { ...this.p1 },
      p2: { ...this.p2 },
    };
  }
}

module.exports = { Game, PHASE, SAMPLES_NEEDED, MEASURE_TIMEOUT_MS, MAX_SCORE, toScore };

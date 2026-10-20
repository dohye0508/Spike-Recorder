'use strict';

// SpikerBox 샘플 → 100 ms 구간 AC RMS (PLAN.md 2장). 구간 평균을 빼므로 중심값·드리프트를 몰라도 된다.

class EmgWindow {
  constructor() {
    this._n = 0;
    this._sum = 0;
    this._sumSq = 0;
  }

  add(values) {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      this._n++;
      this._sum += v;
      this._sumSq += v * v;
    }
  }

  /** 모은 샘플로 { rms, count } 를 돌려주고 비운다. 샘플이 없으면 null */
  take() {
    if (!this._n) return null;
    const n = this._n;
    const mean = this._sum / n;
    const variance = this._sumSq / n - mean * mean;
    this._n = 0;
    this._sum = 0;
    this._sumSq = 0;
    return { rms: variance > 0 ? Math.sqrt(variance) : 0, count: n };
  }
}

function strengthOf(rms, restRms) {
  return Math.max(0, rms - (restRms || 0));
}

/** 영점 잡기: 일정 시간 동안 구간 RMS 평균 */
class RestMeter {
  constructor(durationMs = 3000) {
    this._duration = durationMs;
    this._startedAt = 0;
    this._sum = 0;
    this._n = 0;
    this._running = false;
  }

  start(now) {
    this._startedAt = now;
    this._sum = 0;
    this._n = 0;
    this._running = true;
  }

  /** 구간 RMS 를 넣는다. 시간이 다 차면 true */
  add(rms, now) {
    if (!this._running) return false;
    this._sum += rms;
    this._n++;
    if (now - this._startedAt >= this._duration) {
      this._running = false;
      return true;
    }
    return false;
  }

  stop() {
    this._running = false;
  }

  get running() {
    return this._running;
  }

  result() {
    return this._n ? this._sum / this._n : 0;
  }
}

module.exports = { EmgWindow, strengthOf, RestMeter };

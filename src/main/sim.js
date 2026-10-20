'use strict';

// 하드웨어 없이 테스트하는 가짜 SpikerBox. 실제 장치처럼 바이트 스트림(HWT 메시지 + 10 kHz 프레임)을 만들어
// 실제 파서와 RMS 경로를 그대로 거친다. A 키를 누르는 동안 진폭이 서서히 올라가고, 떼면 내려간다.
// 시연용으로 14비트 범위(중심 8192)를 써서 보정계수 1에서도 점수가 수천 점대가 되어 게이지가 켜진다.
// 누를 때마다 목표 세기를 무작위로 골라 기록이 매번 다르게 나온다.

const { encodeFrames, encodeMessage } = require('./spikerbox');

const TICK_MS = 10;
const SAMPLES_PER_TICK = 100; // 10 kHz
const SAMPLE_RATE = 10000;
const SINE_HZ = 80;
const CENTER = 8192;
const MAX_RAW = 16383;
const REST_AMP = 40;
const HELD_AMP_MIN = 4000;
const HELD_AMP_MAX = 11000;
const SHAPE = Math.tanh(2.5); // 사인을 각지게 만들어 RMS 를 키운다
const FOLLOW = 0.06; // 틱마다 목표를 따라가는 비율

class Simulator {
  /** feed(Buffer): SpikerBox 바이트를 넘겨 준다 */
  constructor(feed) {
    this.feed = feed;
    this.enabled = false;
    this.held = { a: false };
    this.timer = null;
    this.amp = REST_AMP;
    this.target = HELD_AMP_MAX;
    this.n = 0; // 지금까지 만든 샘플 수 (사인 위상 유지)
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    this.held = { a: false };
    if (on) {
      this.feed(encodeMessage('HWT:MUSCLESS;'));
      this.timer = setInterval(() => this.tick(), TICK_MS);
    } else {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  key(k, down) {
    if (!(k in this.held)) return;
    if (k === 'a' && down && !this.held.a) this.target = HELD_AMP_MIN + Math.random() * (HELD_AMP_MAX - HELD_AMP_MIN);
    this.held[k] = !!down;
  }

  releaseAll() {
    this.held = { a: false };
  }

  /** 10 ms 분량(100샘플)을 만들어 넘긴다 */
  tick() {
    this.amp += ((this.held.a ? this.target : REST_AMP) - this.amp) * FOLLOW;
    const frames = [];
    for (let i = 0; i < SAMPLES_PER_TICK; i++) {
      const phase = (2 * Math.PI * SINE_HZ * this.n++) / SAMPLE_RATE;
      const noise = (Math.random() * 2 - 1) * 0.25;
      const v = CENTER + this.amp * (Math.tanh(2.5 * Math.sin(phase)) / SHAPE + noise);
      frames.push([Math.max(0, Math.min(MAX_RAW, Math.round(v)))]);
    }
    this.feed(encodeFrames(frames));
  }
}

module.exports = { Simulator };

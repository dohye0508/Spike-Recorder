'use strict';

// 하드웨어 없이 테스트하는 시뮬레이션.
// 0.1초마다 p1 에 가짜 세기를 넣고, A 키를 누르는 동안은 큰 값(펀치).
// (SpikerBox 바이트 스트림 시뮬레이션은 Phase 3)

const TICK_MS = 100;

function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

class Simulator {
  /** feed(player, rawValue) */
  constructor(feed) {
    this.feed = feed;
    this.enabled = false;
    this.held = { a: false };
    this.timer = null;
    this.level = 0;
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    this.held = { a: false };
    if (on) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    } else {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  key(k, down) {
    if (k in this.held) this.held[k] = !!down;
  }

  releaseAll() {
    this.held = { a: false };
  }

  tick() {
    // 근전도처럼: 누르고 있으면 서서히 올라가고, 떼면 서서히 내려가며 약간 흔들린다
    const held = this.held.a;
    this.level += ((held ? 7000 : 150) - this.level) * (held ? 0.3 : 0.4);
    const noise = this.level * 0.12 * (Math.random() * 2 - 1);
    this.feed('p1', Math.max(0, Math.round(this.level + noise + rand(0, 60))));
  }
}

module.exports = { Simulator };

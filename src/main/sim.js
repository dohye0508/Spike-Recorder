'use strict';

// 아두이노 없이 테스트하는 시뮬레이션.
// 0.1초마다 P1·P2에 가짜 피크값을 넣고, A/L 키를 누르는 동안은 큰 값(펀치), T 키는 두 쪽에 같은 값(동점).

const TICK_MS = 100;
const TIE_VALUE = 7000;

function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

class Simulator {
  /** feed(player, rawValue) */
  constructor(feed) {
    this.feed = feed;
    this.enabled = false;
    this.held = { a: false, l: false, t: false };
    this.timer = null;
    this.level = { p1: 0, p2: 0 };
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    this.held = { a: false, l: false, t: false };
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
    this.held = { a: false, l: false, t: false };
  }

  tick() {
    // 근전도처럼: 누르고 있으면 서서히 올라가고, 떼면 서서히 내려가며 약간 흔들린다
    const goal = (held) => (held ? 7000 : 150);
    if (this.held.t) {
      this.level.p1 = this.level.p2 = this.level.p1 + (TIE_VALUE - this.level.p1) * 0.35;
      const v = Math.round(this.level.p1);
      this.feed('p1', v);
      this.feed('p2', v);
      return;
    }
    for (const [k, held] of [['p1', this.held.a], ['p2', this.held.l]]) {
      this.level[k] += (goal(held) - this.level[k]) * (held ? 0.3 : 0.4);
      const noise = this.level[k] * 0.12 * (Math.random() * 2 - 1);
      this.feed(k, Math.max(0, Math.round(this.level[k] + noise + rand(0, 60))));
    }
  }
}

module.exports = { Simulator };

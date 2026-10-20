'use strict';

// 명예의 전당(상위 5개). 점수 내림차순, 같은 점수면 먼저 세운 기록이 위.

const HALL_SIZE = 5;
const TEMP_NAME = 'ㅇㅇㅇ';
const MAX_NAME_LENGTH = 20;

function qualifies(hall, score) {
  if (!(score > 0)) return false; // 0점 기록은 남기지 않는다
  return hall.length < HALL_SIZE || score > hall[hall.length - 1].score;
}

/** 새 기록을 넣은 새 배열을 돌려준다. 같은 점수 뒤에 끼워서 먼저 세운 기록이 위에 남게 한다. */
function insert(hall, entry) {
  const out = hall.slice();
  let i = out.findIndex((e) => e.score < entry.score);
  if (i < 0) i = out.length;
  out.splice(i, 0, entry);
  return out.slice(0, HALL_SIZE);
}

let seq = 0;
function makeEntry(score, player, date) {
  seq += 1;
  return {
    id: date.getTime().toString(36) + '-' + seq.toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name: TEMP_NAME,
    score,
    player, // 'PLAYER 1' | 'PLAYER 2'
    at: date.toISOString(),
  };
}

/** 경기 결과를 반영한다. 패자·무승부도 각각 검사. 바뀌었으면 changed = true */
function applyResult(hall, result, date = new Date()) {
  let next = hall;
  let changed = false;
  for (const [score, player] of [[result.p1, 'PLAYER 1'], [result.p2, 'PLAYER 2']]) {
    if (qualifies(next, score)) {
      next = insert(next, makeEntry(score, player, date));
      changed = true;
    }
  }
  return { hall: next, changed };
}

function cleanName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return s || TEMP_NAME;
}

/** names: { [id]: 새 이름 } */
function renameEntries(hall, names) {
  return hall.map((e) => (Object.prototype.hasOwnProperty.call(names, e.id) ? { ...e, name: cleanName(names[e.id]) } : e));
}

/** 파일에서 읽은 값이 이상해도 앱이 죽지 않게 정리 */
function normalizeHall(raw) {
  if (!Array.isArray(raw)) return [];
  const list = raw
    .filter((e) => e && Number.isFinite(Number(e.score)))
    .map((e, i) => ({
      id: String(e.id || 'legacy-' + i),
      name: cleanName(e.name),
      score: Math.max(0, Math.min(9999, Math.round(Number(e.score)))),
      player: e.player === 'PLAYER 2' ? 'PLAYER 2' : 'PLAYER 1',
      at: typeof e.at === 'string' ? e.at : new Date(0).toISOString(),
    }));
  // 점수 내림차순, 같으면 시간 오름차순
  list.sort((a, b) => b.score - a.score || a.at.localeCompare(b.at));
  return list.slice(0, HALL_SIZE);
}

module.exports = { HALL_SIZE, TEMP_NAME, qualifies, insert, applyResult, renameEntries, normalizeHall, cleanName };

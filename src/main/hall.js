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
function makeEntry(score, date) {
  seq += 1;
  return {
    id: date.getTime().toString(36) + '-' + seq.toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name: TEMP_NAME,
    score,
    at: date.toISOString(),
  };
}

/** 기록을 반영한다. rank = 들어간 순위(1~5), 못 들어가면 null. 바뀌었으면 changed = true */
function applyResult(hall, score, date = new Date()) {
  if (!qualifies(hall, score)) return { hall, changed: false, rank: null };
  const entry = makeEntry(score, date);
  const next = insert(hall, entry);
  return { hall: next, changed: true, rank: next.indexOf(entry) + 1 };
}

/**
 * 지금까지의 모든 기록(history, 점수 배열) 중 몇 위인지. 같은 점수는 먼저 세운 쪽이 위라서 새 기록은 그 뒤.
 * history 는 이번 기록을 넣기 전의 목록. 0점은 순위를 매기지 않는다(null).
 */
function placeOf(history, score) {
  if (!(score > 0)) return null;
  let above = 0;
  for (let i = 0; i < history.length; i++) if (history[i] >= score) above++;
  return above + 1;
}

const HISTORY_MAX = 20000;
function pushHistory(history, score) {
  const next = history.concat([score]);
  return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(Number).filter((n) => Number.isFinite(n) && n >= 0).map((n) => Math.min(9999, Math.round(n))).slice(-HISTORY_MAX);
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
      at: typeof e.at === 'string' ? e.at : new Date(0).toISOString(),
    }));
  // 점수 내림차순, 같으면 시간 오름차순
  list.sort((a, b) => b.score - a.score || a.at.localeCompare(b.at));
  return list.slice(0, HALL_SIZE);
}

module.exports = { placeOf, pushHistory, normalizeHistory, HALL_SIZE, TEMP_NAME, qualifies, insert, applyResult, renameEntries, normalizeHall, cleanName };

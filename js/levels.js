// JLPT levels: which ones are unlocked, and each mode's content for them. Every piece of content carries a level
// (js/level-tag.js; N5 for everything before N4), and every mode draws its content through `content()` here instead
// of reading its lists directly, so a new level reaches every mode at once. tests/levels.spec.js checks that each mode
// has enough content at every level the app offers.
//
// The gate: N5 is always open. Each later level opens once the level before it is done: a full mock passed, or the
// real test marked as passed on Progress (store.examDone). N4 opens after N5, N3 after N4. The Settings switch "Show every level" opens them all, for
// testing and for learners who want to look ahead. Locking never takes anything away: what's already planted keeps
// being reviewed, and locked content shows as locked with one friendly line, never hidden.
//
// Mixing: once a new level opens, a session draws about 70% from the newest unlocked level and 30% review from the
// levels below (`mixed`).
import { store } from './store.js';
import { APP_LEVELS, levelOf, prevLevel, nextLevel, tagLevel } from './level-tag.js';
import { PHRASES, CHAPTERS, TRAINS, KANJI, SHOP_STOCK, CUSTOMERS, SHOP_KEIGO, N5_WORDS, N4_WORDS, N3_WORDS, ARCS } from './data.js';
import { DIALOGUES, NUMBER_SCENES, KATA_WORDS, CONJ_WORDS, BUILD_SENTENCES } from './practice-data.js';
import { ALL_LESSONS, TRACKS } from './dojo-data.js';
import { STUDY_UNITS } from './course-data.js';
import { BRUSH_KANA, BRUSH_WORDS } from './brush-data.js';
import { RIVALS } from './rival-data.js';
import { SCENES as MEET_SCENES } from './encounter-data.js';
import { MESSAGES } from './messages-data.js';
import { READERS } from './library-data.js';
import { MANGA_SAMPLES } from './manga-samples.js';

export { APP_LEVELS, levelOf, prevLevel, nextLevel, tagLevel };

/** Share of a session drawn from the newest unlocked level (the rest is review from the levels below). */
export const NEW_SHARE = 0.7;

/** The one friendly line a locked level shows. */
export function lockLine(level) {
  const before = prevLevel(level);
  return before ? `Unlocks when you pass a full mock ${before}, or mark the real ${before} as passed.` : '';
}

/** Levels open now, easiest first. A level done opens everything up to the one after it (a passed N4 opens N3 even
 * if N5 was never marked). */
export function unlockedLevels() {
  const done = store.examDone();
  const all = !!store.settings.showAllLevels;
  const top = Math.max(-1, ...APP_LEVELS.map((lv, i) => (done.has(lv) ? i : -1)));
  return APP_LEVELS.filter((lv, i) => i === 0 || all || i <= top + 1);
}
export const isUnlocked = (level) => unlockedLevels().includes(level);
export const lockedLevels = () => APP_LEVELS.filter((lv) => !isUnlocked(lv));
/** The newest unlocked level. */
export const newestLevel = () => unlockedLevels().slice(-1)[0];
/** Whether an item's level is open. */
export const itemOpen = (x) => isUnlocked(levelOf(x));

/**
 * Each mode's content, every level (filtered by `content`). Keys are the modes' ids, plus a few shared pools.
 * Sources are functions so the lists are read when asked for (they are filled in when the data modules load).
 */
export const SOURCES = {
  garden: () => [...N5_WORDS, ...N4_WORDS, ...N3_WORDS],                 // the decks the Garden introduces, in teaching order
  rhythm: () => PHRASES.filter((p) => !p.isBoss),           // phrases to say on the beat
  slice: () => PHRASES,                                     // words to say out loud (pitch pairs included)
  duel: () => PHRASES,                                      // melodies to tell apart (pairs and single words)
  story: () => CHAPTERS,
  arcs: () => ARCS,
  particle: () => TRAINS,
  forge: () => KANJI,
  dojo: () => ALL_LESSONS,                                  // kana lessons (N5) and kanji lessons (N5, N4, N3)
  tracks: () => TRACKS,
  conj: () => CONJ_WORDS,
  build: () => BUILD_SENTENCES,
  kata: () => KATA_WORDS,
  shop: () => SHOP_STOCK,
  customers: () => Object.entries(CUSTOMERS).map(([key, c]) => ({ ...c, key })),
  keigo: () => SHOP_KEIGO,                                  // the shopkeeper's polite replies (N4, N3)
  listen: () => DIALOGUES,
  numbers: () => NUMBER_SCENES,
  course: () => STUDY_UNITS,
  brush: () => [...BRUSH_KANA, ...BRUSH_WORDS],             // single kana (N5), whole words (N4, N3)
  rival: () => RIVALS,
  meet: () => MEET_SCENES,                                  // Encounters scenes (one person, one moment)
  messages: () => MESSAGES,
  library: () => READERS,                                   // graded readers (js/library-*.js)
  walk: () => [...N5_WORDS, ...N4_WORDS, ...N3_WORDS],       // words to recall out loud (Garden words first)
  type: () => [...N5_WORDS, ...N4_WORDS, ...N3_WORDS],       // words to type from memory (Garden words first)
  dictation: () => [...N5_WORDS, ...N4_WORDS, ...N3_WORDS],  // words and their example sentences to hear and type in kana
  manga: () => MANGA_SAMPLES,                               // Manga Reader practice pages (the learner's own pages are theirs)
};

/** Every item of a source, whatever its level (for lookups and counts). */
export const allContent = (key) => SOURCES[key]();

/** A source's items at the given levels (default: the unlocked ones). */
export function content(key, levels = unlockedLevels()) {
  const open = new Set(levels);
  return SOURCES[key]().filter((x) => open.has(levelOf(x)));
}

/** A source's items at exactly one level. */
export const atLevel = (key, level) => content(key, [level]);

function shuffle(a, rand = Math.random) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/**
 * `list` in session order: about NEW_SHARE from its newest level, the rest from the levels below, each part shuffled
 * and dealt out evenly (so review is spread through the session, not bunched at the end). With one level, a shuffle.
 * `n`: how many (default all; once one side runs out the rest come from the other).
 */
export function mixed(list, n = list.length, rand = Math.random) {
  const levels = [...new Set(list.map(levelOf))].sort((a, b) => APP_LEVELS.indexOf(a) - APP_LEVELS.indexOf(b));
  if (levels.length < 2) return shuffle(list, rand).slice(0, n);
  const top = levels[levels.length - 1];
  const fresh = shuffle(list.filter((x) => levelOf(x) === top), rand);
  const review = shuffle(list.filter((x) => levelOf(x) !== top), rand);
  const out = [];
  let f = 0, r = 0;
  while (out.length < n && (f < fresh.length || r < review.length)) {
    // Keep the running share of new items at NEW_SHARE (7 of every 10), until one side runs out.
    const takeFresh = f < fresh.length && (r >= review.length || f < Math.round(NEW_SHARE * (out.length + 1)));
    out.push(takeFresh ? fresh[f++] : review[r++]);
  }
  return out;
}

/** One item from `list`, the newest level about NEW_SHARE of the time. */
export function pickMixed(list, rand = Math.random) {
  const levels = [...new Set(list.map(levelOf))];
  if (levels.length < 2) return list[Math.floor(rand() * list.length)];
  const top = levels.sort((a, b) => APP_LEVELS.indexOf(a) - APP_LEVELS.indexOf(b)).slice(-1)[0];
  const pool = list.filter((x) => (rand() < NEW_SHARE) === (levelOf(x) === top));
  const from = pool.length ? pool : list;
  return from[Math.floor(rand() * from.length)];
}

/**
 * A small line of level chips for the top of a mode: which levels are in the mix, and the locked ones. A locked
 * chip is a button: tapping it shows its friendly unlock line (js/app.js), so the line isn't printed on every screen.
 */
export function levelBar(key = null) {
  const open = unlockedLevels();
  const chips = APP_LEVELS.map((lv) => {
    const has = !key || atLevel(key, lv).length > 0 || !open.includes(lv);
    if (!has) return '';
    return open.includes(lv)
      ? `<span class="level-chip on" title="${lv} content is in the mix">${lv}</span>`
      : `<button type="button" class="level-chip locked" data-lockline="${lockLine(lv)}" title="${lockLine(lv)}" aria-label="${lv} locked. ${lockLine(lv)}">🔒 ${lv}</button>`;
  }).join('');
  // The mix, once two levels are open.
  const mix = open.length > 1 ? `Mostly ${open[open.length - 1]}, with some ${open.slice(0, -1).join(' and ')} review.` : '';
  const note = mix ? `<span class="small dim">${mix}</span>` : '';
  return `<div class="level-bar" data-levels="${open.join(' ')}">${chips}${note}</div>`;
}

const warmed = new Set();
/**
 * Asks the service worker to cache the voice clips of every unlocked level past the first (they aren't precached, so
 * a phone doesn't download N4 audio before N4 opens). Once per level per visit; harmless without a service worker.
 */
export function warmLevels() {
  const sw = typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw) return;
  for (const lv of unlockedLevels().slice(1)) {
    if (warmed.has(lv)) continue;
    warmed.add(lv);
    sw.postMessage({ type: 'cache-level', level: lv });
  }
}

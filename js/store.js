// Progress store: spaced review with no streaks. Missing days never wipes anything out.
// Port of ProgressStore.swift plus the daily-plan bookkeeping for the "Today" screen.
import { PHRASES, PHRASE_BY_ID, GARDEN_CATALOG, CHAPTERS, N5_WORDS, N4_WORDS, N3_WORDS } from './data.js';
import { itemOpen } from './levels.js';
import { partnerOf } from './pairs.js';
import { ALL_LESSONS, LESSON_BY_ID } from './dojo-data.js';
import * as srs from './srs.js';
import { blankEngine, normalizeEngine, recordGrade, dayNumber, prune } from './skills.js';
import { newPerDay, newDirsPerDay, newGrammarPerDay } from './tuning.js';
import { unitCardKeys, isCardKey } from './grammar-cards.js';

export const STORAGE_KEY = 'kotobaBeat.v1';
const DAY = 86_400_000;

/** The old fixed review ladder (days per level). Reviews now use the FSRS-style scheduler in srs.js; this stays for
 *  the growth-stage range (levels 0-6) and for migrating items saved before v3. */
export const INTERVALS = srs.LEGACY_INTERVALS;
export const DAILY_REVIEW_CAP = 20;
export const DAILY_REVIEW_CAP_SHORT = 10;
export const DAILY_NEW_CAP = 5;

/** Extra card directions a well-grown word gets, each with its own schedule (in items[id].dirs). */
export const DIRECTIONS = ['listen', 'say'];
/** Garden stage a word's normal card must reach before its Listen and Say it cards are added. */
export const DIRECTION_STAGE = 3;
/** Misses (since the last time it was cleared) after which a card is marked as needing help. */
export const HELP_AFTER = 4;
/** Card directions a Reading Dojo kana can have besides reading it (Kana Brush: hear it, draw it). Added in v10. */
export const KANA_DIRECTIONS = ['draw'];
/** Right answers in a row that clear the needs-help mark. */
export const HELP_CLEAR = 2;

/** Skill areas the learner model tracks. Every graded action in every mode feeds one of these (see store.grade). */
export const SKILLS = ['kana', 'kanji', 'vocab', 'grammar', 'listening', 'pitch', 'speaking', 'counters'];

/** Version of the saved progress shape. Bump it and add a step to MIGRATIONS whenever the shape changes. */
export const STATE_VERSION = 17;

function blank() {
  return {
    v: STATE_VERSION,
    items: {},          // id -> { level, due (ms), best, r (reviews), pl (planted ms), s (stability, days), d (difficulty 1-10), lr (last review ms),
                        //        lapses, help, ok2 (needs-help bookkeeping, added in v6), dirs: { listen, say } (v6, see DIRECTIONS)
                        //        or, on a 'kana:' item, dirs: { draw } (v10, Kana Brush, see KANA_DIRECTIONS) }
    lastSession: null,
    chapters: [],       // cleared chapter ids
    forged: [],         // forged kanji
    dojo: [],           // cleared Reading Dojo lesson ids
    storyReplays: {},   // chapter id -> last replay ms (to rotate replays in the daily plan)
    settings: {
      latencyMs: 0, quiet: false, length: 'standard', hideIosHint: false, theme: 'auto', readingHelp: 'auto', voiceSrc: 'auto', speed: 'normal',
      textSize: 'm', sfx: true, haptics: true,   // added in v2
      pace: 'normal',                             // added in v3: 'less' = at most 3 new words a day
      pronCheck: true,                            // added in v7: show the 🎤 pronunciation check buttons
      autoMic: false,                             // the mic starts on its own in Say it cards and Sentence Builder
      voice: null,                                // added in v8: { mid (Hz), lo, hi (semitones), n } learned by the Pitch Coach
      showAllLevels: false,                       // added in v12: open every JLPT level (js/levels.js), not just the ones reached
    },
    engine: blankEngine(),   // added in v3: the skill model, placement and weekly check-in (see skills.js)
    days: {},           // 'YYYY-MM-DD' -> { ok, tot, rev, newc, studied, blocks: { id: 'done'|'skipped' }, newd?, newg? (v6) }
    saga: blankSaga(),  // added in v4: Story line mining and chapter results (see migrateStory)
    course: blankCourse(),   // added in v5: the guided course (see migrateCourse)
    grammar: {},        // added in v6: grammar review cards, key -> card (see migrateCards and js/grammar-cards.js)
    coach: { ears: [] }, // added in v8: Pitch Coach; ears = words whose "where does it drop?" warm-up is done
    exam: blankExam(),  // added in v9: mock JLPT results and readiness (see blankExam)
    messages: blankMessages(),   // added in v11: Ren's Messages (see blankMessages and js/messages.js)
    library: blankLibrary(),     // added in v13: Library readers read (see blankLibrary and js/modes/library.js)
    mywords: {},        // added in v16: My words, Garden cards for words met in the Manga Reader (see normalizeMyWords)
    daily: null,        // added in v17: today's words { date, ids, at } (js/daily-words.js), shared so every device shows the same set
  };
}

/** Mock results kept (the oldest drop off), and question ids remembered so the next mocks pick fresh ones. */
export const EXAM_HISTORY_MAX = 50;
export const EXAM_SEEN_MAX = 400;
const LEVEL_RE = /^N[1-5]$/;

/**
 * Mock JLPT (js/exam.js) and readiness (js/readiness.js):
 *   history  [{ level, format ('mini'|'full'), at, lk, li, total, pass, ok, n, parts: { part: [right, asked] } }], oldest first
 *   real     { level: { on, at } }: the learner marked the real test as passed (on), or took the mark back
 *   seen     question ids from recent mocks, newest last
 *   later    { level: 'YYYY-MM-DD' }: "ready for a mock" stays quiet until this day ("Later")
 * A level is done once a full mock is passed or the real test is marked; readiness then moves to the next level.
 */
/**
 * Ren's Messages (js/messages.js): the thread, oldest first. Each entry: { id (message id), day ('YYYY-MM-DD' it
 * arrived), at (ms), reply (index of the reply chosen, or null), ok (the "what did they mean?" answer: true, false,
 * or null before it's answered) }. At most one arrives a day; nothing in it ever expires.
 */
export function blankMessages() {
  return { thread: [], letters: [] };
}

/**
 * Ren's monthly letters (js/letters.js), oldest first: { month ('YYYY-MM'), reg ('polite'|'casual'), lines (line ids,
 * js/letter-data.js), words (Garden ids to recall), stats: { days, words, mocks }, snap: { hira, kata, chapters, units }
 * (what the learner had, for the next letter), read, at (ms written) }. One per month at most.
 */
export const LETTERS_MAX = 60;
const LINE_ID_RE = /^[a-zA-Z]{1,20}$/;
function normalizeLetters(raw) {
  if (!Array.isArray(raw)) return [];
  const by = new Map();
  for (const l of raw) {
    if (!l || typeof l !== 'object' || typeof l.month !== 'string' || !/^\d{4}-\d{2}$/.test(l.month)) continue;
    const st = l.stats && typeof l.stats === 'object' ? l.stats : {};
    const sn = l.snap && typeof l.snap === 'object' ? l.snap : {};
    by.set(l.month, {
      month: l.month, reg: l.reg === 'polite' ? 'polite' : 'casual',
      lines: Array.isArray(l.lines) ? l.lines.filter((x) => typeof x === 'string' && LINE_ID_RE.test(x)).slice(0, 20) : [],
      words: Array.isArray(l.words) ? l.words.filter((x) => typeof x === 'string' && x.length < 80).slice(0, 5) : [],
      stats: { days: Math.max(0, Math.round(num(st.days))), words: Math.max(0, Math.round(num(st.words))), mocks: Math.max(0, Math.round(num(st.mocks))) },
      snap: { hira: !!sn.hira, kata: !!sn.kata, chapters: Math.max(0, Math.round(num(sn.chapters))), units: Math.max(0, Math.round(num(sn.units))) },
      read: !!l.read, at: Math.max(0, num(l.at)),
    });
  }
  return [...by.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-LETTERS_MAX);
}
export const MESSAGES_MAX = 500;

function normalizeMessages(raw) {
  const m = blankMessages();
  if (raw && typeof raw === 'object') m.letters = normalizeLetters(raw.letters);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.thread)) return m;
  const seen = new Set();
  for (const e of raw.thread) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(e.id)) continue;
    if (typeof e.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.day)) continue;
    const key = e.id + '|' + e.day;
    if (seen.has(key)) continue;
    seen.add(key);
    m.thread.push({
      id: e.id, day: e.day, at: Math.max(0, Number(e.at) || 0),
      reply: Number.isInteger(e.reply) && e.reply >= 0 && e.reply < 5 ? e.reply : null,
      ok: e.ok === true ? true : e.ok === false ? false : null,
    });
  }
  m.thread.sort((a, b) => a.at - b.at || (a.day < b.day ? -1 : 1));
  m.thread = m.thread.slice(-MESSAGES_MAX);
  return m;
}

/** Two devices' threads: every message from both, once; a copy with the reply (and answer) chosen wins. */
function mergeMessages(a, b) {
  const by = new Map();
  for (const e of [...a.thread, ...b.thread]) {
    const key = e.id + '|' + e.day;
    const cur = by.get(key);
    const score = (x) => (x.reply != null ? 2 : 0) + (x.ok != null ? 1 : 0);
    if (!cur || score(e) > score(cur) || (score(e) === score(cur) && e.at < cur.at)) by.set(key, { ...e });
  }
  // Letters: one per month from either device (the first one written wins), read on either device counts as read.
  const letters = new Map();
  for (const l of [...a.letters, ...b.letters]) {
    const cur = letters.get(l.month);
    if (!cur) letters.set(l.month, { ...l });
    else letters.set(l.month, { ...(l.at < cur.at ? l : cur), read: cur.read || l.read });
  }
  return normalizeMessages({ thread: [...by.values()], letters: [...letters.values()] });
}

/**
 * The Library (js/modes/library.js): readers read to the end, id -> { n (times finished), at (ms, the last time),
 * q (best questions right), qt (questions asked) }. Words read are counted from these (a reader's words x n).
 */
export function blankLibrary() {
  return { read: {} };
}

function normalizeLibrary(raw) {
  const l = blankLibrary();
  if (!raw || typeof raw !== 'object' || !raw.read || typeof raw.read !== 'object') return l;
  for (const [id, r] of Object.entries(raw.read)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(id) || !r || typeof r !== 'object') continue;
    const n = Math.max(0, Math.min(9999, Math.floor(Number(r.n) || 0)));
    if (!n) continue;
    const qt = Math.max(0, Math.min(10, Math.floor(Number(r.qt) || 0)));
    l.read[id] = { n, at: Math.max(0, Number(r.at) || 0), q: Math.max(0, Math.min(qt, Math.floor(Number(r.q) || 0))), qt };
  }
  return l;
}

/** Two devices' Library: each reader's larger count, latest time and best score. */
/**
 * My words (v14): words the learner looked up in the Manga Reader and kept, each a Garden card 'my:<written form>'.
 * Written form -> { r (reading in kana), en (meaning), at (ms added) }. The card's id is the word itself, so two
 * devices that add the same word make the same card, and a merge is a plain union.
 */
export const MYWORD_MAX = 2000;
export const myWordId = (jp) => 'my:' + jp;

function normalizeMyWords(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [jp, w] of Object.entries(raw)) {
    if (!jp || jp.length > 40 || !/[ぁ-ゖァ-ヺ一-鿿々]/.test(jp) || !w || typeof w !== 'object') continue;
    out[jp] = {
      r: typeof w.r === 'string' ? w.r.slice(0, 80) : '',
      en: typeof w.en === 'string' ? w.en.slice(0, 200) : '',
      at: Math.max(0, Number(w.at) || 0),
    };
  }
  return out;
}

/** Two devices' My words: every word from both; a word on both keeps the copy added first. */
function mergeMyWords(a, b) {
  const out = { ...a };
  for (const [jp, w] of Object.entries(b)) if (!out[jp] || (w.at && (!out[jp].at || w.at < out[jp].at))) out[jp] = { ...w };
  return out;
}

function mergeLibrary(a, b) {
  const read = { ...a.read };
  for (const [id, r] of Object.entries(b.read)) {
    const x = read[id];
    read[id] = !x ? { ...r } : {
      n: Math.max(x.n, r.n), at: Math.max(x.at, r.at),
      ...(r.qt > x.qt || (r.qt === x.qt && r.q > x.q) ? { q: r.q, qt: r.qt } : { q: x.q, qt: x.qt }),
    };
  }
  return normalizeLibrary({ read });
}

export function blankExam() {
  return { history: [], real: {}, seen: [], later: {}, goal: null };
}

/**
 * The test date goal (js/planner.js): { level, date ('YYYY-MM-DD' test day), days (study days a week, 3-7), from
 * ('YYYY-MM-DD' the plan was made, which fixes its checkpoints), at (ms, set or removed) }. Removing it keeps the
 * entry with level and date null, so a removal syncs like any change. Null when no goal was ever set.
 */
function normalizeGoal(g) {
  if (!g || typeof g !== 'object' || !(Number(g.at) > 0)) return null;
  const day = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const on = LEVEL_RE.test(g.level) && day(g.date);
  const days = Math.round(Number(g.days));
  return {
    level: on ? g.level : null, date: on ? g.date : null,
    days: days >= 3 && days <= 7 ? days : 5,
    from: day(g.from) ? g.from : dateKey(new Date(Number(g.at))),
    at: Number(g.at),
  };
}

/**
 * A review card that isn't a word's normal card: a word's Listen or Say it direction, or a grammar card.
 * { due, s, d, lr, r, pl } like an item (no growth stage), plus lapses / help / ok2 for the needs-help mark.
 */
export const newCard = (now = Date.now()) => ({ due: 0, s: 0, d: 0, lr: 0, r: 0, pl: now });

/**
 * v5 -> v6: review cards in more directions and for grammar. Words keep every field; the grammar block starts with a
 * card for each grammar point of the course units already read or done, and for each conjugation form already
 * practised in Conjugation Dojo (from the skill model's per-item records). New cards wait to be introduced, at most
 * 2 a day, like new words.
 */
export function migrateCards(raw) {
  const grammar = raw.grammar && typeof raw.grammar === 'object' ? { ...raw.grammar } : {};
  const course = raw.course && typeof raw.course === 'object' ? raw.course : {};
  const units = [...new Set([...(Array.isArray(course.read) ? course.read : []), ...(Array.isArray(course.done) ? course.done : [])])];
  let n = 0;
  // Planted-at times are small counters, not the clock: every device migrating the same progress gets the same cards
  // (so syncing two migrated copies changes nothing), in lesson order, ahead of anything planted later.
  for (const u of units) for (const key of unitCardKeys(u)) if (!grammar[key]) grammar[key] = newCard(++n);
  const mastery = raw.engine && raw.engine.mastery && typeof raw.engine.mastery === 'object' ? raw.engine.mastery : {};
  for (const k of Object.keys(mastery)) {
    const m = /^grammar\|conj:(.+)$/.exec(k);
    const key = m && 'cj:' + m[1];
    if (key && isCardKey(key) && !grammar[key]) grammar[key] = newCard(++n);
  }
  return { ...raw, grammar };
}

/**
 * The guided course (js/course.js): on = Today follows it, current = unit chosen as current (null: first not done),
 * reached / done / read = unit ids, tally = unit id -> { ok, tot, last } first-try answers in that unit's practice
 * (last: the most recent results as a '1'/'0' string, newest at the end).
 */
export function blankCourse() {
  return { on: true, current: null, reached: [], done: [], read: [], tally: {} };
}

export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Story saga state: mined lines (Garden cards 'mine:<n>'), the next mined id, and per-chapter results. */
function blankSaga() {
  return {
    mined: [],        // [{ id: 'mine:<n>', jp, reading, en, parts: [[text, reading|null]], at }]
    seq: 0,           // highest mined number handed out (ids are never reused, even after a delete)
    quiz: {},         // chapter id -> { ok, tot, best, at } (comprehension questions)
    challenge: {},    // chapter id -> { ok, tot, best, runs, at } (no-furigana challenge replays)
  };
}

/** Adds the Story saga fields (mined lines, chapter results) with empty defaults. Changes nothing else. */
export function migrateStory(raw) {
  const prev = raw.saga && typeof raw.saga === 'object' ? raw.saga : {};
  return { ...raw, saga: { ...blankSaga(), ...prev } };
}

/**
 * Upgrade steps, one per version: MIGRATIONS[n] turns a version-n blob into version n+1.
 * Each step only adds or renames; nothing a learner has saved is ever dropped.
 */
const MIGRATIONS = {
  // v1 -> v2: text size, sound effects and vibration settings (defaults: medium, on, on).
  1: (raw) => ({ ...raw, settings: { textSize: 'm', sfx: true, haptics: true, ...(raw.settings || {}) } }),
  // v2 -> v3: the FSRS-style scheduler. Each item gets a stability from its level's old interval, a middle difficulty
  // and an estimated last review; level, due, best, r and pl stay exactly as they were. Adds the skill model
  // (empty) and the new-words pace setting (normal).
  2: (raw) => {
    const items = {};
    if (raw.items && typeof raw.items === 'object') {
      for (const [id, p] of Object.entries(raw.items)) items[id] = p && typeof p === 'object' ? srs.migrateItem(p) : p;
    }
    return { ...raw, items, engine: raw.engine || blankEngine(), settings: { pace: 'normal', ...(raw.settings || {}) } };
  },
  // v3 -> v4: Story saga (line mining, comprehension and challenge results).
  3: migrateStory,
  // v4 -> v5: the guided course (current unit, units reached and done, practice tallies).
  4: migrateCourse,
  // v5 -> v6: Listen and Say it cards for words, grammar review cards, and the needs-help mark.
  5: migrateCards,
  // v6 -> v7: the pronunciation check setting (on). A per-device setting, so sync never changes it.
  6: (raw) => ({ ...raw, settings: { pronCheck: true, ...(raw.settings || {}) } }),
  // v7 -> v8: the Pitch Coach. The learner's voice range (a per-device setting, learned later, so none yet) and the
  // words whose pitch ear-training is done.
  7: (raw) => ({ ...raw, settings: { voice: null, ...(raw.settings || {}) }, coach: raw.coach && typeof raw.coach === 'object' ? raw.coach : { ears: [] } }),
  // v8 -> v9: mock JLPT results and readiness (none yet). Nothing else changes.
  8: (raw) => ({ ...raw, exam: raw.exam && typeof raw.exam === 'object' ? raw.exam : blankExam() }),
  // v9 -> v10: Kana Brush. A Reading Dojo kana can carry a drawing card (items['kana:あ'].dirs.draw) with its own
  // schedule. None exist yet (each starts the first time that kana is drawn), so every item, review date, chapter and
  // setting passes through untouched. The version still moves so an older copy of the app, which would drop the
  // drawing cards, leaves synced v10 progress alone until it updates.
  9: (raw) => ({ ...raw }),
  // v10 -> v11: Ren's Messages. An empty thread (the first message arrives the next time the app opens). Nothing
  // else changes.
  10: (raw) => ({ ...raw, messages: raw.messages && typeof raw.messages === 'object' ? raw.messages : blankMessages() }),
  // v11 -> v12: JLPT levels (js/levels.js). The "Show every level" setting, off: N4 opens the usual way, once N5 is
  // done (a full mock passed, or the real N5 marked as passed). A per-device setting, so sync never changes it.
  // Everything already learned stays exactly as it was.
  11: (raw) => ({ ...raw, settings: { showAllLevels: false, ...(raw.settings || {}) } }),
  // v12 -> v13: the Library. No readers read yet; everything else passes through untouched.
  12: (raw) => ({ ...raw, library: raw.library && typeof raw.library === 'object' ? raw.library : blankLibrary() }),
  // v16 -> v17: today's words, shared across devices. None picked yet.
  16: (raw) => ({ ...raw, daily: null }),
  // v15 -> v16: My words from the Manga Reader. None yet; everything else passes through untouched.
  15: (raw) => ({ ...raw, mywords: raw.mywords && typeof raw.mywords === 'object' ? raw.mywords : {} }),
  // v14 -> v15: Ren's monthly letters (messages.letters). None yet; everything else passes through untouched.
  14: (raw) => ({ ...raw, messages: { thread: [], ...(raw.messages && typeof raw.messages === 'object' ? raw.messages : {}), letters: [] } }),
  // v13 -> v14: the test date planner (exam.goal, see normalizeGoal). No goal yet; everything else passes through
  // untouched. The version moves so an older copy of the app, which would drop the goal, leaves synced v14 alone.
  13: (raw) => ({ ...raw, exam: { ...(raw.exam && typeof raw.exam === 'object' ? raw.exam : blankExam()), goal: null } }),
};

/** Adds the guided-course field with defaults. Self-contained: it touches nothing else in the blob. */
export function migrateCourse(raw) {
  return { ...raw, course: raw.course && typeof raw.course === 'object' ? raw.course : blankCourse() };
}

export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  let v = Number.isInteger(raw.v) && raw.v > 0 ? raw.v : 1;
  let out = raw;
  while (v < STATE_VERSION) {
    out = MIGRATIONS[v](out);
    v += 1;
  }
  return { ...out, v: Math.max(v, out.v || 0) };
}

function normalize(input) {
  const s = blank();
  const raw = migrate(input);
  if (!raw || typeof raw !== 'object') return s;
  if (raw.items && typeof raw.items === 'object') {
    for (const [id, p] of Object.entries(raw.items)) {
      if (!p || typeof p !== 'object') continue;
      const m = srs.migrateItem(p);   // fills in s, d and lr if they are missing; keeps them if present
      s.items[id] = {
        level: Math.max(0, Math.min(INTERVALS.length - 1, Number(p.level) || 0)),
        due: Number(p.due) || 0,
        best: Number(p.best) || 0,
        r: Number(p.r) || 0,
        pl: Number(p.pl) || 0,
        s: Math.max(0, Number(m.s) || 0),
        d: Math.max(0, Math.min(10, Number(m.d) || 0)),
        lr: Math.max(0, Number(m.lr) || 0),
        ...helpFields(p),
      };
      if (p.dirs && typeof p.dirs === 'object') {
        const dirs = {};
        for (const dir of id.startsWith('kana:') ? KANA_DIRECTIONS : DIRECTIONS) { const c = normalizeCard(p.dirs[dir]); if (c) dirs[dir] = c; }
        if (Object.keys(dirs).length) s.items[id].dirs = dirs;
      }
    }
  }
  s.lastSession = typeof raw.lastSession === 'number' ? raw.lastSession : null;
  if (Array.isArray(raw.chapters)) s.chapters = raw.chapters.filter((x) => typeof x === 'string');
  if (Array.isArray(raw.forged)) s.forged = raw.forged.filter((x) => typeof x === 'string');
  if (Array.isArray(raw.dojo)) s.dojo = raw.dojo.filter((x) => typeof x === 'string');
  if (raw.storyReplays && typeof raw.storyReplays === 'object') s.storyReplays = { ...raw.storyReplays };
  if (raw.settings && typeof raw.settings === 'object') {
    const st = raw.settings;
    s.settings.latencyMs = Math.max(-200, Math.min(500, Number(st.latencyMs) || 0));
    s.settings.quiet = !!st.quiet;
    s.settings.length = st.length === 'short' ? 'short' : 'standard';
    s.settings.hideIosHint = !!st.hideIosHint;
    s.settings.theme = ['light', 'dark'].includes(st.theme) ? st.theme : 'auto';
    s.settings.readingHelp = ['romaji', 'kana', 'off'].includes(st.readingHelp) ? st.readingHelp : 'auto';
    // voiceSrc replaced the older 'voice' setting, whose default was the built-in clips.
    s.settings.voiceSrc = ['clips', 'device'].includes(st.voiceSrc) ? st.voiceSrc : 'auto';
    s.settings.speed = st.speed === 'slow' ? 'slow' : 'normal';
    s.settings.textSize = ['s', 'm', 'l', 'xl'].includes(st.textSize) ? st.textSize : 'm';
    s.settings.sfx = st.sfx !== false;
    s.settings.haptics = st.haptics !== false;
    s.settings.pace = st.pace === 'less' ? 'less' : 'normal';
    s.settings.pronCheck = st.pronCheck !== false;
    s.settings.autoMic = st.autoMic === true;
    s.settings.voice = normalizeVoice(st.voice);
    s.settings.showAllLevels = st.showAllLevels === true;
  }
  s.engine = normalizeEngine(raw.engine, SKILLS);
  if (raw.days && typeof raw.days === 'object') {
    for (const [k, d] of Object.entries(raw.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !d || typeof d !== 'object') continue;
      s.days[k] = {
        ok: Number(d.ok) || 0, tot: Number(d.tot) || 0, rev: Number(d.rev) || 0, newc: Number(d.newc) || 0,
        studied: !!d.studied, blocks: d.blocks && typeof d.blocks === 'object' ? { ...d.blocks } : {},
      };
      // New Listen / Say it and grammar cards introduced that day (v6): kept only when there were some.
      if (Number(d.newd) > 0) s.days[k].newd = Number(d.newd);
      if (Number(d.newg) > 0) s.days[k].newg = Number(d.newg);
    }
  }
  s.saga = normalizeSaga(raw.saga);
  s.course = normalizeCourse(raw.course);
  if (raw.coach && typeof raw.coach === 'object' && Array.isArray(raw.coach.ears)) {
    s.coach.ears = [...new Set(raw.coach.ears.filter((x) => typeof x === 'string' && x.length < 200))];
  }
  if (raw.grammar && typeof raw.grammar === 'object') {
    for (const [key, c] of Object.entries(raw.grammar)) {
      const n = /^(g|cj):/.test(key) ? normalizeCard(c) : null;
      if (n) s.grammar[key] = n;
    }
  }
  s.exam = normalizeExam(raw.exam);
  s.messages = normalizeMessages(raw.messages);
  s.library = normalizeLibrary(raw.library);
  s.mywords = normalizeMyWords(raw.mywords);
  s.daily = normalizeDaily(raw.daily);
  return s;
}

/** Cleans the mock JLPT block, keeping every well-formed result. */
function normalizeExam(raw) {
  const e = blankExam();
  if (!raw || typeof raw !== 'object') return e;
  if (Array.isArray(raw.history)) {
    for (const h of raw.history) {
      if (!h || typeof h !== 'object' || !LEVEL_RE.test(h.level) || !(Number(h.at) > 0)) continue;
      const parts = {};
      if (h.parts && typeof h.parts === 'object') {
        for (const [k, t] of Object.entries(h.parts)) {
          if (/^[a-z]+$/.test(k) && Array.isArray(t) && t.length >= 2) parts[k] = [Math.max(0, Math.floor(num(t[0]))), Math.max(0, Math.floor(num(t[1])))];
        }
      }
      e.history.push({
        level: h.level, format: h.format === 'full' ? 'full' : 'mini', at: Number(h.at),
        lk: Math.max(0, Math.round(num(h.lk))), li: Math.max(0, Math.round(num(h.li))), total: Math.max(0, Math.round(num(h.total))),
        pass: !!h.pass, ok: Math.max(0, Math.floor(num(h.ok))), n: Math.max(0, Math.floor(num(h.n))), parts,
      });
    }
    e.history.sort((a, b) => a.at - b.at);
    e.history = e.history.slice(-EXAM_HISTORY_MAX);
  }
  if (raw.real && typeof raw.real === 'object') {
    for (const [lv, r] of Object.entries(raw.real)) if (LEVEL_RE.test(lv) && r && typeof r === 'object') e.real[lv] = { on: !!r.on, at: num(r.at) };
  }
  if (Array.isArray(raw.seen)) e.seen = [...new Set(raw.seen.filter((x) => typeof x === 'string' && x.length < 200))].slice(-EXAM_SEEN_MAX);
  if (raw.later && typeof raw.later === 'object') {
    for (const [lv, d] of Object.entries(raw.later)) if (LEVEL_RE.test(lv) && /^\d{4}-\d{2}-\d{2}$/.test(d)) e.later[lv] = d;
  }
  e.goal = normalizeGoal(raw.goal);
  return e;
}

/** A saved voice range, or null if it's missing or doesn't look like a human voice. */
function normalizeVoice(v) {
  if (!v || typeof v !== 'object') return null;
  const mid = Number(v.mid);
  if (!(mid >= 60 && mid <= 700)) return null;
  const lo = Math.max(-12, Math.min(0, Number(v.lo) || -2));
  const hi = Math.min(12, Math.max(0, Number(v.hi) || 2));
  return { mid, lo, hi, n: Math.max(1, Math.floor(Number(v.n) || 1)) };
}

/** The needs-help fields, kept only when set (most cards never need them). */
function helpFields(p) {
  const out = {};
  const lapses = Math.max(0, Math.floor(Number(p.lapses) || 0));
  if (lapses) out.lapses = lapses;
  if (p.help) out.help = true;
  const ok2 = Math.max(0, Math.floor(Number(p.ok2) || 0));
  if (ok2 && p.help) out.ok2 = ok2;
  return out;
}

/** Cleans a direction or grammar card; null if it isn't one. */
function normalizeCard(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    due: Number(c.due) || 0, s: Math.max(0, Number(c.s) || 0), d: Math.max(0, Math.min(10, Number(c.d) || 0)),
    lr: Math.max(0, Number(c.lr) || 0), r: Math.max(0, Math.floor(Number(c.r) || 0)), pl: Number(c.pl) || 0,
    ...helpFields(c),
  };
}

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

function normalizeResults(obj, extra = []) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, r] of Object.entries(obj)) {
    if (!r || typeof r !== 'object') continue;
    const e = { ok: num(r.ok), tot: num(r.tot), best: num(r.best), at: num(r.at) };
    for (const f of extra) e[f] = num(r[f]);
    out[k] = e;
  }
  return out;
}

const UNIT_ID_RE = /^p\d+-\d+$/;
function normalizeCourse(c) {
  const out = blankCourse();
  if (!c || typeof c !== 'object') return out;
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && UNIT_ID_RE.test(x)))] : []);
  out.on = c.on !== false;
  out.current = typeof c.current === 'string' && UNIT_ID_RE.test(c.current) ? c.current : null;
  out.reached = ids(c.reached);
  out.done = ids(c.done);
  out.read = ids(c.read);
  if (c.tally && typeof c.tally === 'object') {
    for (const [id, t] of Object.entries(c.tally)) {
      if (!UNIT_ID_RE.test(id) || !t || typeof t !== 'object') continue;
      const tot = Math.max(0, Math.floor(Number(t.tot) || 0));
      out.tally[id] = {
        tot,
        ok: Math.max(0, Math.min(tot, Math.floor(Number(t.ok) || 0))),
        last: typeof t.last === 'string' ? t.last.replace(/[^01]/g, '').slice(-30) : '',
      };
    }
  }
  return out;
}

/** Validates the saga block: keeps every well-formed mined line and result, fills in what's missing. */
function normalizeSaga(raw) {
  const g = blankSaga();
  if (!raw || typeof raw !== 'object') return g;
  const seen = new Set();
  if (Array.isArray(raw.mined)) {
    for (const m of raw.mined) {
      if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !/^mine:\d+$/.test(m.id) || seen.has(m.id)) continue;
      if (typeof m.jp !== 'string' || !m.jp.trim()) continue;
      seen.add(m.id);
      const parts = Array.isArray(m.parts)
        ? m.parts.filter((p) => Array.isArray(p) && typeof p[0] === 'string').map((p) => [p[0], typeof p[1] === 'string' ? p[1] : null])
        : [];
      g.mined.push({ id: m.id, jp: m.jp, reading: typeof m.reading === 'string' ? m.reading : '', en: typeof m.en === 'string' ? m.en : '', parts, at: num(m.at) });
    }
  }
  const top = g.mined.reduce((n, m) => Math.max(n, Number(m.id.slice(5))), 0);
  g.seq = Math.max(top, Math.floor(num(raw.seq)));
  g.quiz = normalizeResults(raw.quiz);
  g.challenge = normalizeResults(raw.challenge, ['runs']);
  return g;
}

// ---------- merging two devices' progress (cross-device sync) ----------

const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];
const BLOCK_RANK = { done: 2, skipped: 1 };

/** Whether card `b` was reviewed more recently than `a` (ties: more reviews, then the later due date). */
const laterCard = (a, b) => (b.lr || 0) > (a.lr || 0)
  || ((b.lr || 0) === (a.lr || 0) && ((b.r || 0) > (a.r || 0) || ((b.r || 0) === (a.r || 0) && (b.due || 0) > (a.due || 0))));

/** A card (direction or grammar) from two devices: the one with the most recent review wins whole, miss count and
 *  needs-help mark included, since they describe that same history. */
function mergeCard(a, b) {
  const w = laterCard(a, b) ? b : a;
  const pl = [a.pl, b.pl].filter((x) => x > 0);
  return { ...w, pl: pl.length ? Math.min(...pl) : 0 };
}

/** The review item with the most recent review wins whole; its best score never drops. Each extra direction
 *  (Listen, Say it) has its own schedule, so each is merged on its own. */
function mergeItem(a, b) {
  const w = laterCard(a, b) ? b : a;
  const pl = [a.pl, b.pl].filter((x) => x > 0);
  const out = { ...w, best: Math.max(a.best || 0, b.best || 0), pl: pl.length ? Math.min(...pl) : 0 };
  const dirs = {};
  for (const dir of union(Object.keys(a.dirs || {}), Object.keys(b.dirs || {}))) {
    const x = a.dirs && a.dirs[dir], y = b.dirs && b.dirs[dir];
    dirs[dir] = x && y ? mergeCard(x, y) : { ...(x || y) };
  }
  if (Object.keys(dirs).length) out.dirs = dirs; else delete out.dirs;
  return out;
}

/** Latest result wins, but personal bests and replay counts never drop. */
function mergeResults(a, b) {
  const out = { ...a };
  for (const [k, r] of Object.entries(b)) {
    const l = out[k];
    if (!l) { out[k] = r; continue; }
    const w = (r.at || 0) > (l.at || 0) ? r : l;
    out[k] = { ...w, best: Math.max(l.best || 0, r.best || 0) };
    if ('runs' in l || 'runs' in r) out[k].runs = Math.max(l.runs || 0, r.runs || 0);
  }
  return out;
}

function mergeEngine(a, b, todayKey) {
  const e = { ...a, tally: {}, recent: { ...a.recent }, mastery: { ...a.mastery } };
  for (const k of union(Object.keys(a.tally), Object.keys(b.tally))) {
    const da = a.tally[k] || {}, db = b.tally[k] || {};
    e.tally[k] = {};
    // Each device's day tally is a running count: keep the larger one (the same day synced twice must not double).
    for (const sk of union(Object.keys(da), Object.keys(db))) {
      const ta = da[sk] || [0, 0], tb = db[sk] || [0, 0];
      e.tally[k][sk] = tb[1] > ta[1] || (tb[1] === ta[1] && tb[0] > ta[0]) ? [...tb] : [...ta];
    }
  }
  for (const [sk, r] of Object.entries(b.recent)) if (r.length > (e.recent[sk] || '').length) e.recent[sk] = r;
  for (const [k, m] of Object.entries(b.mastery)) {
    const l = e.mastery[k];
    if (!l || m[2] > l[2] || (m[2] === l[2] && m[1] > l[1])) e.mastery[k] = [...m];
  }
  const pa = a.placement, pb = b.placement;
  e.placement = pa && pb ? { at: Math.max(pa.at, pb.at), lessons: union(pa.lessons, pb.lessons) } : (pa || pb || null);
  e.placementSkip = a.placementSkip || b.placementSkip;
  e.checkin = a.checkin > b.checkin ? a.checkin : b.checkin;   // ISO weeks sort as text
  prune(e, todayKey);
  return e;
}

/**
 * Mined Story lines from both devices. A line is the same line wherever its Japanese text matches. Two devices can
 * hand out the same 'mine:<n>' to different lines between syncs, so ids are reassigned deterministically: oldest
 * line first, each takes its lowest id not already taken, else a fresh number. Every device computes the same
 * answer, so syncing again changes nothing. Each line's Garden card moves with it (merged if both devices had one).
 */
function mergeMined(a, b, aItems, bItems) {
  const byJp = new Map();
  for (const [g, items] of [[a, aItems], [b, bItems]]) {
    for (const m of g.mined) {
      let e = byJp.get(m.jp);
      if (!e) byJp.set(m.jp, e = { line: m, ids: new Set(), cards: [], at: m.at || 0 });
      e.ids.add(m.id);
      if (items[m.id]) e.cards.push(items[m.id]);
      if (m.at && (!e.at || m.at < e.at)) e.at = m.at;
    }
  }
  const idNum = (id) => Number(id.slice(5));
  const lines = [...byJp.values()].sort((x, y) => x.at - y.at || (x.line.jp < y.line.jp ? -1 : x.line.jp > y.line.jp ? 1 : 0));
  const taken = new Set();
  let seq = Math.max(a.seq, b.seq, ...lines.flatMap((e) => [...e.ids].map(idNum)));
  const mined = [], cards = {}, oldIds = new Set();
  for (const e of lines) {
    e.ids.forEach((id) => oldIds.add(id));
    const id = [...e.ids].sort((x, y) => idNum(x) - idNum(y)).find((x) => !taken.has(x)) || 'mine:' + (++seq);
    taken.add(id);
    mined.push({ ...e.line, id, at: e.at });
    if (e.cards.length) cards[id] = e.cards.reduce((x, y) => mergeItem(x, y));
  }
  return { mined, seq, cards, oldIds };
}

/**
 * Merges two devices' progress without losing anything from either: `local` is this device, `remote` the copy
 * synced from another. Pure: neither input is changed. Both may be raw or older-version blobs.
 * - Review items: the copy with the most recent review wins (best score kept from both); each Listen / Say it card
 *   and each grammar card the same way, on its own, with its miss count and needs-help mark.
 * - Cleared lessons, chapters, forged kanji, course units: union.
 * - Counters (days, story replays, course tallies, skill tallies, Library readers read): the larger value.
 * - My words (v14): union; each word's Garden card merges like any other review item.
 * - Settings and the course on/off switch: this device's (they stay per device).
 */
/** Today's words as saved: { date: 'YYYY-MM-DD', ids: [...], at: ms }, or null. */
function normalizeDaily(d) {
  if (!d || typeof d !== 'object' || typeof d.date !== 'string' || !Array.isArray(d.ids)) return null;
  const ids = d.ids.filter((x) => typeof x === 'string').slice(0, 20);
  return ids.length ? { date: d.date, ids, at: Number(d.at) || 0 } : null;
}

/** The later day's set; on the same day, the set picked first, so a device that synced late takes the other's. */
function mergeDaily(x, y) {
  if (!x || !y) return x || y ? { ...(x || y), ids: [...(x || y).ids] } : null;
  const pick = x.date !== y.date ? (x.date > y.date ? x : y) : (y.at < x.at ? y : x);
  return { ...pick, ids: [...pick.ids] };
}

export function mergeProgress(local, remote, now = Date.now()) {
  const a = normalize(local), b = normalize(remote);
  const out = { ...a, v: STATE_VERSION };

  const mined = mergeMined(a.saga, b.saga, a.items, b.items);
  out.items = {};
  for (const [items, other] of [[a.items, b.items], [b.items, a.items]]) {
    for (const [id, p] of Object.entries(items)) {
      if (mined.oldIds.has(id) || out.items[id]) continue;   // mined lines' cards are placed below
      out.items[id] = other[id] ? mergeItem(p, other[id]) : { ...p };
    }
  }
  Object.assign(out.items, mined.cards);
  out.saga = {
    mined: mined.mined, seq: mined.seq,
    quiz: mergeResults(a.saga.quiz, b.saga.quiz), challenge: mergeResults(a.saga.challenge, b.saga.challenge),
  };

  out.chapters = union(a.chapters, b.chapters);
  out.forged = union(a.forged, b.forged);
  out.dojo = union(a.dojo, b.dojo);
  out.lastSession = Math.max(a.lastSession || 0, b.lastSession || 0) || null;
  out.storyReplays = { ...a.storyReplays };
  for (const [k, t] of Object.entries(b.storyReplays)) out.storyReplays[k] = Math.max(out.storyReplays[k] || 0, t || 0);

  out.days = {};
  for (const k of union(Object.keys(a.days), Object.keys(b.days))) {
    const x = a.days[k], y = b.days[k];
    if (!x || !y) { out.days[k] = JSON.parse(JSON.stringify(x || y)); continue; }
    const blocks = { ...x.blocks };
    for (const [id, st] of Object.entries(y.blocks)) if ((BLOCK_RANK[st] || 0) > (BLOCK_RANK[blocks[id]] || 0)) blocks[id] = st;
    out.days[k] = {
      ok: Math.max(x.ok, y.ok), tot: Math.max(x.tot, y.tot), rev: Math.max(x.rev, y.rev), newc: Math.max(x.newc, y.newc),
      studied: x.studied || y.studied, blocks,
    };
    for (const f of ['newd', 'newg']) { const v = Math.max(x[f] || 0, y[f] || 0); if (v) out.days[k][f] = v; }
  }

  out.engine = mergeEngine(a.engine, b.engine, dateKey(new Date(now)));

  const c = { ...a.course, reached: union(a.course.reached, b.course.reached), done: union(a.course.done, b.course.done), read: union(a.course.read, b.course.read), tally: { ...a.course.tally } };
  if (!c.current) c.current = b.course.current;
  for (const [id, t] of Object.entries(b.course.tally)) {
    const l = c.tally[id];
    if (!l || t.tot > l.tot || (t.tot === l.tot && t.ok > l.ok)) c.tally[id] = { ...t };
  }
  out.course = c;

  out.grammar = {};
  for (const key of union(Object.keys(a.grammar), Object.keys(b.grammar))) {
    const x = a.grammar[key], y = b.grammar[key];
    out.grammar[key] = x && y ? mergeCard(x, y) : { ...(x || y) };
  }

  out.coach = { ears: union(a.coach.ears, b.coach.ears) };

  // Mock results from both devices (the same mock synced twice counts once); the latest real-test mark per level;
  // recently seen questions from both; the later of two "Later" days.
  const hist = new Map();
  for (const h of [...a.exam.history, ...b.exam.history]) hist.set(`${h.level}|${h.format}|${h.at}`, h);
  const later = { ...a.exam.later };
  for (const [lv, d] of Object.entries(b.exam.later)) if (!later[lv] || d > later[lv]) later[lv] = d;
  const real = { ...a.exam.real };
  for (const [lv, r] of Object.entries(b.exam.real)) if (!real[lv] || r.at > real[lv].at) real[lv] = { ...r };
  out.messages = mergeMessages(a.messages, b.messages);
  out.library = mergeLibrary(a.library, b.library);
  out.mywords = mergeMyWords(a.mywords, b.mywords);
  out.daily = mergeDaily(a.daily, b.daily);
  out.exam = {
    history: [...hist.values()].sort((x, y) => x.at - y.at).slice(-EXAM_HISTORY_MAX).map((h) => ({ ...h, parts: { ...h.parts } })),
    real, later,
    seen: union(a.exam.seen, b.exam.seen).slice(-EXAM_SEEN_MAX),
    // The test date goal: the one set (or removed) most recently, on either device.
    goal: [a.exam.goal, b.exam.goal].filter(Boolean).sort((x, y) => y.at - x.at).map((g) => ({ ...g }))[0] || null,
  };

  out.settings = { ...a.settings };   // per device: theme, voice range, "Show every level" (v12)…
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* private mode or corrupt data: start fresh */ }
  return blank();
}

/** How sure the app is of a kana or kanji the placement check found you already know (days of stability). */
export const PLACEMENT_STABILITY = 3;

/**
 * Schedules one review of item `p` (mutated) with the FSRS-style scheduler. A miss makes it due now and never
 * lowers its growth stage; a pass grows the stage by at most one, up to what its stability supports.
 */
function schedule(p, ok, now = Date.now()) {
  const next = srs.review(p, srs.gradeOf(ok), now);
  p.s = next.s;
  p.d = next.d;
  p.lr = next.lr;
  p.due = next.due;
  if (ok) p.level = Math.max(p.level || 0, Math.min((p.level || 0) + 1, srs.stageOf(p.s)));
  return p;
}

const newItem = (now = Date.now()) => ({ level: 0, due: 0, best: 0, r: 0, pl: now, s: 0, d: 0, lr: 0 });

/**
 * Needs-help bookkeeping after a review of card `c` (mutated). Misses are counted; after HELP_AFTER the card gets the
 * help mark (shown as 🩹, never as wilting). While marked, HELP_CLEAR right answers in a row clear it and its count.
 */
function trackHelp(c, ok) {
  if (!ok) {
    c.lapses = (c.lapses || 0) + 1;
    if (c.help) delete c.ok2;
    else if (c.lapses >= HELP_AFTER) c.help = true;
    return;
  }
  if (!c.help) return;
  c.ok2 = (c.ok2 || 0) + 1;
  if (c.ok2 >= HELP_CLEAR) { delete c.help; delete c.ok2; delete c.lapses; }
}

/** Schedules a direction or grammar card (no growth stage). */
function scheduleCard(c, ok, now = Date.now()) {
  const next = srs.review(c, srs.gradeOf(ok), now);
  c.s = next.s; c.d = next.d; c.lr = next.lr; c.due = next.due;
  c.r = (c.r || 0) + 1;
  return c;
}

const listeners = new Set();
const gradeListeners = new Set();
const milestoneListeners = new Set();

class Store {
  constructor() {
    this.s = load();
    // Remember when the previous visit was, before this one overwrites it (for the welcome line).
    this.previousSession = this.s.lastSession;
    this.saveOk = true;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.s));
      this.saveOk = true;
    } catch (e) {
      this.saveOk = false;
    }
    listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
  }

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  get settings() { return this.s.settings; }
  setSetting(k, v) { this.s.settings[k] = v; this.save(); }

  // ----- days -----
  day(key = dateKey()) {
    if (!this.s.days[key]) this.s.days[key] = { ok: 0, tot: 0, rev: 0, newc: 0, studied: false, blocks: {} };
    return this.s.days[key];
  }

  /** Any graded answer anywhere. Feeds "accuracy this week". */
  log(ok) {
    const d = this.day();
    d.tot += 1;
    if (ok) d.ok += 1;
    d.studied = true;
    this.s.lastSession = Date.now();
    this.save();
  }

  markSession() {
    this.s.lastSession = Date.now();
    this.save();
  }

  markStudied() {
    this.day().studied = true;
    this.save();
  }

  setBlock(id, status) {
    const d = this.day();
    d.blocks[id] = status;
    if (status === 'done') d.studied = true;
    this.save();
    if (status === 'done') milestoneListeners.forEach((fn) => { try { fn({ block: id }); } catch (e) { /* ignore */ } });
  }

  weekAccuracy() {
    let ok = 0, tot = 0;
    const day = new Date();
    for (let i = 0; i < 7; i++) {
      // Step back by calendar day, not 24 hours, so a daylight-saving change never skips or repeats a day.
      if (i) day.setDate(day.getDate() - 1);
      const d = this.s.days[dateKey(day)];
      if (d) { ok += d.ok; tot += d.tot; }
    }
    return { ok, tot, rate: tot ? ok / tot : null };
  }

  daysStudiedThisMonth() {
    const prefix = dateKey().slice(0, 7);
    return Object.entries(this.s.days).filter(([k, d]) => k.startsWith(prefix) && d.studied).length;
  }

  // ----- skill model -----
  /**
   * Records one graded action for the skill model: `skill` is one of SKILLS, `id` the item it was about (optional),
   * `ok` whether it was right, `firstTry` false for a retry after a miss. First tries feed the per-skill daily
   * tallies, the recent results that difficulty targeting reads, and per-item mastery (skills.js). Callers still
   * use log()/recordReview()/recordDojo()/... for scheduling and daily accuracy. Every call is emitted to onGrade().
   */
  grade({ skill, id = null, ok, firstTry = true } = {}) {
    if (!SKILLS.includes(skill)) return;
    const ev = { skill, id, ok: !!ok, firstTry: !!firstTry, at: Date.now() };
    recordGrade(this.s.engine, ev, dateKey());
    this.save();
    gradeListeners.forEach((fn) => { try { fn(ev); } catch (e) { /* ignore */ } });
  }

  get engine() { return this.s.engine; }

  /** First-try accuracy per skill over calendar days fromKey..toKey (inclusive): { skill: { ok, tot, rate } }. */
  skillDays(fromKey, toKey) {
    const from = dayNumber(fromKey), to = dayNumber(toKey);
    const out = {};
    for (const sk of SKILLS) out[sk] = { ok: 0, tot: 0, rate: null };
    for (const [k, day] of Object.entries(this.s.engine.tally)) {
      const n = dayNumber(k);
      if (n < from || n > to) continue;
      for (const [sk, t] of Object.entries(day)) { if (out[sk]) { out[sk].ok += t[0]; out[sk].tot += t[1]; } }
    }
    for (const sk of SKILLS) out[sk].rate = out[sk].tot ? out[sk].ok / out[sk].tot : null;
    return out;
  }

  /** New garden words allowed today: at most DAILY_NEW_CAP, fewer on the gentle pace or while accuracy is low. */
  newCap() { return Math.min(DAILY_NEW_CAP, newPerDay(this.s.engine, this.s.settings)); }

  // ----- placement check -----
  skipPlacement() { this.s.engine.placementSkip = true; this.save(); }

  /**
   * Marks Reading Dojo lessons the placement check found you know: clears them (never un-clears anything) and
   * seeds their characters as learned with a modest stability, due over the next week. Existing items are left
   * alone. Returns the lesson ids that were newly cleared.
   */
  applyPlacement(lessonIds, now = Date.now()) {
    const added = [];
    let n = 0;
    for (const id of lessonIds) {
      const l = LESSON_BY_ID[id];
      if (!l) continue;
      if (!this.s.dojo.includes(id)) { this.s.dojo.push(id); added.push(id); }
      const ids = l.chars ? l.chars.map((c) => 'kana:' + c.k) : (l.kanji || []).map((j) => 'kj:' + j.k);
      for (const cid of ids) {
        if (this.s.items[cid]) continue;
        const s = PLACEMENT_STABILITY;
        this.s.items[cid] = { level: srs.stageOf(s), due: now + (2 + (n++ % 5)) * DAY, best: 0, r: 1, pl: now, s, d: 5, lr: now };
      }
    }
    const prev = this.s.engine.placement ? this.s.engine.placement.lessons : [];
    this.s.engine.placement = { at: now, lessons: [...new Set([...prev, ...lessonIds.filter((x) => LESSON_BY_ID[x])])] };
    this.save();
    return added;
  }

  // ----- weekly check-in -----
  markCheckin(week) { this.s.engine.checkin = week; this.save(); }

  /** Listen to every graded action (e.g. a course unit counting its practice). Returns an unsubscribe function. */
  onGrade(fn) { gradeListeners.add(fn); return () => gradeListeners.delete(fn); }

  // ----- review items -----
  item(id) { return this.s.items[id]; }
  progress(id) { return this.s.items[id] || newItem(0); }
  level(phrase) { return this.progress(phrase.id).level; }
  isDue(phrase, now = Date.now()) { return this.progress(phrase.id).due <= now; }

  /** Adds a word to the garden the first time it's met. Does nothing if it's already planted. */
  plant(id) {
    if (this.s.items[id]) return;
    this.s.items[id] = newItem();
    this.save();
  }

  /** Garden review: a pass grows the plant and waters it until its next due date (when recall drops to ~90%). */
  recordReview(id, ok) {
    const p = this.s.items[id] || newItem();
    const wasNew = !p.r;
    schedule(p, ok);
    trackHelp(p, ok);
    p.r = (p.r || 0) + 1;
    this.s.items[id] = p;
    const d = this.day();
    d.rev += 1;
    if (wasNew) d.newc += 1;
    this.log(ok);
  }

  /**
   * Words missed in a recap quiz come back sooner: a planted one is due again by tomorrow at the latest, and a Garden
   * word not planted yet is planted (so it joins the new words). Levels and stability are never lowered.
   */
  recapMissed(ids, now = Date.now()) {
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 0, 0, 0);
    let changed = false;
    for (const id of ids) {
      if (!this.catalogItem(id)) continue;
      const p = this.s.items[id];
      if (!p) { this.s.items[id] = newItem(now); changed = true; }
      else if (p.due > tomorrow.getTime()) { p.due = tomorrow.getTime(); changed = true; }
    }
    if (changed) this.save();
  }

  clearChapter(id) {
    if (!this.s.chapters.includes(id)) this.s.chapters.push(id);
    this.save();
  }
  noteReplay(id) { this.s.storyReplays[id] = Date.now(); this.save(); }
  get clearedChapters() { return new Set(this.s.chapters); }

  forge(kanji) {
    if (!this.s.forged.includes(kanji)) this.s.forged.push(kanji);
    this.save();
  }
  get forgedKanji() { return new Set(this.s.forged); }

  /** Due phrases first (oldest due first), boss levels only after the basics have been seen. */
  queue() {
    const now = Date.now();
    // Only phrases of unlocked levels (an N4 phrase already planted keeps its review, though: nothing is taken away).
    const open = PHRASES.filter((p) => itemOpen(p) || this.s.items[p.id]);
    const seenBasics = open.filter((p) => !p.isBoss && this.s.items[p.id]).length;
    const pool = open.filter((p) => !p.isBoss || seenBasics >= 6);
    const byDue = (a, b) => this.progress(a.id).due - this.progress(b.id).due;
    const due = pool.filter((p) => this.isDue(p, now)).sort(byDue);
    return due.length ? due : pool.slice().sort(byDue);
  }

  /** Rhythm result. A pass moves the phrase up a level and schedules it further out. */
  recordRhythm(phrase, score) {
    const p = { ...this.progress(phrase.id) };
    if (!p.pl) p.pl = Date.now();
    p.best = Math.max(p.best, score);
    schedule(p, score >= 0.8);
    this.s.items[phrase.id] = p;
    this.log(score >= 0.8);
  }

  /** Speak Slice / Pitch Duel result. A miss brings the phrase back today; a hit leaves its schedule alone. */
  recordSlice(phrase, hit) {
    const p = { ...this.progress(phrase.id) };
    if (!p.pl) p.pl = Date.now();
    if (!hit) p.due = Date.now();
    this.s.items[phrase.id] = p;
    this.log(hit);
  }

  // ----- garden -----
  /** The Garden card for a progress id: the built-in catalog, a line the learner mined in Story, or one of My words. */
  catalogItem(id) {
    if (GARDEN_CATALOG[id]) return GARDEN_CATALOG[id];
    if (id.startsWith('my:')) {
      const w = this.s.mywords[id.slice(3)];
      // Like a mined line, it has no voice clip, so it's asked by meaning only (mined: true).
      return w ? { id, jp: id.slice(3), reading: w.r, en: w.en, mined: true, my: true } : null;
    }
    if (!id.startsWith('mine:')) return null;
    const m = this.s.saga.mined.find((x) => x.id === id);
    return m ? { id: m.id, jp: m.jp, reading: m.reading, en: m.en, mined: true } : null;
  }

  planted() {
    return Object.entries(this.s.items)
      .filter(([id]) => this.catalogItem(id))
      .map(([id, prog]) => ({ item: this.catalogItem(id), prog }))
      .sort((a, b) => a.prog.due - b.prog.due);
  }

  thirsty(now = Date.now()) { return this.planted().filter((p) => p.prog.due <= now).map((p) => p.item); }

  /** New words not yet planted that today's watering would introduce, in order (starter phrases, the N5 deck, then the N4 and N3 decks once unlocked). */
  freshWords(limit) {
    const plants = this.planted();
    const fresh = plants.filter((p) => !p.prog.r && p.prog.due <= Date.now())
      // New plants oldest first, except lines the learner mined themselves, which come first.
      .sort((a, b) => (b.item.mined ? 1 : 0) - (a.item.mined ? 1 : 0) || (a.prog.pl || 0) - (b.prog.pl || 0)).map((p) => p.item);
    // If fewer than 5 planted words are waiting, introduce starter phrases in order, then the N5 deck in order.
    if (fresh.length < limit) {
      for (const ph of PHRASES) {
        if (fresh.length >= limit) break;
        if (!ph.isBoss && ph.level === 'N5' && !this.s.items[ph.id]) fresh.push(GARDEN_CATALOG[ph.id]);
      }
    }
    fresh.length = Math.min(fresh.length, Math.max(0, limit));
    // Skip deck words already growing under another id (met in Story, Kanji Forge or the starter phrases).
    const known = new Set(plants.map((p) => p.item.jp).concat(fresh.map((f) => f.jp)));
    // A word's partner (男 → 女, js/pairs.js) comes in the same day, even one past the limit, so pairs stay together.
    let extra = 0;
    const addPartner = (item) => {
      const p = partnerOf(item.jp);
      if (!p || !itemOpen(p) || this.s.items[p.id] || known.has(p.jp) || !GARDEN_CATALOG[p.id]) return;
      if (fresh.length >= limit) extra += 1;
      fresh.push(GARDEN_CATALOG[p.id]);
      known.add(p.jp);
    };
    fresh.slice().forEach(addPartner);
    if (fresh.length < limit) {
      // Then the N4 deck, once N4 is unlocked, and the N3 deck once N3 is (js/levels.js).
      for (const w of [...N5_WORDS, ...N4_WORDS.filter(itemOpen), ...N3_WORDS.filter(itemOpen)]) {
        if (fresh.length >= limit) break;
        if (!this.s.items[w.id] && !known.has(w.jp)) { fresh.push(GARDEN_CATALOG[w.id]); known.add(w.jp); addPartner(w); }
      }
    }
    return limit > 0 ? fresh.slice(0, limit + extra) : [];
  }

  /**
   * Every card due now, as Garden cards: a word's normal card ({ kind: 'word', dir: 'mean' }), its Listen and Say it
   * cards (dir: 'listen' | 'say') and grammar cards ({ kind: 'gram' }). `reviewed`: only ones seen before.
   */
  dueCards(now = Date.now(), { reviewed = true } = {}) {
    const out = [];
    for (const { item, prog } of this.planted()) {
      if (prog.due <= now && (!reviewed || prog.r)) out.push({ kind: 'word', dir: 'mean', id: item.id, item, due: prog.due, help: !!prog.help });
      for (const [dir, c] of Object.entries(prog.dirs || {})) {
        if (c.due <= now && (!reviewed || c.r)) out.push({ kind: 'word', dir, id: item.id, item, due: c.due, help: !!c.help });
      }
    }
    for (const [key, c] of Object.entries(this.s.grammar)) {
      if (c.due <= now && (!reviewed || c.r) && isCardKey(key)) out.push({ kind: 'gram', id: key, due: c.due, help: !!c.help });
    }
    return out.sort((a, b) => a.due - b.due);
  }

  /** Words grown enough (stage DIRECTION_STAGE) for a Listen or Say it card they don't have yet, oldest first. */
  directionCandidates() {
    const out = [];
    // Not while a word needs help: it gets its new directions once it's steady again.
    const plants = this.planted().filter(({ item, prog }) => prog.level >= DIRECTION_STAGE && !item.mined && !this.wordNeedsHelp(item.id))
      .sort((a, b) => (a.prog.pl || 0) - (b.prog.pl || 0));
    // One new direction per word at a time: Listen first (the easier one), Say it once Listen is under way. Words
    // whose next step is Listen come first, so a day's few spread over different words.
    for (const pass of DIRECTIONS) {
      for (const { item, prog } of plants) {
        const next = DIRECTIONS.find((dir) => !(prog.dirs && prog.dirs[dir]));
        if (next === pass) out.push({ kind: 'word', dir: next, id: item.id, item, due: 0, isNew: true });
      }
    }
    return out;
  }

  /** New grammar cards waiting to be introduced, in the order they were planted. */
  freshGrammar() {
    return Object.entries(this.s.grammar).filter(([key, c]) => !c.r && isCardKey(key))
      .sort((a, b) => a[1].pl - b[1].pl).map(([key]) => ({ kind: 'gram', id: key, due: 0, isNew: true }));
  }

  /**
   * Today's garden queue: due reviews of every kind (most overdue first), then new cards: at most 5 new words, 2 new
   * grammar cards and 3 new Listen / Say it cards a day (fewer while accuracy is low), all within one daily cap, so a
   * backlog after a break never piles up. The rest simply wait.
   */
  dailyGardenQueue(cap = DAILY_REVIEW_CAP) {
    const d = this.day();
    const remaining = Math.max(0, cap - d.rev);
    const reviews = this.dueCards();
    const q = reviews.slice(0, remaining);
    let slots = remaining - q.length;
    const take = (list, n) => { const got = list.slice(0, Math.max(0, Math.min(n, slots))); slots -= got.length; return got; };
    const words = take(this.freshWords(Math.max(0, this.newCap() - d.newc)).map((item) => ({ kind: 'word', dir: 'mean', id: item.id, item, due: 0, isNew: true })), Infinity);
    const gram = take(this.freshGrammar(), Math.max(0, newGrammarPerDay(this.s.engine) - (d.newg || 0)));
    const dirs = take(this.directionCandidates(), Math.max(0, newDirsPerDay(this.s.engine) - (d.newd || 0)));
    return { queue: q.concat(words, gram, dirs), waiting: Math.max(0, reviews.length - q.length), remaining };
  }

  // ----- review cards in other directions, grammar cards, needs help -----
  /** The saved state of a Garden card (a word's normal card is the item itself). */
  cardState(card) {
    if (card.kind === 'gram') return this.s.grammar[card.id] || null;
    const p = this.s.items[card.id];
    if (!p) return null;
    return card.dir === 'mean' ? p : (p.dirs && p.dirs[card.dir]) || null;
  }

  /**
   * Records one review of a Garden card of any kind: schedules it, counts it toward today's reviews (and today's new
   * cards of its kind the first time), and keeps the needs-help count. Grades go through store.grade as before.
   */
  reviewCard(card, ok, now = Date.now()) {
    if (card.kind === 'word' && card.dir === 'mean') {
      this.recordReview(card.id, ok);
      this.grade({ skill: 'vocab', id: card.id, ok });
      return;
    }
    let c;
    const d = this.day();
    if (card.kind === 'gram') {
      c = this.s.grammar[card.id] || (this.s.grammar[card.id] = newCard(now));
      if (!c.r) d.newg = (d.newg || 0) + 1;
    } else {
      const p = this.s.items[card.id] || (this.s.items[card.id] = newItem(now));
      p.dirs = p.dirs || {};
      c = p.dirs[card.dir] || (p.dirs[card.dir] = newCard(now));
      if (!c.r) d.newd = (d.newd || 0) + 1;
    }
    scheduleCard(c, ok, now);
    trackHelp(c, ok);
    d.rev += 1;
    this.log(ok);
    const skill = card.kind === 'gram' ? 'grammar' : card.dir === 'say' ? 'speaking' : 'listening';
    this.grade({ skill, id: card.kind === 'gram' ? card.id : `${card.dir}:${card.id}`, ok });
  }

  /** Plants a grammar card (a course grammar point or a conjugation form). Does nothing if it's already planted. */
  plantGrammar(key, now = Date.now()) {
    if (this.s.grammar[key] || !isCardKey(key)) return false;
    this.s.grammar[key] = newCard(now);
    this.save();
    return true;
  }

  /** Plants the grammar cards of a course unit (when its lesson is read, or the unit is done). */
  plantUnitGrammar(unitId, now = Date.now()) {
    let n = 0;
    for (const key of unitCardKeys(unitId)) {
      if (this.s.grammar[key]) continue;
      this.s.grammar[key] = newCard(now + n++);
    }
    if (n) this.save();
    return n;
  }

  /**
   * Grammar cards due now that have been reviewed at least once, most overdue first: [{ key, due, help }].
   * For other modes (a Rival Battle, say) to draw on; record their results with reviewGrammar().
   */
  dueGrammar(now = Date.now(), limit = Infinity) {
    return Object.entries(this.s.grammar).filter(([key, c]) => c.r && c.due <= now && isCardKey(key))
      .sort((a, b) => a[1].due - b[1].due).slice(0, limit).map(([key, c]) => ({ key, due: c.due, help: !!c.help }));
  }

  /** One grammar card result from any mode: scheduled like a Garden review. */
  reviewGrammar(key, ok, now = Date.now()) {
    if (!this.s.grammar[key] && !isCardKey(key)) return;
    this.reviewCard({ kind: 'gram', id: key }, ok, now);
  }

  /** Every card with the needs-help mark, for the Garden's "Needs help" practice. */
  helpCards() {
    const out = [];
    for (const { item, prog } of this.planted()) {
      if (prog.help) out.push({ kind: 'word', dir: 'mean', id: item.id, item, due: prog.due, help: true });
      for (const [dir, c] of Object.entries(prog.dirs || {})) if (c.help) out.push({ kind: 'word', dir, id: item.id, item, due: c.due, help: true });
    }
    for (const [key, c] of Object.entries(this.s.grammar)) if (c.help && isCardKey(key)) out.push({ kind: 'gram', id: key, due: c.due, help: true });
    return out;
  }

  /** Whether a word (any of its cards) is marked as needing help: a 🩹 on its plant. */
  wordNeedsHelp(id) {
    const p = this.s.items[id];
    return !!(p && (p.help || Object.values(p.dirs || {}).some((c) => c.help)));
  }

  // ----- story saga: line mining and chapter results -----
  get mined() { return this.s.saga.mined; }

  /** Today's words as picked (js/daily-words.js): { date, ids, at } or null. */
  get daily() { return this.s.daily; }
  setDaily(date, ids, now = Date.now()) {
    this.s.daily = { date, ids: ids.slice(), at: now };
    this.save();
  }

  /** Saves a pasted line as a Garden card (planted, due now). Returns its id. */
  mineLine({ jp, reading, en, parts = [] }) {
    const g = this.s.saga;
    g.seq += 1;
    const id = 'mine:' + g.seq;
    g.mined.push({ id, jp, reading, en, parts, at: Date.now() });
    this.s.items[id] = { level: 0, due: 0, best: 0, r: 0, pl: Date.now() };
    this.save();
    return id;
  }

  // ----- My words (Manga Reader) -----
  get myWords() {
    return Object.entries(this.s.mywords).map(([jp, w]) => ({ id: myWordId(jp), jp, reading: w.r, en: w.en, at: w.at })).sort((a, b) => b.at - a.at);
  }

  /** Keeps a word as one of My words and plants its Garden card (due now, as a new word). Returns its id. */
  addMyWord({ jp, reading = '', en = '' }) {
    jp = String(jp).trim().slice(0, 40);
    if (!jp) return null;
    const id = myWordId(jp);
    if (!this.s.mywords[jp]) {
      if (Object.keys(this.s.mywords).length >= MYWORD_MAX) return null;
      this.s.mywords[jp] = { r: String(reading).slice(0, 80), en: String(en).slice(0, 200), at: Date.now() };
    }
    if (!this.s.items[id]) this.s.items[id] = { level: 0, due: 0, best: 0, r: 0, pl: Date.now() };
    this.save();
    return id;
  }

  /** Removes one of My words and its Garden card. */
  deleteMyWord(id) {
    if (!id.startsWith('my:')) return;
    delete this.s.mywords[id.slice(3)];
    delete this.s.items[id];
    this.save();
  }

  /** Removes a mined line and its Garden card. */
  deleteMined(id) {
    const g = this.s.saga;
    g.mined = g.mined.filter((m) => m.id !== id);
    if (id.startsWith('mine:')) delete this.s.items[id];
    this.save();
  }

  /** Comprehension questions for a chapter (or its no-furigana challenge replay): remembers the latest and best. */
  recordStoryQuiz(chapterId, ok, tot, { challenge = false } = {}) {
    const book = challenge ? this.s.saga.challenge : this.s.saga.quiz;
    const prev = book[chapterId] || { best: 0, runs: 0 };
    const e = { ok, tot, best: Math.max(prev.best || 0, ok), at: Date.now() };
    if (challenge) e.runs = (prev.runs || 0) + 1;
    book[chapterId] = e;
    this.save();
  }
  storyResult(chapterId) {
    return { quiz: this.s.saga.quiz[chapterId] || null, challenge: this.s.saga.challenge[chapterId] || null };
  }

  // ----- reading dojo -----
  clearLesson(id) {
    if (!this.s.dojo.includes(id)) this.s.dojo.push(id);
    this.markStudied();
  }
  get clearedLessons() { return new Set(this.s.dojo); }
  trackDone(track) {
    const cleared = this.clearedLessons;
    return ALL_LESSONS.filter((l) => l.track === track).every((l) => cleared.has(l.id));
  }
  /** First lesson not yet cleared, in course order (hiragana, katakana, kanji, then N4 and N3 kanji once unlocked). */
  nextLesson() {
    const cleared = this.clearedLessons;
    return ALL_LESSONS.find((l) => !cleared.has(l.id) && itemOpen(l)) || null;
  }

  /** Dojo review: same scheduler as the garden, but kept out of the garden's daily cap. */
  recordDojo(id, ok, { firstTime = false } = {}) {
    const p = this.s.items[id] || newItem();
    schedule(p, ok);
    // A miss comes back soon, without knocking the level down (no punishment, just more practice).
    if (!ok && firstTime) p.due = Date.now() + DAY / 2;
    p.r = (p.r || 0) + 1;
    this.s.items[id] = p;
    this.log(ok);
  }

  // ----- Kana Brush: drawing cards on Reading Dojo kana -----
  /** A kana's drawing card (items['kana:<k>'].dirs.draw), or null if it was never drawn. */
  brushCard(kana) {
    const p = this.s.items['kana:' + kana];
    return (p && p.dirs && p.dirs.draw) || null;
  }

  /**
   * Records one drawing of a kana met in the Reading Dojo: the same scheduler and rules as the Dojo's reading review
   * (a first-time miss comes back in half a day, nothing is ever knocked down), on the kana's own drawing card.
   */
  recordBrush(kana, ok, now = Date.now()) {
    const p = this.s.items['kana:' + kana];
    if (!p) return null;
    p.dirs = p.dirs || {};
    const c = p.dirs.draw || (p.dirs.draw = newCard(now));
    const firstTime = !c.r;
    scheduleCard(c, ok, now);
    trackHelp(c, ok);
    if (!ok && firstTime) c.due = now + DAY / 2;
    this.log(ok);
    return c;
  }

  /** Kana whose drawing card is due again, most overdue first (as kana, not ids). */
  brushDue(now = Date.now()) {
    return Object.entries(this.s.items)
      .filter(([id, p]) => id.startsWith('kana:') && p.dirs && p.dirs.draw && p.dirs.draw.due <= now)
      .sort((a, b) => a[1].dirs.draw.due - b[1].dirs.draw.due)
      .map(([id]) => id.slice(5));
  }

  /** Learned kana and kanji that are due again, most overdue first. */
  dojoDue(now = Date.now()) {
    return Object.entries(this.s.items)
      .filter(([id, p]) => (id.startsWith('kana:') || id.startsWith('kj:')) && p.due <= now)
      .sort((a, b) => a[1].due - b[1].due)
      .map(([id]) => id);
  }

  // ----- story plan -----
  nextChapter() {
    const cleared = this.clearedChapters;
    const open = CHAPTERS.filter(itemOpen);
    const next = open.find((c) => !cleared.has(c.id));
    if (next) return { chapter: next, replay: false };
    // All cleared: replay the one revisited longest ago (rotating), furigana off.
    const sorted = open.filter((c) => cleared.has(c.id)).sort((a, b) => (this.s.storyReplays[a.id] || 0) - (this.s.storyReplays[b.id] || 0));
    return { chapter: sorted[0], replay: true };
  }

  // ----- export / import -----
  exportJSON() {
    return JSON.stringify({ app: 'kotoba-beat', exported: new Date().toISOString(), data: this.s }, null, 1);
  }

  exportCode() {
    const json = JSON.stringify(this.s);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'KOTOBA1:' + btoa(bin);
  }

  /** Accepts a KOTOBA1: code, an exported .json, or raw state JSON. Returns the parsed state (not applied). */
  parseImport(text) {
    text = String(text || '').trim();
    let obj;
    if (text.startsWith('KOTOBA1:')) {
      const bin = atob(text.slice(8).replace(/\s+/g, ''));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      obj = JSON.parse(new TextDecoder().decode(bytes));
    } else {
      obj = JSON.parse(text);
      if (obj && obj.app === 'kotoba-beat' && obj.data) obj = obj.data;
    }
    if (!obj || typeof obj !== 'object' || typeof obj.items !== 'object') throw new Error('This does not look like Kotoba Beat progress.');
    return normalize(obj);
  }

  applyImport(state) {
    this.s = normalize(state);
    this.save();
  }

  // ----- cross-device sync (js/sync.js) -----
  /** The progress to share with other devices: everything except this device's settings. */
  syncData() {
    const { settings, ...rest } = this.s;
    return rest;
  }

  /**
   * Puts merged progress in place, keeping this device's settings. Top-level objects and arrays are updated in
   * place, so a screen that holds one (the Garden's items, the saga) keeps seeing current data.
   */
  applySynced(state) {
    const next = normalize(state);
    next.settings = this.s.settings;
    for (const [k, nv] of Object.entries(next)) {
      const cur = this.s[k];
      if (Array.isArray(cur) && Array.isArray(nv)) cur.splice(0, cur.length, ...nv);
      else if (cur && nv && typeof cur === 'object' && typeof nv === 'object' && !Array.isArray(cur) && !Array.isArray(nv) && cur !== nv) {
        for (const x of Object.keys(cur)) delete cur[x];
        Object.assign(cur, nv);
      } else this.s[k] = nv;
    }
    this.save();
  }

  // ----- Pitch Coach -----
  /** The learner's voice range on this device ({ mid, lo, hi, n }), or null before the first attempt. */
  get voice() { return this.s.settings.voice; }
  setVoice(v) { this.s.settings.voice = v ? normalizeVoice(v) : null; this.save(); }
  /** Whether a word's "where does the pitch drop?" warm-up is done (it comes first in its first Pitch Coach). */
  earsDone(id) { return this.s.coach.ears.includes(id); }
  markEars(id) { if (id && !this.s.coach.ears.includes(id)) { this.s.coach.ears.push(id); this.save(); } }

  // ----- Ren's Messages (js/messages.js) -----
  get messages() { return this.s.messages.thread; }

  // ----- Ren's monthly letters (js/letters.js) -----
  get letters() { return this.s.messages.letters; }
  addLetter(letter) {
    if (this.s.messages.letters.some((l) => l.month === letter.month)) return;
    this.s.messages.letters = normalizeLetters([...this.s.messages.letters, letter]);
    this.save();
  }
  markLetterRead(month) {
    const l = this.s.messages.letters.find((x) => x.month === month);
    if (l && !l.read) { l.read = true; this.save(); }
  }

  // ----- library -----
  /** A Library reader's record ({ n, at, q, qt }), or null if it hasn't been read to the end. */
  readerResult(id) { return this.s.library.read[id] || null; }
  /** A reader finished: one more read, and its best question score. */
  finishReader(id, q = 0, qt = 0, now = Date.now()) {
    const r = this.s.library.read[id] || { n: 0, at: 0, q: 0, qt: 0 };
    r.n += 1;
    r.at = now;
    if (qt > r.qt || (qt === r.qt && q > r.q)) { r.q = q; r.qt = qt; }
    this.s.library.read[id] = r;
    this.markStudied();
    this.save();
  }
  /** Adds a message that just arrived (at most one a day is the caller's rule; js/messages.js keeps it). */
  deliverMessage(id, now = Date.now()) {
    const day = dateKey(new Date(now));
    if (this.s.messages.thread.some((e) => e.id === id && e.day === day)) return;
    this.s.messages.thread.push({ id, day, at: now, reply: null, ok: null });
    this.s.messages.thread = this.s.messages.thread.slice(-MESSAGES_MAX);
    this.save();
  }
  /** The thread entry for a message (the latest copy, for welcome-back notes that can come more than once). */
  messageEntry(id) { return [...this.s.messages.thread].reverse().find((e) => e.id === id) || null; }
  answerMessage(id, ok) {
    const e = this.messageEntry(id);
    if (!e || e.ok != null) return;
    e.ok = !!ok;
    this.log(ok);
  }
  replyMessage(id, index) {
    const e = this.messageEntry(id);
    if (!e || e.reply != null) return;
    e.reply = index;
    this.markStudied();
  }

  // ----- mock JLPT (js/exam.js, js/readiness.js) -----
  get exam() { return this.s.exam; }

  /** Levels done: a full mock passed, or the real test marked as passed. */
  examDone() {
    const done = new Set(this.s.exam.history.filter((h) => h.format === 'full' && h.pass).map((h) => h.level));
    for (const [lv, r] of Object.entries(this.s.exam.real)) { if (r.on) done.add(lv); }
    return done;
  }

  /** Saves a finished mock and remembers its questions as seen. */
  recordMock(result, ids = [], now = Date.now()) {
    const e = this.s.exam;
    e.history.push({ ...result, at: now });
    e.history = e.history.slice(-EXAM_HISTORY_MAX);
    e.seen = [...e.seen.filter((x) => !ids.includes(x)), ...ids].slice(-EXAM_SEEN_MAX);
    this.markStudied();
  }

  /** "I passed the real test" (on) or taking that back (off). */
  markRealPass(level, on, now = Date.now()) {
    if (!LEVEL_RE.test(level)) return;
    this.s.exam.real[level] = { on: !!on, at: now };
    this.save();
  }

  /** The test date goal (js/planner.js), or null when none is set. */
  get goal() { const g = this.s.exam.goal; return g && g.level ? g : null; }

  /** Sets the test date goal: a level, the test day ('YYYY-MM-DD') and study days a week. Its checkpoints start today. */
  setGoal({ level, date, days }, now = new Date()) {
    this.s.exam.goal = normalizeGoal({ level, date, days, from: dateKey(now), at: now.getTime() });
    this.save();
  }

  /** Removes the test date goal (kept as a removal, so it syncs). */
  clearGoal(now = Date.now()) {
    const g = this.s.exam.goal;
    this.s.exam.goal = { level: null, date: null, days: g ? g.days : 5, from: dateKey(new Date(now)), at: now };
    this.save();
  }

  /** Hides "ready for a mock" for a level until `days` days from now. */
  examLater(level, days = 7, now = new Date()) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    this.s.exam.later[level] = dateKey(d);
    this.save();
  }

  /** Milestones worth syncing right away (a Today block finished). Returns an unsubscribe function. */
  onMilestone(fn) { milestoneListeners.add(fn); return () => milestoneListeners.delete(fn); }

  resetAll() {
    const settings = this.s.settings;
    this.s = blank();
    this.s.settings = settings;
    this.save();
  }
}

export const store = new Store();
export { PHRASE_BY_ID };

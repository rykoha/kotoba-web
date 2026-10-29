// Exam readiness: how close the learner is to a mock JLPT, for the next level they haven't done yet. A level is done
// once a full mock is passed or the real test is marked as passed (store.examDone), and then the next level's meter
// takes its place, so only tests still ahead are shown. Shown on Today (a small card) and on Progress (the details).
//
// N5 readiness reads what the app already tracks, each area filling toward a target:
//   Vocabulary  N5 deck words at the Seedling stage or later (the same "known" as Progress)
//   Kanji       kanji learned in the Reading Dojo or forged, out of the ones the app teaches
//   Grammar     N5 course grammar points whose Garden card has held for a week or more
//   Listening   first-try listening accuracy over the last 4 weeks, once there are enough answers
//   Reading     kana learned, and Story chapters cleared
// N4 readiness (once N5 is done) has the same five areas on the N4 content: the N4 deck, the N4 kanji, the N4 course
// grammar, listening, and the N4 Story arc with the N4 kanji lessons (N4_TARGETS). N3 (once N4 is done) does the same
// on the N3 deck, the N3 kanji lessons, the Phase 3 grammar, listening and the seven N3 Story chapters with their
// reading passages (N3_TARGETS).
// "Ready for a mock" comes when the areas average 90% of their targets and none is under 60%. A mock is optional
// practice: the mini mock is open any time, and nothing is locked.
import { store, dateKey } from './store.js';
import { N5_WORDS, N4_WORDS, N3_WORDS, KANJI, CHAPTERS } from './data.js';
import { LESSONS, KANJI_LESSONS, N4_KANJI_LESSONS, N3_KANJI_LESSONS } from './dojo-data.js';
import { UNITS } from './course-data.js';
import { LEVELS, MOCK_LEVELS, N5_GRAMMAR_KEYS, N4_GRAMMAR_KEYS, N3_GRAMMAR_KEYS, SCORING, scoreSections } from './exam-data.js';
import { esc } from './ui.js';

export const N5_TARGETS = {
  vocab: 0.75,          // share of the N5 deck known
  kanji: 0.8,           // share of the kanji the app teaches
  grammar: 0.8,         // share of the N5 grammar points held
  grammarDays: 7,       // a grammar card "holds" once its stability reaches this (about two good reviews)
  listening: 0.8,       // first-try listening accuracy
  listeningAnswers: 40, // answers needed before the accuracy counts in full
  chapters: 6,          // Story chapters cleared
};
export const READY_AVERAGE = 0.9;
export const READY_FLOOR = 0.6;

const pct = (x) => `${Math.round(x * 100)}%`;
const clamp = (x) => Math.max(0, Math.min(1, x));

/** The kanji the app teaches (Reading Dojo starter kanji and Kanji Forge). */
export const TEACHABLE_KANJI = [...new Set([...KANJI_LESSONS.flatMap((l) => l.kanji.map((j) => j.k)), ...KANJI.filter((k) => k.level === 'N5').map((k) => k.kanji)])];
/** The N4 kanji the app teaches (N4 Reading Dojo lessons and N4 Kanji Forge). */
export const TEACHABLE_KANJI_N4 = [...new Set([...N4_KANJI_LESSONS.flatMap((l) => l.kanji.map((j) => j.k)), ...KANJI.filter((k) => k.level === 'N4').map((k) => k.kanji)])];

/** N4 targets, like N5's: the N4 deck, the N4 kanji, the N4 course grammar, listening and the N4 story arc. */
export const N4_TARGETS = {
  vocab: 0.75,          // share of the N4 deck known
  kanji: 0.8,           // share of the N4 kanji the app teaches
  grammar: 0.8,         // share of the N4 grammar points held
  grammarDays: 7,
  listening: 0.8,       // first-try listening accuracy (N4 scenes count toward it once open)
  listeningAnswers: 60,
  chapters: 5,          // N4 Story chapters cleared (the whole Journey arc)
};

/**
 * N3 targets: the N3 deck (it's big, so a smaller share), the N3 kanji lessons, the Phase 3 grammar, listening, and the
 * seven chapters of the N3 Story arc (each with its reading passages).
 */
export const N3_TARGETS = {
  vocab: 0.6,           // share of the N3 deck known
  kanji: 0.75,          // share of the N3 kanji lessons' kanji learned (or forged)
  grammar: 0.8,         // share of the N3 grammar points held
  grammarDays: 7,
  listening: 0.8,       // first-try listening accuracy
  listeningAnswers: 80,
  chapters: 7,          // N3 Story chapters cleared (the whole Rivals arc and its reading passages)
};
/** The N3 kanji the app teaches (N3 Reading Dojo lessons and N3 Kanji Forge). */
export const TEACHABLE_KANJI_N3 = [...new Set([...N3_KANJI_LESSONS.flatMap((l) => l.kanji.map((j) => j.k)), ...KANJI.filter((k) => k.level === 'N3').map((k) => k.kanji)])];

export function n5Areas(now = new Date()) {
  const items = store.s.items;
  const known = new Set(store.planted().filter((p) => p.prog.level >= 2).map((p) => p.item.jp));
  const vocabN = N5_WORDS.filter((w) => known.has(w.jp)).length;
  const vocabT = Math.round(N5_WORDS.length * N5_TARGETS.vocab);

  const learned = (id) => items[id] && items[id].level >= 1;
  const kanjiN = TEACHABLE_KANJI.filter((k) => learned('kj:' + k) || store.forgedKanji.has(k)).length;
  const kanjiT = Math.round(TEACHABLE_KANJI.length * N5_TARGETS.kanji);

  const g = store.s.grammar;
  const gramN = N5_GRAMMAR_KEYS.filter((k) => g[k] && g[k].r && g[k].s >= N5_TARGETS.grammarDays && !g[k].help).length;
  const gramT = Math.round(N5_GRAMMAR_KEYS.length * N5_TARGETS.grammar);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 27);
  const lis = store.skillDays(dateKey(from), dateKey(today)).listening;
  const lisVal = lis.tot ? clamp(lis.tot / N5_TARGETS.listeningAnswers) * clamp(lis.rate / N5_TARGETS.listening) : 0;

  const kana = LESSONS.flatMap((l) => l.chars.map((c) => c.k));
  const kanaN = kana.filter((k) => learned('kana:' + k)).length;
  const chN = store.clearedChapters.size;
  const readVal = 0.5 * (kanaN / kana.length) + 0.5 * clamp(chN / N5_TARGETS.chapters);

  return [
    { id: 'vocab', label: 'Vocabulary', value: clamp(vocabN / vocabT), n: vocabN, t: vocabT, text: `${vocabN}/${vocabT}`,
      title: `Vocabulary: ${vocabN} of the ${vocabT} N5 words to aim for (${pct(N5_TARGETS.vocab)} of the deck)`,
      tip: 'Water the Garden: new N5 words come in every day.', href: '#/garden', go: 'Garden' },
    { id: 'kanji', label: 'Kanji', value: clamp(kanjiN / kanjiT), n: kanjiN, t: kanjiT, text: `${kanjiN}/${kanjiT}`,
      title: `Kanji: ${kanjiN} of ${kanjiT} learned in the Reading Dojo or forged`,
      tip: 'Learn kanji in the Reading Dojo, then forge them in Kanji Forge.', href: '#/play/dojo', go: 'Reading Dojo' },
    { id: 'grammar', label: 'Grammar', value: clamp(gramN / gramT), n: gramN, t: gramT, text: `${gramN}/${gramT}`,
      title: `Grammar: ${gramN} of ${gramT} N5 grammar points remembered for a week or more`,
      tip: 'Read the course lessons; their grammar cards come back in the Garden.', href: '#/course', go: 'Course' },
    { id: 'listening', label: 'Listening', value: lisVal, text: lis.tot ? `${pct(lis.rate)} (${lis.tot})` : '–',
      title: lis.tot ? `Listening: ${pct(lis.rate)} right on the first try from ${lis.tot} answers in the last 4 weeks (aim: ${pct(N5_TARGETS.listening)} from ${N5_TARGETS.listeningAnswers})`
        : 'Listening: no answers in the last 4 weeks yet',
      tip: 'Play Listening Lab or Numbers & Time.', href: '#/play/listen', go: 'Listening Lab' },
    { id: 'reading', label: 'Reading', value: readVal, text: `${pct(readVal)}`,
      title: `Reading: ${kanaN} of ${kana.length} kana learned, ${chN} of ${N5_TARGETS.chapters} Story chapters cleared`,
      tip: chN < N5_TARGETS.chapters && kanaN >= kana.length * 0.8 ? 'Read the next Story chapter.' : 'Finish the kana in the Reading Dojo, then read Story chapters.',
      href: chN < N5_TARGETS.chapters && kanaN >= kana.length * 0.8 ? '#/play/story' : '#/play/dojo', go: chN < N5_TARGETS.chapters && kanaN >= kana.length * 0.8 ? 'Story' : 'Reading Dojo' },
  ];
}

/** N4: the same five areas as N5, measured on the N4 content (the N4 deck, kanji, course units and story arc). */
export function n4Areas(now = new Date()) {
  const items = store.s.items;
  const T = N4_TARGETS;
  const known = new Set(store.planted().filter((p) => p.prog.level >= 2).map((p) => p.item.jp));
  const vocabN = N4_WORDS.filter((w) => known.has(w.jp)).length;
  const vocabT = Math.max(1, Math.round(N4_WORDS.length * T.vocab));

  const learned = (id) => items[id] && items[id].level >= 1;
  const kanjiN = TEACHABLE_KANJI_N4.filter((k) => learned('kj:' + k) || store.forgedKanji.has(k)).length;
  const kanjiT = Math.max(1, Math.round(TEACHABLE_KANJI_N4.length * T.kanji));

  const g = store.s.grammar;
  const gramN = N4_GRAMMAR_KEYS.filter((k) => g[k] && g[k].r && g[k].s >= T.grammarDays && !g[k].help).length;
  const gramT = Math.max(1, Math.round(N4_GRAMMAR_KEYS.length * T.grammar));

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 27);
  const lis = store.skillDays(dateKey(from), dateKey(today)).listening;
  const lisVal = lis.tot ? clamp(lis.tot / T.listeningAnswers) * clamp(lis.rate / T.listening) : 0;

  const n4Chapters = CHAPTERS.filter((c) => c.level === 'N4');
  const chN = n4Chapters.filter((c) => store.clearedChapters.has(c.id)).length;
  const lessons = N4_KANJI_LESSONS.filter((l) => store.clearedLessons.has(l.id)).length;
  const readVal = 0.6 * clamp(chN / T.chapters) + 0.4 * clamp(lessons / N4_KANJI_LESSONS.length);

  return [
    { id: 'vocab', label: 'Vocabulary', value: clamp(vocabN / vocabT), n: vocabN, t: vocabT, text: `${vocabN}/${vocabT}`,
      title: `Vocabulary: ${vocabN} of the ${vocabT} N4 words to aim for (${pct(T.vocab)} of the N4 deck)`,
      tip: 'Water the Garden: N4 words come in after the N5 deck.', href: '#/garden', go: 'Garden' },
    { id: 'kanji', label: 'Kanji', value: clamp(kanjiN / kanjiT), n: kanjiN, t: kanjiT, text: `${kanjiN}/${kanjiT}`,
      title: `Kanji: ${kanjiN} of ${kanjiT} N4 kanji learned in the Reading Dojo or forged`,
      tip: 'Learn the N4 kanji in the Reading Dojo, then forge them in Kanji Forge.', href: '#/play/dojo', go: 'Reading Dojo' },
    { id: 'grammar', label: 'Grammar', value: clamp(gramN / gramT), n: gramN, t: gramT, text: `${gramN}/${gramT}`,
      title: `Grammar: ${gramN} of ${gramT} N4 grammar points remembered for a week or more`,
      tip: 'Work through the N4 bridge units in the course; their grammar cards come back in the Garden.', href: '#/course', go: 'Course' },
    { id: 'listening', label: 'Listening', value: lisVal, text: lis.tot ? `${pct(lis.rate)} (${lis.tot})` : '–',
      title: lis.tot ? `Listening: ${pct(lis.rate)} right on the first try from ${lis.tot} answers in the last 4 weeks (aim: ${pct(T.listening)} from ${T.listeningAnswers})`
        : 'Listening: no answers in the last 4 weeks yet',
      tip: 'Play Listening Lab or Numbers & Time: N4 scenes are in the mix now.', href: '#/play/listen', go: 'Listening Lab' },
    { id: 'reading', label: 'Reading', value: readVal, text: `${pct(readVal)}`,
      title: `Reading: ${chN} of ${T.chapters} N4 Story chapters cleared, ${lessons} of ${N4_KANJI_LESSONS.length} N4 kanji lessons done`,
      tip: chN < T.chapters ? 'Read the next chapter of the Journey arc.' : 'Finish the N4 kanji lessons in the Reading Dojo.',
      href: chN < T.chapters ? '#/play/story' : '#/play/dojo', go: chN < T.chapters ? 'Story' : 'Reading Dojo' },
  ];
}

/** N3: the same five areas, measured on the N3 content (the N3 deck, kanji, Phase 3 units and the Rivals arc). */
export function n3Areas(now = new Date()) {
  const items = store.s.items;
  const T = N3_TARGETS;
  const known = new Set(store.planted().filter((p) => p.prog.level >= 2).map((p) => p.item.jp));
  const vocabN = N3_WORDS.filter((w) => known.has(w.jp)).length;
  const vocabT = Math.max(1, Math.round(N3_WORDS.length * T.vocab));

  const learned = (id) => items[id] && items[id].level >= 1;
  const kanjiN = TEACHABLE_KANJI_N3.filter((k) => learned('kj:' + k) || store.forgedKanji.has(k)).length;
  const kanjiT = Math.max(1, Math.round(TEACHABLE_KANJI_N3.length * T.kanji));

  const g = store.s.grammar;
  const gramN = N3_GRAMMAR_KEYS.filter((k) => g[k] && g[k].r && g[k].s >= T.grammarDays && !g[k].help).length;
  const gramT = Math.max(1, Math.round(N3_GRAMMAR_KEYS.length * T.grammar));

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 27);
  const lis = store.skillDays(dateKey(from), dateKey(today)).listening;
  const lisVal = lis.tot ? clamp(lis.tot / T.listeningAnswers) * clamp(lis.rate / T.listening) : 0;

  const n3Chapters = CHAPTERS.filter((c) => c.level === 'N3');
  const chN = n3Chapters.filter((c) => store.clearedChapters.has(c.id)).length;
  const lessons = N3_KANJI_LESSONS.filter((l) => store.clearedLessons.has(l.id)).length;
  const readVal = 0.6 * clamp(chN / T.chapters) + 0.4 * clamp(lessons / N3_KANJI_LESSONS.length);

  return [
    { id: 'vocab', label: 'Vocabulary', value: clamp(vocabN / vocabT), n: vocabN, t: vocabT, text: `${vocabN}/${vocabT}`,
      title: `Vocabulary: ${vocabN} of the ${vocabT} N3 words to aim for (${pct(T.vocab)} of the N3 deck)`,
      tip: 'Water the Garden: N3 words come in after the N4 deck.', href: '#/garden', go: 'Garden' },
    { id: 'kanji', label: 'Kanji', value: clamp(kanjiN / kanjiT), n: kanjiN, t: kanjiT, text: `${kanjiN}/${kanjiT}`,
      title: `Kanji: ${kanjiN} of ${kanjiT} N3 kanji learned in the Reading Dojo or forged`,
      tip: 'Learn the N3 kanji in the Reading Dojo, then forge them in Kanji Forge.', href: '#/play/dojo', go: 'Reading Dojo' },
    { id: 'grammar', label: 'Grammar', value: clamp(gramN / gramT), n: gramN, t: gramT, text: `${gramN}/${gramT}`,
      title: `Grammar: ${gramN} of ${gramT} N3 grammar points remembered for a week or more`,
      tip: 'Work through the Phase 3 units in the course; their grammar cards come back in the Garden.', href: '#/course', go: 'Course' },
    { id: 'listening', label: 'Listening', value: lisVal, text: lis.tot ? `${pct(lis.rate)} (${lis.tot})` : '–',
      title: lis.tot ? `Listening: ${pct(lis.rate)} right on the first try from ${lis.tot} answers in the last 4 weeks (aim: ${pct(T.listening)} from ${T.listeningAnswers})`
        : 'Listening: no answers in the last 4 weeks yet',
      tip: 'Play Listening Lab or Numbers & Time: N3 scenes are in the mix now.', href: '#/play/listen', go: 'Listening Lab' },
    { id: 'reading', label: 'Reading', value: readVal, text: `${pct(readVal)}`,
      title: `Reading: ${chN} of ${T.chapters} N3 Story chapters (with their reading passages) cleared, ${lessons} of ${N3_KANJI_LESSONS.length} N3 kanji lessons done`,
      tip: chN < T.chapters ? 'Read the next chapter of the Rivals arc, passages and all.' : 'Finish the N3 kanji lessons in the Reading Dojo.',
      href: chN < T.chapters ? '#/play/story' : '#/play/dojo', go: chN < T.chapters ? 'Story' : 'Reading Dojo' },
  ];
}

/** Each level's readiness areas. */
const LEVEL_AREAS = { N5: n5Areas, N4: n4Areas, N3: n3Areas };

/**
 * Readiness for the next level not done yet: { level, areas, overall (0..1), ready, mock (a mock exists for it),
 * snoozed, weakest, done (levels done) }, or null once every level is done.
 */
export function readiness(now = new Date()) {
  const done = store.examDone();
  const level = LEVELS.find((lv) => !done.has(lv));
  if (!level) return null;
  const mock = MOCK_LEVELS.includes(level);
  const areas = LEVEL_AREAS[level] ? LEVEL_AREAS[level](now) : [];
  const overall = areas.length ? areas.reduce((a, x) => a + x.value, 0) / areas.length : 0;
  const ready = mock && areas.length > 0 && overall >= READY_AVERAGE && Math.min(...areas.map((x) => x.value)) >= READY_FLOOR;
  const later = store.exam.later[level];
  const weakest = areas.slice().sort((a, b) => a.value - b.value)[0] || null;
  return { level, areas, overall, ready, mock, snoozed: !!later && later > dateKey(now), weakest, done: LEVELS.filter((lv) => done.has(lv)) };
}

/** The latest mock for a level, or null. */
export function lastMock(level) {
  const h = store.exam.history.filter((x) => x.level === level);
  return h.length ? h[h.length - 1] : null;
}

/**
 * One line about a mock result: "Full mock, 12 Oct: 96/180, pass". When the total was over the pass line but a
 * section was under its minimum (scoreSections), it says which: "100/180, not yet (reading under 19)".
 */
export function mockLine(h) {
  const d = new Date(h.at);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const sc = SCORING[h.level];
  const under = sc && !h.pass && h.total >= sc.pass ? scoreSections(h.level).filter((x) => typeof h[x.id] === 'number' && h[x.id] < x.min) : [];
  return `${h.format === 'full' ? 'Full' : 'Mini'} mock, ${d.getDate()} ${mon}: ${h.total}/${sc ? sc.total : 180}, ${h.pass ? 'pass' : 'not yet'}${under.length ? ` (${under.map((x) => `${x.short} under ${x.min}`).join(', ')})` : ''}`;
}

/** The Today card: the meter for the next level, and a nudge toward a mock once ready. Empty when all are done. */
export function readinessCard(now = new Date()) {
  const r = readiness(now);
  if (!r) return '';
  const p = Math.round(r.overall * 100);
  const last = lastMock(r.level);
  let body;
  if (r.ready && !r.snoozed) {
    body = `<p class="strong good-c">You look ready for a mock ${r.level}.</p>
      <p class="small">It's practice in the real test's format, scored the same way. Misses go into your Garden.</p>
      <div class="row2"><a class="btn primary" href="#/exam">Take a mock</a><button class="btn ghost" data-act="exam-later" data-level="${r.level}">Later</button></div>`;
  } else if (!r.mock) {
    body = `<p class="small">${r.level} lessons and a mock ${r.level} are still to come. Until then this meter shows the ground they build on.</p>`;
  } else {
    body = `<p class="small">${r.ready ? `Ready for a mock ${r.level} whenever you are.` : `Next to grow: <span class="strong">${esc(r.weakest.label)}</span> (${esc(r.weakest.text)}). ${esc(r.weakest.tip)}`}</p>`;
  }
  return `<section class="panel stack-sm road-card ${r.ready ? 'ready' : ''}" aria-labelledby="road-h">
    <div class="row-between"><h2 class="section-title" id="road-h">Road to ${r.level}</h2><span class="mono strong">${p}%</span></div>
    <div class="bar" role="img" aria-label="${p}% of the way to being ready for a mock ${r.level}"><span style="width:${p}%"></span></div>
    ${body}
    ${last ? `<p class="tiny dim">Last: ${esc(mockLine(last))}.</p>` : ''}
    <a class="linkbtn" href="#/progress">See the details ›</a>
    ${store.goal ? '' : '<a class="linkbtn" href="#/plan">Taking the real test? Plan for a date ›</a>'}
  </section>`;
}

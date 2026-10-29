// Rival Battle attacks: quick recall items built only from what the learner has already met, mixed across skills.
// - Garden words that have been reviewed (due ones first): meaning from the Japanese, or the Japanese from the meaning.
// - Reading Dojo kana that have been reviewed: how is it read?
// - Conjugation Dojo forms already practised, Particle Train trains already ridden, Numbers & Time scenes already heard
//   (all from the skill model's per-item records).
// Each attack knows how to grade itself through the store, so reviews, accuracy and Progress update as usual.
import { store } from './store.js';
import { TRAINS, TRAIN_PALETTE, assembleTrain } from './data.js';
import { CONJ_WORDS, NUMBER_SCENES, FORM_LABEL, FORM_LEVEL, conjugate, conjPrompt, conjDistractors, conjWhy } from './practice-data.js';
import { LESSONS } from './dojo-data.js';
import { conjKey } from './grammar-cards.js';
import { recentRate } from './skills.js';
import { shuffle } from './ui.js';
import { RIVALS } from './rival-data.js';
import { itemOpen, mixed, levelOf, APP_LEVELS } from './levels.js';

/**
 * Rivals unlocked so far: Kaito from the start, the others once their story chapter is cleared. The N4 and N3 rivals
 * also need their level unlocked (js/levels.js); their chapters are of that level, so that comes first anyway.
 */
export function unlockedRivals() {
  const cleared = store.clearedChapters;
  return RIVALS.filter((r) => itemOpen(r) && (!r.after || cleared.has(r.after)));
}

/** Fewest attacks a fight needs; with less than this the rival waits until more has been learned. */
export const MIN_ITEMS = 6;
/** Mastery (0-100) at or above which an item counts as "known well" (the easy pool). */
const WELL = 70;

const KANA = {};
for (const l of LESSONS) for (const c of l.chars) KANA[c.k] = c;

const mastery = (key) => (store.engine.mastery[key] || [null])[0];
const choices = (right, pool, n) => {
  const others = shuffle([...new Set(pool.filter((x) => x && x !== right))]).slice(0, n - 1);
  const options = shuffle([right, ...others]);
  return { options, right: options.indexOf(right) };
};

/**
 * Every attack the learner can face, each { key, kind, skill, prompt, ask, answer, say (what's voiced as the answer),
 * sayable (Japanese the learner can say instead of tapping), detail, due, easy, pool (for options), grade(ok, firstTry) }.
 */
export function attackPool(now = Date.now()) {
  const out = [];

  // Garden words (not mined lines: they're whole sentences without built-in clips).
  const words = store.planted().filter(({ item, prog }) => prog.r > 0 && !item.mined && item.en && item.reading);
  const meanings = words.map(({ item }) => item.en);
  // Each word always asks the same way round (fixed by its id), half one way and half the other.
  const flip = (id) => [...id].reduce((n, ch) => n + ch.codePointAt(0), 0) % 2 === 1;
  words.forEach(({ item, prog }) => {
    const due = prog.due <= now;
    const grade = (ok, firstTry) => {
      if (!firstTry) return;
      if (due) store.reviewCard({ kind: 'word', dir: 'mean', id: item.id, item }, ok);
      else { store.log(ok); store.grade({ skill: 'vocab', id: item.id, ok }); }
    };
    const easy = (prog.level || 0) >= 3;
    const say = item.say || item.reading;
    if (!flip(item.id)) {
      out.push({ key: 'w:' + item.id, level: levelOf(item), kind: 'word', skill: 'vocab', ask: 'What does it mean?', prompt: item.jp, promptJa: true,
        answer: item.en, pool: meanings, optionsJa: false, say, sayable: say, targets: [item.jp, item.reading, say], detail: `${item.jp} (${item.reading}) = ${item.en}`, due, easy, grade });
    } else {
      out.push({ key: 'w:' + item.id, level: levelOf(item), kind: 'word', skill: 'vocab', ask: 'Say it or pick it in Japanese:', prompt: item.en, promptJa: false,
        answer: item.jp, pool: words.filter((w) => w.item.en !== item.en).map((w) => w.item.jp), optionsJa: true, say, sayable: say, targets: [item.jp, item.reading, say], detail: `${item.en} = ${item.jp} (${item.reading})`, due, easy, grade });
    }
  });

  // Reading Dojo kana.
  const kana = Object.entries(store.s.items).filter(([id, p]) => id.startsWith('kana:') && p.r > 0 && KANA[id.slice(5)]);
  const romajiPool = kana.map(([id]) => KANA[id.slice(5)].r);
  for (const [id, p] of kana) {
    const c = KANA[id.slice(5)];
    const due = p.due <= now;
    out.push({ key: id, level: 'N5', kind: 'kana', skill: 'kana', ask: 'How do you read it?', prompt: c.k, promptJa: true, noruby: true,
      answer: c.r, pool: romajiPool.filter((r) => r !== c.r), optionsJa: false, say: c.k, sayable: c.k, targets: [c.k], detail: `${c.k} = ${c.r}`,
      due, easy: (p.level || 0) >= 3,
      grade: (ok, firstTry) => {
        if (!firstTry) return;
        if (due) store.recordDojo(id, ok); else store.log(ok);
        store.grade({ skill: 'kana', id, ok });
      } });
  }

  // Conjugation Dojo forms already practised.
  for (const k of Object.keys(store.engine.mastery)) {
    const m = /^grammar\|conj:(.+)\|([a-z]+)$/.exec(k);
    const word = m && CONJ_WORDS.find((w) => w.jp === m[1]);
    if (!word || !FORM_LABEL[m[2]]) continue;
    const form = m[2];
    const conj = conjugate(word, form);
    const right = conj.jp;
    const card = store.s.grammar[conjKey(word.jp, form)];
    const due = !!(card && card.r && card.due <= now);
    out.push({ key: `cj:${word.jp}|${form}`, level: [levelOf(word), FORM_LEVEL[form]].sort((x, y) => APP_LEVELS.indexOf(y) - APP_LEVELS.indexOf(x))[0], kind: 'conj', skill: 'grammar', ask: `${FORM_LABEL[form]}?`, prompt: conjPrompt(word, form).jp, promptJa: true,
      promptEn: word.en, answer: right, pool: conjDistractors(word, form), optionsJa: true, say: right, sayable: right, targets: [conj.jp, conj.kana],
      detail: conjWhy(word, form), due, easy: mastery(k) >= WELL,
      grade: (ok, firstTry) => {
        if (!firstTry) return;
        if (due) store.reviewGrammar(conjKey(word.jp, form), ok); else store.log(ok);
        store.grade({ skill: 'grammar', id: `conj:${word.jp}|${form}`, ok });
      } });
  }

  // Particle Train trains already ridden: one coupling, the others filled in.
  for (const k of Object.keys(store.engine.mastery)) {
    const m = /^grammar\|train:(\d+)$/.exec(k);
    const t = m && TRAINS[Number(m[1])];
    if (!t) continue;
    const gi = t.gaps.findIndex(Boolean);
    const g = t.gaps[gi];
    const filled = Object.fromEntries(t.gaps.map((x, i) => [i, x ? x.correct[0] : null]));
    const full = assembleTrain(t, filled);
    const blanked = assembleTrain(t, { ...filled, [gi]: '（　）' });
    out.push({ key: 'train:' + m[1], level: levelOf(t), kind: 'particle', skill: 'grammar', ask: t.palette ? 'Which piece fits?' : 'Which particle fits?', prompt: blanked, promptJa: true, promptEn: t.en,
      answer: g.correct[0], pool: (t.palette || TRAIN_PALETTE).filter((p) => !g.correct.includes(p)), optionsJa: true, say: full, sayable: null,
      detail: g.why, due: false, easy: mastery(k) >= WELL,
      grade: (ok, firstTry) => { if (firstTry) { store.log(ok); store.grade({ skill: 'grammar', id: 'train:' + m[1], ok }); } } });
  }

  // Numbers & Time scenes already heard (the right option is listed first in the data).
  for (const s of NUMBER_SCENES) {
    const k = 'counters|num:' + s.id;
    if (!store.engine.mastery[k]) continue;
    out.push({ key: 'num:' + s.id, level: levelOf(s), kind: 'number', skill: 'counters', ask: s.q, prompt: null, listen: { text: s.jp, voice: s.voice },
      answer: s.options[0], pool: s.options.slice(1), optionsJa: false, fixedPool: true, say: s.jp, sayVoice: s.voice, sayable: null,
      detail: s.why, due: false, easy: mastery(k) >= WELL,
      grade: (ok, firstTry) => {
        if (!firstTry) return;
        store.log(ok);
        store.grade({ skill: 'counters', id: 'num:' + s.id, ok });
        store.grade({ skill: 'listening', id: 'num:' + s.id, ok });
      } });
  }
  return out;
}

/** Options per attack: 3 while recent accuracy in that skill is under ~80% (as the recap quiz does), else 4. */
export function optionCount(skill) {
  const r = recentRate(store.engine, skill);
  return r != null && r < 0.8 ? 3 : 4;
}

/** Tap options for an attack (a fresh shuffle each time it comes up). */
export function optionsFor(a) {
  return choices(a.answer, a.pool, a.fixedPool ? a.pool.length + 1 : optionCount(a.skill));
}

/**
 * Orders a fight: mixes kinds so no two neighbours share one when it can be helped, due items first within each
 * kind. Returns at most `n` attacks. `level`: the rival's level.
 */
export function planFight(pool, n = 16, level = 'N5') {
  // An N4 or N3 rival attacks mostly with items of its own level (about 70%, js/levels.js), the rest review from the
  // levels below, never above. An N5 rival keeps to N5 items while there are enough of them.
  const n5 = pool.filter((a) => levelOf(a) === 'N5');
  const upTo = pool.filter((a) => APP_LEVELS.indexOf(levelOf(a)) <= APP_LEVELS.indexOf(level));
  const picked = level === 'N5' ? (n5.length >= MIN_ITEMS ? n5 : pool) : mixed(upTo.length >= MIN_ITEMS ? upTo : pool, n);
  const byKind = {};
  for (const a of shuffle(picked)) (byKind[a.kind] || (byKind[a.kind] = [])).push(a);
  for (const list of Object.values(byKind)) list.sort((a, b) => Number(b.due) - Number(a.due));
  const out = [];
  let last = null;
  while (out.length < n && Object.values(byKind).some((l) => l.length)) {
    const kinds = shuffle(Object.keys(byKind).filter((k) => byKind[k].length));
    const k = kinds.find((x) => x !== last) || kinds[0];
    out.push(byKind[k].shift());
    last = k;
  }
  return out;
}

/**
 * Picks the next attack to aim at ~85%: while the fight's accuracy is under 80% an easy (well-known) one comes next
 * when there is one; over 90%, a due or less-known one. Takes it out of `queue` and returns it.
 */
export function nextAttack(queue, { ok, tot }) {
  if (!queue.length) return null;
  const rate = tot >= 3 ? ok / tot : null;
  let i = 0;
  if (rate != null && rate < 0.8) i = Math.max(0, queue.findIndex((a) => a.easy));
  else if (rate != null && rate > 0.9) i = Math.max(0, queue.findIndex((a) => a.due || !a.easy));
  return queue.splice(i, 1)[0];
}

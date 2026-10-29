// Ren's monthly letter: on the first visit of a new month, Ren writes a short letter in simple Japanese about the month
// before: the words learned, what moved on (kana, the story, the course, a mock), and a few of that month's words to
// recall. It's reading practice made from the learner's own month, in Ren's voice, at the learner's register.
//
// Kind by design: a month with no study brings no letter (nothing to be sorry about), a quiet month gets "don't push
// yourself", and it never counts or mentions days missed. Letters are kept in progress (messages.letters) and sync.
import { store, dateKey } from './store.js';
import { speaker } from './audio.js';
import { GARDEN_CATALOG } from './data.js';
import { SENDERS } from './messages-data.js';
import { LETTER_LINES } from './letter-data.js';
import { learnerTier, knownKanji } from './messages.js';
import { lookupHTML, mountLookup } from './lookup.js';
import { esc, delegate } from './ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Words to recall at the end of a letter. */
export const QUIZ_WORDS = 3;
/** Things that moved on, at most, so a letter stays short. */
const MAX_NEWS = 3;

/** 'YYYY-MM' of a date. */
export const monthKey = (d) => dateKey(d).slice(0, 7);
/** The month before `now`, as 'YYYY-MM'. */
export const prevMonth = (now = new Date()) => monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
/** "October 2026" */
export const monthName = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

/** What the learner has now, to compare with the next letter: kana tracks done, chapters, course units, mocks. */
function snapshot() {
  return {
    hira: store.trackDone('hiragana'), kata: store.trackDone('katakana'),
    chapters: store.clearedChapters.size, units: store.s.course.done.length,
  };
}

/** The month's numbers: { days (studied), words (new Garden words), mocks, picks (word ids to recall) }. */
export function monthFacts(month) {
  let days = 0, words = 0;
  for (const [k, d] of Object.entries(store.s.days)) {
    if (!k.startsWith(month + '-')) continue;
    if (d.studied) days++;
    words += d.newc || 0;
  }
  const [y, m] = month.split('-').map(Number);
  const from = new Date(y, m - 1, 1).getTime(), to = new Date(y, m, 1).getTime();
  const mocks = store.exam.history.filter((h) => h.at >= from && h.at < to).length;
  // Words planted that month and reviewed at least once, the most recent first.
  const picks = Object.entries(store.s.items)
    .filter(([id, p]) => GARDEN_CATALOG[id] && p.pl >= from && p.pl < to && p.r > 0)
    .sort((a, b) => b[1].pl - a[1].pl).slice(0, QUIZ_WORDS).map(([id]) => id);
  return { days, words, mocks, picks };
}

/** The line ids of a letter, from its facts and what moved on since the last letter. */
export function letterLines(facts, snap, before, goal) {
  const ids = ['open'];
  ids.push(facts.words >= 50 ? 'wordsMany' : facts.words >= 10 ? 'wordsSome' : facts.words > 0 ? 'wordsFew' : 'review');
  if (facts.days <= 3 && facts.words < 50) ids.push('busy');
  const news = [];
  if (snap.hira && !(before && before.hira)) news.push('hiragana');
  if (snap.kata && !(before && before.kata)) news.push('katakana');
  if (snap.chapters > (before ? before.chapters : 0)) news.push('story');
  if (snap.units > (before ? before.units : 0)) news.push('course');
  if (facts.mocks) news.push('mock');
  ids.push(...news.slice(0, MAX_NEWS));
  if (goal) ids.push('plan');
  if (facts.picks.length) ids.push('quiz');
  ids.push('close', 'sign');
  return ids;
}

/** Ren writes the same way he talks to the learner: polite at first, then casual like a friend. */
const register = () => SENDERS.ren.answer(learnerTier());

/**
 * Writes last month's letter if it's due: called when the app opens (Today). Returns the new letter or null. No study
 * last month, or a letter already written for it, means no letter.
 */
export function writeLetter(now = new Date()) {
  const month = prevMonth(now);
  if (store.letters.some((l) => l.month === month)) return null;
  const facts = monthFacts(month);
  if (!facts.days) return null;
  const before = store.letters.length ? store.letters[store.letters.length - 1].snap : null;
  const snap = snapshot();
  const goal = store.goal && store.goal.date > dateKey(now) ? store.goal : null;
  const letter = {
    month, reg: register(), lines: letterLines(facts, snap, before, goal), words: facts.picks,
    stats: { days: facts.days, words: facts.words, mocks: facts.mocks }, snap, read: false, at: now.getTime(),
  };
  store.addLetter(letter);
  return letter;
}

/** The letter's lines, in its register. */
export const linesOf = (letter) => letter.lines.map((id) => LETTER_LINES[id] && LETTER_LINES[id][letter.reg]).filter(Boolean);

/** Shows kanji only once every kanji in the line is known (as in Messages). */
function shown(line, known) {
  const kanji = [...line.jp].filter((c) => /[一-鿿々]/.test(c));
  return kanji.length && !kanji.every((c) => known.has(c)) ? line.kana : line.jp;
}

/** The Today card while a letter is unread. */
export function letterCard() {
  const l = store.letters.filter((x) => !x.read).slice(-1)[0];
  if (!l) return '';
  const s = SENDERS.ren;
  return `<a class="panel link-panel msg-card letter-card" href="#/letter/${l.month}" style="--who:${s.color}">
      <span class="msg-face" lang="ja" data-noruby aria-hidden="true">${esc(s.jpName.slice(0, 1))}</span>
      <span class="grow"><span class="strong">A letter from Ren</span> <span class="small dim">about ${esc(monthName(l.month).split(' ')[0])}</span><br>
      <span class="small dim">Ren looks back on your month, in Japanese.</span></span>
      <span class="dim chev" aria-hidden="true">›</span></a>`;
}

/** The letter screen (#/letter or #/letter/YYYY-MM). */
export function mount(el, month = null) {
  const list = store.letters;
  const letter = (month && list.find((l) => l.month === month)) || list[list.length - 1] || null;
  const shownEn = new Set();
  const revealed = new Set();
  if (letter && !letter.read) store.markLetterRead(letter.month);

  function render() {
    if (!letter) {
      el.innerHTML = `<section class="panel stack-sm"><h2 class="section-title">Letters from Ren</h2>
        <p class="small">At the start of each month, Ren writes you a short letter about the month before. The first one comes after a month with some study in it.</p></section>`;
      return;
    }
    const known = knownKanji();
    const s = SENDERS.ren;
    const lines = linesOf(letter);
    const st = letter.stats;
    el.innerHTML = `<div class="stack letter-screen">
      <section class="panel stack-sm letter" style="--who:${s.color}" aria-labelledby="letter-h">
        <div class="row-gap"><span class="msg-face" lang="ja" data-noruby aria-hidden="true">${esc(s.jpName.slice(0, 1))}</span>
          <h2 class="section-title" id="letter-h">A letter about ${esc(monthName(letter.month))}</h2></div>
        <p class="small dim">Tap a line to hear it, and "English" to check what it means. Tap any word to look it up.</p>
        <ol class="letter-lines">${lines.map((l, i) => `<li class="letter-line">
          <p class="msg-text" lang="ja">${lookupHTML(shown(l, known))}</p>
          <div class="row-gap wrap-gap"><button class="btn small-btn" data-act="hear" data-i="${i}">🔊 Hear it</button>
            <button class="linkbtn inline" data-act="en" data-i="${i}" aria-expanded="${shownEn.has(i)}">English</button></div>
          ${shownEn.has(i) ? `<p class="small dim">${esc(l.en)}</p>` : ''}
        </li>`).join('')}</ol>
        ${letter.words.length ? `<h3 class="small strong">Words from your month</h3>
          <p class="small dim">Say what each one means, then tap to check.</p>
          <div class="letter-words">${letter.words.map((id) => {
            const w = GARDEN_CATALOG[id];
            if (!w) return '';
            return `<button class="btn left letter-word" data-act="word" data-id="${esc(id)}" aria-expanded="${revealed.has(id)}">
              <span lang="ja">${esc(w.jp)}</span>${revealed.has(id) ? `<span class="small dim"> · ${esc(w.en)}</span>` : ''}</button>`;
          }).join('')}</div>` : ''}
        <p class="tiny dim">${esc(monthName(letter.month).split(' ')[0])}: ${st.words} new ${st.words === 1 ? 'word' : 'words'} over ${st.days} study ${st.days === 1 ? 'day' : 'days'}${st.mocks ? `, ${st.mocks} mock ${st.mocks === 1 ? 'test' : 'tests'}` : ''}.</p>
      </section>
      ${list.length > 1 ? `<section class="panel stack-sm" aria-labelledby="letters-h"><h2 class="section-title" id="letters-h">Earlier letters</h2>
        <ul class="small">${list.slice().reverse().filter((l) => l !== letter).map((l) => `<li><a href="#/letter/${l.month}">${esc(monthName(l.month))}</a></li>`).join('')}</ul></section>` : ''}
    </div>`;
  }

  const off = delegate(el, {
    hear: (b) => { const l = linesOf(letter)[Number(b.dataset.i)]; if (l) speaker.speak(l.jp, { voice: SENDERS.ren.voice, mps: 4 }); },
    en: (b) => { const i = Number(b.dataset.i); if (shownEn.has(i)) shownEn.delete(i); else shownEn.add(i); render(); },
    word: (b) => {
      const id = b.dataset.id;
      const w = GARDEN_CATALOG[id];
      if (!revealed.has(id)) { revealed.add(id); render(); }
      if (w) speaker.speak(w.say || w.reading, { mps: 3.5 });
    },
  });
  const offLookup = mountLookup(el);
  render();
  return () => { off(); if (offLookup) offLookup(); speaker.stop(); };
}

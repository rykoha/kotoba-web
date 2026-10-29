// Things I can do in Japanese: real-life skills, JLPT can-do style, each lit by real evidence and never by time
// spent. A course unit lights its goal once the unit is complete (85% right over 20+ answers); an Encounters scene
// once every reply in it is learned; reading skills once the kana are done, a Library reader is read or a Story
// chapter is cleared; a level's test once a full mock is passed.
//
// A lit skill never goes dark. When a course unit's grammar cards start slipping in the Garden (one needs help, or
// one is well overdue), the skill shows a calm "refresh" link back to the unit, so it gets reviewed while it's still
// easy to bring back. Which skills were lit on the last visit is kept on this device only (kotobaBeat.cando), so
// newly lit ones can be marked as new.
import { store } from './store.js';
import { CHAPTERS } from './data.js';
import { KANJI_LESSONS } from './dojo-data.js';
import { STUDY_UNITS } from './course-data.js';
import { unitCardKeys } from './grammar-cards.js';
import { READERS } from './library-data.js';
import { SCENES, PERSON } from './encounter-data.js';
import { sceneState } from './modes/meet.js';
import { BRUSH_KANA } from './brush-data.js';
import { APP_LEVELS, isUnlocked, levelOf, lockLine } from './levels.js';
import { icon } from './icons.js';
import { esc, delegate } from './ui.js';

const DAY = 86_400_000;
/** A Garden card this overdue (days) suggests a refresh. */
export const OVERDUE_DAYS = 7;
/** Kana drawn from memory in Kana Brush for "write kana from memory". */
export const BRUSH_GOAL = 20;
const SEEN_KEY = 'kotobaBeat.cando';

export const GROUPS = [
  { id: 'read', title: 'Reading and writing' },
  { id: 'talk', title: 'Real conversations' },
  { id: 'course', title: 'From the course' },
  { id: 'test', title: 'The test' },
];

const unitLabel = (u) => `Unit ${u.id.slice(1).replace('-', '.')}`;

/** Every can-do: { id, level, group, text, sub, lit, refresh, how, href }. */
export function canDos(now = Date.now()) {
  const out = [];
  const add = (x) => out.push({ refresh: false, sub: '', ...x });
  const items = store.s.items;
  const drawn = BRUSH_KANA.filter((x) => { const p = items['kana:' + x.k]; return p && p.dirs && p.dirs.draw && p.dirs.draw.r > 0; }).length;

  add({ id: 'hiragana', level: 'N5', group: 'read', text: 'Read every hiragana', lit: store.trackDone('hiragana'), how: 'Finish the hiragana in the Reading Dojo.', href: '#/play/dojo' });
  add({ id: 'katakana', level: 'N5', group: 'read', text: 'Read katakana, the letters for loanwords like コーヒー', lit: store.trackDone('katakana'), how: 'Finish the katakana in the Reading Dojo.', href: '#/play/dojo' });
  add({ id: 'kanji', level: 'N5', group: 'read', text: 'Read your first kanji, like 日 and 人', lit: KANJI_LESSONS.some((l) => store.clearedLessons.has(l.id)), how: 'Do a kanji lesson in the Reading Dojo.', href: '#/play/dojo' });
  add({ id: 'brush', level: 'N5', group: 'read', text: 'Write kana from memory', lit: drawn >= BRUSH_GOAL, how: `Draw ${BRUSH_GOAL} kana in Kana Brush (${Math.min(drawn, BRUSH_GOAL)} so far).`, href: '#/play/brush' });

  for (const lv of APP_LEVELS) {
    const readers = READERS.filter((r) => levelOf(r) === lv);
    if (readers.length) {
      add({ id: `reader-${lv}`, level: lv, group: 'read', text: `Read a short ${lv} story on your own`, lit: readers.some((r) => store.readerResult(r.id)), how: 'Read any reader in the Library.', href: '#/play/library' });
    }
    const chapters = CHAPTERS.filter((c) => (c.level || 'N5') === lv);
    if (chapters.length) {
      add({ id: `chapter-${lv}`, level: lv, group: 'read', text: `Follow a whole ${lv} story chapter`, lit: chapters.some((c) => store.clearedChapters.has(c.id)), how: `Clear a chapter of the ${lv} Story.`, href: '#/play/story' });
    }
    for (const s of SCENES.filter((x) => levelOf(x) === lv)) {
      const p = PERSON[s.who];
      add({ id: `meet-${s.id}`, level: lv, group: 'talk', text: s.title, sub: `With ${p.name} at ${p.place}`, lit: sceneState(s) === 'learned', how: 'Play this scene in Encounters until every reply is learned.', href: '#/play/meet' });
    }
  }

  const g = store.s.grammar;
  const done = new Set(store.s.course.done);
  for (const u of STUDY_UNITS) {
    if (!u.goal || u.outline) continue;
    const lit = done.has(u.id);
    const refresh = lit && unitCardKeys(u.id).some((k) => g[k] && g[k].r && (g[k].help || (g[k].due && g[k].due < now - OVERDUE_DAYS * DAY)));
    add({ id: `unit-${u.id}`, level: levelOf(u), group: 'course', text: u.goal, sub: `${unitLabel(u)}: ${u.title}`, lit, refresh,
      how: `Complete ${unitLabel(u)} in the course.`, href: `#/course/${u.id}` });
  }

  const passed = new Set(store.exam.history.filter((h) => h.format === 'full' && h.pass).map((h) => h.level));
  for (const lv of APP_LEVELS) {
    const real = store.exam.real[lv] && store.exam.real[lv].on;
    add({ id: `test-${lv}`, level: lv, group: 'test', text: `Pass the JLPT ${lv}${real ? '' : ' (a full mock counts)'}`, lit: passed.has(lv) || !!real, how: `Pass a full mock ${lv}.`, href: '#/exam' });
  }
  return out;
}

/** Can-dos lit since the last time they were marked seen (this device). */
function seenSet() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (e) { return null; }
}
function markSeen(list) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(list.filter((x) => x.lit).map((x) => x.id))); } catch (e) { /* this visit only */ }
}

/** The next few to light at a level: the order they're listed in, reading first. */
const nextUp = (list, n = 3) => list.filter((x) => !x.lit).slice(0, n);

function row(x, fresh) {
  return `<li class="cd-row ${x.lit ? 'lit' : ''}">
    <span class="cd-mark" aria-hidden="true">${x.lit ? icon('check') : ''}</span>
    <span class="grow"><span class="${x.lit ? 'strong' : ''}">${esc(x.text)}</span>${fresh ? ' <span class="cd-new">New</span>' : ''}
      ${x.sub ? `<br><span class="tiny dim">${esc(x.sub)}</span>` : ''}
      ${!x.lit ? `<br><a class="tiny linkbtn inline" href="${x.href}">${esc(x.how)}</a>` : ''}
      ${x.refresh ? `<br><a class="tiny linkbtn inline" href="${x.href}">Some of this is slipping. A quick refresh brings it back.</a>` : ''}</span>
    <span class="sr-only">${x.lit ? 'Can do' : 'Not yet'}</span>
  </li>`;
}

/** The panel on Progress: how many are lit at the level being worked on, the new ones, and what's next. */
export function candoSection() {
  const all = canDos();
  const seen = seenSet();
  const level = APP_LEVELS.find((lv) => isUnlocked(lv) && all.some((x) => x.level === lv && !x.lit)) || 'N5';
  const at = all.filter((x) => x.level === level);
  const lit = at.filter((x) => x.lit).length;
  const fresh = seen ? all.filter((x) => x.lit && !seen.has(x.id)) : [];
  const p = at.length ? Math.round((lit / at.length) * 100) : 0;
  return `<section class="panel stack-sm cando" aria-labelledby="cando-h">
    <h2 class="section-title" id="cando-h">Things I can do</h2>
    <p><span class="stat-v mono">${lit}</span><span class="stat-of"> / ${at.length}</span> <span class="small dim">${level} skills you can do in Japanese</span></p>
    <div class="bar" role="img" aria-label="${lit} of ${at.length} ${level} skills"><span style="width:${p}%"></span></div>
    ${fresh.length ? `<h3 class="small strong">New since last time</h3><ul class="cd-list">${fresh.slice(0, 5).map((x) => row(x, true)).join('')}</ul>` : ''}
    ${nextUp(at).length ? `<h3 class="small strong">Next to unlock</h3><ul class="cd-list">${nextUp(at).map((x) => row(x, false)).join('')}</ul>` : ''}
    <a class="linkbtn" href="#/cando">See every skill ›</a>
  </section>`;
}

/** The full list (#/cando), one level at a time. */
export function mount(el) {
  const all = canDos();
  const seen = seenSet();
  let level = APP_LEVELS.find((lv) => isUnlocked(lv) && all.some((x) => x.level === lv && !x.lit)) || 'N5';
  function render() {
    const at = all.filter((x) => x.level === level);
    const lit = at.filter((x) => x.lit).length;
    el.innerHTML = `<div class="stack cando-screen">
      <section class="panel stack-sm" aria-labelledby="cd-h">
        <h2 class="section-title" id="cd-h">Things I can do in Japanese</h2>
        <p class="small dim">Each skill lights up from what you've actually done, never from time spent. A lit skill stays lit; if it starts to slip, it says so, kindly.</p>
        <div class="seg" role="radiogroup" aria-label="Level">${APP_LEVELS.map((lv) => `<button class="seg-btn ${lv === level ? 'on' : ''}" data-act="lv" data-v="${lv}" role="radio" aria-checked="${lv === level}">${lv}</button>`).join('')}</div>
        <p class="small"><span class="strong mono">${lit} / ${at.length}</span> lit at ${level}.${isUnlocked(level) ? '' : ` ${esc(lockLine(level))}`}</p>
      </section>
      ${GROUPS.map((gr) => {
        const list = at.filter((x) => x.group === gr.id);
        if (!list.length) return '';
        return `<section class="panel stack-sm" aria-labelledby="cd-${gr.id}"><h2 class="section-title" id="cd-${gr.id}">${esc(gr.title)}</h2>
          <ul class="cd-list">${list.map((x) => row(x, seen && x.lit && !seen.has(x.id))).join('')}</ul></section>`;
      }).join('')}
    </div>`;
  }
  const off = delegate(el, { lv: (b) => { level = b.dataset.v; render(); } });
  render();
  markSeen(all);
  return off;
}

/** Marks the current lit skills as seen (when Progress is left), so "New" shows each one once. */
export const markCandoSeen = () => markSeen(canDos());

// The guided course: the lesson path (#/course), a unit (#/course/<id>), its lesson (#/course/<id>/lesson),
// tagged practice in the existing modes (#/course/<id>/<mode>) and the grammar reference (#/grammar).
// Unit progress counts first-try answers from store.onGrade while that unit's practice runs. Nothing is ever locked:
// units unlock in order, but any unit can be opened, read and practised at any time.
import { store } from './store.js';
import { speaker } from './audio.js';
import { TRAINS, trainParticles, CHAPTERS, COUNTERS, PHRASE_BY_ID, MODE_BY_ID, N5_WORDS, accentMorae, accentName, toMorae } from './data.js';
import { PHASES, UNITS, UNIT_BY_ID, STUDY_UNITS, UNIT_TARGET, UNIT_MIN_ANSWERS, UNIT_WINDOW, COURSE_EXAMPLES } from './course-data.js';
import { esc, delegate, toast, melodySVG, shuffle } from './ui.js';
import { romaji, toHiragana } from './romaji.js';
import * as fx from './fx.js';
import { mountRecap, particleQuestion, orderQuestion, listenQuestion, meaningQuestion } from './recap.js';
import { POINT_PARTICLES } from './grammar-cards.js';
import { pronButton, wordTarget } from './pron.js';
import { N4_WORDS, N3_WORDS } from './data.js';
import { itemOpen, lockLine, levelOf } from './levels.js';

/** N5, N4 and N3 deck words by written form (the first entry wins for the rare shared spelling). */
const N5_BY_JP = new Map();
for (const w of [...N5_WORDS, ...N4_WORDS, ...N3_WORDS]) if (!N5_BY_JP.has(w.jp)) N5_BY_JP.set(w.jp, w);
export const unitWords = (u) => (u.vocab || []).map((jp) => N5_BY_JP.get(jp)).filter(Boolean);
/** Units with content in a level that's open (js/levels.js): Phase 2 (N4) waits until N4 is unlocked. */
const openUnits = () => STUDY_UNITS.filter(itemOpen);

// ---------- state ----------
const C = () => store.s.course;
const indexOf = (id) => openUnits().findIndex((u) => u.id === id);

export const unitLabel = (u) => `Unit ${u.id.slice(1).replace('-', '.')}`;
export const isDone = (id) => C().done.includes(id);

/** The unit Today draws from: the one picked as current (until it's done), else the first one not done yet. */
export function currentUnit() {
  const c = C();
  if (c.current && UNIT_BY_ID[c.current] && !UNIT_BY_ID[c.current].outline && itemOpen(UNIT_BY_ID[c.current]) && !c.done.includes(c.current)) return UNIT_BY_ID[c.current];
  return openUnits().find((u) => !c.done.includes(u.id)) || null;
}

/** Units reached so far: everything up to the furthest unit that is current, done or was practised. */
export function reachedUnits() {
  const c = C();
  const cur = currentUnit();
  const idx = Math.max(0, ...[...c.reached, ...c.done, cur ? cur.id : null].filter(Boolean).map(indexOf));
  return openUnits().slice(0, idx + 1);
}

function markReached(id) {
  const c = C();
  if (UNIT_BY_ID[id] && !UNIT_BY_ID[id].outline && !c.reached.includes(id)) { c.reached.push(id); store.save(); }
}

export function setCurrent(id) {
  const c = C();
  c.current = id;
  markReached(id);
  store.save();
}

export function setOn(on) { C().on = !!on; store.save(); }

export function unitStats(id) {
  const t = C().tally[id] || { ok: 0, tot: 0, last: '' };
  const recent = t.last.length ? [...t.last].filter((x) => x === '1').length / t.last.length : null;
  return { ok: t.ok, tot: t.tot, recent, done: isDone(id) };
}

/** Records one first-try answer for a unit. Returns true if it just completed the unit. */
export function recordAnswer(id, ok) {
  const c = C();
  const t = c.tally[id] || (c.tally[id] = { ok: 0, tot: 0, last: '' });
  t.tot += 1;
  if (ok) t.ok += 1;
  t.last = (t.last + (ok ? '1' : '0')).slice(-UNIT_WINDOW);
  if (!c.reached.includes(id)) c.reached.push(id);
  const st = unitStats(id);
  let completed = false;
  if (!st.done && t.tot >= UNIT_MIN_ANSWERS && st.recent >= UNIT_TARGET) {
    completed = true;
    c.done.push(id);
    store.plantUnitGrammar(id);   // its grammar points join the Garden's review cards
    if (c.current === id) c.current = null;
    const next = currentUnit();
    if (next && !c.reached.includes(next.id)) c.reached.push(next.id);
  }
  store.save();
  return completed;
}

/** Marks a unit's lesson read, and plants a Garden review card for each of its grammar points. */
export function markRead(id) {
  const c = C();
  if (!c.read.includes(id)) { c.read.push(id); store.save(); }
  store.plantUnitGrammar(id);
}

/**
 * Counts graded answers toward a unit while its practice runs. Only first tries count (a retry after a miss is
 * practice, not a score), and pitch is left out: Rhythm already grades the same attempt as speaking.
 */
export function trackUnit(id, onUpdate = null) {
  markReached(id);
  return store.onGrade((ev) => {
    if (!ev.firstTry || ev.skill === 'pitch') return;
    const completed = recordAnswer(id, ev.ok);
    if (completed) {
      const next = currentUnit();
      toast(`✓ ${unitLabel(UNIT_BY_ID[id])} complete!${next ? ` Next: ${next.title}` : ''}`);
      fx.sound('fanfare');
    }
    if (onUpdate) onUpdate(unitStats(id), completed);
  });
}

// ---------- practice ----------
const GOALS = { particle: '6 trains', shop: '3 customers', rhythm: '3 phrases', story: 'one scene' };

/** Other trains that use only particles taught by this unit or earlier ones, so a unit's practice has variety. */
export function extraTrains(u) {
  const upto = UNITS.slice(0, UNITS.indexOf(u) + 1);
  // An N4 unit's extras: the N4 trains of the units up to it (their connectors are taught by then).
  if (levelOf(u) === 'N4') {
    const ids = new Set(upto.map((x) => x.id));
    const own = new Set(unitTrains(u));
    return TRAINS.map((_, i) => i).filter((i) => TRAINS[i].unit && ids.has(TRAINS[i].unit) && !own.has(i));
  }
  const taught = new Set(upto.flatMap((x) => (x.practice?.trains || []).flatMap((i) => (TRAINS[i] ? trainParticles(TRAINS[i]) : []))));
  const own = new Set(u.practice?.trains || []);
  return TRAINS.map((_, i) => i).filter((i) => !own.has(i) && levelOf(TRAINS[i]) === 'N5' && trainParticles(TRAINS[i]).every((x) => taught.has(x)));
}

/** A unit's own trains: listed in its practice, or (N4 units) the N4 trains written for it. */
export function unitTrains(u) {
  if (u.practice?.trains?.length) return u.practice.trains;
  return TRAINS.map((t, i) => (t.unit === u.id ? i : -1)).filter((i) => i >= 0);
}

/** The practice a unit tags in each mode: [{ mode, label, detail, ctx }]. */
export function practiceList(u) {
  const p = { ...(u.practice || {}), trains: unitTrains(u) };
  const out = [];
  if (p.trains?.length) {
    out.push({ mode: 'particle', label: 'Particle Train', ctx: { trainIds: p.trains, extraTrainIds: extraTrains(u) },
      detail: p.trains.map((i) => TRAINS[i]?.en).filter(Boolean).join(' · ') });
  }
  if (p.story) {
    const ch = CHAPTERS.find((x) => x.id === p.story.chapter);
    if (ch) {
      out.push({ mode: 'story', label: 'Story scene', ctx: { chapterId: ch.id, beats: [p.story.from, p.story.to] },
        detail: `Chapter ${ch.number} · ${ch.en}, lines ${p.story.from + 1}–${p.story.to + 1}` });
    }
  }
  if (p.shop?.length) {
    out.push({ mode: 'shop', label: 'Shopkeeper', ctx: { counters: p.shop },
      detail: `Counters: ${p.shop.map((k) => COUNTERS[k].symbol).join(' ')}` });
  }
  if (p.phrases?.length) {
    out.push({ mode: 'rhythm', label: 'Rhythm', ctx: { phraseIds: p.phrases },
      detail: p.phrases.map((id) => PHRASE_BY_ID[id]?.display).filter(Boolean).join('・') });
  }
  return out;
}

/** Today's Story block outside a unit lesson day: the next chapter not cleared yet, or a replay once all are. */
export function storyBlock() {
  const { chapter, replay } = store.nextChapter();
  return {
    id: 'input', mode: 'story', mins: 5, title: replay ? 'Story replay' : 'Story',
    desc: `${replay ? 'Replay (furigana off)' : 'Next chapter'}: ${chapter.number}. ${chapter.title} · ${chapter.en}`,
    ctx: { chapterId: chapter.id },
  };
}

/**
 * Today's course blocks, or null when the course is off or finished.
 * input: the unit's lesson until it has been read, then the next story chapter. Every daily Story clears a whole
 * chapter, so doing the story each day always moves the saga on (the unit's own scene stays on the unit page), and
 * its answers still count toward the unit.
 * skill(weekdaySkill): on grammar and counter days (Particle Train, Shopkeeper) the unit's own practice.
 */
export function coursePlan() {
  const c = C();
  const u = currentUnit();
  if (!c.on || !u) return null;
  const label = unitLabel(u);
  const practice = practiceList(u);
  const examples = u.points.reduce((a, p) => a + p.examples.length, 0);
  let input;
  if (!c.read.includes(u.id)) {
    input = { id: 'input', mode: 'lesson', modeTitle: 'Lesson', mins: 5, title: `Lesson · ${u.title}`,
      desc: `${label}: ${u.points.length} grammar points and ${examples} example sentences.`, ctx: { unitId: u.id }, unit: u.id };
  } else {
    input = { ...storyBlock(), unit: u.id };
  }
  const skill = (weekdaySkill) => {
    if (weekdaySkill !== 'particle' && weekdaySkill !== 'shop') return null;
    const other = weekdaySkill === 'particle' ? 'shop' : 'particle';
    const pick = practice.find((x) => x.mode === weekdaySkill) || practice.find((x) => x.mode === other);
    if (!pick) return null;
    return { mode: pick.mode, ctx: pick.ctx, unit: u.id, desc: `${label} practice, ${GOALS[pick.mode]}.` };
  };
  return { unit: u, input, skill };
}

// ---------- shared bits ----------
function progressHTML(u) {
  const st = unitStats(u.id);
  const pct = st.done ? 100 : Math.min(100, (st.tot / UNIT_MIN_ANSWERS) * 100);
  const acc = st.recent == null ? '–' : Math.round(st.recent * 100) + '%';
  return `<div class="course-progress">
    <div class="bar" role="img" aria-label="${st.done ? 'Unit complete' : `${Math.min(st.tot, UNIT_MIN_ANSWERS)} of ${UNIT_MIN_ANSWERS} answers`}"><span style="width:${pct}%"></span></div>
    <p class="small dim">${st.done ? '✓ Complete. Practise any time to keep it fresh.'
      : `${st.tot} practice answers · ${acc} right on the first try lately. Completes at ${Math.round(UNIT_TARGET * 100)}% over ${UNIT_MIN_ANSWERS}+ answers.`}</p>
  </div>`;
}

function exampleHTML(ex, key) {
  return `<div class="ex-row">
    <button class="iconbtn ex-play" data-act="play" data-key="${esc(key)}" aria-label="Play: ${esc(ex.en)}" title="Play">🔊</button>
    <span class="grow"><span class="ex-jp" lang="ja">${esc(ex.jp)}</span><br>
      <span class="small dim ex-reading" lang="ja" data-noruby>${esc(ex.reading)}</span><br>
      <span class="small">${esc(ex.en)}</span></span>
  </div>`;
}

function pointHTML(p, u, { withUnit = false } = {}) {
  return `<section class="panel stack-sm gp" aria-label="${esc(p.title)}">
    ${withUnit ? `<a class="small dim linkbtn" href="#/course/${u.id}">${esc(unitLabel(u))} · ${esc(u.title)}</a>` : ''}
    <h3 class="gp-title">${esc(p.title)}</h3>
    <p class="gp-pattern" lang="ja">${esc(p.pattern)}</p>
    <p class="small">${esc(p.explain)}</p>
    <div class="ex-list">${p.examples.map((ex, i) => exampleHTML(ex, `${u.id}/${p.id}/${i}`)).join('')}</div>
  </section>`;
}

function exampleByKey(key) {
  const [uid, pid, i] = key.split('/');
  const p = UNIT_BY_ID[uid]?.points?.find((x) => x.id === pid);
  return p ? p.examples[+i] : null;
}

const playExample = (ex) => { if (ex) speaker.speak(ex.jp, { mps: 4, voice: ex.voice }); };

/** Card linking to the course; used on Today and at the top of Modes. */
export function courseCard({ compact = false } = {}) {
  const u = currentUnit();
  const c = C();
  if (!u) {
    return `<a class="panel link-panel course-card" href="#/course"><span class="mode-icon" aria-hidden="true" lang="ja" data-noruby>道</span>
      <span class="grow"><span class="strong big">Course</span><br><span class="small dim">Phases 0 and 1 are complete. Phase 2 is coming.</span></span><span class="dim chev" aria-hidden="true">›</span></a>`;
  }
  const phase = PHASES.find((p) => p.id === u.phase);
  return `<a class="panel link-panel course-card" href="#/course">
    <span class="mode-icon" aria-hidden="true" lang="ja" data-noruby>道</span>
    <span class="grow"><span class="small dim">Course · Phase ${phase.n} ${esc(phase.title)} · ${esc(unitLabel(u))}${c.on ? '' : ' · not in Today'}</span><br>
      <span class="strong big">${esc(u.title)}</span>
      ${compact ? '' : `<br><span class="small dim">${esc(u.goal)}</span>${progressHTML(u)}`}</span>
    <span class="dim chev" aria-hidden="true">›</span></a>`;
}

// ---------- #/course: the path ----------
export function renderPath(view) {
  const draw = () => {
    const c = C();
    const cur = currentUnit();
    const reached = new Set(reachedUnits().map((u) => u.id));
    view.innerHTML = `<div class="stack course">
      <p class="dim">A guided path through the study program: units of about a week, each with one clear goal. Open any unit of your level to read ahead; the N4 units open once N5 is done.</p>
      ${cur ? `<section class="panel stack-sm course-now" aria-label="Current unit">
          <p class="small dim">Now · ${esc(unitLabel(cur))}</p>
          <h2 class="section-title">${esc(cur.title)}</h2>
          <p class="small">${esc(cur.goal)}</p>
          ${progressHTML(cur)}
          <a class="btn primary wide" href="#/course/${cur.id}">▶ Continue</a>
        </section>` : ''}
      <div class="row-between wrap-gap">
        <label class="switch-row small grow"><span>Follow the course in Today</span><input type="checkbox" role="switch" data-act="on" ${c.on ? 'checked' : ''}></label>
        <a class="btn small-btn" href="#/grammar">文 Grammar reference</a>
      </div>
      ${PHASES.map((ph) => `<section class="stack-sm" aria-label="Phase ${ph.n}: ${esc(ph.title)}">
        <h2 class="section-label">PHASE ${ph.n} · ${esc(ph.title.toUpperCase())}</h2>
        <p class="small dim">${esc(ph.when)}. ${esc(ph.focus)}</p>
        ${UNITS.some((u) => u.phase === ph.id && !itemOpen(u)) ? `<p class="small dim">🔒 ${esc(lockLine(levelOf(UNITS.find((u) => u.phase === ph.id && !itemOpen(u)))))}</p>` : ''}
        ${phaseUnits(ph, cur, reached)}
      </section>`).join('')}
    </div>`;
  };
  // A phase that's locked or all done folds to one line; the phases still being worked on stay open.
  const phaseUnits = (ph, cur, reached) => {
    const units = UNITS.filter((u) => u.phase === ph.id);
    const locked = units.every((u) => !itemOpen(u));
    const allDone = units.every((u) => u.outline || isDone(u.id));
    const open = !locked && (!allDone || (cur && cur.phase === ph.id));
    const label = locked ? `${units.length} units, locked` : allDone ? `${units.length} units, all done` : `${units.length} units`;
    return `<details class="fold" ${open ? 'open' : ''}><summary class="small strong">${label}</summary>
      <div class="stack-sm">${units.map((u) => unitRow(u, cur, reached)).join('')}</div></details>`;
  };
  const unitRow = (u, cur, reached) => {
    const num = u.id.split('-')[1];
    if (u.outline) {
      return `<div class="panel lesson-row unit-row outline"><span class="ch-num" aria-hidden="true">${num}</span>
        <span class="grow"><span class="strong">${esc(u.title)}</span> <span class="tag">coming later</span><br>
        <span class="small dim">${esc(u.goal)} Planned: <span lang="ja">${esc(u.planned.join('・'))}</span></span></span></div>`;
    }
    if (!itemOpen(u)) {
      return `<div class="panel lesson-row unit-row locked" data-state="locked"><span class="ch-num" aria-hidden="true">${num}</span>
        <span class="grow"><span class="small dim">${esc(unitLabel(u))}</span> <span class="tag">🔒 ${esc(levelOf(u))}</span><br>
        <span class="strong">${esc(u.title)}</span><br><span class="small dim">${esc(u.goal)}</span></span></div>`;
    }
    const done = isDone(u.id);
    const isCur = cur && cur.id === u.id;
    const state = done ? 'done' : isCur ? 'current' : reached.has(u.id) ? 'reached' : 'ahead';
    return `<a class="panel lesson-row unit-row ${done ? 'cleared' : ''} ${isCur ? 'next' : ''}" href="#/course/${u.id}" data-state="${state}" ${isCur ? 'aria-current="step"' : ''}>
      <span class="ch-num" aria-hidden="true">${done ? '✓' : num}</span>
      <span class="grow"><span class="small dim">${esc(unitLabel(u))}</span>${isCur ? ' <span class="tag">current</span>' : ''}${done ? ' <span class="tag good">done</span>' : ''}<br>
        <span class="strong">${esc(u.title)}</span><br><span class="small dim">${esc(u.goal)}</span></span>
      <span class="dim chev" aria-hidden="true">›</span></a>`;
  };
  draw();
  const onChange = (ev) => {
    if (ev.target.matches('[data-act=on]')) {
      setOn(ev.target.checked);
      toast(ev.target.checked ? 'Today now follows the course' : 'Today is back to the standard plan');
    }
  };
  view.addEventListener('change', onChange);
  return () => view.removeEventListener('change', onChange);
}

// ---------- #/course/<id>: a unit ----------
export function renderUnit(view, id) {
  const u = UNIT_BY_ID[id];
  const draw = () => {
    const cur = currentUnit();
    const phase = PHASES.find((p) => p.id === u.phase);
    if (!itemOpen(u)) {
      view.innerHTML = `<div class="stack course">
        <p class="small dim">Phase ${phase.n} · ${esc(phase.title)} · ${esc(unitLabel(u))}</p>
        <h2 class="section-title">${esc(u.title)}</h2>
        <p>${esc(u.goal)}</p>
        <div class="panel note">🔒 ${esc(lockLine(levelOf(u)))}</div>
        <a class="btn wide" href="#/course">Back to the course</a></div>`;
      return;
    }
    if (u.outline) {
      view.innerHTML = `<div class="stack course">
        <p class="small dim">Phase ${phase.n} · ${esc(phase.title)} · ${esc(unitLabel(u))}</p>
        <h2 class="section-title">${esc(u.title)}</h2>
        <p>${esc(u.goal)}</p>
        <div class="panel stack-sm"><p class="strong">Coming later</p><p class="small">Planned grammar:</p>
          <ul>${u.planned.map((x) => `<li lang="ja">${esc(x)}</li>`).join('')}</ul></div>
        <a class="btn wide" href="#/course">Back to the course</a></div>`;
      return;
    }
    const isCur = cur && cur.id === u.id;
    const done = isDone(u.id);
    const phrases = (u.practice.phrases || []).map((pid) => PHRASE_BY_ID[pid]).filter(Boolean);
    const words = unitWords(u);
    view.innerHTML = `<div class="stack course">
      <section class="panel stack-sm unit-head">
        <p class="small dim">Phase ${phase.n} · ${esc(phase.title)} · ${esc(unitLabel(u))}
          ${isCur ? '<span class="tag">current</span>' : ''}${done ? '<span class="tag good">done</span>' : ''}</p>
        <h2 class="section-title">${esc(u.title)}</h2>
        <p class="lead"><span class="strong">Goal:</span> ${esc(u.goal)}</p>
        ${progressHTML(u)}
        <div class="row-gap wrap-gap">
          <a class="btn primary" href="#/course/${u.id}/lesson">▶ Lesson</a>
          ${!isCur && !done ? '<button class="btn" data-act="current">Make this my current unit</button>' : ''}
          <a class="btn" href="#/grammar">文 Grammar reference</a>
        </div>
      </section>
      ${words.length ? `<h2 class="section-label">WORDS</h2>
      <p class="small dim">Key words from the N5 deck, with their pitch (standard Tokyo accent, said on their own). They come up in the Garden too.</p>
      <div class="word-melodies">${words.map((w) => `<div class="word-cell"><button class="panel melody-item word-item" data-act="word" data-id="${esc(w.id)}" aria-label="Play ${esc(w.en)}">
        ${melodySVG(accentMorae(w.reading, w.accent), { height: 56 })}
        <span class="strong" lang="ja">${esc(w.jp)}</span><span class="small">${esc(w.en)}</span>
        <span class="tiny dim">${esc(accentName(w.accent, toMorae(w.reading).length))}</span></button>${pronButton(wordTarget(w), { compact: true })}</div>`).join('')}</div>` : ''}
      <h2 class="section-label">GRAMMAR</h2>
      ${u.points.map((p) => pointHTML(p, u)).join('')}
      <h2 class="section-label">PRACTICE</h2>
      <p class="small dim">Practice drawn from the modes, tagged to this unit. Your first try at each answer counts toward the unit; a miss just shows you the answer.</p>
      <div class="mode-grid">${practiceList(u).map((pr) => `<a class="panel mode-card practice-card" href="#/course/${u.id}/${pr.mode}" data-mode="${pr.mode}">
          <span class="grow"><span class="strong big">${esc(pr.label)}</span><br><span class="small dim" lang="ja">${esc(pr.detail)}</span></span>
          <span class="dim chev" aria-hidden="true">›</span></a>`).join('')}</div>
      ${phrases.length ? `<section class="panel stack-sm" aria-label="Phrase melodies">
        <h3 class="gp-title">Phrase melodies</h3>
        <p class="small dim">The pitch (standard Tokyo accent) of this unit's Rhythm phrases: dots up high, dots down low.</p>
        <div class="melody-list">${phrases.map((ph) => `<button class="panel melody-item" data-act="phrase" data-id="${ph.id}" aria-label="Play ${esc(ph.meaning)}">
          ${melodySVG(ph.morae, { height: 64 })}<span class="small dim">${esc(ph.meaning)}</span></button>`).join('')}</div>
      </section>` : ''}
    </div>`;
  };
  draw();
  const off = delegate(view, {
    play: (b) => playExample(exampleByKey(b.dataset.key)),
    phrase: (b) => { const ph = PHRASE_BY_ID[b.dataset.id]; if (ph) speaker.speak(ph.speak, { mps: 4 }); },
    word: (b) => { const w = N5_WORDS.find((x) => x.id === b.dataset.id); if (w) speaker.speak(w.say, { mps: 3, voice: 0 }); },
    current: () => { setCurrent(u.id); toast(`${unitLabel(u)} is now your current unit`); draw(); },
  });
  return () => { off(); speaker.stop(); };
}

// ---------- #/grammar: reference ----------
const norm = (s) => toHiragana(String(s || '').toLowerCase()).replace(/[\s、。・！？!?.,'"()（）～〜/-]+/g, '');

export function renderGrammar(view) {
  const units = reachedUnits();
  const entries = units.flatMap((u) => u.points.map((p) => {
    const text = [p.title, p.pattern, p.explain, ...p.examples.flatMap((e) => [e.jp, e.reading, e.en, romaji(e.reading)])];
    return { u, p, hay: norm(text.join('|')) };
  }));
  let query = '';
  try { query = sessionStorage.getItem('kotobaBeat.grammarQuery') || ''; } catch (e) { /* ignore */ }
  view.innerHTML = `<div class="stack course">
    <p class="dim">Every grammar point from the units you've reached (${units.length} of ${openUnits().length}), with its examples. Search in English, Japanese or romaji.</p>
    <label class="search-row"><span class="sr-only">Search grammar</span>
      <input type="search" class="search" data-act="q" placeholder="Search: past tense, を, tai…" value="${esc(query)}" autocomplete="off"></label>
    <p class="small dim" id="gram-count" aria-live="polite"></p>
    <div class="stack-sm" id="gram-list"></div>
    <a class="btn wide" href="#/course">The course path</a>
  </div>`;
  const list = view.querySelector('#gram-list');
  const count = view.querySelector('#gram-count');
  const draw = () => {
    const q = norm(query);
    const hits = q ? entries.filter((e) => e.hay.includes(q)) : entries;
    count.textContent = q ? `${hits.length} of ${entries.length} grammar points match.` : `${entries.length} grammar points.`;
    list.innerHTML = hits.length ? hits.map((e) => pointHTML(e.p, e.u, { withUnit: true })).join('')
      : '<p class="panel small">Nothing matches yet. Try another word, or reach more units in the course.</p>';
  };
  draw();
  const onInput = (ev) => {
    if (!ev.target.matches('[data-act=q]')) return;
    query = ev.target.value;
    try { sessionStorage.setItem('kotobaBeat.grammarQuery', query); } catch (e) { /* ignore */ }
    draw();
  };
  view.addEventListener('input', onInput);
  const off = delegate(view, { play: (b) => playExample(exampleByKey(b.dataset.key)) });
  return () => { off(); view.removeEventListener('input', onInput); speaker.stop(); };
}

// ---------- lesson: grammar points and examples, one card at a time (also Today's Input block) ----------
// ---------- lesson recap ----------
/**
 * 4-6 recap questions on a unit's lesson: one per grammar point, then more examples until there are at least four.
 * At most two fill-the-particle questions; the rest take turns: hear it, pick the Japanese, put it in order.
 */
export function lessonRecap(u) {
  const items = u.points.flatMap((p) => p.examples.map((ex) => ({ p, ex })));
  const words = unitWords(u);
  const others = shuffle(COURSE_EXAMPLES.filter((e) => !items.some((x) => x.ex === e)));
  const pool = (key, self) => [...shuffle(items.map((x) => x.ex[key]).filter((v) => v !== self)), ...others.map((e) => e[key])];
  const build = (p, ex, kind) => {
    const b = {
      jp: ex.jp, en: ex.en, voice: ex.voice, gradeId: `${u.id}:${p.id}`,
      garden: words.filter((w) => ex.jp.includes(w.jp)).map((w) => w.id),
    };
    if (kind === 'particle') {
      const pp = POINT_PARTICLES[p.id];
      return pp ? particleQuestion({ ...b, particles: pp[0], distractors: pp[1], why: `${p.title}. ${ex.jp} = "${ex.en}"` }) : null;
    }
    if (kind === 'order') return orderQuestion({ ...b, why: `${ex.jp}: ${p.title}.` });
    if (kind === 'listen') return listenQuestion({ ...b, pool: pool('en', ex.en), why: `${ex.jp} = "${ex.en}"`, what: 'the line' });
    return meaningQuestion({ ...b, skill: 'grammar', pool: pool('jp', ex.jp), why: `"${ex.en}" is ${ex.jp}` });
  };
  const kinds = ['listen', 'meaning', 'order'];
  const out = [];
  const used = new Set();
  let turn = 0;
  let particles = 0;
  const add = (p, ex) => {
    if (particles < 2) {
      const q = build(p, ex, 'particle');
      if (q) { particles++; out.push(q); used.add(ex); return; }
    }
    for (let k = 0; k < kinds.length; k++) {
      const q = build(p, ex, kinds[(turn + k) % kinds.length]);
      if (q) { turn = (turn + k + 1) % kinds.length; out.push(q); used.add(ex); return; }
    }
  };
  for (const p of u.points) if (out.length < 6) add(p, p.examples[0]);
  for (const { p, ex } of items) { if (out.length >= 4) break; if (!used.has(ex)) add(p, ex); }
  // A unit with few examples: ask about the same lines another way.
  for (const { p, ex } of items) { if (out.length >= 4) break; particles = 2; add(p, ex); }
  return out.slice(0, 6);
}

export function mountLesson(el, ctx) {
  const u = UNIT_BY_ID[ctx.unitId] || currentUnit() || STUDY_UNITS[0];
  const cards = u.points.flatMap((p) => p.examples.map((ex, i) => ({ p, ex, first: i === 0 })));
  let i = 0;
  let showEnglish = false;
  let finished = false;
  let recapOff = null;     // the recap quiz, while it's showing
  let recap = null;        // its result once done or skipped
  markReached(u.id);

  function render() {
    if (finished) {
      el.innerHTML = `<div class="stack course">
        <h2 class="section-title">Lesson read ✓</h2>
        <p>${esc(unitLabel(u))} · ${esc(u.title)}. Now practise it: your first-try answers count toward the unit.</p>
        ${recap && !recap.skipped ? `<p class="small dim">Recap: ${recap.ok} of ${recap.total} right on the first try.</p>` : ''}
        <div class="mode-grid">${practiceList(u).map((pr) => `<a class="panel mode-card" href="#/course/${u.id}/${pr.mode}">
          <span class="grow"><span class="strong big">${esc(pr.label)}</span><br><span class="small dim" lang="ja">${esc(pr.detail)}</span></span><span class="dim chev" aria-hidden="true">›</span></a>`).join('')}</div>
        ${ctx.today ? '' : `<a class="btn wide" href="#/course/${u.id}">Back to the unit</a>`}
      </div>`;
      return;
    }
    const { p, ex } = cards[i];
    el.innerHTML = `<div class="stack course lesson">
      <div class="row-between"><span class="small dim">${esc(unitLabel(u))} · ${esc(u.title)}</span><span class="small dim mono">${i + 1}/${cards.length}</span></div>
      <div class="bar"><span style="width:${((i + 1) / cards.length) * 100}%"></span></div>
      <section class="panel stack-sm note">
        <h3 class="gp-title">${esc(p.title)}</h3>
        <p class="gp-pattern" lang="ja">${esc(p.pattern)}</p>
        <p class="small">${esc(p.explain)}</p>
      </section>
      <button class="panel line-card" data-act="meaning" aria-label="Tap to show meaning">
        <span class="reading dim" data-noruby>${esc(ex.reading)}</span>
        <span class="line-jp" lang="ja">${esc(ex.jp)}</span>
        ${showEnglish ? `<span class="trace-c">${esc(ex.en)}</span>` : '<span class="small dim">Tap for meaning</span>'}
      </button>
      <div class="row3">
        <button class="btn" data-act="replay">🔊 Replay</button>
        <button class="btn" data-act="meaning">📖 Meaning</button>
        <button class="btn primary" data-act="next">${i + 1 < cards.length ? 'Next ▶' : 'Finish ✓'}</button>
      </div>
      ${pronButton({ id: `ex:${u.id}:${p.id}:${p.examples.indexOf(ex)}`, jp: ex.jp, reading: ex.reading, say: ex.jp, voice: ex.voice, en: ex.en }, { cls: 'btn ghost small-btn wide' })}
    </div>`;
  }

  const speak = () => playExample(cards[i]?.ex);
  function next() {
    if (i + 1 < cards.length) {
      i++;
      showEnglish = false;
      if (ctx.today) ctx.today.report(`${i + 1}/${cards.length}`);
      render();
      speak();
    } else {
      finished = true;
      markRead(u.id);
      store.markStudied();
      speaker.stop();
      if (ctx.today) ctx.today.done();
      // A quick recap before the practice list: skippable, and the lesson already counts as read.
      recapOff = mountRecap(el, {
        questions: lessonRecap(u), title: 'Lesson recap', quiet: store.settings.quiet, doneLabel: 'On to practice ▶',
        onDone: (r) => {
          if (recapOff) recapOff();
          recapOff = null;
          recap = r;
          render();
          window.scrollTo(0, 0);
          fx.hit({ big: true, el: el.querySelector('.section-title') });
        },
      });
    }
  }

  const off = delegate(el, {
    meaning: () => { showEnglish = !showEnglish; render(); },
    replay: speak,
    next,
  });
  store.markSession();
  if (ctx.today) ctx.today.report(`1/${cards.length}`);
  render();
  speak();
  return () => { off(); if (recapOff) recapOff(); speaker.stop(); };
}

// ---------- #/course/<id>/<mode>: tagged practice ----------
export function mountPractice(view, banner, id, modeId, mod, quiet) {
  const u = UNIT_BY_ID[id];
  const pr = practiceList(u).find((x) => x.mode === modeId);
  let completedHere = false;
  const draw = (st = unitStats(id), justDone = false) => {
    if (justDone) completedHere = true;
    banner.hidden = false;
    const acc = st.recent == null ? '–' : Math.round(st.recent * 100) + '%';
    banner.innerHTML = `<div class="banner ${st.done ? 'done' : ''} course-banner"><span class="grow"><span class="small dim">${esc(unitLabel(u))} practice · ${esc(MODE_BY_ID[modeId].title)}</span><br>
      <span class="strong">${st.done ? (completedHere ? "✓ Unit complete!" : "✓ Unit done") : `${st.tot} answer${st.tot === 1 ? "" : "s"} · ${acc} first try`}</span>
      ${st.done ? '' : `<span class="small dim"> (target ${Math.round(UNIT_TARGET * 100)}% over ${UNIT_MIN_ANSWERS}+)</span>`}</span>
      <a class="btn small-btn" href="#/course/${id}">Unit</a></div>`;
  };
  draw();
  const stop = trackUnit(id, (st, justDone) => draw(st, justDone));
  const cleanupMode = mod.mount(view, { ...(pr ? pr.ctx : {}), quiet, unit: id });
  return () => { stop(); if (cleanupMode) cleanupMode(); };
}

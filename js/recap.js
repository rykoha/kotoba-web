// Quick recap: a short quiz (3-6 questions) at the end of anything that teaches something new: a course lesson, a
// story scene, the Garden's new words, a round of new kanji. One shared component; each mode only builds questions.
//
// It asks for recall where it can: hear Japanese and pick the meaning, see the meaning and pick the Japanese, fill
// the particle in a sentence, put a short sentence in order. Scoring is generous: a miss shows the answer with a
// one-line reason, the question comes back once at the end, and its Garden words come up for review sooner. It is
// always skippable and never blocks moving on. Only existing lines are spoken, so every one has its VOICEVOX clip.
import { store } from './store.js';
import { speaker } from './audio.js';
import { GARDEN_CATALOG } from './data.js';
import { recentRate } from './skills.js';
import { esc, shuffle, delegate } from './ui.js';
import * as fx from './fx.js';

/**
 * A question:
 *   type     'choice' (pick one) or 'order' (tap tiles into order)
 *   ask      the instruction, in English ("Listen. What does it mean?")
 *   show     text to show (or null), showJa: it's Japanese, noruby: hide reading help (it would give the answer away)
 *   say      { text, voice } played when the question opens (and on 🔊), or null
 *   options  choices, right one first (shuffled when shown); optsJa / optsNoruby as for `show`
 *   tiles    for 'order': the pieces in the right order; free: any order is right as long as the last stays last
 *   after    { text, voice } spoken once answered (the whole sentence), or null
 *   why      one line shown with the answer after a miss
 *   skill    skill area graded (store.grade), gradeId its item id, garden: Garden ids that come back sooner on a miss
 */

/** How many options to show: 4 normally, 3 while recent answers in that skill are below ~80% (aiming at ~85% right). */
export function optionCount(skill) {
  const r = recentRate(store.engine, skill);
  return r != null && r < 0.8 ? 3 : 4;
}

/** Picks `n - 1` distractors from `pool` (in its order: put the best ones first) that differ from `right` and from
 *  each other, keeping `right` first. */
export function withDistractors(right, pool, n) {
  const out = [right];
  for (const x of pool) {
    if (out.length >= n) break;
    if (x && !out.includes(x)) out.push(x);
  }
  return out;
}

/** Quiet mode: a listening question shows its Japanese instead of playing it. */
function forQuiet(q) {
  if (!q.say || q.show) return q;
  return { ...q, ask: q.askQuiet || 'Read it. What does it mean?', show: q.say.text, showJa: true, say: null };
}

/**
 * Mounts a recap into `el`. Calls onDone({ skipped, ok, total }) when it's finished or skipped (the caller then
 * shows what comes next). Returns a cleanup function. With no questions it calls onDone right away.
 */
export function mountRecap(el, { questions, title = 'Quick recap', quiet = false, onDone = () => {}, doneLabel = 'Continue ▶' }) {
  const qs = questions.filter(Boolean).slice(0, 6).map((q) => prepare(quiet ? forQuiet(q) : q));
  let queue = qs.map((q) => ({ q, retry: false }));
  let pos = 0;
  let state = null;        // the current question's answer state
  let firstOk = 0;
  let ended = false;
  const missedGarden = new Set();

  function prepare(q) {
    if (q.type === 'order') {
      let order = shuffle(q.tiles.map((_, i) => i));
      // Never start already in order.
      if (order.every((x, i) => x === i) && order.length > 1) order = [...order.slice(1), order[0]];
      return { ...q, order };
    }
    const opts = shuffle(q.options.map((_, i) => i));
    return { ...q, opts };
  }

  function finish(skipped) {
    if (ended) return;
    ended = true;
    speaker.stop();
    if (missedGarden.size) store.recapMissed([...missedGarden]);
    onDone({ skipped, ok: firstOk, total: qs.length });
  }

  if (!qs.length) { setTimeout(() => finish(false), 0); return () => {}; }

  const cur = () => queue[pos];
  const play = (s) => { if (s) speaker.speak(s.text, { mps: 4, voice: s.voice || 0 }); };

  function open() {
    state = { picked: -1, placed: [], answered: false, ok: false };
    render();
    play(cur().q.say);
    el.querySelector('.recap-ask')?.focus({ preventScroll: true });
  }

  function answer(ok) {
    const { q, retry } = cur();
    state.answered = true;
    state.ok = ok;
    if (!retry) {
      if (ok) firstOk++;
      store.log(ok);
      if (q.skill) store.grade({ skill: q.skill, id: q.gradeId ?? null, ok, firstTry: true });
      if (!ok) {
        queue.push({ q: prepare(q), retry: true });   // comes back once, at the end
        for (const id of q.garden || []) missedGarden.add(id);
      }
    }
    render();
    play(q.after);
    if (ok) fx.hit({ el: el.querySelector('.recap-feedback') }); else fx.miss({ el: el.querySelector('.recap-feedback') });
    el.querySelector('[data-act=rc-next]')?.focus({ preventScroll: true });
  }

  function next() {
    pos++;
    if (pos < queue.length) open(); else { state = null; render(); fx.hit({ big: firstOk === qs.length, el: el.querySelector('.recap-title') }); }
  }

  const jaAttrs = (ja, noruby) => `${ja ? ' lang="ja"' : ''}${noruby ? ' data-noruby' : ''}`;

  function choiceHTML(q) {
    return `<div class="choice-grid recap-opts">${q.opts.map((oi, k) => {
      let cls = '';
      if (state.answered) cls = oi === 0 ? 'good' : k === state.picked ? 'wrong' : 'faded';
      return `<button class="btn ${cls}" data-act="rc-pick" data-k="${k}" ${state.answered ? 'disabled' : ''}${jaAttrs(q.optsJa, q.optsNoruby)}>${esc(q.options[oi])}</button>`;
    }).join('')}</div>`;
  }

  function orderHTML(q) {
    const placed = state.answered ? (state.ok ? state.placed : q.tiles.map((_, i) => i)) : state.placed;
    const left = q.order.filter((i) => !state.placed.includes(i));
    return `
      <div class="tile-row answer-row ${state.answered ? (state.ok ? 'is-right' : 'is-shown') : ''}"${jaAttrs(true, q.optsNoruby)} aria-label="Your sentence">
        ${placed.length ? placed.map((i, k) => `<button class="word-tile placed" data-act="rc-untile" data-k="${k}" ${state.answered ? 'disabled' : ''}>${esc(q.tiles[i])}</button>`).join('')
          : '<span class="small dim">Tap the pieces in order.</span>'}
      </div>
      ${state.answered ? '' : `<div class="tile-row"${jaAttrs(true, q.optsNoruby)} aria-label="Pieces">${left.map((i) => `<button class="word-tile" data-act="rc-tile" data-i="${i}">${esc(q.tiles[i])}</button>`).join('')}</div>`}`;
  }

  function render() {
    if (!state) {
      const missed = queue.some((x) => x.retry);
      el.innerHTML = `<section class="stack recap" aria-label="${esc(title)}">
        <h2 class="section-title recap-title">${esc(title)} ✓</h2>
        <p class="lead"><span class="strong">${firstOk} of ${qs.length}</span> right on the first try.</p>
        <p class="small dim">${firstOk >= qs.length ? 'All of it stuck. Nice.' : missed && missedGarden.size ? 'The ones you missed come back in your Garden soon. Seeing the answer counts as learning it.' : 'Seeing the answer counts as learning it. No penalty.'}</p>
        <button class="btn primary wide" data-act="rc-done">${esc(doneLabel)}</button>
      </section>`;
      return;
    }
    const { q, retry } = cur();
    const right = q.type === 'order' ? q.tiles.join(' ') : q.options[0];
    el.innerHTML = `<section class="stack recap" aria-label="${esc(title)}">
      <div class="row-between recap-head"><span class="section-label">${esc(title.toUpperCase())}</span>
        <span class="small dim mono">${Math.min(pos + 1, queue.length)}/${queue.length}</span>
        <button class="btn ghost small-btn" data-act="rc-skip">Skip recap</button></div>
      <div class="bar"><span style="width:${(pos / queue.length) * 100}%"></span></div>
      ${retry ? '<p class="small dim">One more try at this one.</p>' : ''}
      <p class="strong recap-ask" tabindex="-1">${esc(q.ask)}</p>
      ${q.show ? `<p class="${q.showJa ? 'recap-show-jp' : 'lead recap-show'}"${jaAttrs(q.showJa, q.noruby)}>${esc(q.show)}</p>` : ''}
      ${q.say ? '<button class="btn ghost small-btn recap-play" data-act="rc-play">🔊 Play again</button>' : ''}
      ${q.type === 'order' ? orderHTML(q) : choiceHTML(q)}
      ${state.answered ? `<div class="recap-feedback" role="status">
          ${state.ok ? '<p class="good-c strong">✓ Right!</p>'
            : `<p class="strong">Answer: <span${jaAttrs(q.type === 'order' || q.optsJa, false)}>${esc(right)}</span></p>${q.why ? `<p class="small">${esc(q.why)}</p>` : ''}
               ${retry ? '' : '<p class="small dim">It comes back once at the end.</p>'}`}
        </div>
        <button class="btn primary wide" data-act="rc-next">${pos + 1 < queue.length ? 'Next ▶' : 'Finish ✓'}</button>` : ''}
    </section>`;
  }

  function placeTile(i) {
    const q = cur().q;
    if (state.answered || state.placed.includes(i)) return;
    state.placed.push(i);
    if (state.placed.length < q.tiles.length) { render(); return; }
    const exact = state.placed.every((x, k) => x === k);
    // Phrases marked by a particle can come in any order before the last piece: accept those orders too.
    const free = q.free && state.placed[state.placed.length - 1] === q.tiles.length - 1;
    answer(exact || free);
  }

  const off = delegate(el, {
    'rc-pick': (b) => { if (state.answered) return; state.picked = +b.dataset.k; answer(cur().q.opts[state.picked] === 0); },
    'rc-tile': (b) => placeTile(+b.dataset.i),
    'rc-untile': (b) => { if (!state.answered) { state.placed.splice(+b.dataset.k, 1); render(); } },
    'rc-play': () => play(cur().q.say),
    'rc-next': next,
    'rc-skip': () => finish(true),
    'rc-done': () => finish(false),
  });

  open();
  return () => { off(); if (!ended) speaker.stop(); };
}

// ---------- question builders shared by the modes ----------

/** "明日 (あした)", or just "おはよう" when the word is already written in kana. */
export const withReading = (jp, reading) => (reading && reading !== jp ? `${jp} (${reading})` : jp);

/** Default wrong options for each particle. Callers that know the sentence pattern pass better ones (see course.js). */
export const PARTICLE_DISTRACTORS = {
  'は': ['を', 'に', 'で', 'の'],
  'が': ['に', 'で', 'へ', 'の'],
  'を': ['に', 'で', 'の', 'へ'],
  'に': ['を', 'で', 'の'],
  'へ': ['を', 'で', 'の'],
  'で': ['を', 'の', 'が'],
  'と': ['を', 'の', 'へ'],
  'も': ['を', 'で', 'の'],
  'の': ['を', 'で', 'に'],
};
const TRAIL = /[、。！？!?…]+$/;

/** The sentence's space-separated pieces (the way lines are written in this app). */
export const pieces = (jp) => jp.trim().split(/\s+/).filter(Boolean);

/**
 * A fill-the-particle question for a sentence, blanking the first piece that ends in one of `particles`, or null.
 * `en` is shown as a hint; `say` is the sentence's clip, played once answered.
 */
export function particleQuestion({ jp, en, voice = 0, particles, distractors = null, why, skill = 'grammar', gradeId = null, garden = [] }) {
  const ps = pieces(jp);
  for (let k = 0; k < ps.length; k++) {
    const core = ps[k].replace(TRAIL, '');
    const tail = ps[k].slice(core.length);
    const p = core.slice(-1);
    const wrong = (distractors || PARTICLE_DISTRACTORS[p] || []).filter((x) => !particles.includes(x));
    if (core.length < 2 || !particles.includes(p) || wrong.length < 2) continue;
    const blanked = ps.map((x, i) => (i === k ? core.slice(0, -1) + '（　）' + tail : x)).join(' ');
    const n = Math.min(optionCount(skill), wrong.length + 1);
    return {
      type: 'choice', ask: `Fill in the particle: "${en}"`, show: blanked, showJa: true, noruby: false,
      options: withDistractors(p, shuffle(wrong), n), optsJa: true, optsNoruby: true,
      after: { text: jp, voice }, why, skill, gradeId, garden,
    };
  }
  return null;
}

/** An "order the pieces" question for a sentence of 3-5 pieces, or null. */
export function orderQuestion({ jp, en, voice = 0, why = null, skill = 'grammar', gradeId = null, garden = [] }) {
  const ps = pieces(jp);
  if (ps.length < 3 || ps.length > 5 || new Set(ps).size !== ps.length) return null;
  // の and と ("and") tie a word to the next one, so only phrases ending in these particles may move freely.
  const free = ps.slice(0, -1).every((x) => /[はがをにでへも]$/.test(x.replace(TRAIL, '')));
  return {
    type: 'order', ask: `Put it in order: "${en}"`, tiles: ps, free, optsNoruby: false,
    after: { text: jp, voice }, why: why || 'Japanese puts the verb or です at the end.', skill, gradeId, garden,
  };
}

/** Hear a line, pick its meaning. */
export function listenQuestion({ jp, en, voice = 0, say = null, pool, skill = 'listening', gradeId = null, garden = [], why = null, what = 'it' }) {
  return {
    type: 'choice', ask: `Listen. What does ${what} mean?`, askQuiet: `Read ${what}. What does it mean?`,
    say: { text: say || jp, voice }, show: null,
    options: withDistractors(en, pool, optionCount(skill)), optsJa: false,
    after: null, why: why || `You heard ${jp}.`, skill, gradeId, garden,
  };
}

let synonyms = null;
/** Japanese words that share an English meaning (だれ and 誰 are both "who"): none may be a wrong option for another. */
export function sameMeaning(en) {
  if (!synonyms) {
    synonyms = new Map();
    for (const w of Object.values(GARDEN_CATALOG)) {
      if (!w || !w.en) continue;
      const k = String(w.en).trim().toLowerCase();
      if (!synonyms.has(k)) synonyms.set(k, new Set());
      synonyms.get(k).add(w.jp);
    }
  }
  return synonyms.get(String(en).trim().toLowerCase()) || new Set();
}

/** See the meaning, pick the Japanese (reading help off on the options when `noruby`). */
export function meaningQuestion({ jp, en, voice = 0, say = null, pool, skill = 'vocab', gradeId = null, garden = [], noruby = false, why = null }) {
  const same = sameMeaning(en);
  return {
    type: 'choice', ask: `Which one means "${en}"?`, show: null,
    options: withDistractors(jp, pool.filter((x) => !same.has(x)), optionCount(skill)), optsJa: true, optsNoruby: noruby,
    after: { text: say || jp, voice }, why: why || `${jp} means "${en}".`, skill, gradeId, garden,
  };
}

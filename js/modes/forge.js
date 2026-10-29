// Kanji Forge (KanjiForgeView.swift): combine components into a kanji to unlock a real word.
import { store } from '../store.js';
import { earlyHint } from '../tuning.js';
import { speaker } from '../audio.js';
import { PART_NAMES } from '../data.js';
import { content, pickMixed, levelBar } from '../levels.js';
import { esc, shuffle, delegate, pick } from '../ui.js';
import * as fx from '../fx.js';
import { mountRecap, withDistractors, optionCount, withReading } from '../recap.js';

export function mount(el, ctx) {
  const GOAL = 3;
  // The unlocked levels' kanji: N5 first, then N4 once unlocked (js/levels.js).
  const KANJI = content('forge');
  let target = null;
  let tray = [];
  let anvil = [];
  let message = null;
  let forged = false;
  let showStory = false;
  let practice = false;   // all forged: re-forge old ones for practice
  let done = 0;
  let firstTry = true;
  let misses = 0;          // strikes that missed on this kanji: after two, its parts are shown
  let newForged = [];      // kanji forged for the first time this visit (recapped after each round of GOAL)
  let recapOff = null;

  function nextTarget() {
    forged = false;
    showStory = earlyHint(store.engine, 'kanji');   // difficulty targeting: story hint up front while kanji is hard
    message = null;
    anvil = [];
    firstTry = true;
    misses = 0;
    const have = store.forgedKanji;
    const remaining = KANJI.filter((k) => !have.has(k.kanji));
    practice = remaining.length === 0 && (practice || !!ctx.today);
    // New kanji in order; once all are forged, practice mostly the newest level's (about 70%).
    target = remaining[0] || (practice ? pickMixed(KANJI.filter((k) => k !== target)) : null);
    if (!target) return;
    const uniq = [...new Set(target.parts)];
    const others = shuffle(Object.keys(PART_NAMES).filter((p) => !target.parts.includes(p))).slice(0, 8 - uniq.length);
    tray = shuffle(uniq.concat(others));
  }

  const tile = (part, hi, act, i) => `<button class="part ${hi ? 'hi' : ''}" data-act="${act}" data-i="${i}" lang="ja">
      <span class="part-k">${esc(part)}</span><span class="part-n">${esc(PART_NAMES[part] || '')}</span></button>`;

  function render() {
    if (recapOff) return;   // the recap draws itself
    const have = store.forgedKanji;
    const t = target;
    el.innerHTML = `
      <div class="stack">
        <div>
          ${levelBar('forge')}
          <p class="strong mono">Forged ${KANJI.filter((k) => have.has(k.kanji)).length} of ${KANJI.length}</p>
          <div class="bar"><span style="width:${(KANJI.filter((k) => have.has(k.kanji)).length / KANJI.length) * 100}%"></span></div>
        </div>
        ${t ? `
          <div>
            <p class="small dim">${practice ? 'Practice: re-forge the kanji for' : 'Forge the kanji for'}</p>
            <p class="forge-meaning">"${esc(t.meaning)}"</p>
            ${showStory ? `<p class="trace-c">${esc(t.story)}</p>` : '<button class="linkbtn" data-act="story">Show the story hint</button>'}
          </div>
          <div class="panel anvil">
            ${forged ? `
              <div class="forged-k" lang="ja">${esc(t.kanji)}</div>
              <p class="strong lead" lang="ja">${esc(t.word)} (${esc(t.reading)}): ${esc(t.wordEn)}</p>
              <p class="small dim">${practice ? 'Already growing in your garden.' : 'Planted in your garden.'}</p>`
            : `<div class="anvil-row">${anvil.length ? anvil.map((p, i) => tile(p, true, 'unplace', i)).join('') : '<span class="dim small">Tap parts to place them on the anvil</span>'}</div>`}
          </div>
          ${message ? `<p class="miss-c">${esc(message)}</p>` : ''}
          ${forged
            ? '<button class="btn primary wide" data-act="next">🔨 Next kanji</button>'
            : `<div class="part-grid">${tray.map((p, i) => tile(p, misses >= 2 && t.parts.includes(p), 'add', i)).join('')}</div>
               <button class="btn primary wide" data-act="strike" ${anvil.length ? '' : 'disabled'}>🔨 Strike the anvil</button>`}
        ` : `<p>You've forged every kanji in this set. More are coming.</p>
             <button class="btn wide" data-act="practice">Practice re-forging</button>`}
        ${have.size ? `<p class="section-label">YOUR FORGE</p>
          <div class="forge-grid">${KANJI.filter((k) => have.has(k.kanji)).map((k) => `<span class="panel forge-k" lang="ja" title="${esc(k.word)} · ${esc(k.wordEn)}">${esc(k.kanji)}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  function strike() {
    const t = target;
    const a = anvil.slice().sort().join();
    const b = t.parts.slice().sort().join();
    if (a === b) {
      forged = true;
      message = null;
      if (firstTry) store.log(true);
      store.grade({ skill: 'kanji', id: t.kanji, ok: true, firstTry });
      if (!practice) {
        store.forge(t.kanji);
        store.plant(t.gardenID);
        newForged.push(t);
      }
      speaker.speak(t.reading, { mps: 3 });
      done++;
      if (ctx.today) {
        ctx.today.report(`${Math.min(done, GOAL)}/${GOAL}`);
        if (done >= GOAL) ctx.today.done();
      }
    } else {
      if (firstTry) store.log(false);
      store.grade({ skill: 'kanji', id: t.kanji, ok: false, firstTry });
      firstTry = false;
      misses += 1;
      // A second miss shows the answer instead of leaving it to guesswork.
      message = misses >= 2
        ? `It's ${t.parts.map((p) => `${p} (${PART_NAMES[p] || p})`).join(' + ')}. Place ${t.parts.length === 1 ? 'it' : 'them'} on the anvil and strike.`
        : `Not quite. This kanji needs ${t.parts.length} parts.`;
      anvil = [];
    }
    render();
    if (forged) fx.hit({ big: true, el: el.querySelector('.forged-k') }); else fx.miss({ el: el.querySelector('.anvil') });
  }

  /** Two questions per new kanji: see its word and pick the meaning, then hear the word and pick how it's written
   *  (reading help off there, since furigana would give the answer away). */
  function forgeRecap(ks) {
    const see = ks.map((k) => ({
      type: 'choice', ask: 'What does this word mean?', show: k.word, showJa: true, noruby: false,
      options: withDistractors(k.wordEn, shuffle(KANJI.map((x) => x.wordEn)), optionCount('kanji')),
      after: { text: k.reading, voice: 0 }, why: `${withReading(k.word, k.reading)} means "${k.wordEn}". ${k.story}`,
      skill: 'kanji', gradeId: k.kanji, garden: [k.gardenID],
    }));
    const hear = ks.map((k) => ({
      type: 'choice', ask: 'Listen. Which word is it?', askQuiet: `Which word is read ${k.reading}?`,
      say: { text: k.reading, voice: 0 }, show: null,
      options: withDistractors(k.word, [...shuffle(ks.map((x) => x.word)), ...shuffle(KANJI.map((x) => x.word))], optionCount('kanji')),
      optsJa: true, optsNoruby: true,
      why: `${k.reading} is written ${k.word}: ${k.meaning} (${k.parts.join(' + ')}).`, skill: 'kanji', gradeId: k.kanji, garden: [k.gardenID],
    }));
    return [...see, ...hear].slice(0, 6);
  }

  function nextOrRecap() {
    const remaining = KANJI.some((k) => !store.forgedKanji.has(k.kanji));
    if (newForged.length >= GOAL || (newForged.length && !remaining)) {
      const ks = newForged;
      newForged = [];
      recapOff = mountRecap(el, {
        questions: forgeRecap(ks), title: 'Kanji recap', quiet: !!ctx.quiet, doneLabel: 'Back to the forge',
        onDone: () => { if (recapOff) recapOff(); recapOff = null; nextTarget(); render(); window.scrollTo(0, 0); },
      });
      return;
    }
    nextTarget();
    render();
  }

  const off = delegate(el, {
    story: () => { showStory = true; render(); },
    add: (b) => { if (anvil.length < 3) { anvil.push(tray[+b.dataset.i]); render(); } },
    unplace: (b) => { anvil.splice(+b.dataset.i, 1); render(); },
    strike,
    next: nextOrRecap,
    practice: () => { practice = true; nextTarget(); render(); },
  });

  store.markSession();
  nextTarget();
  if (ctx.today) ctx.today.report(`0/${GOAL}`);
  render();
  return () => { off(); if (recapOff) recapOff(); speaker.stop(); };
}

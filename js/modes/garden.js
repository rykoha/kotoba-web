// Garden (GardenView.swift): every word becomes a plant that needs watering at growing intervals. Nothing ever dies.
//
// The daily watering mixes several kinds of review card, each on its own schedule (store.dailyGardenQueue):
//   Meaning   see the Japanese, recall the meaning (every word)
//   Listen    hear the word with no text, recall the meaning   } added once a word's Meaning card reaches stage 3,
//   Say it    see the English, say the Japanese out loud       } at most 3 new a day
//   Grammar   fill the blank in a course example sentence, or pick a conjugated form (js/grammar-cards.js)
// A card missed about 4 times gets a 🩹 and a help panel before its next review (mnemonic, slow audio, example,
// look-alikes) until it's right twice in a row. The plant's growth stage only ever follows the Meaning card.
import { store, DAILY_REVIEW_CAP } from '../store.js';
import { speaker, Recognizer, recognitionSupported, normalizeJa } from '../audio.js';
import { gardenStage, accentMorae, accentName, toMorae, N5_WORDS, N4_WORDS, N3_WORDS, GARDEN_CATALOG } from '../data.js';
import { isUnlocked, lockLine, levelBar } from '../levels.js';
import { mountRecap, listenQuestion, meaningQuestion, withReading, optionCount } from '../recap.js';
import { cardQuestion, cardName } from '../grammar-cards.js';
import { mnemonicFor, confusablesFor, exampleFor } from '../word-help.js';
import { readingOf } from '../furigana.js';
import { pronButton, wordTarget } from '../pron.js';
import { partnerOf } from '../pairs.js';
import { esc, shuffle, delegate, melodySVG } from '../ui.js';
import * as fx from '../fx.js';

const LABELS = { mean: '👁 Meaning', listen: '🎧 Listen', say: '🗣 Say it', grammar: '📐 Grammar', conj: '🔁 Conjugation' };

/** How alike two strings are (shared character pairs), 0..1. Generous on purpose: recognition is imperfect. */
function likeness(a, b) {
  const pairs = (s) => { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out.length ? out : [s]; };
  const pa = pairs(a);
  const pool = [...pairs(b)];
  let hit = 0;
  for (const p of pa) { const j = pool.indexOf(p); if (j >= 0) { hit++; pool.splice(j, 1); } }
  return (2 * hit) / (pa.length + pool.length + hit);
}

export function mount(el, ctx) {
  const cap = ctx.cap || DAILY_REVIEW_CAP;
  const recognizer = new Recognizer();
  let speech = !ctx.quiet && recognitionSupported;   // Say it cards: graded by speech recognition when it's there
  let session = [];
  let position = 0;
  let revealed = false;
  let helping = false;     // the help panel is showing for the current card
  let helpShown = new Set();
  let gram = null;         // the current grammar card's question: { q, picked }
  let heard = '';
  let heardOk = false;
  let micOn = false;       // the mic starts when the learner taps 🎤, or on its own if Settings says so
  let hint = false;        // Say it: the example's English is showing
  let fresh = [];          // words seen for the first time this session (recapped at the end)
  let firstSeen = false;   // the current card is a word never reviewed before: shown to study, marked NEW
  let recapOff = null;
  let practice = '';       // '' daily watering, 'extra' or 'help' (on purpose, from the overview)
  let helpData = { alike: [], example: null };   // what the help panel's 🔊 buttons play

  const cur = () => session[position];
  const sayOf = (item) => item.say || item.reading;
  const kindOf = (card) => (card.kind === 'gram' ? (card.id.startsWith('cj:') ? 'conj' : 'grammar') : card.dir);

  function begin(cards, mode = '') {
    session = keepPairsTogether(shuffle(cards));
    practice = mode;
    fresh = session.filter(isFirstSight).map((c) => c.item);
    position = 0;
    helpShown = new Set();
    openCard();
  }

  /** A word card never reviewed before: it opens as a study card, marked NEW. */
  function isFirstSight(c) { return c.kind === 'word' && c.dir === 'mean' && !(store.item(c.id)?.r); }

  /** New partner words (男 and 女, js/pairs.js) meet back to back, so they're learned as a pair. */
  function keepPairsTogether(cards) {
    const out = cards.slice();
    for (let i = 0; i < out.length; i++) {
      if (!isFirstSight(out[i])) continue;
      const p = partnerOf(out[i].item.jp);
      const j = p ? out.findIndex((c, k) => k > i + 1 && isFirstSight(c) && c.item.jp === p.jp) : -1;
      if (j > 0) out.splice(i + 1, 0, ...out.splice(j, 1));
    }
    return out;
  }

  function startDaily() { begin(store.dailyGardenQueue(cap).queue); }

  /** Sets up the current card: the help panel first if it needs help, then the card itself. */
  function openCard() {
    revealed = false;
    gram = null;
    heard = '';
    heardOk = false;
    micOn = false;
    hint = false;
    recognizer.stop();
    const card = cur();
    firstSeen = !!card && isFirstSight(card);
    if (!card) { render(); return; }
    const st = store.cardState(card);
    const key = `${card.kind}:${card.dir || ''}:${card.id}`;
    helping = !!(st && st.help && !helpShown.has(key));
    if (helping) helpShown.add(key);
    render();
    if (helping) { playHelp(card); return; }
    startCard(card);
  }

  function startCard(card) {
    if (card.kind === 'gram') {
      const st = store.cardState(card);
      const q = cardQuestion(card.id, st ? st.r : 0, optionCount('grammar'));
      gram = { q, opts: shuffle(q.options.map((_, i) => i)), picked: -1 };
      render();
      return;
    }
    if (card.dir === 'listen' || firstSeen) speaker.speak(sayOf(card.item), { mps: 3.5 });
    // "Start the mic on its own" (Settings): Say it cards listen as soon as they open.
    if (card.dir === 'say' && speech && store.settings.autoMic && !revealed) { micOn = true; render(); listen(card); }
  }

  // ---------- Say it: speech recognition ----------
  function listen(card) {
    const item = card.item;
    const targets = [...new Set([item.jp, item.reading, item.say, readingOf(item.jp)].filter(Boolean).map((t) => normalizeJa(t)))].filter(Boolean);
    recognizer.onTranscript = (text, alts = '') => {
      if (cur() !== card || revealed) return;
      heard = text;
      const tries = [text, ...String(alts || '').split(/\s*\|\s*|\n/)].filter(Boolean);
      if (tries.some((h) => targets.some((t) => h.includes(t) || likeness(h, t) >= 0.6))) {
        heardOk = true;
        reveal();
        return;
      }
      status();
    };
    recognizer.onState = () => { if (cur() === card && !revealed) status(); };
    recognizer.onUnavailable = () => { speech = false; if (cur() === card && !revealed) render(); };
    recognizer.start([sayOf(item)]);
  }

  function status() {
    const h = el.querySelector('#gd-heard');
    if (h) h.textContent = heard ? `Heard: 「${heard}」` : recognizer.listening ? '🎤 Listening… say it in Japanese' : 'Starting the mic…';
  }

  function reveal() {
    const card = cur();
    recognizer.stop();
    revealed = true;
    render();
    speaker.speak(sayOf(card.item), { mps: 3.5 });
    if (heardOk) fx.hit({ el: el.querySelector('.review-jp') });
  }

  // ---------- rendering ----------
  function render() {
    if (recapOff) return;   // the recap draws itself
    const card = cur();
    if (!card) return renderOverview();
    if (helping) return renderHelp(card);
    if (card.kind === 'gram') return renderGrammar(card);
    renderWord(card);
  }

  function renderOverview() {
    const planted = store.planted();
    const thirsty = store.thirsty();
    const daily = store.dailyGardenQueue(cap);
    const n = daily.queue.length;
    const reviewedToday = store.day().rev;
    const help = store.helpCards();
    const grammarCount = Object.keys(store.s.grammar).length;
    let action = '';
    if (n) {
      action = `<button class="btn primary wide" data-act="water">💧 Water ${n} plant${n === 1 ? '' : 's'}</button>`;
    } else if (store.dueCards().length) {
      const due = store.dueCards();
      action = `<div class="panel note">Today's watering is done (${reviewedToday} reviewed). ${due.length} more can wait for tomorrow; nothing wilts.</div>
        <button class="btn wide" data-act="extra">Optional extra round (${Math.min(due.length, 20)})</button>`;
    }
    el.innerHTML = `
      <div class="stack">
        <div class="hero-jp good-c">庭</div>
        <p class="dim">${planted.length === 0
          ? "Your garden is empty. Words you meet in Rhythm, Story and Kanji Forge get planted here. Watering also introduces up to 5 new words a day: starter phrases first, then the N5 deck."
          : `${planted.length} plants. ${thirsty.length} need water. Plants grow each time you remember them, and they never die if you're away.`}</p>
        ${planted.length ? `<p class="small dim">N5 deck: ${planted.filter((p) => p.item.deck === 'n5').length} of ${N5_WORDS.length} words planted, up to 5 new a day.</p>` : ''}
        ${planted.length ? (isUnlocked('N4')
          ? `<p class="small dim">N4 deck: ${planted.filter((p) => p.item.deck === 'n4').length} of ${N4_WORDS.length} words planted. They come in after the N5 deck.</p>`
          : `<p class="small dim">🔒 N4 deck (${N4_WORDS.length} words), after the N5 deck. ${esc(lockLine('N4'))}</p>`) : ''}
        ${planted.length && isUnlocked('N4') ? (isUnlocked('N3')
          ? `<p class="small dim">N3 deck: ${planted.filter((p) => p.item.deck === 'n3').length} of ${N3_WORDS.length} words planted. They come in after the N4 deck.</p>`
          : `<p class="small dim">🔒 N3 deck (${N3_WORDS.length} words), after the N4 deck. ${esc(lockLine('N3'))}</p>`) : ''}
        ${grammarCount ? `<p class="small dim">${grammarCount} grammar card${grammarCount === 1 ? '' : 's'} come up in the watering too, up to 2 new a day.</p>` : ''}
        ${daily.waiting ? `<p class="small dim">Big backlog? Only ${cap} a day, most overdue first. The other ${daily.waiting} wait patiently.</p>` : ''}
        ${action}
        ${help.length ? `<button class="btn wide" data-act="helpround">🩹 Needs help (${help.length}): practise them now</button>` : ''}
        <div class="plant-grid">
          ${planted.map(({ item, prog }) => {
            const hurt = store.wordNeedsHelp(item.id);
            return `
            <div class="plant${hurt ? ' needs-help' : ''}" title="${esc(item.reading)} · ${esc(item.en)}${hurt ? ' · needs a little help' : ''}">
              <span class="plant-emoji">${gardenStage(prog.level)}${prog.due <= Date.now() ? '<span class="drop">💧</span>' : ''}${hurt ? '<span class="bandage" aria-label="needs help">🩹</span>' : ''}</span>
              <span class="plant-jp${[...item.jp].length > 4 ? ' long' : ''}">${esc(item.jp)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function head(card) {
    const kind = kindOf(card);
    const st = store.cardState(card);
    return `<div class="row-between card-head"><span class="tag card-dir card-dir-${kind}">${LABELS[kind]}</span>
      ${firstSeen ? '<span class="tag new-tag" title="A word you haven\'t met before: have a look first">🌱 NEW</span>' : ''}
      ${st && st.help ? '<span class="tag" title="This one has been slipping: help comes first">🩹</span>' : ''}
      <span class="small dim mono">${position + 1} / ${session.length}</span></div>`;
  }

  // A word met for the first time (a new Garden card, the N5 deck's new words) offers the 🎤 pronunciation check.
  const pronRow = (card) => (card.isNew && card.dir === 'mean' && !card.item.mined ? pronButton(wordTarget(card.item), { cls: 'btn ghost small-btn wide' }) : '');
  const gradeButtons = (card) => `<div class="row2"><button class="btn" data-act="forgot">↩ Forgot</button><button class="btn primary" data-act="knew">✓ Knew it</button></div>
    <div class="row2"><button class="btn ghost small-btn" data-act="hear">🔊 Hear it again</button><button class="btn ghost small-btn" data-act="slow">🐢 Slowly</button></div>${pronRow(card)}`;

  function answerBlock(item) {
    return `<div class="review-jp"${item.id.includes('|') ? ' data-noruby' : ''}>${esc(item.jp)}</div>
      <p class="lead dim">${esc(item.reading)}</p><p class="lead trace-c strong">${esc(item.en)}</p>${item.deck === 'n5' ? n5Details(item) : ''}`;
  }

  function renderWord(card) {
    const item = card.item;
    let body;
    if (card.dir === 'listen') {
      body = revealed ? answerBlock(item)
        : `<div class="listen-orb" aria-hidden="true">🎧</div>
           <p class="dim">Listen, recall the meaning, then check.</p>
           <div class="row2"><button class="btn" data-act="hear">🔊 Play again</button><button class="btn" data-act="slow">🐢 Slowly</button></div>`;
    } else if (card.dir === 'say') {
      const ex = exampleFor(item);
      body = revealed
        ? `${heardOk ? `<p class="good-c strong">✓ Heard it: 「${esc(heard)}」</p>` : ''}${answerBlock(item)}`
        : `<p class="small dim">Say this in Japanese:</p>
           <p class="say-en">${esc(item.en)}</p>
           ${hint && ex ? `<p class="small trace-c">Used like: "${esc(ex.en)}"</p>` : ex ? '<button class="linkbtn" data-act="hint">💡 Example hint</button>' : ''}
           ${speech ? (micOn ? `<p class="small dim" id="gd-heard" aria-live="polite">${heard ? `Heard: 「${esc(heard)}」` : 'Starting the mic…'}</p>`
             : '<button class="btn wide" data-act="mic">🎤 Tap to answer out loud</button><p class="small dim">Or say it, then Check and grade yourself.</p>')
             : `<p class="dim">${ctx.quiet ? 'Quiet mode: say it in your head' : 'Say it out loud'}, then check and grade yourself.</p>`}`;
    } else if (firstSeen) {
      // A new word isn't a test: it shows the answer to study, with its partner if it has one. The recap at the end
      // of the watering asks it back.
      const p = partnerOf(item.jp);
      body = `<p class="small new-c strong">New word: have a look and say it out loud</p>${answerBlock(item)}
        ${p ? `<p class="small pair-line">Goes with <span lang="ja">${esc(p.jp)}</span> (${esc(p.reading)}) · ${esc(p.en)}</p>` : ''}`;
    } else {
      body = revealed ? answerBlock(item)
        : `<div class="review-jp"${item.id.includes('|') ? ' data-noruby' : ''}>${esc(item.jp)}</div>
           ${item.deck === 'n5' ? '<p class="tiny dim">N5 word</p>' : ''}
           <p class="dim">${ctx.quiet ? 'Say it in your head' : 'Say it out loud'} and recall the meaning, then check.</p>`;
    }
    const buttons = firstSeen
      ? `<button class="btn primary wide" data-act="knew">Got it ▶</button>
         <div class="row2"><button class="btn ghost small-btn" data-act="hear">🔊 Hear it again</button><button class="btn ghost small-btn" data-act="slow">🐢 Slowly</button></div>${pronRow(card)}`
      : revealed
      ? (card.dir === 'say' && heardOk ? '<button class="btn primary wide" data-act="knew">Next ▶</button>' : gradeButtons(card))
      : `<button class="btn primary wide" data-act="check">👁 Check</button>`;
    el.innerHTML = `<div class="card-review card-${card.dir}">${head(card)}${body}<div class="spacer"></div>${buttons}</div>`;
  }

  function renderGrammar(card) {
    if (!gram || !gram.q) { el.innerHTML = `<div class="card-review">${head(card)}<p>This card can't be shown.</p><button class="btn primary wide" data-act="skipcard">Next ▶</button></div>`; return; }
    const { q } = gram;
    const answered = gram.picked >= 0;
    const ok = answered && gram.opts[gram.picked] === 0;
    el.innerHTML = `
      <div class="card-review card-gram">
        ${head(card)}
        <p class="small dim">${esc(q.kind === 'conj' ? `${q.en}: make the ${q.formLabel}` : q.title)}</p>
        <p class="gram-show" lang="ja">${esc(q.kind === 'conj' ? q.show : answered ? q.show : q.blanked)}</p>
        ${q.kind === 'conj' ? '' : `<p class="trace-c">${esc(q.en)}</p>`}
        <div class="choice-grid practice-opts" role="group" aria-label="Choose the missing piece">${gram.opts.map((oi, k) => {
          let cls = '';
          if (answered) cls = oi === 0 ? 'good' : k === gram.picked ? 'wrong' : 'faded';
          return `<button class="btn ${cls}" data-act="gpick" data-k="${k}" lang="ja" ${answered ? 'disabled' : ''}><span class="key-hint" aria-hidden="true">${k + 1}</span> ${esc(q.options[oi])}</button>`;
        }).join('')}</div>
        ${answered ? `<div class="panel note stack-sm left-text" role="status">
            ${ok ? '<p class="good-c strong">✓ Right!</p>' : `<p class="strong">Answer: <span lang="ja">${esc(q.options[0])}</span></p><p class="small">${esc(q.why)}</p>`}
            <button class="btn ghost small-btn" data-act="gsay">🔊 Hear the sentence</button>
          </div>
          <button class="btn primary wide" data-act="gnext">Next ▶</button>` : ''}
      </div>`;
  }

  function renderHelp(card) {
    if (card.kind === 'gram') {
      const q = cardQuestion(card.id, 0);
      el.innerHTML = `
        <div class="stack help-panel">
          ${head(card)}
          <h2 class="section-title">🩹 A little help first</h2>
          <p class="small dim">This one has slipped a few times. Nothing is lost: here it is again, then try it.</p>
          <section class="panel stack-sm note"><h3 class="gp-title">${esc(cardName(card.id))}</h3><p>${esc(q ? q.explain : '')}</p></section>
          ${q ? [{ jp: q.show, en: q.en, voice: q.say.voice }, ...q.more].filter((x) => x.jp).map((x, i) => `
            <div class="panel help-ex"><p class="lead" lang="ja">${esc(x.jp)}</p><p class="small dim">${esc(x.en)}</p>
              <button class="btn ghost small-btn" data-act="hexample" data-i="${i}">🔊 Hear it</button></div>`).join('') : ''}
          <button class="btn primary wide" data-act="helpdone">Got it, test me ▶</button>
        </div>`;
      return;
    }
    const item = card.item;
    const ex = exampleFor(item);
    const mn = mnemonicFor(item.id);
    const prefer = new Set(store.planted().map((p) => p.item.id));
    const alike = confusablesFor(item, { prefer });
    el.innerHTML = `
      <div class="stack help-panel">
        ${head(card)}
        <h2 class="section-title">🩹 A little help first</h2>
        <p class="small dim">This one has slipped a few times. Nothing is lost: have a fresh look, then review it as normal.</p>
        <div class="panel center-text stack-sm">
          <div class="review-jp help-jp"${item.id.includes('|') ? ' data-noruby' : ''}>${esc(item.jp)}</div>
          <p class="lead dim">${esc(item.reading)} · <span class="trace-c strong">${esc(item.en)}</span></p>
          <div class="row2"><button class="btn" data-act="slow">🐢 Hear it slowly</button><button class="btn" data-act="hear">🔊 Normal speed</button></div>
          ${item.mined ? '' : pronButton(wordTarget(item), { cls: 'btn ghost small-btn wide' })}
        </div>
        ${mn ? `<div class="panel note"><p class="small dim">Picture it</p><p class="mnemonic">${esc(mn)}</p></div>` : ''}
        ${ex ? `<div class="panel help-ex"><p class="small dim">In a sentence</p><p class="lead" lang="ja">${esc(ex.jp)}</p><p class="small dim">${esc(ex.en)}</p>
          <button class="btn ghost small-btn" data-act="hexample" data-i="0">🔊 Hear the sentence</button></div>` : ''}
        ${alike.length ? `<div class="stack-sm"><p class="small dim">Easy to mix up with</p>
          <div class="alike-grid">
            ${[{ item, why: 'this' }, ...alike].map((a, i) => `
              <div class="panel alike ${i ? '' : 'alike-this'}">
                <span class="tiny dim">${i ? (a.why === 'look' ? 'looks alike' : 'sounds alike') : 'this word'}</span>
                <span class="alike-jp" lang="ja">${esc(a.item.jp)}</span>
                <span class="small dim">${esc(a.item.reading)}</span>
                <span class="small strong">${esc(a.item.en)}</span>
                <button class="btn ghost small-btn" data-act="halike" data-i="${i}" aria-label="Hear ${esc(a.item.jp)}">🔊</button>
              </div>`).join('')}
          </div></div>` : ''}
        <button class="btn primary wide" data-act="helpdone">Got it, test me ▶</button>
      </div>`;
    helpData = { alike: [item, ...alike.map((a) => a.item)], example: ex };
  }

  function playHelp(card) {
    if (card.kind === 'gram') return;
    speaker.speak(sayOf(card.item), { mps: 2.5, speed: 'slow' });
  }

  // N5 deck cards also show the pitch melody and an example sentence.
  function n5Details(item) {
    const morae = accentMorae(item.reading, item.accent);
    return `
      <div class="n5-pitch" data-noruby title="Pitch: ${esc(accentName(item.accent, toMorae(item.reading).length))}">${melodySVG(morae, { height: 64 })}</div>
      <p class="tiny dim">Pitch: ${esc(accentName(item.accent, morae.length))}</p>
      ${item.ex ? `<div class="panel n5-ex">
        <p class="lead">${esc(item.ex)}</p>
        <p class="small dim">${esc(item.exEn)}</p>
        <button class="btn ghost small-btn" data-act="hearEx">🔊 Example</button>
      </div>` : ''}`;
  }

  // ---------- answering ----------
  function answer(ok) {
    const card = cur();
    if (!card) return;
    recognizer.stop();
    store.reviewCard(card, ok);
    advance(ok);
  }

  function advance(ok) {
    position++;
    if (ctx.today && !practice) ctx.today.report(`${Math.min(position, session.length)}/${session.length}`);
    const done = position >= session.length;
    if (done) {
      session = [];
      position = 0;
      if (ctx.today && !practice) ctx.today.done();
      if (fresh.length) startRecap();
      else render();
    } else openCard();
    if (ok) fx.hit({ big: done }); else fx.miss();
  }

  function pickGrammar(k) {
    if (!gram || gram.picked >= 0) return;
    gram.picked = k;
    const ok = gram.opts[k] === 0;
    store.reviewCard(cur(), ok);
    render();
    speaker.speak(gram.q.say.text, { mps: 4, voice: gram.q.say.voice });
    if (ok) fx.hit(); else fx.miss({ el: el.querySelector('.gram-show') });
    el.querySelector('[data-act=gnext]')?.focus({ preventScroll: true });
  }

  function nextGrammar() {
    if (!gram || gram.picked < 0) return;
    const ok = gram.opts[gram.picked] === 0;
    position++;
    if (ctx.today && !practice) ctx.today.report(`${Math.min(position, session.length)}/${session.length}`);
    if (position >= session.length) {
      session = [];
      position = 0;
      if (ctx.today && !practice) ctx.today.done();
      if (fresh.length) startRecap(); else render();
      if (ok) fx.hit({ big: true });
      return;
    }
    openCard();
  }

  /**
   * A quick recap of today's new words: with one or two, each is asked twice (hear it, pick the meaning; see the
   * meaning, pick the word); with more, each once, taking turns. A miss brings that word back by tomorrow.
   */
  function gardenRecap(all) {
    const words = all.filter((w) => w.en);
    const planted = store.planted().map((p) => p.item);
    const pool = (key, self, deck) => [
      ...shuffle(planted.filter((x) => !words.includes(x)).map((x) => x[key])),
      ...shuffle(Object.values(GARDEN_CATALOG).filter((x) => (deck ? x.deck === deck : !x.deck)).map((x) => x[key])),
    ].filter((v) => v && v !== self);
    // Lines mined from shows have no voice clip, so they're only asked by meaning.
    const listenQ = (w) => (w.mined ? meaning(w) : listenQuestion({ jp: w.jp, en: w.en, say: sayOf(w), pool: pool('en', w.en, w.deck), skill: 'vocab', gradeId: w.id, garden: [w.id], why: `${withReading(w.jp, w.reading)} means "${w.en}".`, what: 'the word' }));
    const meaning = (w) => meaningQuestion({ jp: w.jp, en: w.en, say: sayOf(w), pool: pool('jp', w.jp, w.deck), gradeId: w.id, garden: [w.id], noruby: w.id.includes('|'), why: `"${w.en}" is ${withReading(w.jp, w.reading)}.` });
    if (words.length <= 2) return [...words.map(listenQ), ...words.filter((w) => !w.mined).map(meaning)];
    return words.slice(0, 6).map((w, i) => (i % 2 ? meaning(w) : listenQ(w)));
  }

  function startRecap() {
    const words = fresh;
    fresh = [];
    recapOff = mountRecap(el, {
      questions: gardenRecap(words), title: 'New words recap', quiet: !!ctx.quiet, doneLabel: 'Back to the garden',
      onDone: () => { if (recapOff) recapOff(); recapOff = null; render(); window.scrollTo(0, 0); },
    });
  }

  const off = delegate(el, {
    water: startDaily,
    extra: () => begin(store.dueCards().slice(0, 20), 'extra'),
    helpround: () => begin(store.helpCards(), 'help'),
    check: () => {
      const card = cur();
      if (card.dir === 'say') { reveal(); return; }
      revealed = true;
      render();
      speaker.speak(sayOf(card.item), { mps: 3.5 });
    },
    hint: () => { hint = true; render(); },
    mic: () => { if (micOn || revealed) return; micOn = true; render(); listen(cur()); },
    hear: () => speaker.speak(sayOf(cur().item), { mps: 3.5 }),
    slow: () => speaker.speak(sayOf(cur().item), { mps: 2.5, speed: 'slow' }),
    hearEx: () => speaker.speak(cur().item.ex, { mps: 4 }),
    forgot: () => answer(false),
    knew: () => answer(true),
    helpdone: () => { helping = false; render(); startCard(cur()); },
    hexample: (b) => {
      const card = cur();
      if (card.kind === 'gram') {
        const q = cardQuestion(card.id, 0);
        const x = [{ jp: q.show, voice: q.say.voice }, ...q.more][+b.dataset.i];
        if (x) speaker.speak(x.jp, { mps: 4, voice: x.voice });
        return;
      }
      if (helpData.example) speaker.speak(helpData.example.jp, { mps: 4, voice: helpData.example.voice });
    },
    halike: (b) => { const it = helpData.alike[+b.dataset.i]; if (it) speaker.speak(sayOf(it), { mps: 3 }); },
    gpick: (b) => pickGrammar(+b.dataset.k),
    gsay: () => gram && speaker.speak(gram.q.say.text, { mps: 4, voice: gram.q.say.voice }),
    gnext: nextGrammar,
    skipcard: () => { position++; openCard(); },
  });

  // Keyboard on the PC: Space / Enter to check (or continue), 1 / ← forgot, 2 / → knew it, 1-4 to pick a grammar answer.
  const onKey = (e) => {
    const card = cur();
    if (!card || recapOff || e.target.closest?.('input, textarea')) return;
    if (helping) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.querySelector('[data-act=helpdone]')?.click(); }
      return;
    }
    if (card.kind === 'gram') {
      if (gram && gram.picked < 0 && /^[1-4]$/.test(e.key) && +e.key <= gram.opts.length) { e.preventDefault(); pickGrammar(+e.key - 1); }
      else if (gram && gram.picked >= 0 && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) { e.preventDefault(); nextGrammar(); }
      return;
    }
    if (firstSeen && cur()?.kind === 'word') {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); answer(true); }
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (!revealed) { e.preventDefault(); el.querySelector('[data-act=check]')?.click(); }
      else if (heardOk) { e.preventDefault(); answer(true); }
    } else if (revealed && !heardOk && (e.key === '1' || e.key === 'ArrowLeft')) answer(false);
    else if (revealed && (e.key === '2' || e.key === 'ArrowRight')) answer(true);
  };
  window.addEventListener('keydown', onKey);

  if (ctx.today) {
    const { queue } = store.dailyGardenQueue(cap);
    if (queue.length) { startDaily(); ctx.today.report(`0/${session.length}`); }
    else { render(); ctx.today.done(store.thirsty().length ? "Today's watering is done. The rest wait for later days; nothing wilts." : 'Nothing to water right now. Your garden is fine.'); }
  } else {
    render();
  }

  return () => { off(); if (recapOff) recapOff(); recognizer.stop(); window.removeEventListener('keydown', onKey); speaker.stop(); };
}

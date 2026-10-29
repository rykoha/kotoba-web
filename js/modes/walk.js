// Walk mode: eyes-free review for a walk, a commute or doing the dishes, in the style of audio courses. You hear the
// English, say the Japanese out loud in the pause, then hear the answer (twice: a second chance to repeat it). Every
// few words an example sentence gets the same treatment. Words come from your Garden, the ones due and the shakiest
// first; with only a few planted, the first deck words are added as "listen and repeat" (Japanese, then English).
// Nothing is graded and nothing can be missed, so it never touches a review schedule.
//
// The English is read by the device's English voice (the app's own clips are Japanese only); without one, it's shown
// on screen with a longer pause. The screen is kept awake while it plays (Wake Lock), and the lock-screen media keys
// can pause it where the browser supports them.
import { store } from '../store.js';
import { speaker, setAudioSession } from '../audio.js';
import { GARDEN_CATALOG } from '../data.js';
import { content, itemOpen, levelBar } from '../levels.js';
import { romaji } from '../romaji.js';
import { esc, delegate, shuffle } from '../ui.js';

const LENGTHS = [5, 10, 15];
const PREFS_KEY = 'kotobaBeat.walk';   // this device's choices (length, sentences, pause); not progress
const MIN_POOL = 8;

function loadPrefs() {
  try { return { mins: 10, sentences: true, slow: false, text: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch (e) { return { mins: 10, sentences: true, slow: false, text: true }; }
}
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* this device only */ } }

/** The English voice, if the device has one. */
function englishVoice() {
  try {
    const vs = speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    return vs.find((v) => /en-US/i.test(v.lang) && v.localService) || vs.find((v) => /en-US/i.test(v.lang)) || vs[0] || null;
  } catch (e) { return null; }
}
const ttsSupported = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

/** A deck word (or story word) usable here: it has a Japanese clip and an English meaning. */
const usable = (item) => item && item.en && (item.say || item.reading) && itemOpen(item);

/** Short English for speaking: the first meaning ("immediately / soon" -> "immediately"). */
export function spokenEnglish(en) {
  return String(en).split(/\s*[/;]\s*|,\s+(?=to )/)[0].replace(/\s*\([^)]*\)/g, '').trim() || en;
}

/**
 * The session's steps. Planted Garden words: due ones first, then the least stable. Topped up with the deck's first
 * words not planted yet ('intro' steps) when fewer than MIN_POOL are planted. Every third word (with sentences on)
 * is followed by its example sentence.
 */
export function walkSteps({ sentences = true, count = 40 } = {}) {
  const deck = new Set(content('walk').map((w) => w.id));
  const now = Date.now();
  const planted = store.planted().filter((p) => usable(p.item) && !p.item.mined)
    .sort((a, b) => (a.prog.due <= now ? 0 : 1) - (b.prog.due <= now ? 0 : 1) || (a.prog.s || 0) - (b.prog.s || 0));
  const recall = planted.slice(0, count).map((p) => ({ kind: 'recall', item: p.item }));
  const intro = [];
  if (recall.length < MIN_POOL) {
    for (const w of content('walk')) {
      if (intro.length + recall.length >= MIN_POOL * 2) break;
      if (!store.s.items[w.id] && deck.has(w.id)) intro.push({ kind: 'intro', item: GARDEN_CATALOG[w.id] || w });
    }
  }
  const words = [...intro, ...shuffle(recall)];
  const out = [];
  words.forEach((s, i) => {
    out.push(s);
    if (sentences && s.kind === 'recall' && i % 3 === 2 && s.item.ex && s.item.exEn) out.push({ kind: 'sentence', item: s.item });
  });
  return out;
}

export function mount(el, ctx = {}) {
  let prefs = loadPrefs();
  let screen = 'intro';
  let steps = [];
  let i = 0;
  let phase = '';         // 'en' | 'pause' | 'jp' | 'jp2' | 'gap'
  let paused = false;
  let gen = 0;            // bumps on every pause, skip or stop, so stale callbacks do nothing
  let timer = 0;
  let started = 0;
  let elapsed = 0;        // ms played, not counting pauses
  let lastTick = 0;
  let done = 0;
  let lock = null;
  let enVoice = null;

  const step = () => steps[i];
  const answerOf = (s) => (s.kind === 'sentence' ? s.item.ex : s.item.say || s.item.reading);
  const readingOf = (s) => (s.kind === 'sentence' ? s.item.exReading || s.item.ex : s.item.reading);
  const englishOf = (s) => (s.kind === 'sentence' ? s.item.exEn : spokenEnglish(s.item.en));

  async function wake(on) {
    try {
      if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener?.('release', () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch (e) { lock = null; }
  }
  const onVisible = () => { if (document.visibilityState === 'visible' && screen === 'play' && !paused) wake(true); };
  document.addEventListener('visibilitychange', onVisible);

  function media() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      if (typeof MediaMetadata !== 'undefined') ms.metadata = new MediaMetadata({ title: 'Walk mode', artist: 'Kotoba Beat' });
      ms.setActionHandler('pause', () => { if (!paused) togglePause(); });
      ms.setActionHandler('play', () => { if (paused) togglePause(); });
      ms.setActionHandler('nexttrack', () => skip());
    } catch (e) { /* not every browser has every action */ }
  }
  function unmedia() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try { for (const a of ['pause', 'play', 'nexttrack']) ms.setActionHandler(a, null); } catch (e) { /* ignore */ }
  }

  /** Says English with the device's English voice, then calls next. Without one, waits about as long as reading takes. */
  function sayEnglish(text, next) {
    const g = gen;
    const go = () => { if (g === gen) next(); };
    if (!ttsSupported() || !enVoice) { timer = setTimeout(go, 1200 + text.length * 45); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = enVoice;
      u.lang = enVoice.lang;
      u.rate = 0.95;
      let fired = false;
      const end = () => { if (fired) return; fired = true; clearTimeout(safety); go(); };
      u.onend = end;
      u.onerror = end;
      // Some browsers never fire onend for a cancelled or interrupted utterance.
      const safety = setTimeout(end, 2500 + text.length * 120);
      speechSynthesis.speak(u);
    } catch (e) { timer = setTimeout(go, 1500); }
  }

  function sayJapanese(s, slow, next) {
    const g = gen;
    speaker.speak(answerOf(s), { mps: slow ? 3 : 4.5, speed: slow ? 'slow' : null, onend: () => { if (g === gen) next(); } });
  }

  /** Seconds to answer in: longer for longer answers, and longer still with "More time" on. */
  function pauseMs(s) {
    const len = [...readingOf(s)].filter((c) => /[ぁ-ゖァ-ヺー]/.test(c)).length || [...answerOf(s)].length;
    return Math.round((2200 + Math.min(len, 30) * 180) * (prefs.slow ? 1.5 : 1));
  }

  function wait(ms, next) {
    const g = gen;
    clearTimeout(timer);
    timer = setTimeout(() => { if (g === gen) next(); }, ms);
  }

  function runStep() {
    if (screen !== 'play' || paused) return;
    if (elapsed >= prefs.mins * 60_000 || i >= steps.length) return finish();
    const s = step();
    if (ctx.today) ctx.today.report(`${Math.min(prefs.mins, Math.floor(elapsed / 60_000))}/${prefs.mins} min`);
    if (s.kind === 'intro') {
      // Listen and repeat: Japanese, English, a pause to say it, the Japanese again.
      phase = 'jp'; render();
      sayJapanese(s, false, () => { phase = 'en'; render();
        sayEnglish(englishOf(s), () => { phase = 'pause'; render();
          wait(pauseMs(s), () => { phase = 'jp2'; render();
            sayJapanese(s, false, () => { phase = 'gap'; render(); wait(900, nextStep); }); }); }); });
      return;
    }
    // Recall: English, a pause to say the Japanese, the answer, and the answer again (slow for sentences).
    phase = 'en'; render();
    sayEnglish(englishOf(s), () => { phase = 'pause'; render();
      wait(pauseMs(s), () => { phase = 'jp'; render();
        sayJapanese(s, false, () => { wait(700, () => { phase = 'jp2'; render();
          sayJapanese(s, s.kind === 'sentence', () => { phase = 'gap'; render(); wait(1000, nextStep); }); }); }); }); });
  }

  function nextStep() {
    done += 1;
    i += 1;
    if (i >= steps.length && elapsed < prefs.mins * 60_000) {
      // Ran out of words before the time: go round again in a new order.
      steps = walkSteps({ sentences: prefs.sentences });
      i = 0;
    }
    runStep();
  }

  function tick() {
    const now = performance.now();
    if (screen === 'play' && !paused) elapsed += now - lastTick;
    lastTick = now;
    const t = el.querySelector('.walk-time');
    if (t) t.textContent = clock(elapsed);
    const bar = el.querySelector('.walk-bar > span');
    if (bar) bar.style.width = Math.min(100, (elapsed / (prefs.mins * 600))).toFixed(1) + '%';
  }
  const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  let ticker = 0;

  function start() {
    savePrefs(prefs);
    enVoice = ttsSupported() ? englishVoice() : null;
    steps = walkSteps({ sentences: prefs.sentences });
    if (!steps.length) return;
    screen = 'play';
    i = 0; done = 0; elapsed = 0; paused = false;
    started = Date.now();
    lastTick = performance.now();
    clearInterval(ticker);
    ticker = setInterval(tick, 250);
    setAudioSession?.('playback');
    wake(true);
    media();
    // Unlock speech on iOS from the tap that started it: an empty utterance.
    try { if (ttsSupported()) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) { /* ignore */ }
    runStep();
  }

  function halt() {
    gen += 1;
    clearTimeout(timer);
    speaker.stop();
    try { if (ttsSupported()) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }

  function togglePause() {
    if (screen !== 'play') return;
    paused = !paused;
    if (paused) { halt(); wake(false); render(); } else { lastTick = performance.now(); wake(true); runStep(); }
  }

  function skip() {
    if (screen !== 'play') return;
    halt();
    paused = false;
    nextStep();
  }

  function finish() {
    halt();
    screen = 'done';
    clearInterval(ticker);
    wake(false);
    unmedia();
    store.markStudied();
    render();
    if (ctx.today) ctx.today.done(`${done} prompts in ${clock(elapsed)}`);
  }

  function renderIntro() {
    const pool = walkSteps({ sentences: false });
    const recall = pool.filter((s) => s.kind === 'recall').length;
    const noEnglish = ttsSupported() && !englishVoice() && speechSynthesis.getVoices().length > 0;
    el.innerHTML = `
      <div class="stack practice walk">
        ${levelBar('walk')}
        <div class="center-text stack-sm">
          <div class="hero-jp accent-c" lang="ja" data-noruby>散歩</div>
          <p class="lead strong">Eyes-free review for walks and commutes.</p>
          <p class="dim">You hear the English. Say the Japanese out loud in the pause, then hear the answer twice. Headphones on, phone in your pocket.</p>
        </div>
        <div class="panel stack-sm">
          <p class="section-label">HOW LONG</p>
          <div class="seg" role="radiogroup" aria-label="How long">
            ${LENGTHS.map((m) => `<button class="seg-btn ${prefs.mins === m ? 'on' : ''}" data-act="mins" data-m="${m}" role="radio" aria-checked="${prefs.mins === m}">${m} min</button>`).join('')}
          </div>
          <label class="switch-row small"><span>Example sentences too</span><input type="checkbox" role="switch" data-pref="sentences" ${prefs.sentences ? 'checked' : ''}></label>
          <label class="switch-row small"><span>More time to answer</span><input type="checkbox" role="switch" data-pref="slow" ${prefs.slow ? 'checked' : ''}></label>
          <label class="switch-row small"><span>Show the words on screen</span><input type="checkbox" role="switch" data-pref="text" ${prefs.text ? 'checked' : ''}></label>
        </div>
        <p class="small dim">${recall ? `${recall} Garden word${recall === 1 ? '' : 's'} to practise, due ones first.` : ''}
          ${pool.some((s) => s.kind === 'intro') ? ' Only a few words are planted, so the first deck words are added as listen-and-repeat.' : ''}
          Nothing is scored, so nothing can be missed.</p>
        ${noEnglish ? '<p class="small miss-c">This device has no English voice, so the English shows on screen instead.</p>' : ''}
        <button class="btn primary wide" data-act="start" ${pool.length ? '' : 'disabled'}>🎧 Start walking</button>
      </div>`;
  }

  function renderPlay() {
    const s = step();
    if (!s) return;
    const showJp = ['jp', 'jp2', 'gap'].includes(phase) || s.kind === 'intro';
    // Without an English voice the English can only be read, so it shows even with "Show the words on screen" off.
    const prompt = phase === 'pause' ? 'Say it in Japanese…' : phase === 'en' ? 'Listen' : showJp ? 'Answer' : '';
    el.innerHTML = `
      <div class="stack practice walk walk-play">
        <div class="row-between"><span class="small dim mono"><span class="walk-time">${clock(elapsed)}</span> / ${prefs.mins}:00</span>
          <span class="small dim">${s.kind === 'sentence' ? 'Sentence' : s.kind === 'intro' ? 'Listen and repeat' : 'Word'} · ${done + 1}</span></div>
        <div class="walk-bar bar" aria-hidden="true"><span style="width:${Math.min(100, elapsed / (prefs.mins * 600))}%"></span></div>
        <div class="panel center-text stack-sm walk-card ${phase}" aria-live="polite">
          <p class="section-label">${paused ? 'PAUSED' : esc(prompt.toUpperCase())}</p>
          ${prefs.text || !enVoice ? `
            <p class="walk-en lead strong">${esc(englishOf(s))}</p>
            <p class="walk-jp" lang="ja">${showJp ? esc(answerOf(s)) : '&nbsp;'}</p>
            <p class="small dim mono">${showJp ? esc(romaji(readingOf(s))) : '&nbsp;'}</p>`
            : '<p class="walk-eyes dim">Eyes free: just listen and answer out loud.</p>'}
          ${phase === 'pause' && !paused ? '<div class="walk-pulse" aria-hidden="true"></div>' : ''}
        </div>
        <div class="row3">
          <button class="btn" data-act="pause">${paused ? '▶ Resume' : '■ Pause'}</button>
          <button class="btn" data-act="skip">Skip ▶</button>
          <button class="btn" data-act="stop">✕ End</button>
        </div>
      </div>`;
  }

  function renderDone() {
    el.innerHTML = `
      <div class="stack practice walk center-text">
        <div class="hero-jp accent-c" lang="ja" data-noruby>おつかれ！</div>
        <p class="lead strong">${done} prompt${done === 1 ? '' : 's'} in ${clock(elapsed)}.</p>
        <p class="dim">Saying the answer before you hear it is what makes it stick. Your Garden reviews are unchanged.</p>
        ${ctx.today ? '' : '<button class="btn primary wide" data-act="again">🎧 Walk again</button>'}
      </div>`;
  }

  function render() {
    if (screen === 'intro') return renderIntro();
    if (screen === 'done') return renderDone();
    return renderPlay();
  }

  const off = delegate(el, {
    mins: (b) => { prefs.mins = +b.dataset.m; savePrefs(prefs); render(); },
    start,
    pause: togglePause,
    skip,
    stop: finish,
    again: () => { screen = 'intro'; render(); },
  });
  const onChange = (ev) => {
    const t = ev.target.closest('[data-pref]');
    if (!t) return;
    prefs[t.dataset.pref] = t.checked;
    savePrefs(prefs);
  };
  el.addEventListener('change', onChange);
  // Voices load late in some browsers; the intro's note about an English voice redraws once they're in.
  const onVoices = () => { if (screen === 'intro') render(); };
  try { if (ttsSupported()) speechSynthesis.addEventListener?.('voiceschanged', onVoices); } catch (e) { /* ignore */ }

  render();
  return () => {
    off();
    el.removeEventListener('change', onChange);
    document.removeEventListener('visibilitychange', onVisible);
    try { if (ttsSupported()) speechSynthesis.removeEventListener?.('voiceschanged', onVoices); } catch (e) { /* ignore */ }
    halt();
    clearInterval(ticker);
    wake(false);
    unmedia();
  };
}

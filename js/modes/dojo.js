// Reading Dojo: learn hiragana, katakana and starter kanji in small lessons, then practice with quick quizzes.
// No lives and no locks: wrong answers just come back once more, and learned characters return for review.
import { store } from '../store.js';
import { speaker } from '../audio.js';
import { LESSONS, ALL_LESSONS, LESSON_BY_ID, TRACKS, READ_WORDS } from '../dojo-data.js';
import { itemOpen, lockLine, levelOf, levelBar } from '../levels.js';
import { romaji } from '../romaji.js';
import { BRUSH_KANA, BRUSH_BY_KANA } from '../brush-data.js';
import { esc, shuffle, delegate } from '../ui.js';
import * as fx from '../fx.js';

// ---------- lookups ----------
const KANA = {};      // 'kana:あ' -> { id, k, r, m, track, lesson }
for (const l of LESSONS) for (const c of l.chars) KANA['kana:' + c.k] = { ...c, id: 'kana:' + c.k, track: l.track, lesson: l.id };
// Kanji tracks: the starter kanji ('kanji', N5), the N4 kanji ('kanji4') and the N3 kanji ('kanji3').
const isKanji = (track) => track === 'kanji' || track === 'kanji4' || track === 'kanji3';
const KANJI = {};     // 'kj:一' -> { id, k, meaning, m, word, reading, wordEn, track, lesson, level }
for (const l of ALL_LESSONS) if (isKanji(l.track)) for (const j of l.kanji) KANJI['kj:' + j.k] = { ...j, id: 'kj:' + j.k, track: l.track, lesson: l.id, level: l.level };
const ITEM = { ...KANA, ...KANJI };

const SMALL = new Set([...'ゃゅょャュョっッーァィゥェォぁぃぅぇぉ']);

/** Characters of every cleared lesson plus `extra` (used to pick distractors and readable words). */
function learnedKana(extra = []) {
  const cleared = store.clearedLessons;
  const set = new Set(extra);
  for (const l of LESSONS) if (cleared.has(l.id)) for (const c of l.chars) set.add(c.k);
  return set;
}

/** A word is readable when every character in it is known (small kana count once a combo lesson is done). */
function readable(word, known) {
  const combosDone = known.has('きゃ') || known.has('キャ');
  return [...word].every((ch) => known.has(ch) || (SMALL.has(ch) && combosDone));
}

function wordsFor(lessonChars, known) {
  const fresh = new Set(lessonChars.flatMap((k) => [...k]));
  return READ_WORDS.filter((v) => readable(v.w, known) && [...v.w].some((ch) => fresh.has(ch)));
}

const sameTrack = (track) => Object.values(KANA).filter((c) => c.track === track);

function options(correct, pool, n = 4) {
  const others = shuffle([...new Set(pool.filter((x) => x !== correct))]).slice(0, n - 1);
  return shuffle([correct, ...others]);
}

// ---------- question builders ----------
function kanaQuestion(c, type, pool) {
  // Leave out sound-alikes (じ/ぢ, お/を) so there is only one right answer.
  pool = pool.filter((p) => p.r !== c.r || p.k === c.k);
  const poolChars = pool.map((p) => p.k);
  if (type === 'k2r') return { id: c.id, type, prompt: c.k, answer: c.r, opts: options(c.r, [...new Set(pool.map((p) => p.r))]), item: c };
  if (type === 'r2k') return { id: c.id, type, prompt: c.r, answer: c.k, opts: options(c.k, poolChars), item: c };
  return { id: c.id, type: 's2k', prompt: c.k, answer: c.k, opts: options(c.k, poolChars), item: c };
}

function wordQuestion(v, pool) {
  const answer = romaji(v.w);
  const others = pool.filter((x) => x.w !== v.w).map((x) => romaji(x.w));
  return { id: 'w:' + v.w, type: 'w2r', prompt: v.w, answer, opts: options(answer, others), item: v };
}

export function kanjiQuestion(j, type, pool) {
  if (type === 'j2m') return { id: j.id, type, prompt: j.k, answer: j.meaning, opts: options(j.meaning, pool.map((p) => p.meaning)), item: j };
  // Kanji that share a meaning (都 and 京 are both "capital") are never each other's wrong option.
  if (type === 'm2j') return { id: j.id, type, prompt: j.meaning, answer: j.k, opts: options(j.k, pool.filter((p) => p.meaning !== j.meaning).map((p) => p.k)), item: j };
  return { id: j.id, type: 'jw2r', prompt: j.word, answer: j.reading, opts: options(j.reading, pool.map((p) => p.reading)), item: j };
}

function buildLessonQuiz(lesson) {
  if (isKanji(lesson.track)) {
    const pool = Object.values(KANJI).filter((j) => j.track === lesson.track);
    const mine = lesson.kanji.map((j) => KANJI['kj:' + j.k]);
    const near = pool.filter((p) => p.lesson === lesson.id);
    const qs = [];
    mine.forEach((j, i) => {
      qs.push(kanjiQuestion(j, 'j2m', near.length >= 4 ? near : pool));
      qs.push(kanjiQuestion(j, i % 2 ? 'm2j' : 'jw2r', near.length >= 4 ? near : pool));
    });
    return shuffle(qs);
  }
  const chars = lesson.chars.map((c) => KANA['kana:' + c.k]);
  const known = learnedKana(lesson.chars.map((c) => c.k));
  const trackPool = sameTrack(lesson.track).filter((c) => known.has(c.k));
  // Distractors come mostly from this lesson, so the look-alikes get compared directly.
  const pool = chars.length >= 4 ? chars : trackPool;
  const qs = [];
  const types = ['s2k', 'r2k'];
  chars.forEach((c, i) => {
    qs.push(kanaQuestion(c, 'k2r', pool));
    if (chars.length <= 8) qs.push(kanaQuestion(c, types[i % 2], pool));
  });
  // A few earlier characters from the same track, for spaced practice.
  const earlier = shuffle(trackPool.filter((c) => !chars.includes(c))).slice(0, 3);
  for (const c of earlier) qs.push(kanaQuestion(c, 'k2r', trackPool));
  const qsShuffled = shuffle(qs);
  // Then real words, so it's reading and not just letters.
  const words = shuffle(wordsFor(lesson.chars.map((c) => c.k), known)).slice(0, 3);
  const wordPool = READ_WORDS.filter((v) => readable(v.w, known));
  for (const v of words) qsShuffled.push(wordQuestion(v, wordPool.length >= 4 ? wordPool : READ_WORDS));
  return qsShuffled;
}

function buildReviewQuiz(ids) {
  const known = learnedKana();
  const qs = [];
  ids.slice(0, 15).forEach((id, i) => {
    const it = ITEM[id];
    if (!it) return;
    if (isKanji(it.track)) qs.push(kanjiQuestion(it, i % 2 ? 'm2j' : 'j2m', Object.values(KANJI).filter((j) => j.track === it.track)));
    else {
      const pool = sameTrack(it.track).filter((c) => known.has(c.k));
      qs.push(kanaQuestion(it, i % 3 === 2 ? 's2k' : 'k2r', pool.length >= 4 ? pool : sameTrack(it.track)));
    }
  });
  return shuffle(qs);
}

// ---------- view ----------
export function mount(el, ctx) {
  let screen = 'overview';   // overview | chart | learn | quiz | result
  let lesson = null;
  let quiz = null;           // { questions, i, firstTry: Map id->bool, answered, picked, isReview, retried: Set }
  let chartTrack = 'hiragana';

  const say = (text) => speaker.speak(text, { mps: 3 });

  function render() {
    if (screen === 'chart') return renderChart();
    if (screen === 'learn') return renderLearn();
    if (screen === 'quiz') return renderQuiz();
    if (screen === 'result') return renderResult();
    renderOverview();
  }

  function renderOverview() {
    const cleared = store.clearedLessons;
    const next = store.nextLesson();
    const due = store.dojoDue();
    el.innerHTML = `
      <div class="stack">
        <div class="hero-jp accent-c" lang="ja" data-noruby>読</div>
        <p class="dim">Learn to read from zero: hiragana, then katakana, then your first kanji, a few characters per lesson. Until you know them, games show romaji over the Japanese.</p>
        ${due.length ? `<button class="btn primary wide" data-act="review">🔁 Review ${Math.min(due.length, 15)} learned character${due.length === 1 ? '' : 's'}</button>` : ''}
        ${brushHTML()}
        ${next ? `<button class="btn ${due.length ? '' : 'primary'} wide" data-act="lesson" data-id="${next.id}">▶ Next lesson: ${esc(trackTitle(next.track))} · ${esc(next.title)}</button>`
          : '<div class="panel note">🎉 Every lesson is cleared. Keep reviewing here, and the games will now show furigana only over kanji.</div>'}
        <div class="row2"><button class="btn" data-act="chart" data-track="hiragana">あ Hiragana chart</button><button class="btn" data-act="chart" data-track="katakana">ア Katakana chart</button></div>
        ${TRACKS.map((t) => {
          const lessons = ALL_LESSONS.filter((l) => l.track === t.id);
          const done = lessons.filter((l) => cleared.has(l.id)).length;
          // A locked level's track shows, locked, with the one line saying how it opens.
          const open = itemOpen(t);
          return `<section class="stack-sm" aria-label="${esc(t.title)}">
            <div class="row-between"><h2 class="section-title"><span lang="ja" data-noruby>${esc(t.jp)}</span> ${esc(t.title)}</h2><span class="small dim mono">${open ? `${done}/${lessons.length}` : '🔒 ' + levelOf(t)}</span></div>
            <p class="small dim">${esc(t.body)}</p>
            ${open ? '' : `<p class="small dim">${esc(lockLine(levelOf(t)))}</p>`}
            <details class="fold" ${next && next.track === t.id ? 'open' : ''}><summary class="small strong">${open ? `${lessons.length} lessons` : `${lessons.length} lessons, locked`}</summary>
            <div class="lesson-list">${lessons.map((l, i) => `
              <button class="panel lesson-row ${cleared.has(l.id) ? 'cleared' : ''} ${next && next.id === l.id ? 'next' : ''}" data-act="lesson" data-id="${l.id}" ${open ? '' : 'disabled'}>
                <span class="ch-num">${cleared.has(l.id) ? '✓' : i + 1}</span>
                <span class="grow"><span class="strong">${esc(l.title)}</span><br><span class="lesson-preview" lang="ja" data-noruby>${esc(preview(l))}</span></span>
                <span class="dim chev" aria-hidden="true">›</span>
              </button>`).join('')}</div></details>
          </section>`;
        }).join('')}
      </div>`;
  }

  /** Kana Brush: draw the kana met here from memory. Its drawing reviews are listed with the reading ones. */
  function brushHTML() {
    const met = BRUSH_KANA.filter((x) => store.item('kana:' + x.k)).length;
    if (!met) return '';
    const due = store.brushDue().filter((k) => BRUSH_BY_KANA[k]).length;
    return `<a class="btn wide" href="#/play/brush">✍ ${due ? `Draw ${due} kana that ${due === 1 ? 'is' : 'are'} due` : 'Kana Brush: draw them from memory'}</a>`;
  }

  const trackTitle = (id) => TRACKS.find((t) => t.id === id)?.title || id;
  const preview = (l) => (isKanji(l.track) ? l.kanji.map((j) => j.k) : l.chars.map((c) => c.k)).join(' ');

  function renderChart() {
    const known = learnedKana();
    const lessons = LESSONS.filter((l) => l.track === chartTrack);
    el.innerHTML = `
      <div class="stack">
        <div class="seg" role="radiogroup">
          ${['hiragana', 'katakana'].map((t) => `<button class="seg-btn ${chartTrack === t ? 'on' : ''}" data-act="chart" data-track="${t}" role="radio" aria-checked="${chartTrack === t}">${t === 'hiragana' ? 'あ Hiragana' : 'ア Katakana'}</button>`).join('')}
        </div>
        <p class="small dim">Tap any character to hear it. Bright ones are learned.</p>
        ${lessons.map((l) => `<div><p class="tiny dim strong">${esc(l.title.toUpperCase())}</p>
          <div class="kana-chart">${l.chars.map((c) => `<button class="kana-cell ${known.has(c.k) ? 'known' : ''}" data-act="hear" data-t="${esc(c.k)}"><span class="kc-k" lang="ja" data-noruby>${esc(c.k)}</span><span class="kc-r">${esc(c.r)}</span></button>`).join('')}</div></div>`).join('')}
        <button class="btn wide" data-act="home">Back to the Dojo</button>
      </div>`;
  }

  function renderLearn() {
    const l = lesson;
    const kanji = isKanji(l.track);
    el.innerHTML = `
      <div class="stack">
        <p class="small dim">${esc(trackTitle(l.track))} · Lesson ${ALL_LESSONS.filter((x) => x.track === l.track).indexOf(l) + 1}</p>
        <h2 class="section-title">${esc(l.title)}</h2>
        ${l.note ? `<div class="panel note">💡 <span data-noruby>${esc(l.note)}</span></div>` : ''}
        <p class="small dim">Tap each card to hear it. Say it out loud, picture the hook, then practice.</p>
        <div class="learn-grid">
          ${kanji ? l.kanji.map((j) => `
            <button class="panel learn-card" data-act="hear" data-t="${esc(j.reading)}">
              <span class="learn-k" lang="ja" data-noruby>${esc(j.k)}</span>
              <span class="strong">${esc(j.meaning)}</span>
              <span class="small dim">${esc(j.m)}</span>
              <span class="small" lang="ja" data-noruby>${esc(j.word)} · ${esc(j.reading)} · <span class="mono">${esc(romaji(j.reading))}</span> · ${esc(j.wordEn)}</span>
            </button>`).join('')
          : l.chars.map((c) => `
            <button class="panel learn-card" data-act="hear" data-t="${esc(c.k)}">
              <span class="learn-k" lang="ja" data-noruby>${esc(c.k)}</span>
              <span class="strong mono big">${esc(c.r)}</span>
              ${c.m ? `<span class="small dim" data-noruby>${esc(c.m)}</span>` : ''}
            </button>`).join('')}
        </div>
        <button class="btn primary wide" data-act="practice">✏️ Practice these</button>
        ${ctx.today ? '' : '<button class="btn ghost wide" data-act="home">Back to the Dojo</button>'}
      </div>`;
  }

  function startQuiz(questions, isReview) {
    quiz = { questions, i: 0, firstTry: new Map(), answered: false, picked: null, isReview, retried: new Set(), wrongWords: [] };
    screen = 'quiz';
    render();
    autoSay();
  }

  const q = () => quiz.questions[quiz.i];

  function autoSay() {
    const cur = q();
    if (cur && cur.type === 's2k') setTimeout(() => say(cur.prompt), 150);
  }

  function promptHTML(cur) {
    const kanaish = cur.type === 'k2r' || cur.type === 'w2r' || cur.type === 'j2m' || cur.type === 'jw2r';
    const ask = {
      k2r: 'How do you read this?', r2k: 'Which one is this sound?', s2k: 'Listen. Which one did you hear?',
      w2r: 'Read this word.', j2m: 'What does this kanji mean?', m2j: 'Which kanji means this?', jw2r: 'How is this word read?',
    }[cur.type];
    let big;
    if (cur.type === 's2k') big = '<button class="btn quiz-listen" data-act="replay">🔊 Play again</button>';
    else big = `<div class="quiz-prompt ${kanaish ? '' : 'latin'}" ${kanaish ? 'lang="ja"' : ''} data-noruby>${esc(cur.prompt)}</div>`;
    return `<p class="small dim">${ask}</p>${big}`;
  }

  function optionLabel(cur, o) {
    if (cur.type === 'jw2r') return `<span lang="ja">${esc(o)}</span> <span class="small dim mono">${esc(romaji(o))}</span>`;
    if (cur.type === 'r2k' || cur.type === 's2k' || cur.type === 'm2j') return `<span class="opt-k" lang="ja">${esc(o)}</span>`;
    return `<span class="mono">${esc(o)}</span>`;
  }

  function renderQuiz() {
    const cur = q();
    const n = quiz.questions.length;
    const pct = (quiz.i / n) * 100;
    const right = quiz.answered && quiz.picked === cur.answer;
    el.innerHTML = `
      <div class="stack quiz" data-noruby>
        <div class="row-between"><span class="small dim">${quiz.isReview ? 'Review' : esc(lesson.title)}</span><span class="small dim mono">${quiz.i + 1} / ${n}</span></div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        ${promptHTML(cur)}
        <div class="choice-grid quiz-opts">
          ${cur.opts.map((o, i) => {
            let cls = '';
            if (quiz.answered) cls = o === cur.answer ? 'good' : o === quiz.picked ? 'wrong' : 'faded';
            return `<button class="btn ${cls}" data-act="pick" data-i="${i}" ${quiz.answered ? 'disabled' : ''}><span class="tiny dim">${i + 1}</span> ${optionLabel(cur, o)}</button>`;
          }).join('')}
        </div>
        ${quiz.answered ? feedbackHTML(cur, right) : ''}
      </div>`;
  }

  function feedbackHTML(cur, right) {
    const it = cur.item;
    let detail = '';
    if (cur.type === 'w2r') detail = `<span lang="ja">${esc(it.w)}</span> = <span class="mono">${esc(romaji(it.w))}</span>: ${esc(it.en)}`;
    else if (isKanji(it.track)) detail = `<span lang="ja">${esc(it.k)}</span> = ${esc(it.meaning)} · <span lang="ja">${esc(it.word)}</span> (${esc(it.reading)}, <span class="mono">${esc(romaji(it.reading))}</span>) ${esc(it.wordEn)}`;
    else detail = `<span lang="ja">${esc(it.k)}</span> = <span class="mono">${esc(it.r)}</span>${it.m ? ` · <span class="dim">${esc(it.m)}</span>` : ''}`;
    return `<div class="panel ${right ? 'good-panel' : 'note'} stack-sm">
        <p class="strong ${right ? 'good-c' : 'miss-c'}">${right ? '✓ Right!' : "Not quite. It'll come back once more."}</p>
        <p class="small">${detail}</p>
        <div class="row2"><button class="btn" data-act="replay">🔊 Hear it</button><button class="btn primary" data-act="next">Next ▶</button></div>
      </div>`;
  }

  function soundOf(cur) {
    const it = cur.item;
    if (cur.type === 'w2r') return it.w;
    if (isKanji(it.track)) return it.reading;
    return it.k;
  }

  function pick(i) {
    if (quiz.answered) return;
    const cur = q();
    const o = cur.opts[i];
    quiz.answered = true;
    quiz.picked = o;
    const ok = o === cur.answer;
    store.grade({ skill: isKanji(cur.item.track) ? 'kanji' : cur.type === 'w2r' ? 'vocab' : 'kana', id: cur.id, ok, firstTry: !quiz.retried.has(cur.id + cur.type) });
    if (!quiz.firstTry.has(cur.id)) quiz.firstTry.set(cur.id, ok);
    else if (!ok) quiz.firstTry.set(cur.id, false);
    if (!ok && !quiz.retried.has(cur.id + cur.type)) {
      // Ask it again a little later in the round, with fresh option order.
      quiz.retried.add(cur.id + cur.type);
      const again = { ...cur, opts: shuffle(cur.opts) };
      const at = Math.min(quiz.questions.length, quiz.i + 3);
      quiz.questions.splice(at, 0, again);
    }
    say(soundOf(cur));
    render();
    if (ok) fx.hit(); else fx.miss();
    fx.announce(ok ? 'Right.' : `Not quite. The answer is ${cur.answer}.`);
    if (ok) {
      const at = quiz.i;
      setTimeout(() => { if (quiz && quiz.answered && quiz.i === at && screen === 'quiz') next(); }, 1100);
    }
  }

  function next() {
    if (!quiz) return;
    quiz.i++;
    quiz.answered = false;
    quiz.picked = null;
    if (ctx.today) ctx.today.report(`${Math.min(quiz.i, quiz.questions.length)}/${quiz.questions.length}`);
    if (quiz.i >= quiz.questions.length) return finish();
    render();
    autoSay();
  }

  function finish() {
    // Grade each character once: right on every try = it grows; any miss = it comes back sooner.
    for (const [id, ok] of quiz.firstTry) {
      if (!ITEM[id]) { store.log(ok); continue; }
      store.recordDojo(id, ok, { firstTime: !quiz.isReview && !store.item(id) });
    }
    if (!quiz.isReview && lesson) store.clearLesson(lesson.id);
    else store.markStudied();
    screen = 'result';
    render();
    fx.hit({ big: true, el: el.querySelector('.score-huge') });
    if (ctx.today) ctx.today.done();
  }

  function renderResult() {
    const vals = [...quiz.firstTry.values()];
    const right = vals.filter(Boolean).length;
    const rate = vals.length ? right / vals.length : 1;
    const next = store.nextLesson();
    const missed = [...quiz.firstTry.entries()].filter(([, ok]) => !ok).map(([id]) => ITEM[id] || null).filter(Boolean);
    el.innerHTML = `
      <div class="stack center-text">
        <div class="score-huge accent-c mono">${Math.round(rate * 100)}%</div>
        <p class="lead strong">${quiz.isReview ? 'Review done.' : `${esc(lesson.title)} cleared!`} ${right}/${vals.length} on the first try.</p>
        <p class="dim">${rate >= 0.85 ? 'Great. These will come back for a quick review in a day or two.' : 'No problem: the ones you missed come back for review soon. Practicing this lesson again now also helps.'}</p>
        ${missed.length ? `<div class="panel left-text"><p class="section-label">PRACTICE THESE</p><div class="chips">${missed.map((it) => `<button class="chip" data-act="hear" data-t="${esc(isKanji(it.track) ? it.reading : it.k)}"><span lang="ja" data-noruby>${esc(it.k)}</span> <span class="mono small">${esc(it.r || it.meaning)}</span></button>`).join('')}</div></div>` : ''}
        ${ctx.today ? '' : `
          ${next ? `<button class="btn primary wide" data-act="lesson" data-id="${next.id}">▶ Next: ${esc(trackTitle(next.track))} · ${esc(next.title)}</button>` : ''}
          ${!quiz.isReview ? `<button class="btn wide" data-act="practice">↻ Practice this lesson again</button>` : ''}
          <button class="btn ghost wide" data-act="home">Back to the Dojo</button>`}
      </div>`;
  }

  function openLesson(id) {
    lesson = LESSON_BY_ID[id];
    if (!lesson) return;
    screen = 'learn';
    render();
    window.scrollTo(0, 0);
  }

  const off = delegate(el, {
    lesson: (b) => openLesson(b.dataset.id),
    review: () => { lesson = null; startQuiz(buildReviewQuiz(store.dojoDue()), true); },
    chart: (b) => { chartTrack = b.dataset.track; screen = 'chart'; render(); },
    home: () => { screen = 'overview'; quiz = null; render(); },
    hear: (b) => say(b.dataset.t),
    practice: () => startQuiz(buildLessonQuiz(lesson), false),
    pick: (b) => pick(+b.dataset.i),
    replay: () => { const cur = q(); if (cur) say(cur.type === 's2k' && !quiz.answered ? cur.prompt : soundOf(cur)); },
    next,
  });

  const onKey = (e) => {
    if (screen !== 'quiz' || !quiz) return;
    if (!quiz.answered && /^[1-4]$/.test(e.key)) { const i = +e.key - 1; if (q().opts[i] !== undefined) pick(i); }
    else if (quiz.answered && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
  };
  window.addEventListener('keydown', onKey);

  if (ctx.today) {
    const due = store.dojoDue();
    const nextL = store.nextLesson();
    if (ctx.review || !nextL) {
      if (due.length) { startQuiz(buildReviewQuiz(due), true); ctx.today.report(`0/${quiz.questions.length}`); }
      else { render(); ctx.today.done('Nothing to review right now.'); }
    } else {
      openLesson(nextL.id);
      ctx.today.report('learn');
    }
  } else {
    render();
  }

  return () => { off(); window.removeEventListener('keydown', onKey); speaker.stop(); quiz = null; };
}

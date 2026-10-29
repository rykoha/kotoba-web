// Voice time capsule: record the same five sentences now, and again every four weeks, then hear the first take next to
// the latest one and the app's own voice, with each one's pitch line drawn over the others. Hearing your own growth
// is the clearest proof of progress there is.
//
// Learning first: the English shows first, so you try each sentence from memory before showing the Japanese. The
// sentences are course examples that already have VOICEVOX clips, five per level, harder as the level rises.
//
// Private: recordings stay on this device only, in IndexedDB (kotobaBeat-capsule), never in progress, sync or an
// export code. "Delete my recordings" removes them all.
import { store } from './store.js';
import { speaker, audioContext, micSupported, micHelp } from './audio.js';
import { STUDY_UNITS } from './course-data.js';
import { APP_LEVELS, isUnlocked } from './levels.js';
import { modelClip, analyseBuffer } from './model-clip.js';
import { icon } from './icons.js';
import { esc, delegate } from './ui.js';

/** Days between takes. */
export const TAKE_EVERY = 28;
/** Longest recording (ms). */
export const MAX_MS = 7000;
/** Takes kept per sentence: the first one, and the newest after it. */
export const KEEP = 6;
const DAY = 86_400_000;
const DB = 'kotobaBeat-capsule';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (t) => { const d = new Date(t); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };

/** The sentences for each level (course examples, so each has its clip and reading). */
const PICKS = {
  N5: ['おはよう ございます、師匠！', 'これは 本です。', '水を のみます。', 'ともだちと えきに いきます。', 'きのう ラーメンを たべました。'],
  N4: ['レンは 道場で れんしゅうして います。', 'ここに すわっても いいですか。', 'バスより 電車の ほうが べんりです。', 'からい ものは 食べられません。', 'よし、ラーメンを 食べに 行こう！'],
  N3: ['毎朝 六時に 起きるように して いる。', '暗く ならない うちに、家に 帰ろう。', 'この 町の 歴史に ついて 調べて います。', '来年の 大会に 出る ことに した。', '天気予報に よると、あしたは 大雨に なるそうだ。'],
};
const EXAMPLES = new Map(STUDY_UNITS.flatMap((u) => u.points.flatMap((p) => p.examples || [])).map((x) => [x.jp, x]));
/** { N5: [{ jp, reading, en, voice }], ... } */
export const SETS = Object.fromEntries(Object.entries(PICKS).map(([lv, list]) => [lv, list.map((jp) => EXAMPLES.get(jp)).filter(Boolean)]));

// ---------- storage (IndexedDB, this device only) ----------
let dbJob = null;
function db() {
  if (dbJob) return dbJob;
  dbJob = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { const s = req.result.createObjectStore('takes', { keyPath: 'id', autoIncrement: true }); s.createIndex('set', 'set'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbJob = null; throw e; });
  return dbJob;
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('takes', mode);
    const out = fn(t.objectStore('takes'));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
};

/** Every recording for a level's set, oldest first: [{ id, set, idx, at, blob }]. */
export async function takesOf(set) {
  try {
    const all = await tx('readonly', (s) => s.index('set').getAll(set));
    return (all || []).sort((a, b) => a.at - b.at);
  } catch (e) { return []; }
}

/** Saves a recording, keeping the first and the newest few per sentence. */
export async function saveTake(set, idx, blob, at = Date.now()) {
  await tx('readwrite', (s) => s.add({ set, idx, at, blob }));
  const mine = (await takesOf(set)).filter((t) => t.idx === idx);
  const drop = mine.length > KEEP ? mine.slice(1, mine.length - (KEEP - 1)) : [];
  if (drop.length) await tx('readwrite', (s) => drop.forEach((t) => s.delete(t.id)));
}

export async function deleteAll() {
  try { await tx('readwrite', (s) => s.clear()); } catch (e) { /* nothing stored */ }
}

/** { first, last, next } for a set: the first and latest take days (ms) and when the next take is due. */
export async function capsuleStatus(set) {
  const takes = await takesOf(set);
  if (!takes.length) return { first: null, last: null, next: null, count: 0 };
  const last = takes[takes.length - 1].at;
  return { first: takes[0].at, last, next: last + TAKE_EVERY * DAY, count: takes.length };
}

/** The level whose sentences to record: the newest level open (so the set rises with the learner). */
export const capsuleLevel = () => APP_LEVELS.filter((lv) => SETS[lv] && SETS[lv].length && isUnlocked(lv)).slice(-1)[0] || 'N5';

// ---------- pitch lines ----------
/** Pitch points across the speech: [{ x (0..1 of the speech), st (semitones from the median) }], with null gaps. */
export function pitchLine({ frames, span }) {
  const len = Math.max(0.05, span.to - span.from);
  const voiced = frames.filter((f) => f.time >= span.from && f.time <= span.to && f.hz);
  if (voiced.length < 3) return [];
  const hz = voiced.map((f) => f.hz).sort((a, b) => a - b);
  const mid = hz[Math.floor(hz.length / 2)];
  return frames.filter((f) => f.time >= span.from && f.time <= span.to).map((f) => ({
    x: (f.time - span.from) / len, st: f.hz ? Math.max(-8, Math.min(8, 12 * Math.log2(f.hz / mid))) : null,
  }));
}

function path(points, w, h) {
  let d = '', pen = false;
  for (const p of points) {
    if (p.st == null) { pen = false; continue; }
    const x = (p.x * w).toFixed(1), y = (h / 2 - (p.st / 8) * (h / 2 - 4)).toFixed(1);
    d += `${pen ? 'L' : 'M'}${x} ${y}`;
    pen = true;
  }
  return d;
}

/** The three lines in one small chart: the app's voice (faint), the first take (dashed) and the latest (solid). */
export function linesSVG({ model, first, last }) {
  const W = 300, H = 70;
  const line = (pts, cls) => (pts && pts.length ? `<path class="${cls}" d="${path(pts, W, H)}"/>` : '');
  return `<svg class="cap-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pitch lines: the app's voice, your first take and your latest take">
    <line class="cap-mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>
    ${line(model, 'cap-model')}${line(first, 'cap-first')}${line(last, 'cap-last')}
  </svg>`;
}

async function blobLine(blob) {
  try {
    const ctx = audioContext();
    if (!ctx) return null;
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return pitchLine(analyseBuffer(buffer));
  } catch (e) { return null; }
}

// ---------- the Progress panel ----------
/** The Progress panel, filled in once the device's recordings are read (they're in IndexedDB, so it's async). */
export function capsuleSection() {
  return `<section class="panel stack-sm capsule" aria-labelledby="cap-h" id="cap-panel">
    <h2 class="section-title" id="cap-h">${icon('mic')} Voice time capsule</h2>
    <p class="small cap-status">Record five sentences now and again every four weeks, then hear how far you've come.</p>
    <a class="btn" href="#/capsule">Open the time capsule</a>
  </section>`;
}

/** Fills in the Progress panel's status line. */
export async function fillCapsuleSection(root) {
  const el = root.querySelector('#cap-panel .cap-status');
  if (!el) return;
  const st = await capsuleStatus(capsuleLevel());
  if (!el.isConnected || !st.count) return;
  const due = st.next <= Date.now();
  el.textContent = due ? `It's been ${TAKE_EVERY / 7} weeks or more since your last take (${day(st.last)}). Time for a new one.`
    : `First take ${day(st.first)}, latest ${day(st.last)}. The next take opens ${day(st.next)}.`;
}

// ---------- the screen (#/capsule) ----------
export function mount(el) {
  let set = capsuleLevel();
  let takes = [];
  let rec = null;          // { idx, mr, stream, timer, chunks }
  let showJa = new Set();  // sentences whose Japanese is showing
  let lines = new Map();   // idx -> { model, first, last }
  let error = '';
  let gone = false;
  const audio = new Audio();

  async function load() {
    takes = await takesOf(set);
    if (gone) return;
    render();
    lines = new Map();
    for (const [idx, s] of SETS[set].entries()) {
      const mine = takes.filter((t) => t.idx === idx);
      if (!mine.length) continue;
      const model = await modelClip({ jp: s.jp, voice: s.voice || 0 });
      const out = { model: model ? pitchLine(model) : null, first: await blobLine(mine[0].blob), last: mine.length > 1 ? await blobLine(mine[mine.length - 1].blob) : null };
      if (gone) return;
      lines.set(idx, out);
      const box = el.querySelector(`[data-chart="${idx}"]`);
      if (box) box.innerHTML = linesSVG(out);
    }
  }

  function render() {
    const sentences = SETS[set];
    const last = takes.length ? takes[takes.length - 1].at : null;
    const next = last ? last + TAKE_EVERY * DAY : null;
    const supported = micSupported && typeof MediaRecorder !== 'undefined';
    el.innerHTML = `<div class="stack capsule-screen">
      <section class="panel stack-sm" aria-labelledby="cap-h2">
        <h2 class="section-title" id="cap-h2">${icon('mic')} Voice time capsule</h2>
        <p class="small">Record these five sentences now, and again every four weeks. Then play your first take next to your latest and the app's voice, and watch the pitch lines come together.</p>
        <p class="small dim">Try each one from memory first: read the English, say the Japanese, then check it.</p>
        ${Object.keys(SETS).filter((lv) => isUnlocked(lv)).length > 1 ? `<div class="seg" role="radiogroup" aria-label="Sentence set">${Object.keys(SETS).filter((lv) => isUnlocked(lv)).map((lv) => `<button class="seg-btn ${lv === set ? 'on' : ''}" data-act="set" data-v="${lv}" role="radio" aria-checked="${lv === set}">${lv}</button>`).join('')}</div>` : ''}
        <p class="small">${last ? (next <= Date.now() ? `<span class="strong">Time for a new take.</span> Your last one was ${day(last)}.` : `Latest take ${day(last)}. The next one opens ${day(next)}, but you can record any time.`) : 'No takes yet. Your first take is the one you\'ll compare against.'}</p>
        ${supported ? '' : `<p class="small miss-c">This browser can't record audio. Chrome, Edge and Safari can.</p>`}
        ${error ? `<p class="small miss-c">${esc(error)}</p>` : ''}
        <p class="tiny dim">Recordings stay on this device only. They're never synced or exported.</p>
      </section>
      ${sentences.map((s, idx) => {
        const mine = takes.filter((t) => t.idx === idx);
        const first = mine[0], latest = mine.length > 1 ? mine[mine.length - 1] : null;
        const recording = rec && rec.idx === idx;
        return `<section class="panel stack-sm cap-item" aria-label="Sentence ${idx + 1}">
          <p class="strong">${idx + 1}. ${esc(s.en)}</p>
          ${showJa.has(idx) ? `<p class="cap-ja" lang="ja">${esc(s.jp)}</p>` : `<button class="linkbtn inline" data-act="ja" data-i="${idx}">Show the Japanese</button>`}
          <div class="row-gap wrap-gap">
            <button class="btn ${recording ? 'primary' : ''}" data-act="rec" data-i="${idx}" ${!supported || (rec && !recording) ? 'disabled' : ''}>${recording ? 'Stop' : `${icon('mic')} Record`}</button>
            <button class="btn small-btn" data-act="model" data-i="${idx}">🔊 App's voice</button>
            ${first ? `<button class="btn small-btn" data-act="play" data-id="${first.id}">First take · ${esc(day(first.at))}</button>` : ''}
            ${latest ? `<button class="btn small-btn" data-act="play" data-id="${latest.id}">Latest · ${esc(day(latest.at))}</button>` : ''}
          </div>
          ${first ? `<div class="cap-lines" data-chart="${idx}">${lines.has(idx) ? linesSVG(lines.get(idx)) : ''}</div>
            <p class="tiny dim cap-key"><span class="k-model">App</span> <span class="k-first">First take</span>${latest ? ' <span class="k-last">Latest</span>' : ''}</p>` : ''}
        </section>`;
      }).join('')}
      ${takes.length ? '<button class="btn ghost" data-act="delete">Delete my recordings</button>' : ''}
    </div>`;
  }

  function stopTracks() { if (rec && rec.stream) rec.stream.getTracks().forEach((t) => t.stop()); }

  async function startRec(idx) {
    error = '';
    speaker.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (gone) { stream.getTracks().forEach((t) => t.stop()); return; }
      const mr = new MediaRecorder(stream);
      const chunks = [];
      rec = { idx, mr, stream, chunks, timer: null };
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        stopTracks();
        rec = null;
        if (blob.size) { await saveTake(set, idx, blob); store.markStudied(); }
        if (!gone) load();
      };
      mr.start();
      rec.timer = setTimeout(() => stopRec(), MAX_MS);
      render();
    } catch (e) {
      rec = null;
      error = micHelp(e && e.name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture');
      render();
    }
  }
  function stopRec() {
    if (!rec) return;
    clearTimeout(rec.timer);
    if (rec.mr.state !== 'inactive') rec.mr.stop();
  }

  const off = delegate(el, {
    set: (b) => { set = b.dataset.v; showJa = new Set(); load(); },
    ja: (b) => { showJa.add(Number(b.dataset.i)); render(); },
    rec: (b) => { const i = Number(b.dataset.i); if (rec && rec.idx === i) stopRec(); else if (!rec) startRec(i); },
    model: (b) => { const s = SETS[set][Number(b.dataset.i)]; if (s) speaker.speak(s.jp, { voice: s.voice || 0, mps: 4 }); },
    play: (b) => {
      const t = takes.find((x) => String(x.id) === b.dataset.id);
      if (!t) return;
      speaker.stop();
      try { if (audio.src) URL.revokeObjectURL(audio.src); } catch (e) { /* ignore */ }
      audio.src = URL.createObjectURL(t.blob);
      audio.play().catch(() => {});
    },
    delete: async (b) => {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to delete every recording'; return; }
      await deleteAll();
      load();
    },
  });
  render();
  load();
  return () => {
    gone = true;
    off();
    if (rec) { clearTimeout(rec.timer); rec.mr.onstop = null; try { rec.mr.stop(); } catch (e) { /* ignore */ } stopTracks(); rec = null; }
    audio.pause();
  };
}

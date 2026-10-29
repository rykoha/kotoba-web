// Story › Paste a line: line mining. Paste a short line from a show, check its reading (known kanji come from the
// readings pipeline, unknown ones are typed in hiragana), add a meaning, and it becomes a Garden card ('mine:<n>').
// Works offline: nothing leaves the device.
import { store } from '../store.js';
import { speaker } from '../audio.js';
import { gardenStage } from '../data.js';
import { segmentParts } from '../furigana.js';
import { toHiragana, KANJI_RE } from '../romaji.js';
import { romajiToKana } from '../kana-input.js';
import { esc, delegate, toast } from '../ui.js';
import * as fx from '../fx.js';

export const MAX_LINE = 60;
const SEG_RE = /[ぁ-ゖァ-ヺー一-鿿々]+/g;
const KANA_ONLY = /^[ぁ-ゖァ-ヺー]+$/;
const HAS_JP = /[ぁ-ゖァ-ヺー一-鿿々]/;

/**
 * Splits a line into parts: [text, reading, kind] where kind is 'kanji' (needs a reading), 'kana' or 'other'
 * (punctuation, spaces, Latin). Kanji readings come from js/readings.js when known, else null.
 */
export function splitLine(line) {
  const parts = [];
  let last = 0;
  for (const m of line.matchAll(SEG_RE)) {
    if (m.index > last) parts.push([line.slice(last, m.index), null, 'other']);
    for (const [t, r] of segmentParts(m[0])) parts.push(KANJI_RE.test(t) ? [t, r || null, 'kanji'] : [t, null, 'kana']);
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push([line.slice(last), null, 'other']);
  return parts;
}

/** Ruby markup for a saved line's parts (built here, so the page's reading help leaves it alone). */
export function rubyHTML(parts) {
  return parts.map(([t, r]) => (r && KANJI_RE.test(t) ? `<ruby>${esc(t)}<rt>${esc(r)}</rt></ruby>` : esc(t))).join('');
}

export function mountMine(el, { back }) {
  let draft = '';         // the pasted line
  let parts = null;       // splitLine(draft) once "Show readings" is pressed
  let readings = [];      // typed reading per kanji part (index into parts)
  let meaning = '';
  let message = '';
  let armed = null;       // id of a mined line waiting for its second "delete" tap

  function render() {
    const mined = store.mined.slice().reverse();
    el.innerHTML = `
      <div class="stack mine" data-noruby>
        <div class="row-between"><h2 class="section-title">✍️ Paste a line</h2>
          <button class="btn ghost small-btn" data-act="m-back">Chapters</button></div>
        <p class="small dim">Heard a great line in a show you're watching? Paste or type it (Japanese, up to ${MAX_LINE} characters). Check the reading, add what it means, and it goes to your Garden as a review card.</p>
        <label class="stack-sm"><span class="strong small">Japanese line</span>
          <textarea id="mine-jp" class="mine-input" rows="2" maxlength="${MAX_LINE}" lang="ja" placeholder="例: おれは まけねえ！" aria-label="Japanese line">${esc(draft)}</textarea></label>
        <button class="btn" data-act="m-read">🔍 Show readings</button>
        ${parts ? workHTML() : ''}
        ${message ? `<p class="miss-c small" role="alert">${esc(message)}</p>` : ''}
        <section class="stack-sm" aria-labelledby="mined-h">
          <h3 class="section-label" id="mined-h">YOUR MINED LINES · ${mined.length}</h3>
          ${mined.length ? mined.map(minedRow).join('') : '<p class="small dim">None yet. Lines you save show up here and in the Garden.</p>'}
        </section>
      </div>`;
  }

  function workHTML() {
    let k = -1;
    const tokens = parts.map(([t, r, kind]) => {
      if (kind !== 'kanji') return `<span class="mine-tok ${kind}"><span class="mine-k" lang="ja">${esc(t)}</span>${kind === 'kana' ? `<span class="mine-r">${esc(toHiragana(t))}</span>` : ''}</span>`;
      k++;
      const val = readings[k] ?? '';
      return `<label class="mine-tok kanji ${r ? 'known' : 'unknown'}"><span class="mine-k" lang="ja">${esc(t)}</span>
        <input class="mine-reading" data-k="${k}" value="${esc(val)}" lang="ja" autocomplete="off" autocapitalize="off" spellcheck="false"
          aria-label="Reading of ${esc(t)} in hiragana" placeholder="${r ? '' : 'よみ?'}" size="${Math.max(3, t.length * 3)}"></label>`;
    }).join('');
    const unknown = parts.filter((p) => p[2] === 'kanji' && !p[1]).length;
    return `
      <div class="panel stack-sm mine-work">
        <p class="small dim">${unknown ? `Type the reading for the ${unknown === 1 ? 'kanji' : `${unknown} kanji groups`} marked よみ?, in hiragana or romaji.` : 'Readings filled in from the app\'s dictionary. Fix any that look wrong.'}</p>
        <div class="mine-tokens">${tokens}</div>
        <label class="stack-sm"><span class="strong small">What it means (English)</span>
          <input id="mine-en" class="mine-input" maxlength="120" value="${esc(meaning)}" aria-label="Meaning in English" placeholder="e.g. I won't lose!"></label>
        <div class="row2"><button class="btn" data-act="m-hear">🔊 Hear it</button>
          <button class="btn primary" data-act="m-save">🌱 Add to Garden</button></div>
      </div>`;
  }

  function minedRow(m) {
    const lv = store.progress(m.id).level;
    return `<div class="panel mine-row">
      <span class="plant-emoji" aria-hidden="true">${gardenStage(lv)}</span>
      <span class="grow"><span class="mine-line" lang="ja">${m.parts && m.parts.length ? rubyHTML(m.parts) : esc(m.jp)}</span><br>
        <span class="small dim" lang="ja">${esc(m.reading)}</span><br><span class="small trace-c">${esc(m.en)}</span></span>
      <span class="mine-acts">
        <button class="btn ghost small-btn" data-act="m-say" data-id="${m.id}" aria-label="Hear ${esc(m.jp)}">🔊</button>
        <button class="btn small-btn ${armed === m.id ? 'danger' : ''}" data-act="m-del" data-id="${m.id}">${armed === m.id ? 'Tap again to delete' : 'Delete'}</button>
      </span></div>`;
  }

  /** Keeps what's typed when re-rendering. */
  function readForm() {
    const ta = el.querySelector('#mine-jp');
    if (ta) draft = ta.value;
    const en = el.querySelector('#mine-en');
    if (en) meaning = en.value;
    el.querySelectorAll('.mine-reading').forEach((inp) => { readings[+inp.dataset.k] = inp.value; });
  }

  function showReadings() {
    readForm();
    const line = draft.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE);
    message = '';
    if (!HAS_JP.test(line)) { parts = null; message = 'Paste a line with Japanese in it (kana or kanji).'; render(); return; }
    draft = line;
    parts = splitLine(line);
    readings = parts.filter((p) => p[2] === 'kanji').map((p) => p[1] || '');
    render();
    (el.querySelector('.mine-reading:placeholder-shown') || el.querySelector('#mine-en'))?.focus();
  }

  function save() {
    readForm();
    if (!parts) { showReadings(); return; }
    const line = draft.replace(/\s+/g, ' ').trim();
    if (line !== parts.map((p) => p[0]).join('')) { showReadings(); message = 'The line changed, so the readings were refreshed. Check them, then save.'; render(); return; }
    let k = -1;
    const missing = [];
    const saved = parts.map(([t, , kind]) => {
      if (kind !== 'kanji') return [t, null];
      k++;
      // Romaji works too, for a keyboard without Japanese input ("kokoro" becomes こころ).
      const typed = (readings[k] || '').replace(/\s+/g, '');
      const r = toHiragana(/[a-z]/i.test(typed) ? romajiToKana(typed) : typed);
      if (!KANA_ONLY.test(r)) missing.push(t);
      return [t, r];
    });
    if (missing.length) { message = `Type the reading in hiragana or romaji for: ${missing.join('、')}`; render(); return; }
    meaning = meaning.trim();
    if (!meaning) { message = 'Add what the line means, so the Garden card can quiz you on it.'; render(); el.querySelector('#mine-en')?.focus(); return; }
    if (store.mined.some((m) => m.jp === line)) { message = 'That line is already in your Garden.'; render(); return; }
    const reading = saved.map(([t, r]) => (r != null ? r : toHiragana(t))).join('');
    store.mineLine({ jp: line, reading, en: meaning, parts: saved });
    store.grade({ skill: 'vocab', id: 'mine', ok: true });
    draft = ''; parts = null; readings = []; meaning = ''; message = '';
    render();
    toast('🌱 Planted in your Garden. It\'s ready to review now.');
    fx.hit();
  }

  const off = delegate(el, {
    'm-back': back,
    'm-read': showReadings,
    'm-save': save,
    'm-hear': () => { readForm(); if (draft.trim()) speaker.speak(draft.trim(), { mps: 4 }); },
    'm-say': (b) => { const m = store.mined.find((x) => x.id === b.dataset.id); if (m) speaker.speak(m.jp, { mps: 4 }); },
    'm-del': (b) => {
      readForm();
      const id = b.dataset.id;
      if (armed !== id) { armed = id; render(); el.querySelector(`[data-act=m-del][data-id="${id}"]`)?.focus(); return; }
      armed = null;
      store.deleteMined(id);
      render();
      toast('Deleted the line and its Garden card.');
    },
  });
  const onKey = (e) => {
    if (e.key === 'Enter' && e.target.matches?.('#mine-jp') && !e.shiftKey) { e.preventDefault(); showReadings(); }
    else if (e.key === 'Enter' && e.target.matches?.('.mine-reading, #mine-en')) { e.preventDefault(); save(); }
  };
  el.addEventListener('keydown', onKey);
  render();
  return () => { off(); el.removeEventListener('keydown', onKey); };
}

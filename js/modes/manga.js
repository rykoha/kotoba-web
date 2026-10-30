// Manga Reader: read real manga with help. The learner adds pages they own or read legally (screenshots or picture
// files), which stay in this browser only (js/manga-pages.js). They draw a box around a speech bubble and the text is
// read on the device (js/manga-ocr.js), or they paste or type it. The bubble's words are found in an offline
// dictionary that undoes conjugations (js/manga-dict.js); a tap on a word shows its reading and meaning, and any word
// can be kept: a word from the Garden's decks is planted as that card, any other becomes one of My words.
//
// Practice pages at each level (js/manga-samples.js) show how it works before any pages are added.
import { store } from '../store.js';
import { speaker } from '../audio.js';
import { GARDEN_CATALOG } from '../data.js';
import { itemOpen, lockLine, levelOf, APP_LEVELS, allContent } from '../levels.js';
import { LOOKUP_GRAMMAR } from '../lookup.js';
import { romaji } from '../romaji.js';
import { readingConfig } from '../furigana.js';
import { esc, delegate, toast } from '../ui.js';
import * as dict from '../manga-dict.js';
import * as ocr from '../manga-ocr.js';
import * as pages from '../manga-pages.js';
import { MANGA_SAMPLES, SAMPLE_BY_ID, plainText, rubyHTML, pageSVG, PAGE_W, PAGE_H } from '../manga-samples.js';

const KANJI = /[一-鿿々]/;
/** Smallest box (in screen pixels) that counts as boxing a bubble; anything less is a tap. */
const MIN_BOX = 14;

/** Free, legal places to read manga in Japanese, for the "where to get pages" panel. */
export const SOURCES_LEGAL = [
  ['少年ジャンプ+ (Shonen Jump+)', 'Shueisha. SPY×FAMILY, Kaiju No. 8, Dandadan, and campaigns for Naruto and One Piece.'],
  ['サンデーうぇぶり (Sunday Webry)', "Shogakukan. Frieren and other Shōnen Sunday series."],
  ['マガポケ (Magazine Pocket)', 'Kodansha. Blue Lock and other Shōnen Magazine series.'],
  ['Amazon.co.jp Kindle 0円', 'Free first volumes during campaigns. Search for 0円 and the title.'],
];

/** The Garden card for a dictionary word, if one of the decks has it (same writing and reading). */
let catalogIndex = null;
export function catalogMatch(jp, reading) {
  if (!catalogIndex) {
    catalogIndex = new Map();
    for (const item of Object.values(GARDEN_CATALOG)) {
      if (!item || !item.jp || item.mined) continue;
      const key = item.jp + '|' + (item.reading || item.jp);
      if (!catalogIndex.has(key)) catalogIndex.set(key, item);
    }
  }
  return catalogIndex.get(jp + '|' + reading) || null;
}

/**
 * The reading of `text` (as written in the bubble) for a dictionary result: the entry's reading with the kanji part
 * swapped in, so 食べなかった reads たべなかった. Null if it can't be worked out.
 */
export function readingFor(text, r) {
  if (!KANJI.test(text)) return null;
  const e = r.entry;
  const reading = e.kana[0];
  const base = r.base;
  if (!e.kanji.includes(base)) return text === base ? reading : null;
  // 来る changes its first sound: 来ない (こ), 来ます (き), 来れば (く).
  if (base.endsWith('来る') && e.classes.includes('vk')) {
    const at = text.lastIndexOf('来');
    if (at < 0) return null;
    const next = text[at + 1] || '';
    const ko = /[なよさらいず]/.test(next) ? 'こ' : /[まてたそ]/.test(next) ? 'き' : 'く';
    return reading.slice(0, reading.length - 2) + ko + text.slice(at + 1);
  }
  // The base's kanji part and its okurigana (the kana after the last kanji): 食べる → 食 + べる.
  let k = base.length;
  while (k > 0 && !KANJI.test(base[k - 1])) k--;
  const okuri = base.slice(k);
  const head = base.slice(0, k);
  if (!reading.endsWith(okuri) || !text.startsWith(head)) return null;
  return reading.slice(0, reading.length - okuri.length) + text.slice(head.length);
}

/** What the word card shows for one dictionary result. */
export function describeResult(word, r) {
  const e = r.entry;
  // The form to keep: as the dictionary writes it, in kanji if the bubble used kanji, else as the bubble wrote it.
  const usedKanji = KANJI.test(word);
  const jp = usedKanji ? (e.kanji.includes(r.base) ? r.base : e.kanji[0] || r.base) : (e.kana.includes(r.base) ? r.base : e.kana[0]);
  const reading = e.kana[0];
  const grammar = LOOKUP_GRAMMAR[r.base] && (e.classes.includes('prt') || e.classes.includes('aux-v') || !r.reasons.length) ? LOOKUP_GRAMMAR[r.base] : null;
  return {
    jp, reading, word, base: r.base, senses: e.senses, reasons: r.reasons, common: e.common, grammar,
    en: e.senses[0].slice(0, 3).join('; '),
    card: catalogMatch(jp, reading) || (e.kanji[0] ? catalogMatch(e.kanji[0], reading) : null) || catalogMatch(reading, reading),
  };
}

export function mount(el) {
  let view = 'shelf';         // 'shelf' | 'reader'
  let book = null;            // a stored book, or { sample: true, level, pages: [sample ids] }
  let pageIx = 0;
  let page = null;            // the stored page, or a practice page
  let pageUrl = null;         // object URL of the page picture
  let books = [];
  let bubble = null;          // the bubble open in the panel: { id, x, y, w, h, text, ... }
  let words = [];             // the bubble's words (dict.segment)
  let pick = -1;              // the word open in the card
  let alt = 0;                // which dictionary result of that word
  let status = '';            // reading / dictionary status line
  let busy = false;
  let boxMode = true;
  let zoom = false;
  let horizontal = false;     // read the next box as horizontal text
  let armed = null;           // a delete waiting for its second tap
  let translation = null;
  let creating = false;
  let drag = null;
  let alive = true;

  const sampleList = (lv) => allContent('manga').filter((s) => levelOf(s) === lv);

  // ---------- shelf ----------
  async function showShelf() {
    view = 'shelf';
    closeBubble();
    revoke();
    try { books = await pages.listBooks(); } catch (e) { books = []; }
    if (!alive) return;
    render();
  }

  function renderShelf() {
    const mine = store.myWords;
    el.innerHTML = `
      <div class="stack manga">
        <h2 class="title-jp" lang="ja" data-noruby>漫画</h2>
        <p class="dim">Read real manga with help. Add pages, draw a box around a speech bubble, and tap any word for its reading and meaning. Keep the words you want in your Garden.</p>
        <section class="stack-sm" aria-labelledby="mg-mine">
          <h3 class="section-label" id="mg-mine">YOUR MANGA</h3>
          ${books.length ? `<ul class="lib-list">${books.map((b) => `<li><button class="panel lib-card" data-act="book" data-id="${esc(b.id)}">
              <span class="grow stack-xs"><span class="strong">${esc(b.title)}</span>
              <span class="tiny dim">${b.pages.length} page${b.pages.length === 1 ? '' : 's'}${b.pages.length ? ` · page ${Math.min(b.last + 1, b.pages.length)} next` : ''}</span></span>
              <span aria-hidden="true">›</span></button></li>`).join('')}</ul>` : '<p class="small dim">No manga yet. Make a book, then add its pages.</p>'}
          ${creating ? `<form class="panel stack-sm" data-form="new">
              <label class="small strong" for="mg-title">Book name</label>
              <input id="mg-title" class="text-input" name="title" maxlength="60" placeholder="e.g. Frieren 1" autocomplete="off">
              <div class="row2"><button type="button" class="btn" data-act="cancel-new">Cancel</button><button class="btn primary" type="submit">Make book</button></div>
            </form>` : '<button class="btn primary wide" data-act="new">＋ New book</button>'}
          <p class="tiny dim">Pages stay in this browser on this device. They aren't synced, and export codes don't include them.</p>
        </section>
        <section class="stack-sm" aria-labelledby="mg-practice">
          <h3 class="section-label" id="mg-practice">PRACTICE PAGES</h3>
          <p class="small dim">Short original scenes at each level, to try the reader. Their bubbles are ready: just tap one.</p>
          <ul class="lib-list">${APP_LEVELS.map((lv) => {
            const list = sampleList(lv);
            if (!list.length) return '';
            const open = itemOpen(list[0]);
            return `<li><button class="panel lib-card" data-act="practice" data-level="${lv}" ${open ? '' : 'disabled'} aria-label="${lv} practice pages${open ? '' : ' (locked)'}">
              <span class="grow stack-xs"><span class="strong">${lv} practice</span>
              <span class="small" lang="ja" data-noruby>${list.map((s) => esc(plainText(s.title))).join('・')}</span>
              <span class="tiny dim">${open ? `${list.length} pages` : esc(lockLine(lv))}</span></span>
              <span aria-hidden="true">${open ? '›' : '🔒'}</span></button></li>`;
          }).join('')}</ul>
        </section>
        <details class="fold panel" data-fold="words">
          <summary class="strong">My words · ${mine.length}</summary>
          <div class="stack-sm mg-words">
            <p class="small dim">Words you kept from manga that aren't in the Garden's decks. They're Garden cards now, asked by meaning.</p>
            ${mine.length ? mine.map((w) => `<div class="word-row"><span class="strong" lang="ja" data-noruby>${esc(w.jp)}</span>
                ${w.reading && w.reading !== w.jp ? `<span class="dim" lang="ja" data-noruby>${esc(w.reading)}</span>` : ''}
                <span class="small dim grow">${esc(w.en)}</span>
                <button class="btn ghost small-btn" data-act="del-word" data-id="${esc(w.id)}">${armed === w.id ? 'Remove for good?' : 'Remove'}</button></div>`).join('')
              : '<p class="small dim">None yet. In a bubble, tap a word, then "Add to My words".</p>'}
          </div>
        </details>
        <details class="fold panel" data-fold="where">
          <summary class="strong">Where to get pages, and how to add them</summary>
          <div class="stack-sm small">
            <p>Free chapters in Japanese, from the publishers (what's free changes, so check what's up):</p>
            <ul class="mg-sources">${SOURCES_LEGAL.map(([name, what]) => `<li><span class="strong" lang="ja" data-noruby>${esc(name)}</span>: ${esc(what)}</li>`).join('')}</ul>
            <p><span class="strong">On iPhone:</span> open the chapter, take a screenshot of each page (side button + volume up), then in your book tap "Add pages" and pick them from Photos. You can pick several at once.</p>
            <p><span class="strong">On PC:</span> press Win + Shift + S to snip a page, then press Ctrl + V in your book. Or drag picture files onto the page.</p>
            <p><span class="strong">Copying text instead:</span> on iPhone, press and hold the text in a screenshot (Live Text), tap Copy, then use "Paste" in the bubble panel. It's very accurate.</p>
            <p class="dim">Shōnen manga print furigana (small kana) beside their kanji, which helps a lot while you learn kanji. Good first picks: Frieren (calm, short lines), then Naruto, then One Piece (lots of slang).</p>
          </div>
        </details>
      </div>`;
    if (creating) el.querySelector('#mg-title')?.focus();
  }

  // ---------- reader ----------
  async function openBook(id) {
    const b = await pages.getBook(id);
    if (!b || !alive) return;
    book = b;
    view = 'reader';
    await goPage(Math.max(0, Math.min(b.last || 0, b.pages.length - 1)));
    window.scrollTo(0, 0);
  }

  function openPractice(level) {
    book = { sample: true, level, title: `${level} practice`, pages: sampleList(level).map((s) => s.id) };
    view = 'reader';
    goPage(0);
    window.scrollTo(0, 0);
  }

  function revoke() { if (pageUrl) URL.revokeObjectURL(pageUrl); pageUrl = null; }

  async function goPage(i) {
    closeBubble();
    revoke();
    armed = null;
    pageIx = i;
    page = null;
    if (book.pages.length) {
      if (book.sample) page = { sample: SAMPLE_BY_ID[book.pages[i]] };
      else {
        page = await pages.getPage(book.pages[i]);
        if (!alive) return;
        if (page) pageUrl = URL.createObjectURL(page.blob);
        if (book.last !== i) { book.last = i; pages.saveBook(book).catch(() => {}); }
      }
    }
    render();
  }

  function renderReader() {
    const n = book.pages.length;
    const s = page && page.sample;
    const bubbles = s ? s.bubbles.map((b, i) => ({ ...b, id: 's' + i })) : page ? page.bubbles : [];
    const ratio = s ? PAGE_H / PAGE_W : page ? page.h / page.w : 1.4;
    const cfg = readingConfig();
    el.innerHTML = `
      <div class="manga mg-reader ${bubble ? 'has-bubble' : ''}">
        <div class="mg-main stack-sm">
          <div class="mg-bar">
            <button class="btn ghost small-btn" data-act="shelf">‹ Shelf</button>
            <span class="grow strong mg-book-title" ${book.sample ? 'data-noruby' : ''}>${esc(book.title)}</span>
            ${n ? `<span class="small dim mono" aria-live="polite">${pageIx + 1} / ${n}</span>` : ''}
          </div>
          ${n && page ? `<div class="mg-tools">
              ${s ? '' : `<button class="btn small-btn ${boxMode ? 'primary' : ''}" data-act="boxmode" aria-pressed="${boxMode}">${boxMode ? '✏ Boxing bubbles' : '✏ Box a bubble'}</button>`}
              <button class="btn small-btn ${zoom ? 'primary' : ''}" data-act="zoom" aria-pressed="${zoom}">🔍 Zoom</button>
            </div>` : ''}
          ${!n ? emptyBook() : !page ? '<p class="dim">This page could not be opened.</p>' : `
            <div class="mg-scroll ${zoom ? 'zoom' : ''}">
              <div class="mg-stage ${s ? 'sample' : ''} ${boxMode && !s ? 'boxing' : ''} ${cfg.kanji === 'off' ? 'no-rt' : ''}" style="aspect-ratio: ${(1 / ratio).toFixed(4)}">
                ${s ? pageSVG(s, esc) : `<img class="mg-img" src="${pageUrl}" alt="Page ${pageIx + 1}" draggable="false">`}
                ${bubbles.map((b) => bubbleBox(b, s)).join('')}
                <div class="mg-drag" hidden></div>
              </div>
            </div>
            <div class="row2 mg-nav">
              <button class="btn small-btn" data-act="next" ${pageIx + 1 < n ? '' : 'disabled'}>‹ Next page</button>
              <button class="btn small-btn" data-act="prev" ${pageIx > 0 ? '' : 'disabled'}>Previous ›</button>
            </div>
            <p class="tiny dim">${s ? 'Tap a bubble to read it.' : boxMode ? 'Drag a box around a speech bubble to read it. Tap a box to open it again.' : 'Tap a box to open it. Turn on "Box a bubble" to read a new one.'}
              Manga reads right to left, so the next page is on the left.</p>
            ${book.sample ? '' : `<div class="mg-tools mg-page-tools">
              <label class="btn small-btn">📁 Add pages<input type="file" accept="image/*" multiple hidden data-file="add"></label>
              <button class="btn ghost small-btn" data-act="del-page">${armed === 'page' ? 'Remove this page for good?' : 'Remove page'}</button>
              <button class="btn ghost small-btn" data-act="del-book">${armed === 'book' ? 'Delete the whole book?' : 'Delete book'}</button>
            </div>`}`}
        </div>
        ${bubble ? `<aside class="mg-panel panel" aria-label="Bubble">${panelHTML()}</aside>` : ''}
      </div>`;
  }

  function emptyBook() {
    return `<div class="panel stack-sm mg-empty">
      <p class="strong">Add this book's pages</p>
      <p class="small dim">Pick screenshots or picture files. On PC you can also paste a snip (Ctrl + V) or drop files here.</p>
      <label class="btn primary wide">📁 Add pages<input type="file" accept="image/*" multiple hidden data-file="add"></label>
      <button class="btn ghost small-btn" data-act="del-book">${armed === 'book' ? 'Delete the whole book?' : 'Delete book'}</button>
    </div>`;
  }

  /** A bubble on the page: the box drawn for a stored page, the bubble text itself for a practice page. */
  function bubbleBox(b, sample) {
    const W = sample ? PAGE_W : 1, H = sample ? PAGE_H : 1;
    const style = `left:${(b.x / W) * 100}%;top:${(b.y / H) * 100}%;width:${(b.w / W) * 100}%;height:${(b.h / H) * 100}%`;
    const on = bubble && bubble.id === b.id ? ' on' : '';
    if (sample) {
      return `<button class="mg-bubble sample${on}" style="${style}" data-act="bubble" data-id="${b.id}" lang="ja" data-noruby aria-label="Bubble: ${esc(plainText(b.text))}">
        <span class="mg-vtext">${rubyHTML(b.text, esc)}</span></button>`;
    }
    return `<button class="mg-bubble${on}" style="${style}" data-act="bubble" data-id="${esc(b.id)}" aria-label="Bubble${b.text ? ': ' + esc(b.text) : ''}"></button>`;
  }

  // ---------- the bubble panel ----------
  function panelHTML() {
    const w = pick >= 0 ? words[pick] : null;
    const sample = page && page.sample;
    return `
      <div class="mg-panel-head">
        <span class="section-label grow">BUBBLE</span>
        <button class="btn ghost small-btn" data-act="close-bubble" aria-label="Close">✕</button>
      </div>
      ${status ? `<p class="small ${busy ? 'dim' : ''}" role="status">${esc(status)}</p>` : ''}
      ${sample ? `<p class="mg-line" lang="ja" data-noruby>${rubyHTML(bubble.text, esc)}</p>` : `
        <label class="tiny dim" for="mg-text">Text in the bubble (fix anything the reader got wrong)</label>
        <textarea id="mg-text" class="mg-text" lang="ja" rows="2" spellcheck="false" placeholder="Paste or type the bubble's text">${esc(bubble.text || '')}</textarea>
        <div class="mg-tools">
          <button class="btn small-btn primary" data-act="lookup" ${busy ? 'disabled' : ''}>Look up</button>
          <button class="btn small-btn" data-act="paste" ${busy ? 'disabled' : ''}>📋 Paste</button>
          <button class="btn small-btn" data-act="reread" ${busy ? 'disabled' : ''}>↻ Read again${horizontal ? ' (across)' : ''}</button>
          <button class="btn ghost small-btn" data-act="dir" aria-pressed="${horizontal}">${horizontal ? 'Text runs across' : 'Text runs down'}</button>
        </div>`}
      ${words.length ? `<div class="mg-words-row" lang="ja" data-noruby role="list" aria-label="Words">${words.map(chipHTML).join('')}</div>
        <p class="tiny dim">Tap a word for its meaning.</p>` : ''}
      ${w && w.match ? wordCard(w) : ''}
      ${words.some((x) => x.match) ? breakdownHTML() : ''}
      ${sample && bubble.en ? `<details class="fold" data-fold="english"><summary class="small strong">Show the English</summary><p class="small">${esc(bubble.en)}</p></details>` : ''}
      ${!sample && words.length && 'Translator' in self ? `<div class="stack-xs">
          <button class="btn small-btn" data-act="translate">Translate on this device</button>
          ${translation ? `<p class="small">${esc(translation)}</p><p class="tiny dim">A machine translation by your browser, made on this device. It can be wrong.</p>` : ''}
        </div>` : ''}
      ${!sample && bubble.text ? `<button class="btn ghost small-btn" data-act="del-bubble">${armed === 'bubble' ? 'Remove this box for good?' : 'Remove box'}</button>` : ''}
      <p class="tiny dim">Meanings from JMdict (EDRDG, CC BY-SA 4.0).</p>`;
  }

  function chipHTML(w, i) {
    if (!w.match) return `<span class="mg-chip plain" role="listitem">${esc(w.text)}</span>`;
    const r = w.match.results[0];
    const cfg = readingConfig();
    const reading = readingFor(w.text, r);
    let rt = '';
    if (cfg.kanji === 'romaji') rt = romaji(reading || w.text, { particles: !r.reasons.length && !!LOOKUP_GRAMMAR[w.text] });
    else if (cfg.kanji === 'kana' && reading) rt = reading;
    return `<button class="mg-chip${i === pick ? ' on' : ''}" role="listitem" data-act="word" data-i="${i}">${rt ? `<ruby>${esc(w.text)}<rt>${esc(rt)}</rt></ruby>` : esc(w.text)}</button>`;
  }

  function wordCard(w) {
    const results = w.match.results;
    const r = results[Math.min(alt, results.length - 1)];
    const d = describeResult(w.text, r);
    const reading = readingFor(w.text, r);
    const planted = d.card ? !!store.s.items[d.card.id] : !!store.s.items['my:' + d.jp];
    const conj = r.reasons.length ? `<p class="small"><span class="strong" lang="ja" data-noruby>${esc(w.text)}</span> is <span class="strong" lang="ja" data-noruby>${esc(r.base)}</span>: ${esc(dict.reasonText(r.reasons))}.</p>` : '';
    return `<div class="mg-card stack-xs" aria-live="polite">
      <div class="lk-head"><span class="grow"><span class="lk-word" lang="ja" data-noruby>${esc(d.jp)}</span>
        ${d.reading !== d.jp ? `<span class="lk-reading" lang="ja" data-noruby>${esc(d.reading)}</span>` : ''}
        <span class="lk-romaji mono dim">${esc(romaji(d.reading, { particles: false }))}</span></span>
        <button class="btn ghost small-btn" data-act="hear" aria-label="Hear it">🔊</button></div>
      ${reading && reading !== d.reading ? `<p class="tiny dim">In the bubble: <span lang="ja" data-noruby>${esc(w.text)}</span> (${esc(reading)})</p>` : ''}
      ${conj}
      ${d.grammar ? `<p class="small">${esc(d.grammar[1])}</p>` : ''}
      <ol class="mg-senses small">${d.senses.map((s) => `<li>${esc(s.join('; '))}</li>`).join('')}</ol>
      ${results.length > 1 ? `<div class="mg-alts"><span class="tiny dim">Other words it could be:</span>
        ${results.map((x, k) => (k === alt ? '' : `<button class="btn ghost small-btn" data-act="alt" data-k="${k}" lang="ja" data-noruby>${esc(x.entry.kanji[0] || x.entry.kana[0])}</button>`)).join('')}</div>` : ''}
      <div class="lk-actions">
        ${planted ? '<span class="tag">🌱 In your Garden</span>'
          : d.card ? `<button class="btn primary small-btn" data-act="keep">＋ Plant in Garden</button><span class="tiny dim">A voiced card from the ${esc(levelOf(d.card))} deck.</span>`
          : `<button class="btn primary small-btn" data-act="keep">＋ Add to My words</button>`}
      </div>
    </div>`;
  }

  function breakdownHTML() {
    return `<details class="fold" data-fold="breakdown"><summary class="small strong">Breakdown</summary>
      <ul class="mg-breakdown small">${words.filter((w) => w.match).map((w) => {
        const r = w.match.results[0];
        const g = LOOKUP_GRAMMAR[r.base] && !r.reasons.length ? LOOKUP_GRAMMAR[r.base][1] : null;
        return `<li><span class="strong" lang="ja" data-noruby>${esc(w.text)}</span>${r.base !== w.text ? ` <span class="dim" lang="ja" data-noruby>(${esc(r.base)})</span>` : ''}: ${esc(g || r.entry.senses[0].slice(0, 2).join('; '))}${r.reasons.length ? ` <span class="dim">· ${esc(dict.reasonText(r.reasons))}</span>` : ''}</li>`;
      }).join('')}</ul>
      <p class="tiny dim">Word by word, so the order is Japanese order. Put the meanings together, and the last word (usually a verb) is the core.</p></details>`;
  }

  function closeBubble() { bubble = null; words = []; pick = -1; alt = 0; status = ''; translation = null; }

  async function openBubble(b) {
    bubble = b;
    pick = -1; alt = 0; translation = null; armed = null;
    words = [];
    status = '';
    render();
    focusPanel();
    if (b.text) await lookUp(page && page.sample ? plainText(b.text) : b.text);
  }

  function focusPanel() {
    const p = el.querySelector('.mg-panel');
    if (!p) return;
    p.querySelector('textarea, .mg-chip, button')?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 959px)').matches) p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Splits the bubble text into words, fetching the dictionary first if it isn't loaded. */
  async function lookUp(text) {
    if (!dict.dictReady()) {
      busy = true;
      status = 'Getting the dictionary ready. The first time, this downloads about 5 MB.';
      render();
      try { await dict.loadDict(); } catch (e) {
        busy = false; status = "The dictionary couldn't load. Check your connection and try again."; if (alive) render(); return;
      }
      busy = false; status = '';
      if (!alive) return;
    }
    words = dict.segment(text || '');
    pick = words.findIndex((w) => w.match && !LOOKUP_GRAMMAR[w.text]);
    alt = 0;
    render();
  }

  /** Reads the text of a stored page's bubble from the picture. */
  async function readText(b) {
    const img = el.querySelector('.mg-img');
    if (!img || !page) return;
    busy = true;
    status = ocr.ocrStarted() ? 'Reading the bubble…' : 'Getting the text reader ready (the first time, it downloads about 6 MB), then reading the bubble…';
    render();
    try {
      if (!img.complete) await img.decode();
      const rect = { x: b.x * img.naturalWidth, y: b.y * img.naturalHeight, w: b.w * img.naturalWidth, h: b.h * img.naturalHeight };
      const { text } = await ocr.readBubble(img, rect, horizontal ? { vertical: false } : {});
      if (!alive) return;
      b.text = text;
      b.at = Date.now();
      await savePage();
      busy = false;
      status = text ? 'Check the text against the page, fix anything that looks off, then tap Look up.' : "The reader couldn't find text there. Try a tighter box, or paste or type the text.";
      if (bubble === b) await lookUp(text); else render();
    } catch (e) {
      busy = false;
      status = "The text reader couldn't start. You can still paste or type the text.";
      if (alive) render();
    }
  }

  async function savePage() {
    if (page && !page.sample) { try { await pages.savePage(page); } catch (e) { toast('Could not save the page on this device.'); } }
  }

  function keep() {
    const w = words[pick];
    if (!w || !w.match) return;
    const r = w.match.results[Math.min(alt, w.match.results.length - 1)];
    const d = describeResult(w.text, r);
    if (d.card) {
      store.plant(d.card.id);
      toast(`🌱 Planted ${d.card.jp}: it joins your Garden's new words.`);
    } else {
      const id = store.addMyWord({ jp: d.jp, reading: d.reading, en: d.en });
      toast(id ? `🌱 Added ${d.jp} to My words. It joins your Garden's new words.` : 'My words is full.');
    }
    render();
  }

  // ---------- adding pages ----------
  async function addFiles(files) {
    if (!book || book.sample || !files || !files.length) return;
    const before = book.pages.length;
    toast('Adding pages…');
    const n = await pages.addPages(book, files);
    if (!alive) return;
    pages.keepPages();
    if (!n) { toast('Those files are not pictures.'); return; }
    toast(`Added ${n} page${n === 1 ? '' : 's'}.`);
    await goPage(before);
  }

  // ---------- boxing a bubble ----------
  const stageOf = (t) => t && t.closest && t.closest('.mg-stage');
  function onDown(ev) {
    const stage = stageOf(ev.target);
    if (!stage || !boxMode || page?.sample || busy || ev.button > 0) return;
    const r = stage.getBoundingClientRect();
    drag = { stage, r, x0: ev.clientX - r.left, y0: ev.clientY - r.top, x1: ev.clientX - r.left, y1: ev.clientY - r.top, id: ev.pointerId, moved: false };
  }
  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    drag.x1 = Math.max(0, Math.min(drag.r.width, ev.clientX - drag.r.left));
    drag.y1 = Math.max(0, Math.min(drag.r.height, ev.clientY - drag.r.top));
    if (!drag.moved && (Math.abs(drag.x1 - drag.x0) > MIN_BOX / 2 || Math.abs(drag.y1 - drag.y0) > MIN_BOX / 2)) {
      drag.moved = true;
      // Only a real drag holds on to the pointer: a tap must still reach the box it landed on.
      drag.stage.setPointerCapture?.(ev.pointerId);
    }
    const box = drag.stage.querySelector('.mg-drag');
    if (box && drag.moved) {
      box.hidden = false;
      Object.assign(box.style, { left: Math.min(drag.x0, drag.x1) + 'px', top: Math.min(drag.y0, drag.y1) + 'px', width: Math.abs(drag.x1 - drag.x0) + 'px', height: Math.abs(drag.y1 - drag.y0) + 'px' });
    }
    ev.preventDefault();
  }
  function onUp(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    if (!d.moved || w < MIN_BOX || h < MIN_BOX) { const box = d.stage.querySelector('.mg-drag'); if (box) box.hidden = true; return; }
    const b = {
      id: pages.newId('u'), x: Math.min(d.x0, d.x1) / d.r.width, y: Math.min(d.y0, d.y1) / d.r.height, w: w / d.r.width, h: h / d.r.height, text: '', at: Date.now(),
    };
    page.bubbles.push(b);
    // A box drawn as a drag swallows the click that follows it.
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
    bubble = b; words = []; pick = -1; alt = 0; translation = null; armed = null;
    readText(b).then(() => focusPanel());
  }
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', () => { drag = null; });

  // ---------- paste and drop ----------
  const onPaste = (ev) => {
    if (view !== 'reader' || !book || book.sample) return;
    const files = [...(ev.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (!files.length) return;   // text goes where it's pasted, as usual
    ev.preventDefault();
    addFiles(files);
  };
  const onDragOver = (ev) => { if (view === 'reader' && book && !book.sample && ev.dataTransfer?.types?.includes('Files')) ev.preventDefault(); };
  const onDrop = (ev) => {
    if (view !== 'reader' || !book || book.sample || !ev.dataTransfer?.files?.length) return;
    ev.preventDefault();
    addFiles(ev.dataTransfer.files);
  };
  const onKey = (ev) => {
    if (view !== 'reader' || /input|textarea/i.test(ev.target.tagName || '')) return;
    if (ev.key === 'ArrowLeft' && pageIx + 1 < book.pages.length) { ev.preventDefault(); goPage(pageIx + 1); }
    if (ev.key === 'ArrowRight' && pageIx > 0) { ev.preventDefault(); goPage(pageIx - 1); }
    if (ev.key === 'Escape' && bubble) { closeBubble(); render(); }
  };
  window.addEventListener('paste', onPaste);
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('drop', onDrop);
  document.addEventListener('keydown', onKey);
  const onChange = (ev) => { if (ev.target.matches('[data-file=add]')) { addFiles(ev.target.files); ev.target.value = ''; } };
  el.addEventListener('change', onChange);
  const onSubmit = async (ev) => {
    if (!ev.target.matches('[data-form=new]')) return;
    ev.preventDefault();
    const title = ev.target.elements.title.value;
    creating = false;
    const b = await pages.addBook(title);
    openBook(b.id);
  };
  el.addEventListener('submit', onSubmit);

  function render() {
    if (!alive) return;
    // Folds the learner opened (My words, Breakdown…) stay open when the screen redraws.
    const open = new Set([...el.querySelectorAll('details[data-fold][open]')].map((d) => d.dataset.fold));
    if (view === 'shelf') renderShelf(); else renderReader();
    for (const d of el.querySelectorAll('details[data-fold]')) if (open.has(d.dataset.fold)) d.open = true;
  }

  const off = delegate(el, {
    new: () => { creating = true; render(); },
    'cancel-new': () => { creating = false; render(); },
    book: (b) => openBook(b.dataset.id),
    practice: (b) => openPractice(b.dataset.level),
    shelf: () => { speaker.stop(); showShelf(); window.scrollTo(0, 0); },
    next: () => goPage(pageIx + 1),
    prev: () => goPage(pageIx - 1),
    boxmode: () => { boxMode = !boxMode; render(); },
    zoom: () => { zoom = !zoom; render(); },
    bubble: (b) => {
      const id = b.dataset.id;
      const list = page.sample ? page.sample.bubbles.map((x, i) => ({ ...x, id: 's' + i })) : page.bubbles;
      const found = list.find((x) => x.id === id);
      if (found) openBubble(found);
    },
    'close-bubble': () => { closeBubble(); render(); },
    word: (b) => { pick = +b.dataset.i; alt = 0; render(); el.querySelector('.mg-card')?.scrollIntoView({ block: 'nearest' }); speakPick(); },
    alt: (b) => { alt = +b.dataset.k; render(); },
    hear: () => speakPick(true),
    keep,
    lookup: async () => {
      const t = el.querySelector('#mg-text');
      if (!t || !bubble) return;
      bubble.text = t.value.replace(/\s+/g, '').trim();
      bubble.at = Date.now();
      status = '';
      translation = null;
      await savePage();
      lookUp(bubble.text);
    },
    paste: async () => {
      const t = el.querySelector('#mg-text');
      try {
        const text = await navigator.clipboard.readText();
        if (t && text) { t.value = text.replace(/\s+/g, ''); el.querySelector('[data-act=lookup]')?.click(); }
      } catch (e) {
        status = 'Tap in the text box and paste there (press and hold, then Paste; or Ctrl + V).';
        render();
        el.querySelector('#mg-text')?.focus();
      }
    },
    reread: () => { if (bubble) readText(bubble); },
    dir: () => { horizontal = !horizontal; render(); },
    translate: async () => {
      if (!bubble || !('Translator' in self)) return;
      translation = 'Translating…';
      render();
      try {
        const t = await self.Translator.create({ sourceLanguage: 'ja', targetLanguage: 'en' });
        translation = await t.translate(bubble.text);
      } catch (e) { translation = "Your browser couldn't translate this here."; }
      if (alive) render();
    },
    'del-bubble': async () => {
      if (armed !== 'bubble') { armed = 'bubble'; render(); return; }
      page.bubbles = page.bubbles.filter((x) => x !== bubble);
      closeBubble(); armed = null;
      await savePage();
      render();
    },
    'del-page': async () => {
      if (armed !== 'page') { armed = 'page'; render(); return; }
      armed = null;
      await pages.deletePage(book, book.pages[pageIx]);
      goPage(Math.max(0, Math.min(pageIx, book.pages.length - 1)));
    },
    'del-book': async () => {
      if (armed !== 'book') { armed = 'book'; render(); return; }
      armed = null;
      await pages.deleteBook(book.id);
      book = null;
      showShelf();
    },
    'del-word': (b) => {
      if (armed !== b.dataset.id) { armed = b.dataset.id; render(); return; }
      armed = null;
      store.deleteMyWord(b.dataset.id);
      render();
    },
  });

  function speakPick(force = false) {
    const w = words[pick];
    if (!w || !w.match) return;
    const r = w.match.results[Math.min(alt, w.match.results.length - 1)];
    const reading = readingFor(w.text, r) || (KANJI.test(w.text) ? r.entry.kana[0] : w.text);
    if (force || !store.settings.quiet) speaker.speak(reading, { mps: 3 });
  }

  showShelf();
  return () => {
    alive = false;
    off();
    revoke();
    window.removeEventListener('paste', onPaste);
    document.removeEventListener('keydown', onKey);
    speaker.stop();
    ocr.stopOcr();
  };
}

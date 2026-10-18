// Reading help: puts romaji or furigana over Japanese text anywhere in the app, so a beginner can read every game.
// "Auto" follows Reading Dojo progress: romaji until you know hiragana (and katakana), then furigana only over kanji.
// Elements with [data-noruby] (quiz prompts, charts) are left alone.
import { store } from './store.js';
import { SEGMENTS, RUNS } from './readings.js';
import { WORD_BREAKS } from './words.js';
import { romaji, toHiragana, KANJI_RE, HIRA_RE, KATA_RE } from './romaji.js';

const SEG_RE = /[ぁ-ゖァ-ヺー一-鿿々]+/g;
const RUN_RE = /[一-鿿々]+|[^一-鿿々]+/g;
const SKIP = 'script, style, textarea, input, select, option, svg, canvas, title, ruby, rt, .jr, [data-noruby], [contenteditable]';

/** What to annotate right now: { hira, kata: bool (romaji over that script), kanji: 'romaji'|'kana'|'off' }. */
export function readingConfig() {
  const mode = store.settings.readingHelp || 'auto';
  if (mode === 'off') return { hira: false, kata: false, kanji: 'off', mode };
  if (mode === 'romaji') return { hira: true, kata: true, kanji: 'romaji', mode };
  if (mode === 'kana') return { hira: false, kata: false, kanji: 'kana', mode };
  const hiraDone = store.trackDone('hiragana');
  const kataDone = store.trackDone('katakana');
  return { hira: !hiraDone, kata: !kataDone, kanji: hiraDone ? 'kana' : 'romaji', mode };
}

/** Split a Japanese segment into [text, reading|null] parts; kanji parts get a hiragana reading when known. */
export function segmentParts(seg) {
  if (SEGMENTS[seg]) return SEGMENTS[seg];
  const parts = [];
  for (const m of seg.matchAll(RUN_RE)) {
    const t = m[0];
    parts.push([t, KANJI_RE.test(t) ? (RUNS[t] || longestRuns(t)) : null]);
  }
  return parts;
}

/** Reading for an unknown kanji run by stitching together the longest known runs inside it. */
function longestRuns(run) {
  let out = '';
  let i = 0;
  while (i < run.length) {
    let found = false;
    for (let j = run.length; j > i; j--) {
      const r = RUNS[run.slice(i, j)];
      if (r) { out += r; i = j; found = true; break; }
    }
    if (!found) return null;
  }
  return out;
}

/** Hiragana reading of a whole segment, or null if a kanji in it has no known reading. */
export function readingOf(seg) {
  let out = '';
  for (const [t, r] of segmentParts(seg)) {
    if (KANJI_RE.test(t)) { if (!r) return null; out += r; } else out += toHiragana(t);
  }
  return out;
}

/** Romaji for a kana string, if the current reading help wants it (used by canvas/SVG drawings). */
export function romajiIfWanted(kana) {
  const c = readingConfig();
  const wanted = (HIRA_RE.test(kana) && c.hira) || (KATA_RE.test(kana) && c.kata);
  return wanted ? romaji(kana, { particles: false }) : '';
}

const escHTML = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Characters a chunk may not start with (they belong to the kana before them).
const NO_START = new Set([...'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮー']);
const CHUNK = 6;
const PARTICLE_READ = { 'は': 'wa', 'へ': 'e', 'を': 'o' };

/**
 * Ruby can't wrap, so a long kana word with romaji over it (ありがとうございました → arigatougozaimashita) can be
 * wider than a phone screen. Long kana-only segments get their romaji in chunks of about 6 kana, which can wrap.
 */
function chunkedRomaji(seg) {
  const chars = [...seg];
  const parts = [];
  let cur = '';
  chars.forEach((ch, i) => {
    cur += ch;
    const next = chars[i + 1];
    if ([...cur].length >= CHUNK && next && !NO_START.has(next) && ch !== 'っ' && ch !== 'ッ') { parts.push(cur); cur = ''; }
  });
  if (cur) parts.push(cur);
  // Only the last chunk can end in a particle (は read as "wa").
  return parts.map((t, i) => `<ruby>${escHTML(t)}<rt>${escHTML(romaji(t, { particles: i === parts.length - 1 }))}</rt></ruby>`).join('');
}

/** A segment split into words (よろしくおねがいします → よろしく, おねがいします), from js/words.js. */
export function wordsOf(seg) {
  return wordPieces(seg).map((w) => w.join(''));
}

/** Each word as its romaji pieces: れんです → [['れん', 'です']] (one word on screen, "ren desu" in romaji). */
function wordPieces(seg) {
  const cuts = WORD_BREAKS[seg] || [];
  const out = [[]];
  let at = 0;
  for (const c of [...cuts, seg.length]) {
    const end = Math.abs(c);
    out[out.length - 1].push(seg.slice(at, end));
    if (c > 0 && end < seg.length) out.push([]);
    at = end;
  }
  return out;
}

/**
 * Ruby with romaji for one word (given as its romaji pieces), or null when a kanji in it has no known reading.
 * A word of several pieces (がくせい|です|か) gets one ruby per piece inside an unbreakable span, rather than one
 * ruby with spaces in its romaji: Safari spreads spaced ruby text across the word and can break it mid-line
 * ("gaku seidesu ka").
 */
function romajiWord(pieces) {
  const w = pieces.join('');
  if (PARTICLE_READ[w]) return `<ruby>${escHTML(w)}<rt>${PARTICLE_READ[w]}</rt></ruby>`;
  if (!KANJI_RE.test(w) && [...w].length > CHUNK + 2) return chunkedRomaji(w);
  const rs = pieces.map((p) => (PARTICLE_READ[p] && pieces.length > 1 ? PARTICLE_READ[p] : readingOf(p) && romaji(readingOf(p))));
  if (rs.every(Boolean)) {
    const rubies = pieces.map((p, i) => `<ruby>${escHTML(p)}<rt>${escHTML(rs[i])}</rt></ruby>`).join('');
    return pieces.length > 1 ? `<span class="jw">${rubies}</span>` : rubies;
  }
  // A kanji split across pieces has no reading of its own: romaji for the whole word, unspaced.
  const reading = readingOf(w);
  return reading ? `<ruby>${escHTML(w)}<rt>${escHTML(romaji(reading))}</rt></ruby>` : null;
}

function annotateSegment(seg, cfg) {
  const hasKanji = KANJI_RE.test(seg);
  const wantRomaji = (HIRA_RE.test(seg) && cfg.hira) || (KATA_RE.test(seg) && cfg.kata) || (hasKanji && cfg.kanji === 'romaji');
  // Romaji is spaced word by word, the way textbooks write it (yoroshiku onegaishimasu), and a long line wraps
  // between words instead of in the middle of one.
  if (wantRomaji) {
    const words = wordPieces(seg);
    if (words.length > 1 || words[0].length > 1) {
      const parts = words.map(romajiWord);
      if (parts.every(Boolean)) return parts.join('<span class="wsp"></span>');
    }
  }
  if (wantRomaji && !hasKanji && [...seg].length > CHUNK + 2) return chunkedRomaji(seg);
  // A particle on its own (a word tile) is read as a particle: は "wa", へ "e".
  if (wantRomaji && PARTICLE_READ[seg]) return `<ruby>${escHTML(seg)}<rt>${PARTICLE_READ[seg]}</rt></ruby>`;
  if (wantRomaji) {
    const reading = readingOf(seg);
    const r = reading ? romaji(reading) : null;
    if (r) return `<ruby>${escHTML(seg)}<rt>${escHTML(r)}</rt></ruby>`;
  }
  if (hasKanji && cfg.kanji !== 'off') {
    return segmentParts(seg).map(([t, r]) => (r && KANJI_RE.test(t) ? `<ruby>${escHTML(t)}<rt>${escHTML(r)}</rt></ruby>` : escHTML(t))).join('');
  }
  return escHTML(seg);
}

function annotateText(node, cfg) {
  const text = node.nodeValue;
  if (!text || !(KANJI_RE.test(text) || HIRA_RE.test(text) || KATA_RE.test(text))) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  let html = '';
  let last = 0;
  let changed = false;
  for (const m of text.matchAll(SEG_RE)) {
    html += escHTML(text.slice(last, m.index));
    const a = annotateSegment(m[0], cfg);
    if (a !== escHTML(m[0])) changed = true;
    html += a;
    last = m.index + m[0].length;
  }
  if (!changed) return;
  html += escHTML(text.slice(last));
  const span = document.createElement('span');
  span.className = 'jr';
  span.innerHTML = html;
  node.replaceWith(span);
}

function annotateTree(root, cfg) {
  if (root.nodeType === Node.TEXT_NODE) return annotateText(root, cfg);
  if (root.nodeType !== Node.ELEMENT_NODE || root.closest(SKIP)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) annotateText(n, cfg);
}

let observer = null;

/** Start annotating everything under `roots` as it renders. */
export function initReadingHelp(roots) {
  const run = (nodes) => {
    const cfg = readingConfig();
    if (!cfg.hira && !cfg.kata && cfg.kanji === 'off') return;
    for (const n of nodes) if (n.isConnected) annotateTree(n, cfg);
  };
  observer = new MutationObserver((muts) => {
    const nodes = [];
    for (const m of muts) {
      if (m.type === 'characterData') nodes.push(m.target);
      else m.addedNodes.forEach((n) => nodes.push(n));
    }
    run(nodes);
  });
  for (const r of roots) {
    observer.observe(r, { childList: true, subtree: true, characterData: true });
    run([r]);
  }
}

/** Remove every annotation under root (before re-rendering with a different setting). */
export function clearReadingHelp(root) {
  root.querySelectorAll('.jr').forEach((s) => {
    const clone = s.cloneNode(true);
    clone.querySelectorAll('rt').forEach((rt) => rt.remove());
    s.replaceWith(document.createTextNode(clone.textContent));
  });
}

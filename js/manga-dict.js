// Manga Reader dictionary: finds the words in any Japanese text, offline. The word list (manga/dict.txt, from JMdict,
// EDRDG, CC BY-SA 4.0, written by tools/build_manga_dict.py) is fetched the first time the reader needs it, and the
// service worker keeps it. Each point of a text is matched to the longest dictionary word starting there, after
// undoing conjugations (食べなかった → 食べる, "negative, past"), the way pop-up dictionaries do it.
//
// Use: `await loadDict()`, then `segment(text)` for the words of a bubble, or `lookupAt(text, i)` for one word.

export const DICT_URL = './manga/dict.txt';
/** Longest text tried as one word, in characters. */
const MAX_WORD = 14;

// Word classes, as bits. A conjugated form is undone step by step; each step says what kind of word it needs and what
// kind it gives, so 食べなかった → 食べない (an い-adjective-like form) → 食べる (an ichidan verb).
const V1 = 1, V5 = 2, VK = 4, VS = 8, ADJ = 16, MASU = 32, TE = 64, VSN = 128;
const ANY = 0xffff;
/** JMdict class (tools/build_manga_dict.py) -> the bits a dictionary form of that class answers to. */
const CLASS_BITS = {
  v1: V1, vz: V1, 'v5u': V5, 'v5k': V5, 'v5k-s': V5, 'v5g': V5, 'v5s': V5, 'v5t': V5, 'v5n': V5, 'v5b': V5, 'v5m': V5,
  'v5r': V5, 'v5r-i': V5, 'v5aru': V5, vk: VK, 'vs-i': VS, 'vs-s': VS, vs: VSN, 'adj-i': ADJ, 'adj-ix': ADJ,
};

/** What each step of a conjugation means, for the word card. */
export const REASONS = {
  neg: 'negative (not)', past: 'past', polite: 'polite (ます)', te: 'て-form (and / please)', want: 'want to (たい)',
  pot: 'can (potential)', pass: 'passive or polite (〜られる)', caus: 'make or let (causative)', vol: "let's (volitional)",
  cond: 'if (conditional)', imp: 'command', prog: 'is doing (〜ている)', shimau: 'did completely / ended up (〜てしまう)',
  stem: 'stem (joins to other words)', adv: 'adverb form (〜く)', tara: 'if / when (〜たら)', tari: 'things like (〜たり)',
  zu: 'without doing (〜ず)', nakya: 'must (〜なきゃ)', nagara: 'while (〜ながら)', nasai: 'do it (〜なさい)',
  sou: 'looks like (〜そう)', sugi: 'too much (〜すぎる)', sa: 'noun form (〜さ)', casual: 'rough casual speech (〜ねえ)',
  suru: 'with する (do)', oku: 'do ahead (〜ておく)', iku: 'go on doing (〜ていく)', kuru: 'come to (〜てくる)',
  miru: 'try doing (〜てみる)', kureru: 'do for me (〜てくれる)', morau: 'get someone to (〜てもらう)', ageru: 'do for someone (〜てあげる)',
  kudasai: 'please (〜てください)', aru: 'has been done (〜てある)', nu: 'not (old style 〜ぬ)', n: 'not (casual 〜ん)', masu: 'polite (ます)',
};

// [from, to, needs, gives, reason]: replace the ending `from` by `to` when the text is (or may be) a `needs` word.
const RULES = [];
const rule = (from, to, needs, gives, reason) => RULES.push([from, to, needs, gives, reason]);

// Godan verbs: each dictionary ending and its rows.
const GODAN = [
  // u, a, i, e, o, te, ta
  ['う', 'わ', 'い', 'え', 'お', 'って', 'った'],
  ['く', 'か', 'き', 'け', 'こ', 'いて', 'いた'],
  ['ぐ', 'が', 'ぎ', 'げ', 'ご', 'いで', 'いだ'],
  ['す', 'さ', 'し', 'せ', 'そ', 'して', 'した'],
  ['つ', 'た', 'ち', 'て', 'と', 'って', 'った'],
  ['ぬ', 'な', 'に', 'ね', 'の', 'んで', 'んだ'],
  ['ぶ', 'ば', 'び', 'べ', 'ぼ', 'んで', 'んだ'],
  ['む', 'ま', 'み', 'め', 'も', 'んで', 'んだ'],
  ['る', 'ら', 'り', 'れ', 'ろ', 'って', 'った'],
];
for (const [u, a, i, e, o, te, ta] of GODAN) {
  rule(a + 'ない', u, ADJ, V5, 'neg');
  rule(a + 'ず', u, ANY, V5, 'zu');
  rule(a + 'ずに', u, ANY, V5, 'zu');
  rule(a + 'ぬ', u, ANY, V5, 'nu');
  rule(a + 'ん', u, ANY, V5, 'n');
  rule(a + 'ねえ', u, ANY, V5, 'casual');
  rule(a + 'ねぇ', u, ANY, V5, 'casual');
  rule(a + 'ねー', u, ANY, V5, 'casual');
  rule(a + 'なきゃ', u, ANY, V5, 'nakya');
  rule(a + 'なければ', u, ANY, V5, 'nakya');
  rule(a + 'れる', u, V1, V5, 'pass');
  rule(a + 'せる', u, V1, V5, 'caus');
  rule(a + 'す', u, V5, V5, 'caus');
  rule(i + 'ます', u, MASU, V5, 'polite');
  rule(i + 'たい', u, ADJ, V5, 'want');
  rule(i + 'ながら', u, ANY, V5, 'nagara');
  rule(i + 'なさい', u, ANY, V5, 'nasai');
  rule(i + 'そう', u, ANY, V5, 'sou');
  rule(i + 'すぎる', u, V1, V5, 'sugi');
  rule(i, u, ANY, V5, 'stem');
  rule(e + 'る', u, V1, V5, 'pot');
  rule(e + 'ば', u, ANY, V5, 'cond');
  rule(e, u, ANY, V5, 'imp');
  rule(o + 'う', u, ANY, V5, 'vol');
  rule(o + 'ー', u, ANY, V5, 'vol');
  rule(te, u, TE, V5, 'te');
  rule(ta, u, ANY, V5, 'past');
  rule(ta + 'ら', u, ANY, V5, 'tara');
  rule(ta + 'り', u, ANY, V5, 'tari');
}
// 行く: 行って, 行った.
rule('って', 'く', TE, V5, 'te');
rule('った', 'く', ANY, V5, 'past');
rule('ったら', 'く', ANY, V5, 'tara');

// Ichidan verbs (食べる, 見る).
for (const [from, needs, reason] of [
  ['ない', ADJ, 'neg'], ['ず', ANY, 'zu'], ['ずに', ANY, 'zu'], ['ぬ', ANY, 'nu'], ['ん', ANY, 'n'], ['ねえ', ANY, 'casual'],
  ['ねぇ', ANY, 'casual'], ['ねー', ANY, 'casual'], ['なきゃ', ANY, 'nakya'], ['なければ', ANY, 'nakya'],
  ['ます', MASU, 'polite'], ['た', ANY, 'past'], ['たら', ANY, 'tara'], ['たり', ANY, 'tari'], ['て', TE, 'te'],
  ['たい', ADJ, 'want'], ['られる', V1, 'pass'], ['れる', V1, 'pot'], ['させる', V1, 'caus'], ['さす', V5, 'caus'],
  ['よう', ANY, 'vol'], ['よー', ANY, 'vol'], ['れば', ANY, 'cond'], ['ろ', ANY, 'imp'], ['よ', ANY, 'imp'],
  ['ながら', ANY, 'nagara'], ['なさい', ANY, 'nasai'], ['そう', ANY, 'sou'], ['すぎる', V1, 'sugi'], ['', ANY, 'stem'],
]) rule(from, 'る', needs, V1, reason);

// 来る (くる), in kanji and kana.
for (const k of ['来', 'こ']) {
  const ki = k === '来' ? '来' : 'き', ku = k === '来' ? '来' : 'く';
  rule(k + 'ない', ku + 'る', ADJ, VK, 'neg');
  rule(k + 'ず', ku + 'る', ANY, VK, 'zu');
  rule(k + 'ねえ', ku + 'る', ANY, VK, 'casual');
  rule(k + 'よう', ku + 'る', ANY, VK, 'vol');
  rule(k + 'られる', ku + 'る', V1, VK, 'pot');
  rule(k + 'れる', ku + 'る', V1, VK, 'pot');
  rule(k + 'させる', ku + 'る', V1, VK, 'caus');
  rule(k + 'い', ku + 'る', ANY, VK, 'imp');
  rule(ki + 'ます', ku + 'る', MASU, VK, 'polite');
  rule(ki + 'た', ku + 'る', ANY, VK, 'past');
  rule(ki + 'たら', ku + 'る', ANY, VK, 'tara');
  rule(ki + 'て', ku + 'る', TE, VK, 'te');
  rule(ki + 'たい', ku + 'る', ADJ, VK, 'want');
  rule(ki + 'そう', ku + 'る', ANY, VK, 'sou');
  rule(ku + 'れば', ku + 'る', ANY, VK, 'cond');
}

// する, and nouns that take it (勉強する).
for (const [from, needs, reason] of [
  ['しない', ADJ, 'neg'], ['せず', ANY, 'zu'], ['せん', ANY, 'n'], ['しねえ', ANY, 'casual'], ['しなきゃ', ANY, 'nakya'],
  ['しなければ', ANY, 'nakya'], ['します', MASU, 'polite'], ['した', ANY, 'past'], ['したら', ANY, 'tara'], ['したり', ANY, 'tari'],
  ['して', TE, 'te'], ['したい', ADJ, 'want'], ['される', V1, 'pass'], ['させる', V1, 'caus'], ['しよう', ANY, 'vol'],
  ['しよー', ANY, 'vol'], ['すれば', ANY, 'cond'], ['しろ', ANY, 'imp'], ['せよ', ANY, 'imp'], ['しながら', ANY, 'nagara'],
  ['しなさい', ANY, 'nasai'], ['しそう', ANY, 'sou'], ['しすぎる', V1, 'sugi'], ['し', ANY, 'stem'],
]) rule(from, 'する', needs, VS, reason);
rule('する', '', VS, VSN, 'suru');

// い-adjectives (and ない, たい, which conjugate like them).
for (const [from, needs, reason] of [
  ['かった', ANY, 'past'], ['かったら', ANY, 'tara'], ['くない', ADJ, 'neg'], ['くて', ANY, 'te'], ['く', ANY, 'adv'],
  ['ければ', ANY, 'cond'], ['けりゃ', ANY, 'cond'], ['さ', ANY, 'sa'], ['そう', ANY, 'sou'], ['すぎる', V1, 'sugi'], ['くなる', V5, 'adv'],
]) rule(from, 'い', needs, ADJ, reason);
rule('ねえ', 'ない', ANY, ADJ, 'casual');
rule('ねぇ', 'ない', ANY, ADJ, 'casual');
rule('ねー', 'ない', ANY, ADJ, 'casual');

// The ます form's own endings.
for (const [from, reason] of [['ました', 'past'], ['ません', 'neg'], ['ませんでした', 'neg'], ['ましょう', 'vol'], ['まして', 'te'], ['ませ', 'imp']]) {
  rule(from, 'ます', ANY, MASU, reason);
}

// て-form helpers: 食べている → 食べて (+ is doing), 食べちゃう → 食べて (+ ended up).
for (const t of ['て', 'で']) {
  rule(t + 'いる', t, V1, TE, 'prog');
  rule(t + 'る', t, V1, TE, 'prog');
  rule(t + 'しまう', t, V5, TE, 'shimau');
  rule(t + 'おく', t, V5, TE, 'oku');
  rule(t + 'いく', t, V5, TE, 'iku');
  rule(t + 'くる', t, VK, TE, 'kuru');
  rule(t + 'みる', t, V1, TE, 'miru');
  rule(t + 'くれる', t, V1, TE, 'kureru');
  rule(t + 'もらう', t, V5, TE, 'morau');
  rule(t + 'あげる', t, V1, TE, 'ageru');
  rule(t + 'ある', t, V5, TE, 'aru');
  rule(t + 'ください', t, ANY, TE, 'kudasai');
  rule(t + 'くれ', t, ANY, TE, 'kureru');
}
rule('ちゃう', 'て', V5, TE, 'shimau');
rule('じゃう', 'で', V5, TE, 'shimau');
rule('とく', 'て', V5, TE, 'oku');
rule('どく', 'で', V5, TE, 'oku');

// Longest endings first, so a rule never cuts a longer one short.
RULES.sort((a, b) => b[0].length - a[0].length);

/**
 * Every dictionary form `word` could be a conjugation of, with what kind of word each would be and the steps taken
 * (outermost last): [{ word, type, reasons }]. The word itself comes first, as any kind of word.
 */
export function deinflect(word) {
  const out = [{ word, type: ANY, reasons: [] }];
  const seen = new Map([[word, ANY]]);
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    if (cur.reasons.length >= 5) continue;
    for (const [from, to, needs, gives, reason] of RULES) {
      if (!(cur.type & needs) || !cur.word.endsWith(from)) continue;
      // Endings that take any word (past, if, command, a bare stem…) end a word, so they only come off the text
      // itself, never off a form an earlier step made: からね is never "command of からぬ".
      if (needs === ANY && cur.reasons.length) continue;
      const stem = cur.word.slice(0, cur.word.length - from.length);
      if (!stem && !to) continue;
      const w = stem + to;
      if (!w || w.length < 1) continue;
      const had = seen.get(w);
      if (had != null && (had & gives) === gives) continue;
      seen.set(w, (had || 0) | gives);
      out.push({ word: w, type: gives, reasons: [reason, ...cur.reasons] });
    }
  }
  return out;
}

const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

let lines = null;      // the dictionary's lines (parsed on demand)
let index = null;      // written form or reading -> line number(s)
let loading = null;

/** Builds the dictionary from the text of manga/dict.txt (exported for tests). */
export function useDict(text) {
  lines = text.split('\n');
  index = new Map();
  const add = (key, n) => {
    const had = index.get(key);
    if (had == null) index.set(key, n);
    else if (Array.isArray(had)) { if (had[had.length - 1] !== n) had.push(n); }
    else if (had !== n) index.set(key, [had, n]);
  };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!line || line[0] === '#') continue;
    const t1 = line.indexOf('\t'), t2 = line.indexOf('\t', t1 + 1);
    if (t1 < 0 || t2 < 0) continue;
    if (t1 > 0) for (const k of line.slice(0, t1).split(';')) add(k, n);
    for (const r of line.slice(t1 + 1, t2).split(';')) { add(r, n); const h = toHira(r); if (h !== r) add(h, n); }
  }
}

/** Fetches and builds the dictionary once. Resolves when lookups are ready. */
export function loadDict(fetchFn = fetch) {
  if (index) return Promise.resolve();
  if (!loading) {
    loading = fetchFn(DICT_URL)
      .then((res) => { if (!res.ok) throw new Error('dictionary ' + res.status); return res.text(); })
      .then(useDict)
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}
export const dictReady = () => !!index;

const parsed = new Map();
/** One dictionary entry: { kanji: [], kana: [], classes: [], common, senses: [[gloss]] }. */
export function entry(n) {
  let e = parsed.get(n);
  if (e) return e;
  const [k, r, c, p, g] = lines[n].split('\t');
  e = {
    n, kanji: k ? k.split(';') : [], kana: r.split(';'), classes: c ? c.split(',') : [], common: p === '1',
    senses: (g || '').split('|').map((s) => s.split('; ')),
  };
  parsed.set(n, e);
  return e;
}

const linesFor = (key) => { const v = index.get(key); return v == null ? [] : Array.isArray(v) ? v : [v]; };

/** Whether an entry can be the kind of word `type` asks for (any entry, if the word wasn't conjugated). */
function fits(e, type) {
  if (type === ANY) return true;
  return e.classes.some((c) => (CLASS_BITS[c] || 0) & type);
}

/** The dictionary's answers for exactly `s`, best first: [{ entry, base, reasons, exact }]. */
function resultsFor(s) {
  const results = [];
  const got = new Set();
  for (const cand of deinflect(s)) {
    for (const key of new Set([cand.word, toHira(cand.word)])) {
      for (const n of linesFor(key)) {
        if (got.has(n)) continue;
        const e = entry(n);
        if (!fits(e, cand.type)) continue;
        got.add(n);
        results.push({ entry: e, base: cand.word, reasons: cand.reasons, exact: key === cand.word });
      }
    }
  }
  // Unconjugated before conjugated, written as in the text before kana-folded, common words first, then the entry
  // whose main written form it is (行った: 行く before 遣る, which lists 行る as a rare spelling).
  const formRank = (r) => { const k = r.entry.kanji.indexOf(r.base); if (k >= 0) return k; const j = r.entry.kana.indexOf(r.base); return j >= 0 ? (r.entry.kanji.length ? 5 : 0) + j : 9; };
  results.sort((a, b) => a.reasons.length - b.reasons.length || (b.exact - a.exact) || (b.entry.common - a.entry.common)
    || formRank(a) - formRank(b) || a.entry.n - b.entry.n);
  return results.slice(0, 6);
}

const JP_START = /^[ぁ-ゖァ-ヺー一-鿿々〆ヵヶ]/;

/** Every word starting at position `i` of `text`, longest first: [{ text, len, results }]. */
function matchesAt(text, i) {
  const out = [];
  if (!index || !JP_START.test(text.slice(i, i + 1))) return out;
  for (let len = Math.min(MAX_WORD, text.length - i); len >= 1; len--) {
    const s = text.slice(i, i + len);
    if (!/^[ぁ-ゖァ-ヺー一-鿿々〆ヵヶ]+$/.test(s)) continue;
    const results = resultsFor(s);
    if (results.length) out.push({ text: s, len, results });
  }
  return out;
}

/**
 * The longest word at position `i` of `text`: { text (as written), len, results: [{ entry, base, reasons }] },
 * best first, or null if nothing there is in the dictionary.
 */
export function lookupAt(text, i) {
  return matchesAt(text, i)[0] || null;
}

/**
 * How unlikely a word is as a reading of the text. Every word costs 1, so longer words win (火影 over 火・影); rare
 * words, conjugation steps and bare stems cost a little more, so common words win (に・おれ over にお・れ).
 */
function cost(m) {
  const r = m.results[0];
  const rare = !r.entry.common;
  // A word plus a particle that is also listed as a phrase (今日は "hello") is more often the word and the particle.
  const last = m.text[m.text.length - 1];
  const wordAndParticle = m.len > 1 && !r.reasons.length && 'はがを'.includes(last)
    && linesFor(m.text.slice(0, -1)).some((n) => entry(n).common);
  return 1 + (rare ? 0.6 : 0) + (r.exact ? 0 : 0.3) + 0.2 * r.reasons.length + (r.reasons.includes('stem') ? 0.6 : 0)
    + (rare && m.len === 1 ? 1 : 0) + (rare && r.entry.kanji.length && /^[ぁ-ゖ]+$/.test(m.text) ? 0.6 : 0) + (wordAndParticle ? 1.2 : 0);
}

/**
 * A text split into words: [{ text, match }] where match is a lookupAt-style answer, or null for punctuation and
 * anything the dictionary doesn't know. The split is the cheapest way through the text (fewest, most common words),
 * so に・おれ・は・なる wins over にお・れ・はなる.
 */
export function segment(text) {
  const n = text.length;
  const best = new Array(n + 1).fill(Infinity);
  const step = new Array(n + 1).fill(null);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === Infinity) continue;
    for (const m of matchesAt(text, i)) {
      const c = best[i] + cost(m);
      if (c < best[i + m.len]) { best[i + m.len] = c; step[i + m.len] = { from: i, match: m }; }
    }
    // Not a word here: one character on its own.
    const c = best[i] + 3;
    if (c < best[i + 1]) { best[i + 1] = c; step[i + 1] = { from: i, match: null }; }
  }
  const parts = [];
  for (let j = n; j > 0; j = step[j].from) parts.push({ text: text.slice(step[j].from, j), match: step[j].match });
  parts.reverse();
  // Runs of characters that aren't words are joined into one piece.
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (!p.match && last && !last.match) last.text += p.text; else out.push(p);
  }
  return out;
}

/** "食べる + negative + past" style description of the steps from the dictionary form to the text. */
export const reasonText = (reasons) => reasons.map((r) => REASONS[r] || r).join(', then ');

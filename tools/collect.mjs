// Lists every line the app speaks (for voice clips) and every Japanese text with a known reading.
// Run: node tools/collect.mjs > /tmp/collect.json   (used by tools/build_assets.py)
import { PHRASES, CHAPTERS, CAST, STORY_WORDS, TRAINS, assembleTrain, KANJI, SHOP_STOCK, COUNTERS, CUSTOMERS, SHOP_GREETINGS, SHOP_THANKS, GARDEN_CATALOG,
  SHOP_GREETINGS_N4, SHOP_THANKS_N4, SHOP_GREETINGS_N3, SHOP_THANKS_N3, SHOP_KEIGO, N4_WORDS, N3_WORDS } from '../js/data.js';
import { LESSONS, KANJI_LESSONS, N4_KANJI_LESSONS, N3_KANJI_LESSONS, READ_WORDS } from '../js/dojo-data.js';
import { N5_WORDS } from '../js/data.js';
import { N5 } from '../js/n5.js';
import { N4 } from '../js/n4.js';
import { N3 } from '../js/n3.js';
import { N3_TASK, N3_POINT, N3_GIST, N3_UTTER, N3_QUICK } from '../js/exam-bank-n3-listen.js';
import { N4_TASK, N4_POINT, N4_UTTER, N4_QUICK } from '../js/exam-bank-n4-listen.js';
import { BRUSH_WORDS } from '../js/brush-data.js';
import { STUDY_UNITS } from '../js/course-data.js';
import { POINT, QUICK } from '../js/exam-bank-listen1.js';
import { TASK, UTTER } from '../js/exam-bank-listen2.js';
import { PARAPHRASE, TEXT_GRAMMAR, SHORT, MID, INFO } from '../js/exam-bank-reading.js';
import { ALL_MESSAGES, SENDERS } from '../js/messages-data.js';
import { ALL_LETTER_LINES } from '../js/letter-data.js';
import { READERS } from '../js/library-data.js';
import { rivalLines } from '../js/rival-data.js';
import { encounterLines, SCENES as MEET_SCENES } from '../js/encounter-data.js';
import { DIALOGUES, NUMBER_SCENES, KATA_WORDS, CONJ_WORDS, VERB_FORMS, ADJ_FORMS, VERB_FORMS_N4, ADJ_FORMS_N4, VERB_FORMS_N3, formsFor, conjugate, conjPrompt, BUILD_SENTENCES } from '../js/practice-data.js';

// Every clip records the easiest level that uses it (LV while it's added): N5 clips are precached when the app
// installs; clips only N4 (or N3) content uses are cached once that level is unlocked (sw.js LATER), so they don't
// weigh on a phone before they're needed.
const ORDER = ['N5', 'N4', 'N3'];
const later = (...ls) => ls.sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0];
let LV = 'N5';
const lv = (x) => (x && x.level) || 'N5';
const clips = new Map();
const levels = new Map();
/** Sets a clip entry, keeping the easiest level that needs it. */
const put = (key, entry, level = LV) => {
  clips.set(key, entry);
  const was = levels.get(key);
  if (!was || ORDER.indexOf(level) < ORDER.indexOf(was)) levels.set(key, level);
};
// opts (optional): { accent } to set a word's pitch, { say } for text the voice should read instead.
// An entry may end with a list of speeds ('' normal, 'slow') when it doesn't need both.
const add = (text, voice = 0, opts = null, level = LV) => { if (text) put(text + '#' + voice, opts ? [text, voice, opts] : [text, voice], level); };
const pairs = [];

for (const p of PHRASES) {
  for (let v = 0; v < 4; v++) add(p.speak, v, null, lv(p));       // Pitch Duel rotates voices 0-3
  pairs.push([p.display, p.kana]);
}
for (const item of Object.values(GARDEN_CATALOG)) { add(item.reading, 0, null, lv(item)); pairs.push([item.jp, item.reading]); }
for (const ch of CHAPTERS) {
  LV = lv(ch);
  for (const b of ch.beats) {
    add(b.jp, b.speaker.voice);
    pairs.push([b.jp, b.reading]);
    for (const w of b.words) { add(w.reading); pairs.push([w.jp, w.reading]); }
    // English answers are never spoken, so they get no clip.
    if (b.choice) for (const o of b.choice.options) if (/[ぁ-ゖァ-ヺ一-鿿]/.test(o)) add(o, CAST.ren.voice);
  }
}
LV = 'N5';
for (const w of STORY_WORDS) add(w.reading, 0, null, lv(w));
for (const k of KANJI) { add(k.reading, 0, null, lv(k)); pairs.push([k.word, k.reading]); }
for (const t of TRAINS) {
  LV = lv(t);
  // Every correct way to fill the gaps.
  const combos = t.gaps.reduce((acc, g, i) => acc.flatMap((f) => (g ? g.correct.map((c) => ({ ...f, [i]: c })) : [f])), [{}]);
  for (const filled of combos) add(assembleTrain(t, filled));
}
LV = 'N5';
// Shop orders: a customer orders goods of their level or below (js/modes/shop.js).
for (const c of Object.values(CUSTOMERS)) {
  for (const item of SHOP_STOCK) {
    if (ORDER.indexOf(lv(item)) > ORDER.indexOf(lv(c))) continue;
    const level = later(lv(c), lv(item));
    COUNTERS[item.counter].say.forEach((s) => add(c.order(item, s), c.voice, null, level));
  }
}
add(SHOP_GREETINGS[0], 1);
add(SHOP_THANKS[0], 1);
// N4 shop: the shopkeeper's polite greeting and thanks (Ren's voice), and each keigo moment: the customer's line and
// the right reply.
LV = 'N4';
add(SHOP_GREETINGS_N4[0].jp, 1); pairs.push([SHOP_GREETINGS_N4[0].jp, SHOP_GREETINGS_N4[0].reading]);
add(SHOP_THANKS_N4[0].jp, 1); pairs.push([SHOP_THANKS_N4[0].jp, SHOP_THANKS_N4[0].reading]);
LV = 'N3';
add(SHOP_GREETINGS_N3[0].jp, 1); pairs.push([SHOP_GREETINGS_N3[0].jp, SHOP_GREETINGS_N3[0].reading]);
add(SHOP_THANKS_N3[0].jp, 1); pairs.push([SHOP_THANKS_N3[0].jp, SHOP_THANKS_N3[0].reading]);
for (const m of SHOP_KEIGO) {
  LV = lv(m);
  add(m.line.jp, m.who); pairs.push([m.line.jp, m.line.reading]);
  add(m.options[0].jp, 1);
  for (const o of m.options) pairs.push([o.jp, o.reading]);
}
LV = 'N5';
for (const l of LESSONS) for (const c of l.chars) add(c.k);
for (const l of KANJI_LESSONS) for (const j of l.kanji) { add(j.reading); pairs.push([j.word, j.reading]); }
for (const l of N4_KANJI_LESSONS) for (const j of l.kanji) { add(j.reading, 0, null, 'N4'); pairs.push([j.word, j.reading]); }
for (const l of N3_KANJI_LESSONS) for (const j of l.kanji) { add(j.reading, 0, null, 'N3'); pairs.push([j.word, j.reading]); }
for (const v of READ_WORDS) add(v.w);
// Course example sentences, each in its speaker's voice (0 narrator, 1 Ren, 2 Master, 3 Kaito; N4 units also 4, 5).
for (const u of STUDY_UNITS) for (const p of u.points) for (const ex of p.examples) { add(ex.jp, ex.voice, null, lv(u)); pairs.push([ex.jp, ex.reading]); }

// Mock JLPT listening (js/exam-bank-listen*.js): every question, conversation line and reply in its voice. Each item
// plays once in the full mock, so only normal speed is needed; the mini mock's replay uses the same clip.
for (const [bank, level] of [[[...TASK, ...POINT, ...UTTER, ...QUICK], 'N5'], [[...N4_TASK, ...N4_POINT, ...N4_UTTER, ...N4_QUICK], 'N4'], [[...N3_TASK, ...N3_POINT, ...N3_GIST, ...N3_UTTER, ...N3_QUICK], 'N3']]) {
  for (const it of bank) {
    for (const l of [it.question, it.line, ...(it.lines || []), ...(it.replies || [])].filter(Boolean)) {
      put(l.jp + '#' + l.voice, [l.jp, l.voice, null, ['']], level);
      pairs.push([l.jp, l.reading]);
    }
  }
}
// Ren's Messages: each message in its sender's voice.
for (const m of ALL_MESSAGES) { add(m.jp, SENDERS[m.from].voice, null, lv(m)); pairs.push([m.jp, m.kana]); }
// Ren's monthly letters (js/letters.js), in Ren's voice.
for (const l of ALL_LETTER_LINES) { add(l.jp, SENDERS.ren.voice, null, 'N5'); pairs.push([l.jp, l.kana]); }
// Library readers: each line in its speaker's voice.
for (const r of READERS) for (const l of r.lines) { add(l.jp, l.speaker.voice, null, lv(r)); pairs.push([l.jp, l.reading]); }
// Rival Battle: each rival's taunts, counters and endings in their own voice, and Ren's finisher shouts.
for (const [l, voice, level] of rivalLines()) { add(l.jp, voice, null, level); pairs.push([l.jp, l.reading]); }
// Encounters: each person's lines in their own voice, every reply in the narrator's voice (the model to copy), and
// readings for the wrong replies too (they're shown with furigana, never spoken).
for (const [l, voice, level] of encounterLines()) { add(l.jp, voice, null, level); pairs.push([l.jp, l.reading]); }
for (const s of MEET_SCENES) for (const t of s.turns) for (const l of t.wrong) pairs.push([l.jp, l.reading]);
// Kana Brush words (N4, N3): each word said whole, before it's written kana by kana.
for (const w of BRUSH_WORDS) add(w.kana, 0, null, lv(w));

// N5 deck: each word with its pitch accent set, and its example sentence. Added last so these win over
// an older clip of the same text.
for (const [words, raw, level] of [[N5_WORDS, N5, 'N5'], [N4_WORDS, N4, 'N4'], [N3_WORDS, N3, 'N3']]) {
  words.forEach((w, i) => {
    const [, , , , , , , say, exSay] = raw[i];
    add(w.say, 0, { accent: w.accent, ...(say ? { say } : {}) }, level);
    pairs.push([w.jp, w.reading]);
    if (w.ex) {
      add(w.ex, 0, exSay ? { say: exSay } : null, level);
      pairs.push([w.ex, w.exReading]);
    }
  });
}

// Newer practice modes: Listening Lab scenes (each character's voice), Numbers & Time scenes, Katakana Rush words,
// Conjugation Dojo forms (with readings) and Sentence Builder sentences. Most N5 examples and story lines already
// have clips, so only the new text is synthesized.
for (const d of DIALOGUES) for (const l of d.lines) { add(l.jp, l.who.voice, null, lv(d)); pairs.push([l.jp, l.reading]); }
const keep = (key, level) => { const was = levels.get(key); if (was && ORDER.indexOf(level) < ORDER.indexOf(was)) levels.set(key, level); };
for (const s of NUMBER_SCENES) { if (!clips.has(s.jp + '#' + s.voice)) add(s.jp, s.voice, null, lv(s)); else keep(s.jp + '#' + s.voice, lv(s)); if (s.reading) pairs.push([s.jp, s.reading]); }
for (const w of KATA_WORDS) if (!clips.has(w.say + '#0')) add(w.say, 0, null, lv(w)); else keep(w.say + '#0', lv(w));
// Conjugation Dojo: N5 words in the N5 forms; N4 words in every N5 and N4 form and N5 words in the N4 forms; N3 words
// in every form and older words in the N3 forms (js/modes/conj.js).
for (const w of CONJ_WORDS) {
  const n5Forms = w.type === 'verb' ? VERB_FORMS : ADJ_FORMS;
  const n4Forms = w.type === 'verb' ? VERB_FORMS_N4 : ADJ_FORMS_N4;
  const n3Forms = w.type === 'verb' ? VERB_FORMS_N3 : [];
  const sets = lv(w) === 'N5' ? [[n5Forms, 'N5'], [formsFor(w, n4Forms), 'N4'], [formsFor(w, n3Forms), 'N3']]
    : lv(w) === 'N4' ? [[formsFor(w, [...n5Forms, ...n4Forms]), 'N4'], [formsFor(w, n3Forms), 'N3']]
      : [[formsFor(w, [...n5Forms, ...n4Forms, ...n3Forms]), 'N3']];
  for (const [forms, level] of sets) {
    for (const f of forms) {
      for (const c of [conjugate(w, f), conjPrompt(w, f)]) {
        if (!clips.has(c.jp + '#0')) add(c.jp, 0, null, level); else keep(c.jp + '#0', level);
        if (c.jp !== c.kana) pairs.push([c.jp, c.kana]);
      }
    }
  }
}
for (const s of BUILD_SENTENCES) if (!clips.has(s.say + '#' + s.voice)) add(s.say, s.voice, null, lv(s)); else keep(s.say + '#' + s.voice, lv(s));

// Pitch Coach "Ears first" plays a word in two more voices: every N5 word gets voices 1 and 3 at normal speed only (no
// 🐢 copy), with its pitch accent drawn beat by beat (shape) so the drop the quiz asks about is always clear. Voice 2
// (deep) barely follows a set pitch, so it's left out. Starter phrases already have voices 0-3 above (Pitch Duel), and
// a text that already has a clip in a voice keeps it.
N5_WORDS.forEach((w, i) => {
  const say = N5[i][7];
  for (const v of [1, 3]) {
    if (!clips.has(w.say + '#' + v)) clips.set(w.say + '#' + v, [w.say, v, { accent: w.accent, shape: 1, ...(say ? { say } : {}) }, ['']]);
  }
});

// Each clip: [text, voice, opts, speeds, level].
const out = [...clips.entries()].map(([k, [text, voice, opts = null, speeds = null]]) => [text, voice, opts, speeds, levels.get(k) || 'N5']);
// Tap a word to look it up (tools/build_lookup.py): every line shown for reading, with the words tagged on it.
const NAMES = [['レン', 'れん', 'Ren (a name)'], ['カイト', 'かいと', 'Kaito (a name)'], ['ソラ', 'そら', 'Sora (a name)'], ['キク', 'きく', 'Kiku (a name)'],
  ['田中', 'たなか', 'Tanaka (a family name)'], ['クロダ', 'くろだ', 'Kuroda (a family name)'], ['黒田', 'くろだ', 'Kuroda (a family name)'],
  ['師匠', 'ししょう', 'master, teacher (of a martial art); Ren calls his teacher this']].map(([jp, reading, en]) => ({ jp, reading, en }));
const card = (id) => (GARDEN_CATALOG[id] ? { jp: GARDEN_CATALOG[id].jp, reading: GARDEN_CATALOG[id].reading, en: GARDEN_CATALOG[id].en, id } : null);
const lookup = [];
// A reading passage (a story beat with `doc`) shows one sentence per line (js/modes/story.js docSentences).
const sentences = (text) => {
  const out = [];
  let cur = '', depth = 0;
  for (const ch of text) {
    cur += ch;
    if (ch === '「' || ch === '『') depth++;
    else if ((ch === '」' || ch === '』') && depth > 0) depth--;
    else if (ch === '。' && depth === 0) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
};
for (const ch of CHAPTERS) {
  for (const b of ch.beats) {
    const hints = [...b.words.map((w) => ({ jp: w.jp, reading: w.reading, en: w.en, id: GARDEN_CATALOG[w.gardenID] ? w.gardenID : null })), ...NAMES];
    for (const t of b.doc ? sentences(b.jp) : [b.jp]) lookup.push([t, hints, lv(ch)]);
  }
}
for (const m of ALL_MESSAGES) {
  const hints = [...(m.words || []).map(card).filter(Boolean), ...NAMES];
  lookup.push([m.jp, hints, lv(m)]);
  if (m.kana && m.kana !== m.jp) lookup.push([m.kana, hints, lv(m)]);
}
for (const r of READERS) for (const l of r.lines) lookup.push([l.jp, NAMES, lv(r)]);
for (const l of ALL_LETTER_LINES) { lookup.push([l.jp, NAMES, 'N5']); if (l.kana !== l.jp) lookup.push([l.kana, NAMES, 'N5']); }

process.stdout.write(JSON.stringify({ clips: out, pairs, lookup }));

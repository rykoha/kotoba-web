// Today's words: a small set of words to glance at through the day, on the Today's words screen (#/words) and, if the
// learner sets it up, on the iPhone home screen through a free Scriptable widget (widget/kotoba-widget.js).
// The set is the learner's own Garden: words that need help first, then the words the Garden brings in today, then the
// planted words due soonest. A beginner with nothing planted sees the first deck words. The set is picked once a day
// and saved in progress (store.daily), so sync gives every device, and the widget, the same set all day.
import { store, dateKey } from './store.js';
import { romaji } from './romaji.js';
import { readingConfig } from './furigana.js';
import { N5_WORDS, N4_WORDS, N3_WORDS } from './data.js';

export const DAILY_COUNT = 10;
/** The widget feed's file in the sync gist (js/sync.js), read by the Scriptable script. */
export const WIDGET_FILE = 'kotoba-beat-widget.json';

const usable = (x) => x && x.id && x.jp && x.en;

function pick() {
  const out = [];
  const seen = new Set();
  const add = (item) => {
    if (out.length >= DAILY_COUNT || !usable(item) || seen.has(item.jp)) return;
    seen.add(item.jp);
    out.push(item);
  };
  const plants = store.planted();
  plants.filter((p) => store.wordNeedsHelp(p.item.id)).slice(0, 3).forEach((p) => add(p.item));
  store.freshWords(4).forEach(add);
  plants.filter((p) => p.prog.r).forEach((p) => add(p.item));   // planted() is soonest due first
  if (out.length < DAILY_COUNT) store.freshWords(DAILY_COUNT * 2).forEach(add);
  return out;
}

// Deck words by written form, for an example sentence when a word was planted from somewhere without one (Story).
let deckByJp = null;
function deckWord(jp) {
  if (!deckByJp) {
    deckByJp = new Map();
    for (const w of [...N5_WORDS, ...N4_WORDS, ...N3_WORDS]) if (w.ex && !deckByJp.has(w.jp)) deckByJp.set(w.jp, w);
  }
  return deckByJp.get(jp) || null;
}

/** A word with an example sentence when one exists: { ex, exReading, exEn } from its own card or the decks. */
function withExample(item) {
  if (item.ex) return item;
  const d = deckWord(item.jp);
  return d ? { ...item, ex: d.ex, exReading: d.exReading, exEn: d.exEn } : item;
}

/** Today's words, in order: { id, jp, reading, en, ex?, exReading?, exEn?, say?, mined? }. */
export function todaysWords(today = dateKey()) {
  const kept = store.daily;
  if (kept && kept.date === today && kept.ids.length) {
    const items = kept.ids.map((id) => store.catalogItem(id));
    if (items.every(usable)) return items.map(withExample);
  }
  const items = pick();
  if (items.length) store.setDaily(today, items.map((x) => x.id));
  return items.map(withExample);
}

/** Whether the learner reads with romaji right now (so the widget shows it too). */
const wantsRomaji = () => readingConfig().kanji === 'romaji';

/** The widget feed as text: today's words with readings, and where the site lives (for the widget's tap). */
export function widgetFeed(site = new URL('./', location.href).href, today = dateKey()) {
  const words = todaysWords(today).map((w) => {
    const kana = w.reading || w.jp;
    const out = { jp: w.jp, kana, romaji: romaji(kana), en: w.en };
    if (w.ex) Object.assign(out, { ex: w.ex, exKana: w.exReading || '', exEn: w.exEn || '' });
    return out;
  });
  return JSON.stringify({ app: 'kotoba-beat-widget', v: 2, date: today, romaji: wantsRomaji(), site, words });
}

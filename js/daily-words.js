// Today's words: a small set of words to glance at through the day, on the Today's words screen (#/words) and, if the
// learner sets it up, on the iPhone home screen through a free Scriptable widget (widget/kotoba-widget.js).
// The set is the learner's own Garden: words that need help first, then the words the Garden brings in today, then the
// planted words due soonest. A beginner with nothing planted sees the first deck words. The set is picked once a day
// and kept on this device (not in progress), so the screen and the widget agree all day.
import { store, dateKey } from './store.js';
import { romaji } from './romaji.js';
import { readingConfig } from './furigana.js';

const KEY = 'kotobaBeat.dailyWords';
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

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
}

/** Today's words, in order: { id, jp, reading, en, ex?, exEn?, say?, mined? }. */
export function todaysWords(today = dateKey()) {
  const kept = load();
  if (kept && kept.date === today && Array.isArray(kept.ids) && kept.ids.length) {
    const items = kept.ids.map((id) => store.catalogItem(id));
    if (items.every(usable)) return items;
  }
  const items = pick();
  try { localStorage.setItem(KEY, JSON.stringify({ date: today, ids: items.map((x) => x.id) })); } catch (e) { /* this visit only */ }
  return items;
}

/** Whether the learner reads with romaji right now (so the widget shows it too). */
const wantsRomaji = () => readingConfig().kanji === 'romaji';

/** The widget feed as text: today's words with readings, and where the site lives (for the widget's tap). */
export function widgetFeed(site = new URL('./', location.href).href, today = dateKey()) {
  const words = todaysWords(today).map((w) => {
    const kana = w.reading || w.jp;
    return { jp: w.jp, kana, romaji: romaji(kana), en: w.en };
  });
  return JSON.stringify({ app: 'kotoba-beat-widget', v: 1, date: today, romaji: wantsRomaji(), site, words });
}

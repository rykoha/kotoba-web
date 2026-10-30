// Kotoba Beat: today's words on your iPhone home screen. A script for the free Scriptable app.
// Set it up from Kotoba Beat › Today's words › "On your home screen" (that copies this script with your link filled in).
//
// Each word shows first on its own (recall the meaning), then with its meaning, then the next word comes. Tap the
// widget to open Today's words at that word. Works as a small or medium home screen widget and on the Lock Screen.

// Your widget link from Kotoba Beat (needs Sync across devices). Empty: 10 words a day from the N5 deck, in order.
const FEED = '';
const SITE = 'https://rykoha.github.io/kotoba-web/';
// How long each half (the word, then the word with its meaning) is meant to show. iOS decides the real refresh times.
const SLOT_MIN = 30;
const PER_DAY = 10;

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), 'kotoba-words-cache.json');
const dayNumber = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);

function cached() {
  try { return fm.fileExists(CACHE) ? JSON.parse(fm.readString(CACHE)) : null; } catch (e) { return null; }
}

async function load() {
  const old = cached();
  try {
    if (FEED) {
      const req = new Request(FEED + '?t=' + Date.now());
      req.timeoutInterval = 10;
      const j = await req.loadJSON();
      if (j && Array.isArray(j.words) && j.words.length) { fm.writeString(CACHE, JSON.stringify(j)); return j; }
    } else {
      if (old && old.day === dayNumber() && !old.date) return old;   // the N5 deck is read once a day
      const req = new Request(SITE + 'js/n5.js');
      req.timeoutInterval = 15;
      const text = await req.loadString();
      const deck = text.split('\n').filter((l) => l.startsWith('[')).map((l) => JSON.parse(l.trim().replace(/,$/, '')));
      if (deck.length) {
        const start = (dayNumber() * PER_DAY) % deck.length;
        const words = [];
        for (let k = 0; k < PER_DAY; k++) { const [jp, kana, en] = deck[(start + k) % deck.length]; words.push({ jp, kana, en }); }
        const j = { day: dayNumber(), romaji: false, words };
        fm.writeString(CACHE, JSON.stringify(j));
        return j;
      }
    }
  } catch (e) { /* offline: the last words are still good */ }
  return old;
}

const ink = Color.dynamic(new Color('#16131d'), new Color('#f3eee6'));
const dim = Color.dynamic(new Color('#6b6474'), new Color('#a59eb0'));
const flame = Color.dynamic(new Color('#c4300c'), new Color('#ff6b3d'));
const paper = Color.dynamic(new Color('#f6f1e8'), new Color('#0e0c14'));

function line(stack, text, font, color, lines = 1) {
  const t = stack.addText(text);
  t.font = font;
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.5;
  return t;
}

function build(data) {
  const family = config.widgetFamily || 'medium';
  const w = new ListWidget();
  if (!data || !data.words || !data.words.length) {
    w.backgroundColor = paper;
    line(w, 'Kotoba Words', Font.boldSystemFont(14), flame);
    line(w, 'Open Kotoba Beat once while online, then this fills in.', Font.systemFont(12), dim, 3);
    w.url = SITE + '#/words';
    return w;
  }
  const slot = Math.floor(Date.now() / (SLOT_MIN * 60000));
  const n = data.words.length;
  const at = Math.floor(slot / 2) % n;
  const reveal = slot % 2 === 1;
  const word = data.words[at];
  const kana = word.kana && word.kana !== word.jp ? word.kana : '';
  w.refreshAfterDate = new Date((slot + 1) * SLOT_MIN * 60000);
  w.url = SITE + (FEED ? '#/words/' + (at + 1) : '#/words');

  if (family === 'accessoryInline') {
    line(w, reveal ? `${word.jp} · ${word.en}` : `${word.jp}${kana ? ' ' + kana : ''}`, Font.systemFont(12), ink);
    return w;
  }
  if (family === 'accessoryRectangular' || family === 'accessoryCircular') {
    line(w, word.jp, Font.boldSystemFont(16), ink);
    if (kana) line(w, kana, Font.systemFont(12), ink);
    line(w, reveal ? word.en : 'meaning?', Font.systemFont(12), ink);
    return w;
  }

  const big = family === 'small' ? 30 : 36;
  w.backgroundColor = paper;
  w.setPadding(14, 16, 14, 16);
  line(w, `今日の言葉  ${at + 1}/${n}`, Font.mediumSystemFont(11), flame);
  w.addSpacer();
  line(w, word.jp, Font.boldSystemFont(word.jp.length > 4 ? big - 8 : big), ink);
  if (kana) line(w, kana, Font.systemFont(14), dim);
  if (data.romaji && word.romaji) line(w, word.romaji, Font.italicSystemFont(12), dim);
  w.addSpacer(6);
  if (reveal) line(w, word.en, Font.semiboldSystemFont(family === 'small' ? 13 : 15), ink, 2);
  else line(w, FEED ? 'Meaning? Tap to check' : 'Meaning? It shows next', Font.systemFont(12), dim);
  w.addSpacer();
  return w;
}

const widget = build(await load());
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();

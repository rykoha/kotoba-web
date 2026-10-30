// Kotoba Beat: today's words on your iPhone home screen. A script for the free Scriptable app.
// Set it up from Kotoba Beat › Today's words › "On your home screen" (that copies this script with your link filled in).
//
// The widget shows a word (recall its meaning). Tap it: a card opens with the meaning and an example sentence, and
// you can flip through the rest of today's words there. The widget moves to the next word about every half hour.
// Works as a small or medium home screen widget and on the Lock Screen.

// Your widget link from Kotoba Beat (needs Sync across devices). Empty: 10 words a day from the N5 deck, in order.
const FEED = '';
const SITE = 'https://rykoha.github.io/kotoba-web/';
// How long each word is meant to stay. iOS decides the real refresh times.
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
        for (let k = 0; k < PER_DAY; k++) {
          const [jp, kana, en, , ex, exKana, exEn] = deck[(start + k) % deck.length];
          words.push({ jp, kana, en, ex, exKana, exEn });
        }
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
  t.minimumScaleFactor = 0.6;
  return t;
}

const kanaOf = (w) => (w.kana && w.kana !== w.jp ? w.kana : '');
/** Tapping the widget runs this script again in Scriptable, which opens the card at this word. */
const tapUrl = (at) => `scriptable:///run/${encodeURIComponent(Script.name())}?word=${at}`;

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
  const at = slot % n;
  const word = data.words[at];
  const kana = kanaOf(word);
  w.refreshAfterDate = new Date((slot + 1) * SLOT_MIN * 60000);
  w.url = tapUrl(at);

  if (family === 'accessoryInline') {
    line(w, `${word.jp}${kana ? ' (' + kana + ')' : ''}`, Font.systemFont(14), ink);
    return w;
  }
  if (family === 'accessoryRectangular' || family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    w.setPadding(2, 6, 2, 6);
    line(w, word.jp, Font.boldSystemFont(24), ink);
    if (kana) line(w, kana, Font.systemFont(14), ink);
    line(w, 'tap for the meaning', Font.systemFont(11), ink).textOpacity = 0.7;
    return w;
  }

  const small = family === 'small';
  const big = small ? 30 : 36;
  w.backgroundColor = paper;
  w.setPadding(14, 16, 14, 16);
  line(w, `今日の言葉  ${at + 1}/${n}`, Font.mediumSystemFont(11), flame);
  w.addSpacer();
  line(w, word.jp, Font.boldSystemFont(word.jp.length > 4 ? big - 8 : big), ink);
  if (kana) line(w, kana, Font.systemFont(14), dim);
  if (data.romaji && word.romaji) line(w, word.romaji, Font.italicSystemFont(12), dim);
  // The example sentence, in kana: read it, guess the meaning, tap to check. A small widget fits it in place of the hint.
  const ex = word.exKana || word.ex;
  if (ex) { w.addSpacer(small ? 4 : 6); line(w, ex, Font.systemFont(small ? 11 : 13), ink, 2); }
  if (!small || !ex) { w.addSpacer(6); line(w, 'Meaning? Tap to check', Font.systemFont(12), dim); }
  w.addSpacer();
  return w;
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The card a tap opens: the word with its meaning and example, and Back / Next through today's words. */
async function showCard(data, start) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: light dark; --ink:#16131d; --dim:#6b6474; --flame:#c4300c; --paper:#f6f1e8; --card:#fffdf8; --line:rgba(22,19,29,.12); }
@media (prefers-color-scheme: dark) { :root { --ink:#f3eee6; --dim:#a59eb0; --flame:#ff6b3d; --paper:#0e0c14; --card:#1a1722; --line:rgba(255,255,255,.12); } }
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px 32px; background:var(--paper); color:var(--ink); font:17px -apple-system, "Hiragino Sans", sans-serif; text-align:center; }
.count { color:var(--flame); font-weight:700; font-size:13px; letter-spacing:.04em; }
.card { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:24px 16px; margin:12px 0 16px; }
.jp { font-size:52px; font-weight:800; line-height:1.2; margin:4px 0; }
.kana { font-size:20px; color:var(--dim); }
.romaji { font-size:15px; color:var(--dim); font-style:italic; }
.en { font-size:22px; font-weight:700; margin:18px 0 0; }
.ex { margin-top:18px; padding-top:16px; border-top:1px solid var(--line); }
.ex .s { font-size:19px; } .ex .k { font-size:15px; color:var(--dim); margin-top:4px; } .ex .e { font-size:15px; margin-top:6px; }
button { font:inherit; font-weight:700; border-radius:12px; border:1.5px solid var(--line); background:var(--card); color:var(--ink); padding:12px; min-height:48px; }
.reveal { width:100%; margin-top:18px; }
.nav { display:flex; gap:10px; } .nav button { flex:1; } .nav .next { background:var(--flame); color:#fff; border-color:var(--flame); }
.hide { display:none; }
a { color:var(--flame); display:inline-block; margin-top:18px; font-size:15px; }
</style></head><body>
<div class="count" id="count"></div>
<div class="card">
  <div class="jp" id="jp"></div><div class="kana" id="kana"></div><div class="romaji" id="romaji"></div>
  <button class="reveal" id="reveal">Show the meaning</button>
  <div id="answer" class="hide"><div class="en" id="en"></div>
    <div class="ex" id="ex"><div class="s" id="exjp"></div><div class="k" id="exkana"></div><div class="e" id="exen"></div></div></div>
</div>
<div class="nav"><button id="prev">‹ Back</button><button class="next" id="next">Next ›</button></div>
<a href="${esc(SITE)}#/words">Open Kotoba Beat</a>
<script>
const words = ${JSON.stringify(data.words).replace(/</g, '\\u003c')};
const romaji = ${JSON.stringify(!!data.romaji)};
let i = ${Number(start) || 0};
const $ = (id) => document.getElementById(id);
function show(n, open) {
  i = (n + words.length) % words.length;
  const w = words[i];
  $('count').textContent = '今日の言葉  ' + (i + 1) + ' / ' + words.length;
  $('jp').textContent = w.jp;
  $('kana').textContent = w.kana && w.kana !== w.jp ? w.kana : '';
  $('romaji').textContent = romaji && w.romaji ? w.romaji : '';
  $('en').textContent = w.en || '';
  $('ex').classList.toggle('hide', !w.ex);
  $('exjp').textContent = w.ex || '';
  $('exkana').textContent = w.exKana && w.exKana !== w.ex ? w.exKana : '';
  $('exen').textContent = w.exEn || '';
  $('answer').classList.toggle('hide', !open);
  $('reveal').classList.toggle('hide', !!open);
}
$('reveal').onclick = () => show(i, true);
$('next').onclick = () => show(i + 1, false);
$('prev').onclick = () => show(i - 1, false);
show(i, true);   // the word you tapped opens with its meaning
</script></body></html>`;
  const view = new WebView();
  await view.loadHTML(html);
  await view.present(false);
}

/**
 * Keeps this script up to date: about twice a day it fetches the newest copy from the site, fills in this copy's link
 * and site, and saves it over itself, so new features arrive without copying the script again.
 */
async function selfUpdate() {
  const stamp = fm.joinPath(fm.documentsDirectory(), 'kotoba-words-updated.txt');
  try {
    const last = fm.fileExists(stamp) ? Number(fm.readString(stamp)) || 0 : 0;
    if (Date.now() - last < 12 * 3600000) return;
    fm.writeString(stamp, String(Date.now()));
    const req = new Request(SITE + 'widget/kotoba-widget.js?t=' + Date.now());
    req.timeoutInterval = 15;
    let text = await req.loadString();
    const feedLine = 'const FEED = ' + "'';";
    const siteLine = 'const SITE = ' + "'https://rykoha.github.io/kotoba-web/';";
    if (!text.includes(feedLine) || !text.includes('Script.setWidget')) return;
    text = text.replace(feedLine, 'const FEED = ' + JSON.stringify(FEED) + ';').replace(siteLine, 'const SITE = ' + JSON.stringify(SITE) + ';');
    const cloud = FileManager.iCloud();
    const files = module.filename.startsWith(cloud.documentsDirectory()) ? cloud : FileManager.local();
    if (files.readString(module.filename) !== text) files.writeString(module.filename, text);
  } catch (e) { /* offline or no access: try again next time */ }
}

const data = await load();
await selfUpdate();
if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(build(data));
} else if (data && data.words && data.words.length && args.queryParameters && args.queryParameters.word != null) {
  await showCard(data, args.queryParameters.word);
} else if (data && data.words && data.words.length) {
  await showCard(data, Math.floor(Date.now() / (SLOT_MIN * 60000)) % data.words.length);
} else {
  await build(data).presentMedium();
}
Script.complete();

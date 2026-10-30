// Line-drawn icons in place of emoji. The app's templates still write emoji (they read well in the code and fall
// back gracefully), and this pass swaps each one on screen for a small line drawing from js/icon-art.js, drawn in
// the text colour so it follows light and dark mode and the text size. Like reading help (furigana.js), it runs
// over everything that renders, including toasts and banners, so no screen keeps a stray emoji.
//
// Accessibility: an icon next to words is decoration (aria-hidden); an icon that is the only thing in its element
// gets role="img" and a short name, the way the emoji used to be read out.
import { ICON_ART } from './icon-art.js';

/** Emoji the app used to show, and the line drawing (js/icon-art.js) that now stands in for each. */
export const EMOJI_ICONS = {
  "✓": "check",
  "★": "star",
  "▶": "play",
  "🤫": "shush",
  "🔤": "abc",
  "📱": "phone",
  "✕": "close",
  "🔧": "wrench",
  "🐢": "turtle",
  "🎤": "mic",
  "🔊": "speaker",
  "📖": "book-open",
  "🗾": "japan",
  "🗼": "tokyo-tower",
  "🧑‍🏫": "teacher",
  "🧑‍🎓": "student",
  "💧": "drop",
  "🐱": "cat",
  "🐶": "dog",
  "⌨": "keyboard",
  "🥢": "chopsticks",
  "🌉": "bridge",
  "☔": "umbrella",
  "🍬": "candy",
  "🌸": "blossom",
  "👃": "nose",
  "🍎": "apple",
  "🍙": "onigiri",
  "🥤": "cup",
  "🍡": "dango",
  "🎫": "ticket",
  "🍘": "senbei",
  "🧒": "child",
  "🧑‍💼": "office-worker",
  "👵": "grandma",
  "🌱": "seedling",
  "🌿": "herb",
  "🪴": "potted-plant",
  "🌳": "tree",
  "⚡": "bolt",
  "🚃": "train",
  "🔨": "hammer",
  "🥋": "gi",
  "🧩": "puzzle",
  "〰": "wave",
  "👂": "ear",
  "⚔": "swords",
  "🛒": "cart",
  "🎧": "headphones",
  "🔢": "numbers",
  "💡": "bulb",
  "↻": "retry",
  "🔁": "repeat",
  "🎉": "party",
  "✏": "pencil",
  "🩹": "bandage",
  "👁": "eye",
  "🗣": "speaking",
  "💬": "chat",
  "📐": "triangle-ruler",
  "↩": "undo",
  "🕒": "clock",
  "💴": "yen",
  "📅": "calendar",
  "⚠": "warning",
  "✋": "hand",
  "🧑": "person",
  "✍": "writing",
  "⚑": "flag",
  "🔍": "search",
  "🔒": "lock",
  "✔": "check-bold",
  "🙈": "no-peek",
  "🌅": "sunrise",
  "🍜": "ramen",
  "😮‍💨": "sigh",
  "💪": "muscle",
  "⏰": "alarm",
  "🏫": "school",
  "🗓": "calendar-spiral",
  "🕞": "clock-half",
  "🏪": "shop",
  "⏳": "hourglass",
  "🚉": "station",
  "🚌": "bus",
  "🖊": "pen",
  "📕": "book",
  "📝": "memo",
  "🎂": "cake",
  "👨‍👩‍👧‍👦": "family",
  "👥": "people",
  "🍊": "orange",
  "🥛": "milk",
  "📦": "box",
  "🏊": "swimmer",
  "🎓": "grad-cap",
  "🏃": "runner",
  "🏘": "houses",
  "🔥": "fire",
  "🤜": "fist",
  "🎬": "clapper",
  "🍱": "bento",
  "■": "stop",
  "⇄": "swap",
  "📋": "clipboard",
  "⬇": "download",
  "📁": "folder",
  "☀": "sun",
  "👟": "shoe",
  "📺": "tv",
  "🍞": "bread",
  "🛏": "bed",
  "🥚": "egg",
  "🌧": "rain",
  "🏆": "trophy",
  "↗": "rise",
  "↘": "fall",
  "🗯": "manga",
};

/** A short spoken name for an icon that stands alone ("potted plant"). */
const spoken = (name) => name.replace(/-/g, ' ');

/** The SVG for an icon by name ('' if there's no drawing). `label` makes it a named image instead of decoration. */
export function icon(name, { label = '', cls = '' } = {}) {
  const art = ICON_ART[name];
  if (!art) return '';
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="ico ico-${name}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${art}</svg>`;
}

// Longest sequences first, so a combined emoji (🧑‍💼) wins over its parts (🧑). The variation selector (U+FE0F) that
// asks for colour emoji is optional after every character.
const KEYS = Object.keys(EMOJI_ICONS).sort((a, b) => [...b].length - [...a].length);
const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMOJI_RE = new RegExp(KEYS.map((k) => [...k].map((c) => esc(c) + '\\uFE0F?').join('')).join('|'), 'gu');
const keyOf = (m) => m.replace(/️/g, '');

/** Elements whose text must stay text (form fields can't hold drawings; SVG text is already a drawing). */
const SKIP = 'script, style, textarea, input, select, option, svg, [data-noicon]';

function swapText(node) {
  const text = node.nodeValue;
  EMOJI_RE.lastIndex = 0;
  if (!text || !EMOJI_RE.test(text)) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  EMOJI_RE.lastIndex = 0;
  // No words beside it in its element (an icon tile, a plant, even with a drop icon next to it): give it a name.
  // Next to words: decoration, since the words already say it.
  const wordsBeside = [...parent.childNodes].some((c) => c !== node && c.nodeType === Node.TEXT_NODE && c.nodeValue.replace(EMOJI_RE, '').trim());
  EMOJI_RE.lastIndex = 0;
  const alone = text.replace(EMOJI_RE, '').trim() === '' && !wordsBeside && !parent.getAttribute('aria-label') && !parent.closest('[aria-hidden="true"]');
  EMOJI_RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(EMOJI_RE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const name = EMOJI_ICONS[keyOf(m[0])];
    const html = icon(name, { label: alone ? spoken(name) : '' });
    if (html) {
      const t = document.createElement('template');
      t.innerHTML = html;
      frag.append(t.content);
    } else frag.append(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  node.replaceWith(frag);
}

function swapTree(root) {
  if (root.nodeType === Node.TEXT_NODE) { swapText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE || root.closest(SKIP)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) swapText(n);
}

/** Start swapping emoji for icons under `roots`, now and as anything renders. */
export function initIcons(roots) {
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') { if (m.target.isConnected) swapText(m.target); continue; }
      m.addedNodes.forEach((n) => { if (n.isConnected) swapTree(n); });
    }
  });
  for (const r of roots) {
    observer.observe(r, { childList: true, subtree: true, characterData: true });
    swapTree(r);
  }
  return observer;
}

/** Text with its emoji taken out, for places that can only hold text (the page title, a tooltip). */
export const stripEmoji = (s) => String(s).replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();

// Manga Reader practice pages: short original shōnen-style scenes at each JLPT level, to try the reader before
// importing your own pages. Each page is four panels drawn from the Encounters characters (img/encounters/), with
// speech bubbles written as real text, so they need no text reading: tap a bubble and its words are ready.
//
// Bubble text marks furigana as [漢字|かんじ], like the readings printed beside kanji in shōnen manga.
// Layout: panels and bubbles in page units (the page is 600 x 900). Bubbles are written top to bottom (vertical),
// like real manga, unless `h: true`.

/** The page's size in its own units. */
export const PAGE_W = 600, PAGE_H = 900;

// Four panels: a wide one on top, two in the middle, a wide one at the bottom.
const GRID = [[16, 16, 568, 268], [316, 300, 268, 290], [16, 300, 284, 290], [16, 606, 568, 278]];

export const MANGA_SAMPLES = [
  {
    id: 'n5-dojo', level: 'N5', title: '[道場|どうじょう]の[朝|あさ]', en: 'Morning at the dojo',
    panels: [
      { who: 'student', side: 'back', fx: 'ガラッ', lines: 'burst' },
      { who: 'master', side: 'front' },
      { who: 'student', side: 'front', lines: 'speed' },
      { who: 'master', side: 'front', lines: 'burst' },
    ],
    bubbles: [
      { p: 0, x: 400, y: 30, w: 92, h: 220, text: 'おはようございます！', en: 'Good morning!' },
      { p: 1, x: 334, y: 316, w: 80, h: 190, text: 'おそいぞ。もう[八時|はちじ]だ。', en: "You're late. It's already eight." },
      { p: 2, x: 30, y: 316, w: 128, h: 220, text: 'すみません！でも、[今日|きょう]は[早|はや]く[来|き]ました！', en: "Sorry! But I came early today!" },
      { p: 3, x: 430, y: 630, w: 120, h: 200, text: '…よし。[始|はじ]めよう。', en: "...All right. Let's begin." },
    ],
  },
  {
    id: 'n5-rival', level: 'N5', title: '[帰|かえ]り[道|みち]', en: 'The way home',
    panels: [
      { who: 'tough', side: 'front', lines: 'burst' },
      { who: 'student', side: 'front' },
      { who: 'tough', side: 'front', fx: 'ニヤッ' },
      { who: 'student', side: 'front', lines: 'speed', fx: 'ドン！' },
    ],
    bubbles: [
      { p: 0, x: 420, y: 30, w: 92, h: 220, text: 'おい、お[前|まえ]。どこへ[行|い]く？', en: 'Hey, you. Where are you going?' },
      { p: 1, x: 334, y: 316, w: 80, h: 150, text: '[道場|どうじょう]です。', en: 'To the dojo.' },
      { p: 2, x: 30, y: 316, w: 96, h: 210, text: '[道場|どうじょう]？[弱|よわ]そうだな。', en: 'The dojo? You look weak.' },
      { p: 3, x: 400, y: 626, w: 150, h: 230, text: '[弱|よわ]くない！[毎日|まいにち][練習|れんしゅう]しています！', en: "I'm not weak! I train every day!" },
    ],
  },
  {
    id: 'n4-match', level: 'N4', title: '[試合|しあい]の[前|まえ]', en: 'Before the match',
    panels: [
      { who: 'student', side: 'back', fx: 'ドキドキ' },
      { who: 'master', side: 'front' },
      { who: 'student', side: 'front', lines: 'speed' },
      { who: 'master', side: 'front', lines: 'burst' },
    ],
    bubbles: [
      { p: 0, x: 420, y: 30, w: 96, h: 220, text: '[明日|あした]の[試合|しあい]、[勝|か]てるかな…', en: "Tomorrow's match... I wonder if I can win." },
      { p: 1, x: 330, y: 316, w: 128, h: 240, text: '[勝|か]てるかどうかは、お[前|まえ]の[練習|れんしゅう]で[決|き]まる。', en: 'Whether you can win depends on your training.' },
      { p: 2, x: 30, y: 316, w: 96, h: 230, text: 'もっと[強|つよ]くなりたいんです。', en: 'I want to get stronger.' },
      { p: 3, x: 420, y: 626, w: 128, h: 230, text: 'なら、[休|やす]まずに[続|つづ]けることだ。', en: 'Then keep going without resting.' },
    ],
  },
  {
    id: 'n4-again', level: 'N4', title: 'ライバル', en: 'Rival',
    panels: [
      { who: 'biker', side: 'front', lines: 'burst', fx: 'ブォン' },
      { who: 'student', side: 'front' },
      { who: 'biker', side: 'front', fx: 'ニッ' },
      { who: 'student', side: 'front', lines: 'speed', fx: 'ゴゴゴ' },
    ],
    bubbles: [
      { p: 0, x: 400, y: 30, w: 128, h: 220, text: '[久|ひさ]しぶりだな。[覚|おぼ]えているか？', en: "Long time no see. Do you remember me?" },
      { p: 1, x: 334, y: 316, w: 110, h: 220, text: '[忘|わす]れるはずがない！', en: 'There is no way I would forget!' },
      { p: 2, x: 30, y: 316, w: 96, h: 210, text: '[今度|こんど]は[負|ま]けないぞ。', en: "I won't lose this time." },
      { p: 3, x: 400, y: 626, w: 150, h: 230, text: 'こっちも、ずっと[待|ま]っていたんだ！', en: "I've been waiting for this too!" },
    ],
  },
  {
    id: 'n3-words', level: 'N3', title: '[師匠|ししょう]の[言葉|ことば]', en: "The master's words",
    panels: [
      { who: 'master', side: 'front', lines: 'burst' },
      { who: 'student', side: 'front' },
      { who: 'master', side: 'front', lines: 'speed' },
      { who: 'student', side: 'back', fx: 'グッ' },
    ],
    bubbles: [
      { p: 0, x: 400, y: 30, w: 128, h: 230, text: '[強|つよ]さとは、[勝|か]つことだけではない。', en: 'Strength is not only about winning.' },
      { p: 1, x: 330, y: 316, w: 128, h: 240, text: 'じゃあ、[何|なん]のために[戦|たたか]うんですか？', en: 'Then what do we fight for?' },
      { p: 2, x: 30, y: 316, w: 128, h: 240, text: '[守|まも]りたいもののためだ。それを[忘|わす]れるな。', en: "For what you want to protect. Don't forget that." },
      { p: 3, x: 400, y: 626, w: 150, h: 230, text: '…はい。[絶対|ぜったい]に[忘|わす]れません。', en: "...Yes. I'll never forget." },
    ],
  },
  {
    id: 'n3-final', level: 'N3', title: '[決戦|けっせん]', en: 'The final battle',
    panels: [
      { who: 'wrestler', side: 'front', lines: 'burst', fx: 'ゴゴゴ' },
      { who: 'student', side: 'front', lines: 'speed' },
      { who: 'wrestler', side: 'front', fx: 'フン' },
      { who: 'student', side: 'front', lines: 'burst', fx: 'ドン！' },
    ],
    bubbles: [
      { p: 0, x: 400, y: 30, w: 128, h: 230, text: 'ここまで[来|く]るとは、[思|おも]わなかったぜ。', en: "I didn't think you'd make it this far." },
      { p: 1, x: 334, y: 316, w: 120, h: 240, text: '[仲間|なかま]が[信|しん]じてくれたからな。', en: 'Because my friends believed in me.' },
      { p: 2, x: 30, y: 316, w: 120, h: 230, text: 'ふん、[口|くち]だけは[一人前|いちにんまえ]だな。', en: "Hmph. At least your mouth is grown-up." },
      { p: 3, x: 390, y: 626, w: 160, h: 236, text: '[口|くち]だけかどうか、[確|たし]かめてみろ！', en: "Find out if it's just talk!" },
    ],
  },
];
export const SAMPLE_BY_ID = Object.fromEntries(MANGA_SAMPLES.map((s) => [s.id, s]));

/** A bubble's text without its furigana marks. */
export const plainText = (marked) => marked.replace(/\[([^|\]]+)\|[^\]]+\]/g, '$1');

/** A bubble's text as HTML, with furigana as <ruby> (escaped). */
export function rubyHTML(marked, esc) {
  return marked.split(/(\[[^|\]]+\|[^\]]+\])/).map((part) => {
    const m = /^\[([^|\]]+)\|([^\]]+)\]$/.exec(part);
    return m ? `<ruby>${esc(m[1])}<rt>${esc(m[2])}</rt></ruby>` : esc(part);
  }).join('');
}

/** The art of a practice page as SVG: panel frames, speed lines or a burst, the character, sound effects. */
export function pageSVG(s, esc) {
  const out = [];
  s.panels.forEach((p, i) => {
    const [x, y, w, h] = GRID[i];
    const id = `${s.id}-p${i}`;
    out.push(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`);
    out.push(`<g clip-path="url(#${id})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>`);
    const cx = x + w / 2, cy = y + h * 0.6;
    if (p.lines === 'speed') {
      for (let k = 0; k < 26; k++) {
        const yy = y + 8 + ((k * 37) % (h - 16));
        out.push(`<line x1="${x}" y1="${yy}" x2="${x + w * (0.25 + ((k * 13) % 30) / 100)}" y2="${yy}" stroke="#222" stroke-width="${1 + (k % 3)}"/>`);
      }
    } else if (p.lines === 'burst') {
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        const r1 = Math.min(w, h) * 0.42, r2 = Math.max(w, h);
        out.push(`<line x1="${(cx + Math.cos(a) * r1).toFixed(1)}" y1="${(cy + Math.sin(a) * r1).toFixed(1)}" x2="${(cx + Math.cos(a) * r2).toFixed(1)}" y2="${(cy + Math.sin(a) * r2).toFixed(1)}" stroke="#222" stroke-width="${k % 2 ? 1 : 2.5}"/>`);
      }
    } else {
      out.push(`<rect x="${x}" y="${y + h * 0.72}" width="${w}" height="${h * 0.28}" fill="#e9e6df"/>`);
    }
    const size = Math.min(h * 0.86, w * 0.9);
    // Characters stand on the side away from their bubble: bubbles sit on the right of the wide panels and on the
    // left of the two middle ones.
    const px = i === 1 || i === 2 ? x + w - size * 0.9 : x + w * 0.08;
    out.push(`<image href="./img/encounters/${p.who}-${p.side}.png" x="${px.toFixed(1)}" y="${(y + h - size).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" style="image-rendering:pixelated"/>`);
    if (p.fx) {
      out.push(`<text x="${(x + w * (i === 1 ? 0.55 : 0.42)).toFixed(1)}" y="${(y + 64).toFixed(1)}" font-size="46" font-weight="900" fill="#fff" stroke="#111" stroke-width="3" paint-order="stroke" transform="rotate(-10 ${x + w * 0.45} ${y + 50})" font-family="sans-serif">${esc(p.fx)}</text>`);
    }
    out.push(`</g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#111" stroke-width="4"/>`);
  });
  // Bubble shapes (the text itself is HTML on top, so it can be read and tapped).
  for (const b of s.bubbles) {
    const rx = b.w / 2 + 14, ry = b.h / 2 + 16;
    out.push(`<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${rx}" ry="${ry}" fill="#fff" stroke="#111" stroke-width="2.5"/>`);
  }
  return `<svg class="mg-art" viewBox="0 0 ${PAGE_W} ${PAGE_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <rect width="${PAGE_W}" height="${PAGE_H}" fill="#f4f1ea"/>${out.join('')}</svg>`;
}

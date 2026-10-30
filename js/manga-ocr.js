// Manga Reader text reader: reads the Japanese in a boxed speech bubble, on the device. It runs Tesseract
// (tesseract.js, Apache 2.0) with its Japanese models, all served from this site (manga/ocr/), so nothing leaves the
// device and no account or key is needed. The reader and its models (about 6 MB) are fetched the first time a bubble
// is read; the service worker keeps them.
//
// Best on clean, typeset bubbles. Furigana (the small readings beside kanji) are dropped by size, since the
// dictionary gives readings anyway. The learner can always fix the text by hand.

const base = () => new URL('./manga/ocr/', document.baseURI).href;
/** Tesseract's page layouts: one block of vertical text, or one block of horizontal lines. */
const PSM = { vertical: '5', horizontal: '6' };

let worker = null;
let workerLang = null;
let starting = null;

/** Whether the text reader has been started on this page (so the first read can say it's downloading). */
export const ocrStarted = () => !!worker;

async function getWorker(lang) {
  if (!starting) {
    starting = (async () => {
      const { default: Tesseract } = await import('../manga/ocr/tesseract.esm.min.js');
      const w = await Tesseract.createWorker(lang, 1, {
        workerPath: base() + 'worker.min.js', corePath: base() + 'core', langPath: base() + 'lang', gzip: true,
        workerBlobURL: false,
      });
      worker = w;
      workerLang = lang;
      return w;
    })().catch((e) => { starting = null; throw e; });
  }
  const w = await starting;
  if (workerLang !== lang) { await w.reinitialize(lang, 1); workerLang = lang; }
  return w;
}

/** Ends the text reader (frees its memory when the reader screen closes). */
export async function stopOcr() {
  const w = worker;
  worker = null; workerLang = null; starting = null;
  if (w) try { await w.terminate(); } catch (e) { /* already gone */ }
}

/**
 * The part of `img` inside `rect` ({ x, y, w, h } in image pixels), made easy to read: scaled so the text is a good
 * size, grey, black on white (light text on dark is flipped), with a white margin. Returns a canvas.
 */
export function prepare(img, rect) {
  const longer = Math.max(rect.w, rect.h);
  const scale = Math.max(1, Math.min(4, 900 / longer));
  const pad = 24;
  const w = Math.round(rect.w * scale), h = Math.round(rect.h * scale);
  const c = document.createElement('canvas');
  c.width = w + pad * 2; c.height = h + pad * 2;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, rect.x, rect.y, rect.w, rect.h, pad, pad, w, h);
  const data = g.getImageData(pad, pad, w, h);
  const px = data.data;
  const hist = new Array(256).fill(0);
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < grey.length; i++) {
    const v = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
    grey[i] = v; hist[v]++;
  }
  const t = otsu(hist, grey.length);
  // Mostly dark: light text on a dark bubble, so flip it.
  let dark = 0;
  for (let i = 0; i < grey.length; i++) if (grey[i] < t) dark++;
  const flip = dark > grey.length * 0.55;
  for (let i = 0; i < grey.length; i++) {
    const ink = flip ? grey[i] >= t : grey[i] < t;
    const v = ink ? 0 : 255;
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255;
  }
  g.putImageData(data, pad, pad);
  return c;
}

/** Otsu's threshold: the grey level that best splits ink from paper. */
export function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i + 1; }
  }
  return t;
}

/**
 * Keeps the main text of Tesseract's lines (columns, for vertical text) and drops noise and furigana: a line of kana only that is
 * much narrower (shorter, for horizontal text) than the narrowest line with kanji in it. Furigana sit beside kanji, so
 * a bubble without kanji keeps every line. `lines`: [{ text, bbox: { x0, y0, x1, y1 } }].
 */
export function dropFurigana(lines, vertical) {
  const size = (l) => (vertical ? l.bbox.x1 - l.bbox.x0 : l.bbox.y1 - l.bbox.y0);
  // Specks read as letters and digits: a line that is mostly not Japanese is noise.
  lines = lines.filter((l) => { const t = l.text.replace(/\s/g, ''); return t && (t.match(/[ぁ-ゖァ-ヺー一-鿿々！？!?…、。]/g) || []).length * 2 > t.length; });
  const withKanji = lines.filter((l) => /[一-鿿々]/.test(l.text)).map(size);
  if (!withKanji.length) return lines;
  // The narrowest kanji line: a kanji line can look wider when its furigana is read as part of it.
  const main = Math.min(...withKanji);
  return lines.filter((l) => /[一-鿿々]/.test(l.text) || !/^[\sぁ-ゖァ-ヺー・]+$/.test(l.text) || size(l) >= main * 0.55);
}

/** Japanese text from Tesseract, cleaned up: no spaces or line breaks, and ASCII ! and ? as the wide marks. */
export const tidy = (s) => s.replace(/\s+/g, '').replace(/!/g, '！').replace(/\?/g, '？').replace(/\.\.\.|…/g, '…');

/**
 * Reads the text in `rect` of `img` (an image or canvas). `vertical`: the bubble's writing direction (default: taller
 * than wide means vertical). Returns { text, confidence (0-100) }.
 */
export async function readBubble(img, rect, { vertical = rect.h > rect.w * 0.9, keepFurigana = false } = {}) {
  const lang = vertical ? 'jpn_vert' : 'jpn';
  const w = await getWorker(lang);
  await w.setParameters({ tessedit_pageseg_mode: PSM[vertical ? 'vertical' : 'horizontal'], preserve_interword_spaces: '1' });
  const canvas = prepare(img, rect);
  const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
  const lines = (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
  const kept = keepFurigana || !lines.length ? null : dropFurigana(lines, vertical);
  const text = tidy(kept ? kept.map((l) => l.text).join('') : data.text || '');
  return { text, confidence: Math.round(data.confidence || 0) };
}

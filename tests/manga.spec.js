// Manga Reader: the offline dictionary (conjugations undone, bubbles split into words), the text reader's clean-up
// (furigana and specks dropped), the practice pages, reading a practice bubble and planting a deck word, adding your
// own page, boxing a bubble so it's read on the device, keeping a word as one of My words, and the v15 -> v16
// migration. Nothing in the reader may reach another site.
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, view, expectNoHorizontalScroll } from './helpers.js';
import * as dict from '../js/manga-dict.js';
import { dropFurigana, tidy, otsu } from '../js/manga-ocr.js';
import { MANGA_SAMPLES, plainText } from '../js/manga-samples.js';

const base = (extra = {}) => ({ v: 16, items: {}, chapters: [], forged: [], dojo: [], storyReplays: {}, days: {}, settings: { hideIosHint: true, readingHelp: 'kana' }, engine: { placementSkip: true }, ...extra });
const PAGE = new URL('./fixtures/manga-page.png', import.meta.url).pathname;

let loaded = false;
const useDict = () => { if (!loaded) { dict.useDict(readFileSync(new URL('../manga/dict.txt', import.meta.url), 'utf8')); loaded = true; } };
const words = (s) => dict.segment(s).filter((w) => w.match).map((w) => w.text);
const top = (s) => dict.lookupAt(s, 0).results[0];

test.describe('Manga Reader dictionary (Node)', () => {
  test('conjugated words are found under their dictionary form, with each step named', async () => {
    useDict();
    const cases = [
      ['食べなかった', '食べる', ['neg', 'past']],
      ['知らねえ', '知る', ['casual']],
      ['行ってしまった', '行く', ['te', 'shimau', 'past']],
      ['勉強しています', '勉強', ['suru', 'te', 'prog', 'polite']],
      ['負けられない', '負ける', ['pass', 'neg']],
      ['強くなった', '強い', ['adv', 'past']],
      ['来ました', '来る', ['polite', 'past']],
      ['待ってた', '待つ', ['te', 'prog', 'past']],
    ];
    for (const [text, baseForm, reasons] of cases) {
      const m = dict.lookupAt(text, 0);
      expect(m.len, text).toBe(text.length);
      expect(m.results[0].base, text).toBe(baseForm);
      expect(m.results[0].reasons, text).toEqual(reasons);
    }
    expect(dict.reasonText(['neg', 'past'])).toBe('negative (not), then past');
    // An ending that takes any word ends it: からね is から + ね, never "command of からぬ".
    expect(dict.deinflect('からね').some((c) => c.reasons.length > 1)).toBe(false);
  });

  test('a bubble splits into likely words: common words over rare look-alikes, a word over its pieces', async () => {
    useDict();
    expect(words('海賊王におれはなる！')).toEqual(['海賊王', 'に', 'おれ', 'は', 'なる']);
    expect(words('俺は火影になるんだ！')).toEqual(['俺', 'は', '火影', 'に', 'なる', 'んだ']);
    expect(words('すみません！でも、今日は早く来ました！')).toEqual(['すみません', 'でも', '今日', 'は', '早く', '来ました']);
    expect(words('人間の寿命は短いからね')).toEqual(['人間', 'の', '寿命', 'は', '短い', 'から', 'ね']);
    expect(words('ここまで来るとは、思わなかったぜ。')).toEqual(['ここ', 'まで', '来る', 'と', 'は', '思わなかった', 'ぜ']);
    expect(top('行った').entry.kanji[0]).toBe('行く');
    expect(top('おれ').entry.kanji[0]).toBe('俺');
    // Punctuation and anything unknown stay as plain text between the words.
    const parts = dict.segment('！？…');
    expect(parts).toEqual([{ text: '！？…', match: null }]);
  });

  test('every practice bubble is fully understood: each word in the dictionary, furigana marks well formed', async () => {
    useDict();
    const levels = {};
    for (const s of MANGA_SAMPLES) {
      levels[s.level] = (levels[s.level] || 0) + 1;
      expect(s.bubbles.length, s.id).toBeGreaterThanOrEqual(4);
      for (const b of s.bubbles) {
        for (const m of b.text.matchAll(/\[([^|\]]+)\|([^\]]+)\]/g)) {
          expect(/[一-鿿々]/.test(m[1]), m[0]).toBe(true);
          expect(/^[ぁ-ゖ]+$/.test(m[2]), m[0]).toBe(true);
        }
        expect(b.en, b.text).toBeTruthy();
        const unknown = dict.segment(plainText(b.text)).filter((w) => !w.match && /[ぁ-ゖァ-ヺ一-鿿]/.test(w.text));
        expect(unknown.map((w) => w.text), b.text).toEqual([]);
      }
    }
    expect(levels).toEqual({ N5: 2, N4: 2, N3: 2 });
  });
});

test.describe('Manga Reader text clean-up (Node)', () => {
  test('furigana columns and specks are dropped; a bubble without kanji keeps every column', () => {
    const L = (text, x0, x1) => ({ text, bbox: { x0, y0: 0, x1, y1: 300 } });
    const lines = [L('まほう', 300, 343), L('魔法を', 200, 300), L('つかにんげん', 152, 200), L('使える人間は', 50, 148), L('9ょ;', 0, 20)];
    expect(dropFurigana(lines, true).map((l) => l.text)).toEqual(['魔法を', '使える人間は']);
    const kana = [L('おはよう', 100, 200), L('ね', 60, 90)];
    expect(dropFurigana(kana, true).map((l) => l.text)).toEqual(['おはよう', 'ね']);
    expect(tidy('お前は 強く\nなったな!')).toBe('お前は強くなったな！');
    const hist = new Array(256).fill(0);
    hist[20] = 100; hist[235] = 300;
    const t = otsu(hist, 400);
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThanOrEqual(235);
  });
});

test.describe('Manga Reader', () => {
  test('practice page: tap a bubble, its words come up with readings, and a deck word is planted as its voiced card', async ({ page }) => {
    const hosts = new Set();
    page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) hosts.add(u.host); });
    await seed(page, base());
    await page.goto('./#/play/manga');
    const v = view(page);
    await expect(v.locator('h2')).toHaveText('漫画');
    await expect(v.locator('[data-act=practice][data-level=N5]')).toBeEnabled();
    await expect(v.locator('[data-act=practice][data-level=N4]')).toBeDisabled();   // N4 opens after N5
    await v.locator('[data-act=practice][data-level=N5]').click();
    await expect(v.locator('.mg-bubble')).toHaveCount(4);
    await expectNoHorizontalScroll(page);
    await v.locator('.mg-bubble').nth(2).click();
    await expect(v.locator('.mg-chip:not(.plain)').first()).toBeVisible({ timeout: 20_000 });
    await expect(v.locator('.mg-chip', { hasText: '今日' }).locator('rt')).toHaveText('きょう');
    await expect(v.locator('.mg-chip', { hasText: '来ました' }).locator('rt')).toHaveText('きました');
    await v.locator('.mg-chip', { hasText: '来ました' }).click();
    const card = v.locator('.mg-card');
    await expect(card).toContainText('来る');
    await expect(card).toContainText('polite (ます), then past');
    await expect(card.locator('[data-act=keep]')).toHaveText(/Plant in Garden/);
    await card.locator('[data-act=keep]').click();
    await expect(card).toContainText('In your Garden');
    const s = await saved(page);
    const planted = Object.keys(s.items);
    expect(planted.some((id) => !id.startsWith('my:'))).toBe(true);
    expect(s.mywords).toEqual({});
    await v.locator('summary', { hasText: 'Breakdown' }).click();
    await expect(v.locator('.mg-breakdown li')).not.toHaveCount(0);
    await v.locator('[data-act=next]').click();
    await expect(v.locator('.mg-bar')).toContainText('2 / 2');
    await expectNoHorizontalScroll(page);
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });

  test('your own page: add it, box a bubble, the text is read on the device, a new word joins My words and the Garden', async ({ page }) => {
    test.setTimeout(90_000);
    const hosts = new Set();
    page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) hosts.add(u.host); });
    await seed(page, base());
    await page.goto('./#/play/manga');
    const v = view(page);
    await v.locator('[data-act=new]').click();
    await v.locator('#mg-title').fill('Test manga');
    await v.locator('[data-form=new] button[type=submit]').click();
    await expect(v.locator('.mg-empty')).toBeVisible();
    await v.locator('[data-file=add]').setInputFiles(PAGE);
    const stage = v.locator('.mg-stage');
    await expect(v.locator('.mg-img')).toBeVisible();
    await expectNoHorizontalScroll(page);
    // The fixture page is 800 x 1100, with a bubble at (505, 75), 231 x 255: drag a box a little bigger.
    const b = await stage.boundingBox();
    const at = (x, y) => [b.x + (x / 800) * b.width, b.y + (y / 1100) * b.height];
    const [x0, y0] = at(490, 60), [x1, y1] = at(750, 345);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 4 });
    await page.mouse.up();
    const text = v.locator('#mg-text');
    await expect(text).toHaveValue(/強/, { timeout: 60_000 });
    await expect(v.locator('.mg-chip:not(.plain)').first()).toBeVisible({ timeout: 20_000 });
    // Fix the text by hand (as if the reader slipped), then look it up again.
    await text.fill('火影になるんだ');
    await v.locator('[data-act=lookup]').click();
    await v.locator('.mg-chip', { hasText: '火影' }).click();
    const card = v.locator('.mg-card');
    await expect(card).toContainText('ほかげ');
    await expect(card.locator('[data-act=keep]')).toHaveText(/Add to My words/);
    await card.locator('[data-act=keep]').click();
    await expect(card).toContainText('In your Garden');
    const s = await saved(page);
    expect(s.mywords['火影']).toMatchObject({ r: 'ほかげ' });
    expect(s.mywords['火影'].en).toMatch(/firelight/);
    expect(s.items['my:火影']).toMatchObject({ level: 0, r: 0 });
    // The new word comes in first among the Garden's new words, asked by meaning (it has no voice clip).
    const fresh = await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      return store.freshWords(5).map((w) => [w.id, !!w.mined]);
    });
    expect(fresh[0]).toEqual(['my:火影', true]);
    // The page, its box and its text are still there after a reload; the book is on the shelf.
    await page.reload();
    await v.locator('[data-act=book]').click();
    await expect(v.locator('.mg-bubble')).toHaveCount(1);
    await v.locator('.mg-bubble').click();
    await expect(v.locator('#mg-text')).toHaveValue('火影になるんだ');
    // My words lists it, and it can be removed (two taps).
    await v.locator('[data-act=shelf]').click();
    await v.locator('summary', { hasText: 'My words' }).click();
    await expect(v.locator('.mg-words')).toContainText('火影');
    await v.locator('[data-act=del-word]').click();
    await v.locator('[data-act=del-word]').click();
    expect((await saved(page)).mywords).toEqual({});
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });

  test('v15 progress migrates to v16 with no My words, keeping everything else', async ({ page }) => {
    const card = { level: 3, due: Date.now() + 9e8, best: 0, r: 3, pl: Date.now() - 9e8, s: 5, d: 5, lr: Date.now() - 1e8 };
    await seed(page, { ...base({ items: { 'n5:雨': card } }), v: 15 });
    await page.goto('./#/play/manga');
    await expect(view(page).locator('h2')).toHaveText('漫画');
    await page.evaluate(async () => (await import('./js/store.js')).store.save());
    const s = await saved(page);
    expect(s.v).toBe(16);
    expect(s.mywords).toEqual({});
    expect(s.items['n5:雨'].r).toBe(3);
  });
});

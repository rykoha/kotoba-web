// The Library (graded readers), tap a word to look it up (Story, Messages, Library), Walk mode and Type It: the
// readers' data and lookup coverage (in Node), reading a reader through to its questions and the words-read count,
// planting a word from the lookup card, Walk mode's steps and controls, Type It's checks and a round in each
// direction, and the v12 -> v13 migration and sync merge of the Library field.
import { test, expect, seed, saved, view, expectNoHorizontalScroll } from './helpers.js';
import { romajiToKana, checkReading, checkMeaning, checkJapanese } from '../js/kana-input.js';
import { TOKENS, ENTRIES } from '../js/lookup-data.js';

const now = Date.now();
const card = (extra = {}) => ({ level: 3, due: now + 9e8, best: 0, r: 3, pl: now - 9e8, s: 5, d: 5, lr: now - 1e8, ...extra });
const base = (extra = {}) => ({ v: 13, items: {}, chapters: [], forged: [], dojo: [], storyReplays: {}, days: {}, settings: { hideIosHint: true, readingHelp: 'off' }, ...extra });

test.describe('Library data and lookup (Node)', () => {
  test('readers: every level has some, ids are unique, lines and readings line up, questions are answerable', async () => {
    const { READERS } = await import('../js/library-data.js');
    const ids = new Set();
    const levels = {};
    for (const r of READERS) {
      expect(ids.has(r.id), r.id).toBe(false);
      ids.add(r.id);
      levels[r.level] = (levels[r.level] || 0) + 1;
      expect(r.lines.length, r.id).toBeGreaterThanOrEqual(10);
      for (const l of r.lines) {
        expect(l.jp.length, l.jp).toBeLessThanOrEqual(60);
        expect(l.en, l.jp).toBeTruthy();
        expect(l.reading.split(' ').length, `${r.id}: ${l.jp}`).toBe(l.jp.split(' ').length);
        expect(/[一-鿿ァ-ヺ]/.test(l.reading.replace(/ー/g, '')), `reading in hiragana: ${l.reading}`).toBe(false);
      }
      for (const q of r.questions) expect(q.options[q.answer], `${r.id}: ${q.q}`).toBeTruthy();
    }
    expect(levels.N5).toBeGreaterThanOrEqual(10);
    expect(levels.N4).toBeGreaterThanOrEqual(6);
    expect(levels.N3).toBeGreaterThanOrEqual(6);
  });

  test('every line shown for reading has its words worked out, and nearly every word has a meaning', async () => {
    const { READERS } = await import('../js/library-data.js');
    const { CHAPTERS } = await import('../js/data.js');
    const { ALL_MESSAGES } = await import('../js/messages-data.js');
    const texts = [...READERS.flatMap((r) => r.lines.map((l) => l.jp)), ...CHAPTERS.flatMap((c) => c.beats.filter((b) => !b.doc).map((b) => b.jp)), ...ALL_MESSAGES.map((m) => m.jp)];
    const missing = texts.filter((t) => !TOKENS[t]);
    expect(missing).toEqual([]);
    for (const t of texts) {
      const seq = TOKENS[t];
      let n = 0;
      for (let i = 0; i < seq.length; i += 2) n += seq[i];
      expect(n, t).toBe(t.length);
    }
    const words = Object.values(TOKENS).flatMap((seq) => seq.filter((_, i) => i % 2 === 1 && seq[i] >= 0)).map((i) => ENTRIES[i]);
    const noMeaning = words.filter((e) => e[0] === 'r').length;
    expect(noMeaning / words.length).toBeLessThan(0.02);
  });

  test('typed answers: romaji to kana, readings, Japanese and meanings are checked generously', () => {
    expect(romajiToKana('konnichiha')).toBe('こんにちは');
    expect(romajiToKana('kitte')).toBe('きって');
    expect(romajiToKana('shinbun')).toBe('しんぶん');
    expect(romajiToKana("kon'ya")).toBe('こんや');
    expect(romajiToKana('matcha')).toBe('まっちゃ');
    expect(checkReading('taberu', 'たべる')).toBe('exact');
    expect(checkReading('koohii', 'コーヒー')).toBe('exact');
    expect(checkReading('tokyo', 'とうきょう')).toBe('close');
    expect(checkReading('watashiwa', 'わたしは')).toBe('exact');
    expect(checkReading('tabemasu', 'たべる')).toBe(false);
    expect(checkJapanese('食べる', { jp: '食べる', reading: 'たべる' })).toBe('exact');
    expect(checkJapanese('たべる', { jp: '食べる', reading: 'たべる' })).toBe('exact');
    expect(checkJapanese('taberu', { jp: '食べる', reading: 'たべる' })).toBe('exact');
    expect(checkJapanese('nomu', { jp: '食べる', reading: 'たべる' })).toBe(false);
    expect(checkMeaning('eat', 'to eat')).toBe('exact');
    expect(checkMeaning('Soon', 'immediately / soon')).toBe('exact');
    expect(checkMeaning('brother', 'older brother')).toBe('exact');
    expect(checkMeaning('tournment', 'tournament, competition')).toBe('close');
    expect(checkMeaning('dog', 'cat')).toBe(false);
  });
});

test.describe('Library', () => {
  test('the shelf: readers by level, % of words met, words read; reading a reader through to its questions', async ({ page }) => {
    await seed(page, base({ items: { 'n5:雨': card() } }));
    await page.goto('./#/play/library');
    const v = view(page);
    await expect(v.getByRole('heading', { name: '図書室' })).toBeVisible();
    await expect(v.locator('.lib-card').first()).toContainText('% met');
    await expect(v.getByText('N4 SHELF')).toBeVisible();
    await expect(v.locator('.lib-card[disabled]').first()).toBeAttached();   // N4 is locked for now
    await expectNoHorizontalScroll(page);

    await v.locator('.lib-card[data-id=n5-morning]').click();
    await expect(v.locator('.lib-line')).toHaveCount(13);
    await expect(v.locator('.lib-line .lk').first()).toBeVisible();
    // English stays hidden until asked for.
    await expect(v.locator('.lib-en')).toHaveCount(0);
    await v.locator('[data-act=eng]').first().click();
    await expect(v.locator('.lib-en')).toHaveCount(1);
    await v.getByRole('button', { name: /Show English/ }).click();
    await expect(v.locator('.lib-en')).toHaveCount(13);
    await v.getByRole('button', { name: /Play all/ }).click();
    await expect(v.locator('.lib-line.playing')).toHaveCount(1);
    await v.getByRole('button', { name: /Stop/ }).click();
    await expectNoHorizontalScroll(page);

    await v.getByRole('button', { name: /Done reading/ }).click();
    for (let i = 0; i < 2; i++) {
      await v.locator('[data-act=answer]').first().click();
      await expect(v.locator('.saga-feedback')).toBeVisible();
      await v.locator('[data-act=qnext]').click();
    }
    await expect(v.getByText(/more words read/)).toBeVisible();
    const s = await saved(page);
    expect(s.v).toBeGreaterThanOrEqual(13);
    expect(s.library.read['n5-morning'].n).toBe(1);
    expect(s.library.read['n5-morning'].qt).toBe(2);
    // New words from the story can be planted from the end screen.
    const plant = v.locator('[data-act=plant]').first();
    if (await plant.count()) {
      const id = await plant.getAttribute('data-id');
      await plant.click();
      expect((await saved(page)).items[id]).toBeTruthy();
    }
    await v.getByRole('button', { name: 'Shelf' }).click();
    await expect(v.locator('.lib-tiles')).not.toContainText(/^0 words/);
    await expect(v.locator('.lib-card[data-id=n5-morning]')).toContainText('read once');
  });

  test('tap a word: its meaning, reading and a Plant button; planting adds it to the Garden', async ({ page }) => {
    await seed(page, base());
    await page.goto('./#/play/library');
    const v = view(page);
    await v.locator('.lib-card[data-id=n5-morning]').click();
    // 毎朝 (every morning) is an N5 deck word.
    const word = v.locator('.lk', { hasText: '毎朝' }).first();
    await word.click();
    const sheet = page.locator('.lk-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('まいあさ');
    await expect(sheet).toContainText(/every morning/i);
    await expectNoHorizontalScroll(page);
    await sheet.getByRole('button', { name: /Plant in Garden/ }).click();
    await expect(sheet).toContainText('In your Garden');
    expect((await saved(page)).items['n5:毎朝']).toBeTruthy();
    // A particle gets a short note.
    await v.locator('.lk', { hasText: /^は$/ }).first().click();
    await expect(sheet).toContainText('Topic marker');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('tap a word in a Story line, and in a message', async ({ page }) => {
    await seed(page, base());
    await page.goto('./#/play/story');
    const v = view(page);
    await v.locator('[data-act=open]').first().click();
    const skip = v.locator('[data-act=prestart]');
    if (await skip.count()) await skip.click();
    await v.locator('.line-card .lk').first().click();
    await expect(page.locator('.lk-sheet')).toBeVisible();
    // Tapping a word doesn't toggle the line's English.
    await expect(v.locator('.line-card .trace-c')).toHaveCount(0);
    await page.goto('./#/messages');
    await expect(view(page).locator('.msg-text .lk').first()).toBeVisible();
    await view(page).locator('.msg-text .lk').first().click();
    await expect(page.locator('.lk-sheet')).toBeVisible();
  });

  test('v12 progress migrates to v13 with an empty Library, and the sync merge keeps both devices\' reads', async ({ page }) => {
    await seed(page, { ...base({ items: { 'n5:雨': card() } }), v: 12 });
    await page.goto('./#/play/library');
    await expect(view(page).locator('.lib-card').first()).toBeVisible();
    const r = await page.evaluate(async () => {
      const { mergeProgress, store } = await import('./js/store.js');
      store.finishReader('n5-morning', 1, 2);
      const a = { v: 13, library: { read: { 'n5-morning': { n: 2, at: 10, q: 1, qt: 2 }, 'n5-rain': { n: 1, at: 5, q: 3, qt: 3 } } } };
      const b = { v: 13, library: { read: { 'n5-morning': { n: 1, at: 20, q: 2, qt: 2 }, 'n5-cat': { n: 1, at: 7, q: 0, qt: 3 } } } };
      return { merged: mergeProgress(a, b).library.read, again: mergeProgress(mergeProgress(a, b), b).library.read, items: Object.keys(store.s.items) };
    });
    expect(r.merged['n5-morning']).toEqual({ n: 2, at: 20, q: 2, qt: 2 });
    expect(r.merged['n5-rain'].n).toBe(1);
    expect(r.merged['n5-cat'].n).toBe(1);
    expect(r.again).toEqual(r.merged);
    expect(r.items).toContain('n5:雨');
    const s = await saved(page);
    expect(s.v).toBeGreaterThanOrEqual(13);
    expect(s.library.read['n5-morning'].n).toBe(1);
  });
});

test.describe('Walk mode', () => {
  test('a session: English, a pause to answer, the Japanese; pause, skip and end; nothing graded', async ({ page }) => {
    const items = {};
    await page.goto('./');
    const ids = await page.evaluate(async () => (await import('./js/data.js')).N5_WORDS.slice(0, 12).map((w) => w.id));
    for (const id of ids) items[id] = card();
    await page.evaluate(() => localStorage.clear());
    await page.goto('about:blank');
    await seed(page, base({ items }));
    await page.goto('./#/play/walk');
    const v = view(page);
    await expect(v.getByText('Eyes-free review')).toBeVisible();
    await expect(v.getByText(/12 Garden words to practise/)).toBeVisible();
    await v.getByRole('radio', { name: '5 min', exact: true }).click();
    await expectNoHorizontalScroll(page);
    await v.getByRole('button', { name: /Start walking/ }).click();
    await expect(v.locator('.walk-card')).toBeVisible();
    await expect(v.locator('.walk-en')).not.toBeEmpty();
    await expect(v.locator('.walk-card.pause, .walk-card.jp')).toBeVisible({ timeout: 10_000 });
    await v.getByRole('button', { name: /Pause/ }).click();
    await expect(v.locator('.walk-card')).toContainText('PAUSED');
    await v.getByRole('button', { name: /Resume/ }).click();
    await v.getByRole('button', { name: /Skip/ }).click();
    await expect(v.getByText(/Word · 2|Sentence · 2/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await v.getByRole('button', { name: /End/ }).click();
    await expect(v.getByText(/おつかれ/)).toBeVisible();
    const s = await saved(page);
    for (const id of ids) expect(s.items[id].r).toBe(3);   // reviews untouched
  });

  test('with only a few words planted, the first deck words come in as listen-and-repeat', async ({ page }) => {
    await seed(page, base());
    await page.goto('./#/play/walk');
    await expect(view(page).getByText(/listen-and-repeat/)).toBeVisible();
    const steps = await page.evaluate(async () => (await import('./js/modes/walk.js')).walkSteps().map((s) => s.kind));
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((k) => k === 'intro')).toBe(true);
  });
});

test.describe('Type It', () => {
  test('meaning: see the word, type the English; a typo is close enough; a miss shows the answer and comes back', async ({ page }) => {
    await seed(page, base({ items: { 'n5:雨': card({ due: 0 }) } }));
    await page.goto('./#/play/type');
    const v = view(page);
    await expect(v.getByText('Type the answer from memory.')).toBeVisible();
    await v.getByRole('radio', { name: 'Meaning' }).click();
    await v.getByRole('radio', { name: 'All' }).click();
    await expectNoHorizontalScroll(page);
    await v.getByRole('button', { name: /Start a round/ }).click();
    const answerFor = async () => page.evaluate(async () => {
      const { GARDEN_CATALOG } = await import('./js/data.js');
      const jp = document.querySelector('.type-prompt-jp').textContent;
      return Object.values(GARDEN_CATALOG).find((x) => x.jp === jp).en;
    });
    const en = await answerFor();
    await v.locator('#type-answer').fill(en.split(/[/;,]/)[0]);
    await v.locator('#type-answer').press('Enter');
    await expect(v.getByText(/Right!|Close enough!/)).toBeVisible();
    await v.getByRole('button', { name: /Next/ }).click();
    await v.locator('#type-answer').fill('zzzz');
    await v.getByRole('button', { name: /Check/ }).click();
    await expect(v.getByText('Not quite. The answer:')).toBeVisible();
    await expect(v.getByText(/It comes back in a moment/)).toBeVisible();
    await v.getByRole('button', { name: /I was right/ }).click();
    await expect(v.getByText('Counted right.')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('Japanese: see the English, type romaji and it turns into kana; katakana words only', async ({ page }) => {
    await seed(page, base());
    await page.goto('./#/play/type');
    const v = view(page);
    await v.getByRole('radio', { name: 'Japanese' }).click();
    await v.getByRole('radio', { name: 'Katakana' }).click();
    await v.getByRole('button', { name: /Start a round/ }).click();
    const w = await page.evaluate(async () => {
      const { typePool } = await import('./js/modes/type.js');
      const en = document.querySelector('.type-prompt-en').textContent;
      return typePool('katakana', 200).find((x) => x.en === en);
    });
    expect(/[ァ-ヺ]/.test(w.jp)).toBe(true);
    const { romaji } = await import('../js/romaji.js');
    await v.locator('#type-answer').pressSequentially(romaji(w.reading, { particles: false }).replace(/ /g, ''));
    await expect(v.locator('.type-preview')).not.toHaveText(/^\s*$/);
    await v.locator('#type-answer').press('Enter');
    await expect(v.getByText(/Right!|Close enough!/)).toBeVisible();
  });

  test('reading: see the word, type how it reads', async ({ page }) => {
    await seed(page, base());
    await page.goto('./#/play/type');
    const v = view(page);
    await v.getByRole('radio', { name: 'Reading' }).click();
    await v.getByRole('radio', { name: 'Hiragana' }).click();
    await v.getByRole('button', { name: /Start a round/ }).click();
    const jp = await v.locator('.type-prompt-jp').textContent();
    expect(/^[ぁ-ゖー]+$/.test(jp)).toBe(true);
    const { romaji } = await import('../js/romaji.js');
    await v.locator('#type-answer').fill(romaji(jp, { particles: false }));
    await v.locator('#type-answer').press('Enter');
    await expect(v.getByText(/Right!|Close enough!/)).toBeVisible();
    const s = await saved(page);
    expect(Object.keys(s.engine.items || {}).length + Object.keys(s.engine || {}).length).toBeGreaterThan(0);
  });
});

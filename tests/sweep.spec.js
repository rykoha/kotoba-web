// Fixes from the October 2026 bug sweep of the modes: a wrong option that was really also right (two kanji or two
// words with one meaning), the Shopkeeper's right answer always on top, Walk mode's English with no English voice,
// and a mined line's readings typed in romaji.
import { test, expect, seed, saved, view } from './helpers.js';

const base = (extra = {}) => ({ v: 9, items: {}, chapters: [], settings: { hideIosHint: true }, days: {},
  engine: { tally: {}, recent: {}, mastery: {}, placement: null, placementSkip: true, checkin: null }, ...extra });

test('Reading Dojo: kanji that share a meaning (都 and 京, "capital") are never wrong options for each other', async ({ page }) => {
  await page.goto('./');
  const bad = await page.evaluate(async () => {
    const { ALL_LESSONS } = await import('./js/dojo-data.js');
    const { kanjiQuestion } = await import('./js/modes/dojo.js');
    const out = [];
    const checked = [];
    for (const track of ['kanji', 'kanji4', 'kanji3']) {
      const pool = ALL_LESSONS.filter((l) => l.track === track).flatMap((l) => l.kanji.map((j) => ({ ...j, id: 'kj:' + j.k, track })));
      for (const j of pool) {
        // A small pool: the kanji, its twins and a few others, so a twin would surely be offered.
        const twins = pool.filter((p) => p !== j && p.meaning === j.meaning);
        if (!twins.length) continue;
        const q = kanjiQuestion(j, 'm2j', [j, ...twins, ...pool.filter((p) => p.meaning !== j.meaning).slice(0, 3)]);
        const offered = q.opts.filter((k) => twins.some((t) => t.k === k));
        if (offered.length) out.push(`${j.k}: ${offered.join(',')}`);
        checked.push(j.k);
      }
    }
    return { out, checked };
  });
  expect(bad.checked).toEqual(expect.arrayContaining(['都', '京']));
  expect(bad.out).toEqual([]);
});

test('"Which one means…?" never offers another word with the same meaning (だれ and 誰 are both "who")', async ({ page }) => {
  await page.goto('./');
  const r = await page.evaluate(async () => {
    const { meaningQuestion } = await import('./js/recap.js');
    const q = meaningQuestion({ jp: 'だれ', en: 'who', pool: ['誰', 'なに', 'どこ', 'いつ', 'だれ', 'なぜ'] });
    return q.options;
  });
  expect(r).toContain('だれ');
  expect(r).not.toContain('誰');
});

test('Rival Battle: an English-to-Japanese attack never offers a word with the same meaning', async ({ page }) => {
  await page.goto('./');
  const bad = await page.evaluate(async () => {
    const { GARDEN_CATALOG } = await import('./js/data.js');
    const { store } = await import('./js/store.js');
    const { attackPool, optionsFor } = await import('./js/rival-items.js');
    // Every word that shares its English with another, reviewed, so both forms are in the pool.
    const byEn = {};
    for (const w of Object.values(GARDEN_CATALOG)) if (w.en && w.reading) (byEn[w.en] ||= []).push(w);
    const now = Date.now();
    for (const list of Object.values(byEn)) if (new Set(list.map((w) => w.jp)).size > 1) {
      for (const w of list) store.s.items[w.id] = { level: 2, due: now + 86_400_000, best: 0, r: 2, pl: now, s: 2, d: 5, lr: now };
    }
    const out = [];
    for (const a of attackPool().filter((x) => x.kind === 'word' && x.optionsJa)) {
      const item = Object.values(GARDEN_CATALOG).find((w) => 'w:' + w.id === a.key);
      for (let n = 0; n < 3; n++) {
        const { options } = optionsFor(a);
        const twins = options.filter((jp) => jp !== a.answer && (byEn[item.en] || []).some((w) => w.jp === jp));
        if (twins.length) out.push(`${item.en}: ${a.answer} with ${twins.join(',')}`);
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('Shopkeeper: the right greeting is not always the top button', async ({ page }) => {
  await seed(page, base());
  const firsts = new Set();
  for (let n = 0; n < 10 && firsts.size < 2; n++) {
    await page.goto(`./?n=${n}#/play/shop`);
    const first = view(page).locator('[data-act=greet]').first();
    await expect(first).toBeVisible();
    firsts.add(await first.getAttribute('data-i'));
  }
  expect(firsts.size).toBeGreaterThan(1);
});

test('Walk mode: with no English voice, the English shows even with "Show the words on screen" off', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kotobaBeat.walk', JSON.stringify({ text: false, mins: 5 }));
    // No English voice on this device.
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices = () => [];
  });
  await seed(page, base());
  await page.goto('./#/play/walk');
  const v = view(page);
  await v.getByRole('button', { name: /Start walking/ }).click();
  await expect(v.locator('.walk-en')).toBeVisible();
  await expect(v.locator('.walk-en')).not.toBeEmpty();
  await v.getByRole('button', { name: /End/ }).click();
});

test('Paste a line: a kanji reading can be typed in romaji', async ({ page }) => {
  await seed(page, base());
  await page.goto('./#/play/story');
  const v = view(page);
  await v.getByRole('button', { name: /Paste a line/ }).click();
  await v.locator('#mine-jp').fill('鬱だ');
  await v.getByRole('button', { name: /Show readings/ }).click();
  await v.locator('.mine-reading').first().fill('utsu');
  await v.locator('#mine-en').fill('I feel down');
  await v.getByRole('button', { name: /Add to Garden/ }).click();
  await expect(v.getByText('YOUR MINED LINES · 1')).toBeVisible();
  const s = await saved(page);
  expect(s.saga.mined[0].reading).toBe('うつだ');
});

test('Kanji Forge: a second miss shows the parts instead of leaving it to guesswork', async ({ page }) => {
  await seed(page, base());
  await page.goto('./#/play/forge');
  const v = view(page);
  const parts = await page.evaluate(async () => {
    const { KANJI } = await import('./js/data.js');
    const meaning = document.querySelector('.forge-meaning').textContent.replace(/"/g, '');
    return KANJI.find((k) => k.meaning === meaning).parts;
  });
  const wrongTile = async () => {
    const tiles = v.locator('[data-act=add]');
    for (let i = 0; i < await tiles.count(); i++) {
      const k = (await tiles.nth(i).locator('.part-k').textContent()).trim();
      if (!parts.includes(k)) return tiles.nth(i);
    }
    return null;
  };
  for (let miss = 0; miss < 2; miss++) {
    await (await wrongTile()).click();
    await v.getByRole('button', { name: /Strike the anvil/ }).click();
  }
  await expect(v.getByText(/^It's /)).toBeVisible();
  await expect(v.locator('[data-act=add].hi')).toHaveCount(new Set(parts).size);
});

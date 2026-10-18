// New words in the Garden: a first-seen word is marked NEW and shown to study (not tested), and partner words
// (男/女, 大きい/小さい, js/pairs.js) are introduced on the same day, back to back.
import { test, expect, seed, view, expectNoHorizontalScroll } from './helpers.js';

const NOW = new Date('2026-10-10T10:00:00');
const T = NOW.getTime();
const DAY = 86_400_000;
const later = () => ({ level: 4, due: T + 5 * DAY, best: 0, r: 6, pl: T - 30 * DAY, s: 8, d: 5, lr: T - 8 * DAY });

/** Saved items where every starter phrase and every N5 word before 男 is planted except the last `left` of them. */
async function itemsBefore(page, jp, left) {
  await page.goto('./');
  const ids = await page.evaluate(async ([jp, left]) => {
    const { PHRASES, N5_WORDS } = await import('./js/data.js');
    const i = N5_WORDS.findIndex((w) => w.jp === jp);
    const phrases = PHRASES.filter((p) => !p.isBoss && p.level === 'N5').map((p) => p.id);
    return [...phrases, ...N5_WORDS.slice(0, i - left).map((w) => w.id)];
  }, [jp, left]);
  return Object.fromEntries(ids.map((id) => [id, later()]));
}

async function open(page, items, hash = '#/play/garden') {
  await page.clock.setFixedTime(NOW);
  await seed(page, { v: 6, settings: { hideIosHint: true }, days: {}, items });
  await page.goto('./' + hash);
}

test('every pair is in a deck', async ({ page }) => {
  await page.goto('./');
  const r = await page.evaluate(async () => {
    const m = await import('./js/pairs.js');
    return { missing: m.missingPairs(), man: m.partnerOf('男')?.jp, big: m.partnerOf('小さい')?.jp };
  });
  expect(r.missing).toEqual([]);
  expect(r).toMatchObject({ man: '女', big: '大きい' });
});

test("a word's partner comes in the same day, even one past the daily limit", async ({ page }) => {
  await open(page, await itemsBefore(page, '男', 4));
  const fresh = await page.evaluate(async () => (await import('./js/store.js')).store.freshWords(5).map((w) => w.jp));
  expect(fresh.length).toBe(6);
  expect(fresh.slice(-2)).toEqual(['男', '女']);
  // A partner already growing isn't added again.
  const items = await itemsBefore(page, '男', 4);
  await open(page, { ...items, 'n5:女': later() });
  const fresh2 = await page.evaluate(async () => (await import('./js/store.js')).store.freshWords(5).map((w) => w.jp));
  expect(fresh2).not.toContain('女');
  expect(fresh2.length).toBe(5);
});

test('new words are marked NEW, shown to study, and partners meet back to back', async ({ page }) => {
  await open(page, await itemsBefore(page, '男', 4));
  const v = view(page);
  await v.locator('[data-act=water]').click();
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const card = v.locator('.card-review');
    await expect(card.locator('.new-tag')).toContainText('NEW');
    await expect(card).toContainText('New word');
    await expect(card.getByRole('button', { name: /Check/ })).toHaveCount(0);   // not a test
    const jp = await page.evaluate(() => {
      const c = document.querySelector('#view .review-jp').cloneNode(true);
      c.querySelectorAll('rt').forEach((r) => r.remove());
      return c.textContent.trim();
    });
    seen.push(jp);
    if (jp === '男') await expect(card.locator('.pair-line')).toContainText('女');
    if (i === 0) await expectNoHorizontalScroll(page);
    await card.getByRole('button', { name: /Got it/ }).click();
  }
  const m = seen.indexOf('男');
  const f = seen.indexOf('女');
  expect(m).toBeGreaterThanOrEqual(0);
  expect(Math.abs(m - f)).toBe(1);
  // The recap then asks the new words back.
  await expect(v.locator('.recap')).toBeVisible();
});

test('a word seen before has no NEW mark and is tested as usual', async ({ page }) => {
  await open(page, { 'n5:猫': { ...later(), due: T - 1000 } });
  await page.evaluate(async () => {
    const { store } = await import('./js/store.js');
    store.day().newc = 5;
    store.save();
  });
  await page.reload();
  const v = view(page);
  await v.locator('[data-act=water]').click();
  await expect(v.locator('.new-tag')).toHaveCount(0);
  await expect(v.getByRole('button', { name: /Check/ })).toBeVisible();
});

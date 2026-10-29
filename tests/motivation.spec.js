// Progress and motivation: Ren's monthly letter (js/letters.js), Things I can do (js/cando.js) and the voice time
// capsule (js/capsule.js).
import { test, expect, seed, saved, view, expectNoHorizontalScroll } from './helpers.js';

const base = (extra = {}) => ({ v: 15, items: {}, chapters: [], forged: [], dojo: [], storyReplays: {}, days: {}, settings: { hideIosHint: true, readingHelp: 'off' }, ...extra });
const studied = (newc) => ({ ok: 5, tot: 6, rev: 6, newc, studied: true, blocks: {} });

async function wordIds(page, n = 3) {
  await page.goto('./');
  const ids = await page.evaluate(async (k) => (await import('./js/data.js')).N5_WORDS.slice(0, k).map((w) => w.id), n);
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  return ids;
}

test.describe("Ren's monthly letter", () => {
  test('the first visit of a month brings a letter about last month, with its words to recall', async ({ page }) => {
    const ids = await wordIds(page);
    const oct = Date.parse('2026-10-12T09:00:00');
    const items = Object.fromEntries(ids.map((id, i) => [id, { level: 2, due: oct + 5e8, best: 1, r: 2, pl: oct + i * 1000, s: 3, d: 5, lr: oct }]));
    const days = { '2026-10-05': studied(5), '2026-10-12': studied(5), '2026-10-13': studied(4), '2026-10-20': studied(3) };
    await page.clock.setFixedTime(new Date('2026-11-02T10:00:00'));
    await seed(page, base({ items, days }));
    await page.goto('./#/');
    const card = view(page).locator('.letter-card');
    await expect(card).toContainText('A letter from Ren');
    await expect(card).toContainText('October');
    await card.click();
    await expect(page).toHaveURL(/#\/letter\/2026-10/);
    const v = view(page);
    await expect(v.getByRole('heading', { name: 'A letter about October 2026' })).toBeVisible();
    // 17 new words: "you learned new words", then the words to recall, and the sign-off.
    await expect(v.locator('.letter-line')).toHaveCount(5);
    await v.getByRole('button', { name: 'English' }).nth(1).click();
    await expect(v.getByText('You learned new words.')).toBeVisible();
    await expect(v.locator('.letter-word')).toHaveCount(3);
    await v.locator('.letter-word').first().click();
    await expect(v.locator('.letter-word').first()).toHaveAttribute('aria-expanded', 'true');
    await expect(v.getByText(/17 new words over 4 study days/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    const s = await saved(page);
    expect(s.messages.letters).toHaveLength(1);
    expect(s.messages.letters[0]).toMatchObject({ month: '2026-10', read: true, stats: { days: 4, words: 17, mocks: 0 } });
    // Read: the card is gone, and opening the app again writes no second letter.
    await page.goto('./#/');
    await expect(view(page).locator('.letter-card')).toHaveCount(0);
    expect((await saved(page)).messages.letters).toHaveLength(1);
  });

  test('a month with no study brings no letter, and a quiet month gets a kind word', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-02T10:00:00'));
    await seed(page, base({ days: { '2026-09-10': studied(3) } }));
    await page.goto('./#/');
    await expect(view(page).locator('.plan, .today').first()).toBeVisible();
    expect((await saved(page)).messages.letters).toEqual([]);
    const lines = await page.evaluate(async () => (await import('./js/letters.js')).letterLines({ days: 2, words: 3, mocks: 0, picks: [] }, { hira: true, kata: false, chapters: 0, units: 0 }, null, null));
    expect(lines).toEqual(['open', 'wordsFew', 'busy', 'hiragana', 'close', 'sign']);
  });

  test('letters sync: one per month from both devices, and read on either counts as read (v15)', async ({ page }) => {
    await page.goto('./');
    const out = await page.evaluate(async () => {
      const { mergeProgress } = await import('./js/store.js');
      const L = (month, read, at) => ({ month, reg: 'casual', lines: ['open', 'close', 'sign'], words: [], stats: { days: 3, words: 4, mocks: 0 }, snap: {}, read, at });
      const a = { v: 15, messages: { thread: [], letters: [L('2026-10', false, 10)] } };
      const b = { v: 15, messages: { thread: [], letters: [L('2026-10', true, 20), L('2026-11', false, 30)] } };
      const m = mergeProgress(a, b);
      return { months: m.messages.letters.map((l) => [l.month, l.read, l.at]), old: mergeProgress({ v: 14 }, { v: 14 }).messages.letters };
    });
    expect(out.months).toEqual([['2026-10', true, 10], ['2026-11', false, 30]]);
    expect(out.old).toEqual([]);
  });
});

test.describe('Things I can do', () => {
  test('skills light from real evidence, stay lit, and suggest a refresh when the Garden says they slip', async ({ page }) => {
    await page.goto('./');
    const hira = await page.evaluate(async () => (await import('./js/dojo-data.js')).LESSONS.filter((l) => l.track === 'hiragana').map((l) => l.id));
    const keys = await page.evaluate(async () => (await import('./js/grammar-cards.js')).unitCardKeys('p0-1'));
    await page.evaluate(() => localStorage.clear());
    await page.goto('about:blank');
    const now = Date.parse('2026-10-29T10:00:00');
    const grammar = Object.fromEntries(keys.map((k, i) => [k, { due: now + 5e8, s: 8, d: 5, lr: now - 1e8, r: 3, pl: now - 1e9, lapses: i === 0 ? 4 : 0, help: i === 0, ok2: 0 }]));
    await page.clock.setFixedTime(new Date(now));
    await seed(page, base({ dojo: hira, course: { on: true, done: ['p0-1'], reached: ['p0-1', 'p0-2'], read: ['p0-1'], current: 'p0-2', tally: {} }, grammar }));
    await page.goto('./#/progress');
    const sec = view(page).locator('.cando');
    await expect(sec).toContainText('Things I can do');
    await expect(sec).toContainText('New since last time');
    await expect(sec.locator('.cd-row.lit')).toHaveCount(2);
    await sec.getByRole('link', { name: 'See every skill ›' }).click();
    await expect(page).toHaveURL(/#\/cando/);
    const v = view(page);
    await expect(v.locator('.cd-row.lit', { hasText: 'Read every hiragana' })).toBeVisible();
    const unit = v.locator('.cd-row.lit', { hasText: 'Greet people and say who you are.' });
    await expect(unit).toContainText('A quick refresh brings it back');
    await expect(v.locator('.cd-row', { hasText: 'Pass the JLPT N5' })).not.toHaveClass(/lit/);
    await v.getByRole('radio', { name: 'N4' }).click();
    await expect(v.getByText(/lit at N4/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    // Seen now: back on Progress, nothing is marked new.
    await page.goto('./#/progress');
    await expect(view(page).locator('.cando')).not.toContainText('New since last time');
  });
});

test.describe('Voice time capsule', () => {
  test('record a first take and a latest one, compare them with pitch lines, then delete them all', async ({ page }) => {
    await page.goto('./#/capsule');
    const v = view(page);
    await expect(v.getByRole('heading', { name: /Voice time capsule/ })).toBeVisible();
    await expect(v.locator('.cap-item')).toHaveCount(5);
    const first = v.locator('.cap-item').first();
    await first.getByRole('button', { name: 'Show the Japanese' }).click();
    await expect(first.locator('.cap-ja')).toContainText('おはよう');
    for (let i = 0; i < 2; i++) {
      await first.getByRole('button', { name: /Record/ }).click();
      await expect(first.getByRole('button', { name: 'Stop' })).toBeVisible();
      await page.waitForTimeout(900);
      await first.getByRole('button', { name: 'Stop' }).click();
      await expect(first.getByRole('button', { name: /First take/ })).toBeVisible();
    }
    await expect(first.getByRole('button', { name: /Latest/ })).toBeVisible();
    await expect(first.locator('.cap-chart')).toBeVisible();
    await expectNoHorizontalScroll(page);
    // Recordings never go into saved progress.
    expect(JSON.stringify(await saved(page))).not.toContain('capsule');
    await v.getByRole('button', { name: 'Delete my recordings' }).click();
    await v.getByRole('button', { name: 'Tap again to delete every recording' }).click();
    await expect(first.getByRole('button', { name: /First take/ })).toHaveCount(0);
  });
});

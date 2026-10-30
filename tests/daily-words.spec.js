// Today's words (#/words, js/daily-words.js + js/words-page.js) and the feed for the Scriptable home screen widget
// (widget/kotoba-widget.js), sent through the sync gist only when the learner turns it on.
import { test, expect, seed, view, expectNoHorizontalScroll } from './helpers.js';

/** Today's words as the chips show them, without the romaji or furigana reading help adds. */
const chipWords = (page) => view(page).locator('.word-chips button').evaluateAll((els) => els.map((el) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('rt').forEach((rt) => rt.remove());
  return c.textContent.trim();
}));

const SYNC_KEY = 'kotobaBeat.sync';
const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRS';
const FILE = 'kotoba-beat-progress.json';
const WIDGET = 'kotoba-beat-widget.json';
const H = 3_600_000;

/** A fake api.github.com holding one gist, with an owner (as the real API sends). */
async function mockGitHub(page, gist) {
  const server = { gist, requests: [] };
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    server.requests.push({ method: req.method(), path: url.pathname, body: req.postData() || '' });
    const view = () => ({ id: server.gist.id, owner: { login: 'rykoha' }, files: Object.fromEntries(Object.entries(server.gist.files).map(([n, f]) => [n, { filename: n, content: f.content, truncated: false }])) });
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.pathname === `/gists/${server.gist.id}` && req.method() === 'GET') return json(200, view());
    if (url.pathname === `/gists/${server.gist.id}` && req.method() === 'PATCH') {
      for (const [n, f] of Object.entries(JSON.parse(req.postData()).files)) {
        if (f === null) delete server.gist.files[n]; else server.gist.files[n] = f;
      }
      return json(200, view());
    }
    return json(404, { message: 'Not Found' });
  });
  return server;
}

test.describe("Today's words", () => {
  test('a beginner flips through ten deck words, recalling each meaning before it shows', async ({ page }) => {
    await page.goto('./');
    const card = view(page).locator('.words-today');
    await expect(card).toContainText("Today's words");
    await card.click();
    await expect(page).toHaveURL(/#\/words$/);
    await expect(page.locator('#title')).toHaveText("Today's words");
    await expect(view(page).locator('#word-count')).toHaveText('Word 1 of 10');
    await expect(view(page).locator('#word-en')).toHaveCount(0);
    await view(page).getByRole('button', { name: 'Show the meaning' }).click();
    await expect(view(page).locator('#word-en')).toBeVisible();
    await view(page).getByRole('button', { name: 'Next word' }).click();
    await expect(view(page).locator('#word-count')).toHaveText('Word 2 of 10');
    await expect(view(page).locator('#word-en')).toHaveCount(0);   // the next word starts hidden again
    await expect(page).toHaveURL(/#\/words\/2$/);
    await view(page).getByRole('button', { name: 'Previous word' }).click();
    await expect(view(page).locator('#word-count')).toHaveText('Word 1 of 10');
    await expectNoHorizontalScroll(page);
  });

  test('the widget link opens at its word, and the set stays the same all day', async ({ page }) => {
    await page.goto('./#/words/4');
    await expect(view(page).locator('#word-count')).toHaveText('Word 4 of 10');
    const first = await chipWords(page);
    await page.reload();
    expect(await chipWords(page)).toEqual(first);
    await view(page).locator('.word-chips button').nth(9).click();
    await expect(view(page).locator('#word-count')).toHaveText('Word 10 of 10');
    await view(page).getByRole('button', { name: 'Next word' }).click();
    await expect(view(page).locator('#word-count')).toHaveText('Word 1 of 10');   // round again
  });

  test('words that need help come first, then the Garden\'s words', async ({ page }) => {
    const now = Date.now();
    const item = (extra) => ({ level: 2, due: now + 48 * H, best: 0, r: 3, pl: now - 100 * H, s: 3, d: 5, lr: now - 24 * H, ...extra });
    await seed(page, { v: 5, items: { 'n5:人': item({ help: true }), 'n5:私': item({ due: now + 200 * H }), 'n5:水': item({ due: now + 5 * H }) } });
    await page.goto('./#/words');
    const chips = await chipWords(page);
    expect(chips[0]).toBe('人');
    expect(chips.indexOf('水')).toBeLessThan(chips.indexOf('私'));   // due sooner, shown sooner
    expect(chips).toHaveLength(10);
  });

  test('without sync, the copied script has no link and falls back to the N5 deck', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('./#/words');
    await expect(view(page).getByText('Sync across devices')).toBeVisible();
    await page.waitForTimeout(300);   // the script template loads
    await view(page).getByRole('button', { name: /Copy widget script/ }).click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("const FEED = \"\";");
    expect(text).toContain('const SITE = "http://localhost');
    expect(text).toContain('Script.setWidget');
  });

  test('with sync on, turning the widget on sends today\'s words to the gist, and off removes them', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const progress = JSON.stringify({ app: 'kotoba-beat', v: 5, data: { v: 5, items: {} } });
    const server = await mockGitHub(page, { id: 'abc123', files: { [FILE]: { content: progress } } });
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); localStorage.setItem(k, v); } },
      [SYNC_KEY, JSON.stringify({ token: TOKEN, gistId: 'abc123', lastSync: 0, note: '' })]);
    await page.goto('./#/words');
    await expect.poll(() => server.requests.length).toBeGreaterThan(0);
    expect(server.gist.files[WIDGET]).toBeUndefined();   // off by default

    await view(page).getByRole('switch', { name: /Send today's words/ }).check();
    await expect.poll(() => !!server.gist.files[WIDGET]).toBe(true);
    const feed = JSON.parse(server.gist.files[WIDGET].content);
    expect(feed.app).toBe('kotoba-beat-widget');
    expect(feed.words).toHaveLength(10);
    const shown = await chipWords(page);
    expect(feed.words.map((w) => w.jp)).toEqual(shown);
    expect(feed.words[0]).toEqual(expect.objectContaining({ jp: expect.any(String), kana: expect.any(String), romaji: expect.any(String), en: expect.any(String) }));
    // The token never goes into the widget's file.
    expect(server.gist.files[WIDGET].content).not.toContain('github_pat_');

    await expect(view(page).getByRole('button', { name: /Copy widget script/ })).toBeEnabled();
    await view(page).getByRole('button', { name: /Copy widget script/ }).click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain(`const FEED = "https://gist.githubusercontent.com/rykoha/abc123/raw/${WIDGET}";`);
    expect(text).not.toContain('github_pat_');

    // Syncing again the same day sends nothing new for the widget.
    const patches = () => server.requests.filter((r) => r.method === 'PATCH' && r.body.includes(WIDGET)).length;
    const before = patches();
    await page.goto('./#/settings');
    await view(page).getByRole('button', { name: /Sync now/ }).click();
    await expect(view(page).locator('#sync-last')).toContainText('Last synced:');
    expect(patches()).toBe(before);

    await page.goto('./#/words');
    await view(page).getByRole('switch', { name: /Send today's words/ }).uncheck();
    await expect.poll(() => !!server.gist.files[WIDGET]).toBe(false);
    await expectNoHorizontalScroll(page);
  });
});

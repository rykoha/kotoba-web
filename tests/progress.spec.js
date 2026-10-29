// Progress safety: saved progress from the current version loads with nothing lost, export/import round-trips,
// and everything survives a reload.
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, view, gradeGardenCard } from './helpers.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/progress-v1.json', import.meta.url), 'utf8'));
const FIXTURE_V2 = JSON.parse(readFileSync(new URL('./fixtures/progress-v2.json', import.meta.url), 'utf8'));
/** v4 adds the Story saga block (js/store.js migrateStory); older saves get it empty. */
const EMPTY_SAGA = { mined: [], seq: 0, quiz: {}, challenge: {} };

/** Every word, review date, chapter, kanji, lesson, setting and study day in `before` is still in `after`, unchanged. */
function expectNothingLost(before, after) {
  // v3 adds scheduler fields (s, d, lr) to each item; every field that was saved before stays exactly the same.
  expect(Object.keys(after.items).sort()).toEqual(Object.keys(before.items).sort());
  for (const [id, p] of Object.entries(before.items)) expect(after.items[id], id).toEqual(expect.objectContaining(p));
  expect(after.chapters).toEqual(before.chapters);
  expect(after.forged).toEqual(before.forged);
  expect(after.dojo).toEqual(before.dojo);
  expect(after.storyReplays).toEqual(before.storyReplays);
  expect(after.settings).toEqual(expect.objectContaining(before.settings));
  for (const [k, d] of Object.entries(before.days)) expect(after.days[k], `day ${k}`).toEqual(d);
  expect(after.lastSession).toBeGreaterThanOrEqual(before.lastSession);
}

test.describe('saved progress from the current version (v1)', () => {
  test('loads with nothing lost, and the app shows it', async ({ page }) => {
    await seed(page, FIXTURE);
    await page.goto('./');
    await expect(page.locator('#today-h')).toBeVisible();
    expectNothingLost(FIXTURE, await saved(page));

    // The app reads it back the same way.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#quiet-badge')).toBeVisible();
    await expect(page.locator('#slow-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(view(page).getByRole('radio', { name: /Short/ })).toHaveAttribute('aria-checked', 'true');
    await page.goto('./#/play/forge');
    await expect(view(page).getByText('Forged 2 of 12')).toBeVisible();
    await page.goto('./#/play/story');
    await expect(view(page).locator('[aria-label=cleared]')).toHaveCount(2);
    await page.goto('./#/settings');
    await expect(view(page).locator('#lat-val')).toHaveText('120 ms');

    // Using the app afterwards still keeps everything that was there.
    await page.goto('./#/play/duel');
    await view(page).locator('[data-act=choose]').first().click();
    const after = await saved(page);
    expect(Object.keys(after.items)).toEqual(expect.arrayContaining(Object.keys(FIXTURE.items)));
    expect(after.chapters).toEqual(FIXTURE.chapters);
    expect(after.settings).toEqual(expect.objectContaining(FIXTURE.settings));
  });

  test('migrating a v1 blob to the current version is lossless and adds the new settings (what import and load both use)', async ({ page }) => {
    await page.goto('./');
    const out = await page.evaluate(async (blob) => (await import('./js/store.js')).store.parseImport(JSON.stringify(blob)), FIXTURE);
    expectNothingLost(FIXTURE, out);
    expect(out.v).toBe(15);
    expect(out.saga).toEqual(EMPTY_SAGA);
    expect(out.settings).toEqual({ ...FIXTURE.settings, textSize: 'm', sfx: true, haptics: true, pace: 'normal', pronCheck: true, autoMic: false, voice: null, showAllLevels: false });
  });

  test('a v1 blob in storage is saved back as the current version with nothing lost', async ({ page }) => {
    await seed(page, FIXTURE);
    await page.goto('./');
    await expect(page.locator('#view')).not.toBeEmpty();
    const s = await saved(page);
    expect(s.v).toBe(15);
    expectNothingLost(FIXTURE, s);
    expect(s.settings).toEqual(expect.objectContaining({ textSize: 'm', sfx: true, haptics: true }));
  });

  test('an older blob missing newer settings keeps its progress and gets defaults', async ({ page }) => {
    const old = { v: 1, items: FIXTURE.items, lastSession: FIXTURE.lastSession, chapters: ['ch1'], forged: ['休'],
      settings: { latencyMs: 40, quiet: false, length: 'standard', theme: 'light', voice: 'clips' }, days: FIXTURE.days };
    await seed(page, old);
    await page.goto('./');
    await expect(page.locator('#today-h')).toBeVisible();
    const s = await saved(page);
    for (const [id, p] of Object.entries(FIXTURE.items)) expect(s.items[id]).toEqual(expect.objectContaining(p));
    expect(s.chapters).toEqual(['ch1']);
    expect(s.forged).toEqual(['休']);
    expect(s.dojo).toEqual([]);
    expect(s.settings).toEqual(expect.objectContaining({ latencyMs: 40, theme: 'light', readingHelp: 'auto', voiceSrc: 'auto', speed: 'normal' }));
  });

  test('corrupt saved data starts fresh instead of crashing', async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.setItem('kotobaBeat.v1', '{not json'); } });
    await page.goto('./');
    await expect(page.locator('#today-h')).toBeVisible();
  });
});

test.describe('saved progress from v2', () => {
  test('loads with nothing lost, including the v2 settings', async ({ page }) => {
    await seed(page, FIXTURE_V2);
    await page.goto('./');
    await expect(page.locator('#view')).not.toBeEmpty();
    const s = await saved(page);
    expectNothingLost(FIXTURE_V2, s);
    expect(s.v).toBe(15);   // migrated to the current version (engine.spec.js covers v3, story-saga.spec.js v4, garden-cards.spec.js v6, pron.spec.js v7, pitch-coach.spec.js v8, exam.spec.js v9, brush.spec.js v10, messages.spec.js v11, levels.spec.js v12, library.spec.js v13, sync.spec.js v14, motivation.spec.js v15)
    expectNothingLost(FIXTURE_V2, await page.evaluate(async (blob) => (await import('./js/store.js')).store.parseImport(JSON.stringify(blob)), FIXTURE_V2));
  });

  test('a v1 progress code still imports into this version', async ({ page }) => {
    await page.goto('./#/settings');
    const code = 'KOTOBA1:' + Buffer.from(JSON.stringify(FIXTURE)).toString('base64');
    await page.locator('#import-text').fill(code);
    await page.getByRole('button', { name: 'Import pasted' }).click();
    await page.getByRole('button', { name: 'Replace' }).click();
    expectNothingLost(FIXTURE, await saved(page));
  });
});

test.describe('export and import', () => {
  test('progress code: export on one device, import on another', async ({ page, browser }) => {
    await seed(page, FIXTURE);
    await page.goto('./#/settings');
    await view(page).getByRole('button', { name: /Copy code/ }).click();
    const code = await view(page).locator('textarea.code').inputValue();
    expect(code).toMatch(/^KOTOBA1:/);

    // A fresh device with no progress.
    const other = await browser.newContext({ serviceWorkers: 'block' });
    const p2 = await other.newPage();
    const errors = [];
    p2.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(new URL('#/settings', page.url()).href);
    await p2.locator('#import-text').fill(code);
    await p2.getByRole('button', { name: 'Import pasted' }).click();
    await expect(p2.getByText(/It has 8 plants, 2 chapters cleared and 2 kanji forged/)).toBeVisible();
    await p2.getByRole('button', { name: 'Replace' }).click();
    await expect(p2.locator('html')).toHaveAttribute('data-theme', 'dark');
    // The top bar picks up the imported settings straight away (it used to wait for the next screen change).
    await expect(p2.locator('#quiet-badge')).toBeVisible();
    await expect(p2.locator('#slow-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(p2.locator('#ruby-toggle')).toHaveAttribute('title', /Kana/);
    await expect(p2.getByRole('radio', { name: 'Furigana' })).toHaveAttribute('aria-checked', 'true');
    expectNothingLost(FIXTURE, await saved(p2));
    await p2.reload();
    expectNothingLost(FIXTURE, await saved(p2));
    expect(errors).toEqual([]);
    await other.close();
  });

  test('.json file: download, then pick it on another device', async ({ page, browser }, testInfo) => {
    await seed(page, FIXTURE);
    await page.goto('./#/settings');
    const [download] = await Promise.all([page.waitForEvent('download'), view(page).getByRole('button', { name: /Download .json/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^kotoba-beat-progress-\d{4}-\d{2}-\d{2}\.json$/);
    const file = testInfo.outputPath('progress.json');
    await download.saveAs(file);
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.app).toBe('kotoba-beat');

    const other = await browser.newContext({ serviceWorkers: 'block' });
    const p2 = await other.newPage();
    await p2.goto(new URL('#/settings', page.url()).href);
    await p2.locator('input[type=file]').setInputFiles(file);
    await p2.getByRole('button', { name: 'Replace' }).click();
    expectNothingLost(FIXTURE, await saved(p2));
    await other.close();
  });

  test('a broken code shows a friendly message and changes nothing', async ({ page }) => {
    await seed(page, FIXTURE);
    await page.goto('./#/settings');
    await page.locator('#import-text').fill('KOTOBA1:this-is-not-base64!!');
    await view(page).getByRole('button', { name: 'Import pasted' }).click();
    await expect(view(page).getByText(/could not be read/)).toBeVisible();
    await page.locator('#import-text').fill('{"hello": 1}');
    await view(page).getByRole('button', { name: 'Import pasted' }).click();
    await expect(view(page).getByText(/does not look like Kotoba Beat progress/)).toBeVisible();
    expectNothingLost(FIXTURE, await saved(page));
  });

  test('cancelling an import keeps the current progress', async ({ page }) => {
    await seed(page, FIXTURE);
    await page.goto('./#/settings');
    await page.locator('#import-text').fill(JSON.stringify({ v: 1, items: {} }));
    await view(page).getByRole('button', { name: 'Import pasted' }).click();
    await view(page).getByRole('button', { name: 'Cancel' }).click();
    expectNothingLost(FIXTURE, await saved(page));
  });
});

test.describe('reload persistence', () => {
  test('reviews, plan progress and settings survive a reload', async ({ page }) => {
    await page.goto('./#/play/garden');
    await view(page).getByRole('button', { name: /Water \d+ plant/ }).click();
    await gradeGardenCard(view(page));
    await page.goto('./#/');
    await view(page).locator('.block-row').nth(1).getByRole('button', { name: 'Skip' }).click();
    await page.goto('./#/settings');
    await view(page).getByRole('radio', { name: 'Dark' }).click();
    await view(page).getByRole('radio', { name: 'Furigana' }).click();
    const before = await saved(page);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const after = await saved(page);
    expect(after.items).toEqual(before.items);
    expect(after.days).toEqual(before.days);
    expect(after.settings).toEqual(before.settings);
    expect(after.settings.readingHelp).toBe('kana');
    await page.goto('./#/');
    await expect(view(page).locator('.block-row').nth(1)).toHaveClass(/skipped/);
    expect(Object.values(after.items).filter((p) => p.level >= 2)).toHaveLength(0);   // one plant, at level 1
  });

  test('reset needs two taps and keeps settings', async ({ page }) => {
    await seed(page, FIXTURE);
    await page.goto('./#/settings');
    await view(page).getByRole('button', { name: 'Reset all progress' }).click();
    expect((await saved(page)).chapters).toEqual(FIXTURE.chapters);
    await view(page).getByRole('button', { name: /Tap again to erase/ }).click();
    const s = await saved(page);
    expect(s.items).toEqual({});
    expect(s.chapters).toEqual([]);
    expect(s.settings).toEqual(expect.objectContaining(FIXTURE.settings));
  });
});

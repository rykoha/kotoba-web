// The service worker registers, precaches the app and the voice clips, and the site works with no network.
import { readFileSync } from 'node:fs';
import { test, expect, view } from './helpers.js';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const CACHE_VERSION = /const CACHE_VERSION = '([^']+)'/.exec(SW)[1];
const FILE_COUNT = [.../const FILES = \[([\s\S]*?)\];/.exec(SW)[1].matchAll(/'([^']+)'/g)].length;

test.use({ serviceWorkers: 'allow' });

test('service worker registers, precaches everything and the app works offline', async ({ page, context }) => {
  test.setTimeout(300_000);   // the install caches every file, ~4,700 with the N5 deck's clips
  await page.goto('./');
  await expect(page.locator('#today-h')).toBeVisible();
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/kotoba-web\/$/);

  // Wait for the install to finish caching every file, then for the worker to take control.
  await expect.poll(async () => page.evaluate(async (v) => {
    if (!(await caches.has(v))) return 0;
    return (await (await caches.open(v)).keys()).length;
  }, CACHE_VERSION), { timeout: 270_000, intervals: [1000] }).toBeGreaterThanOrEqual(FILE_COUNT);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#today-h')).toBeVisible();
  await page.goto('./#/modes');
  await expect(view(page).locator('.mode-card')).toHaveCount(22);

  // Modes and screens load from the cache.
  for (const [hash, title] of [['#/play/garden', 'Garden'], ['#/play/dojo', 'Reading Dojo'], ['#/play/meet', 'Encounters'], ['#/check', 'Sound & mic check'], ['#/settings', 'Settings']]) {
    await page.goto('./' + hash);
    await expect(page.locator('#title')).toHaveText(title);
  }
  // Settings says the voice clips are all saved for offline use.
  await expect(page.locator('#offline-status')).toContainText('Offline: ready.');
  // …and which version is installed.
  const version = (await (await context.request.get('./sw.js')).text()).match(/kotoba-beat-v(\d+)/)[1];
  await expect(page.locator('#app-version')).toContainText(`Version ${version}.`);

  // A voice clip is served from the cache, whole and as a byte range (Safari asks for ranges).
  const clip = await page.evaluate(async () => {
    const { CLIPS } = await import('./js/clips.js');
    const file = 'audio/' + Object.values(CLIPS)[0];
    const whole = await fetch(file);
    const part = await fetch(file, { headers: { Range: 'bytes=0-99' } });
    return { status: whole.status, size: (await whole.arrayBuffer()).byteLength, partStatus: part.status, partSize: (await part.arrayBuffer()).byteLength };
  });
  expect(clip.status).toBe(200);
  expect(clip.size).toBeGreaterThan(100);
  expect(clip.partStatus).toBe(206);
  expect(clip.partSize).toBe(100);

  // A deep link opened for the first time while offline falls back to the cached app shell.
  await page.goto('./index.html?from=homescreen#/play/forge');
  await expect(page.locator('#title')).toHaveText('Kanji Forge');
  await context.setOffline(false);
});

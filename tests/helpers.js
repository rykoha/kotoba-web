// Shared test helpers: a `test` that fails on any console error, plus progress seeding and layout checks.
import { test as base, expect } from '@playwright/test';

export { expect };

export const STORAGE_KEY = 'kotobaBeat.v1';

/**
 * Every test fails if the page logs a console error or throws an uncaught exception.
 * Tests that expect an error on purpose can push a RegExp onto `allowErrors`.
 */
export const test = base.extend({
  allowErrors: [async ({}, use) => { await use([]); }, { scope: 'test' }],
  consoleErrors: [async ({ page, allowErrors }, use) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`); });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    await use(errors);
    const real = errors.filter((e) => !allowErrors.some((re) => re.test(e)));
    expect(real, 'console errors').toEqual([]);
  }, { auto: true }],
});

/** Puts `state` in localStorage before the app boots, once per tab (so reloads keep what the app saved). */
export async function seed(page, state) {
  await page.addInitScript(([key, json]) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem(key, json);
  }, [STORAGE_KEY, JSON.stringify(state)]);
}

/** Reads the saved progress straight from localStorage. */
export async function saved(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), STORAGE_KEY);
}

/** A progress state where every Reading Dojo lesson is cleared (so the daily plan shows its full shape). */
export async function readerState(page, extra = {}) {
  await page.goto('./');
  const lessons = await page.evaluate(async () => (await import('./js/dojo-data.js')).ALL_LESSONS.map((l) => l.id));
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');   // so the next goto is a fresh page load (seed() runs on load)
  return {
    v: 1, items: {}, lastSession: null, chapters: [], forged: [], dojo: lessons, storyReplays: {},
    settings: { latencyMs: 0, quiet: false, length: 'standard', hideIosHint: true, theme: 'auto', readingHelp: 'auto', voiceSrc: 'auto', speed: 'normal' },
    days: {},
    ...extra,
  };
}

export async function expectNoHorizontalScroll(page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `page is ${sw}px wide in a ${cw}px viewport`).toBeLessThanOrEqual(cw);
}

/** Text of an element without the romaji/furigana that reading help adds in <rt> tags. */
export async function plainText(locator) {
  return locator.evaluate((el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('rt').forEach((rt) => rt.remove());
    return c.textContent.trim();
  });
}

/** The app's main view, where each screen renders. */
export const view = (page) => page.locator('#view');


/** A first read of a story scene starts with its new words; skip them to reach the story lines. */
export async function pastWords(v) {
  await expect(v.locator('.line-jp, [data-act=prestart]').first()).toBeVisible();
  const skip = v.locator('[data-act=prestart]');
  if (await skip.count()) await skip.first().click();
  await expect(v.locator('.line-jp')).toBeVisible();
}

/**
 * Answers the Garden word card on screen: a new word (shown to study) takes "Got it"; any other card is checked and
 * graded Knew it / Forgot.
 */
export async function gradeGardenCard(v, ok = true) {
  const got = v.getByRole('button', { name: /Got it/ });
  await expect(v.locator('[data-act=check], [data-act=knew]').first()).toBeVisible();
  if (await got.count()) { await got.click(); return 'new'; }
  await v.locator('[data-act=check]').click();
  await v.getByRole('button', { name: ok ? /Knew it/ : /Forgot/ }).click();
  return 'review';
}

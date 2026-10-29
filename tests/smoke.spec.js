// Home, settings and the sound & mic check load cleanly at phone and desktop size.
import { test, expect, expectNoHorizontalScroll, view } from './helpers.js';

test('home leads with Today and its next step', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#today-h')).toHaveText('Today');
  await expect(view(page).locator('.hero').getByRole('link', { name: /Start: Reading Dojo/ })).toBeVisible();
  await expect(view(page).locator('.block-row').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('the Modes screen lists every mode', async ({ page }) => {
  await page.goto('./#/modes');
  await expect(view(page).locator('.mode-card')).toHaveCount(22);
  await expectNoHorizontalScroll(page);
});

for (const hash of ['#/', '#/modes', '#/garden', '#/progress', '#/settings']) {
  test(`${hash} is a top-level screen with no horizontal scroll`, async ({ page }) => {
    await page.goto('./' + hash);
    await expect(page.locator('#tabs [aria-current=page]')).toHaveCount(1);
    await expect(page.locator('#back')).toBeHidden();
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page);
  });
}

for (const hash of ['#/check', '#/play/dojo', '#/play/garden', '#/play/story', '#/play/particle',
  '#/play/forge', '#/play/rhythm', '#/play/duel', '#/play/slice', '#/play/shop', '#/play/library', '#/play/walk', '#/play/type', '#/play/dictation']) {
  test(`${hash} has a back button and no horizontal scroll`, async ({ page }) => {
    await page.goto('./' + hash);
    await expect(page.locator('#back')).toBeVisible();
    await page.waitForTimeout(400);
    await expectNoHorizontalScroll(page);
  });
}

test('the sound & mic check screen offers all three tests', async ({ page }) => {
  await page.goto('./#/check');
  await expect(page.locator('#title')).toHaveText('Sound & mic check');
  const v = view(page);
  await expect(v.getByRole('heading', { name: /Can you hear it/ })).toBeVisible();
  await expect(v.getByRole('heading', { name: /Does the mic hear you/ })).toBeVisible();
  await expect(v.getByRole('heading', { name: /understand Japanese/ })).toBeVisible();
  await v.getByRole('button', { name: /Built-in voice/ }).click();
  await expect(v.getByText(/Played with: built-in voice clip/)).toBeVisible();
  await v.getByRole('button', { name: /I heard it/ }).click();
  await expect(v.getByText('Sound works.', { exact: false })).toBeVisible();
  await v.getByRole('link', { name: 'Open Settings' }).click();
  await expect(page.locator('#title')).toHaveText('Settings');
});

test('back button returns home from any screen', async ({ page }) => {
  await page.goto('./#/play/forge');
  await page.locator('#back').click();
  await expect(page.locator('#today-h')).toBeVisible();
  await expect(page.locator('#back')).toBeHidden();
});

test('settings keep the VOICEVOX, JMdict and Open JTalk credits', async ({ page }) => {
  await page.goto('./#/settings');
  for (const name of ['四国めたん', '白上虎太郎', '青山龍星', '玄野武宏', '東北イタコ', 'ずんだもん', '春日部つむぎ', '東北ずん子', '剣崎雌雄']) {
    await expect(view(page).getByText(`VOICEVOX:${name}`, { exact: false })).toBeVisible();
  }
  await expect(view(page).getByText('JMdict, © EDRDG, CC BY-SA 4.0', { exact: false })).toBeVisible();
  await expect(view(page).getByText('Open JTalk', { exact: false })).toBeVisible();
});

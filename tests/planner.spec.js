// Test date planner (js/planner.js): JLPT sittings, the plan's sums, and the #/plan screen, Today card and Progress link.
import { test, expect, seed, saved, view, expectNoHorizontalScroll } from './helpers.js';

const NOW = '2026-10-29T10:00:00';
const fresh = { v: 14, items: {}, chapters: [], forged: [], dojo: [], storyReplays: {}, days: {}, settings: { hideIosHint: true, readingHelp: 'off' } };
const withGoal = (goal) => ({ ...fresh, exam: { history: [], real: {}, seen: [], later: {}, goal: { from: '2026-10-29', at: Date.parse(NOW), days: 5, ...goal } } });

async function open(page, state, hash = '#/plan') {
  await page.clock.setFixedTime(new Date(NOW));
  await seed(page, state);
  await page.goto('./' + hash);
}

test.describe('Test date planner', () => {
  test('JLPT sittings are the first Sundays of July and December', async ({ page }) => {
    await page.goto('./');
    const out = await page.evaluate(async () => {
      const p = await import('./js/planner.js');
      return p.nextSittings(new Date(2026, 9, 29), 3).map((d) => p.longDate(d));
    });
    expect(out).toEqual(['Sun 6 Dec 2026', 'Sun 4 Jul 2027', 'Sun 5 Dec 2027']);
  });

  test('a fresh learner aiming for N5 in July 2027 gets Standard days, with a review stretch and checkpoints', async ({ page }) => {
    await open(page, fresh);
    const v = view(page);
    await expect(v.getByRole('heading', { name: /Set a test goal/ })).toBeVisible();
    await v.getByRole('radio', { name: 'Sun 4 Jul 2027' }).click();
    await expect(v.getByText(/248\s*days until Sun 4 Jul 2027/)).toBeVisible();
    await expect(v.getByText(/Standard days \(about 20 minutes\), 5 days a week/)).toBeVisible();
    await expect(v.getByText(/515 new words/).first()).toBeVisible();
    await expect(v.getByText(/New material ends Sun 13 Jun 2027/)).toBeVisible();
    await expect(v.locator('.plan-checks li')).toHaveCount(3);
    await expectNoHorizontalScroll(page);
    await v.getByRole('button', { name: 'Save this plan' }).click();
    await expect(v.getByRole('button', { name: 'Change the goal' })).toBeVisible();
    const s = await saved(page);
    expect(s.exam.goal).toMatchObject({ level: 'N5', date: '2027-07-04', days: 5, from: '2026-10-29' });
    // Today shows the plan card.
    await page.goto('./#/');
    const card = view(page).locator('.plan-card');
    await expect(card).toContainText('N5 test plan');
    await expect(card).toContainText('248 days to go');
    await expect(card).toContainText('0/');
    await expectNoHorizontalScroll(page);
  });

  test('a date too soon for the Garden\'s pace is a stretch, and offers the next sitting that fits', async ({ page }) => {
    await open(page, fresh);
    const v = view(page);
    await v.getByRole('radio', { name: 'Sun 6 Dec 2026' }).click();
    await expect(v.getByText('This date is a stretch.')).toBeVisible();
    await v.getByRole('button', { name: 'Aim for Sun 4 Jul 2027 instead' }).click();
    await expect(v.getByRole('radio', { name: 'Sun 4 Jul 2027' })).toHaveAttribute('aria-checked', 'true');
    await expect(v.getByText('This date is a stretch.')).toHaveCount(0);
  });

  test('fewer study days a week move the plan up to longer sessions; a custom date works', async ({ page }) => {
    await open(page, fresh);
    const v = view(page);
    await v.locator('[data-field=date]').fill('2027-12-05');
    await v.locator('[data-field=date]').dispatchEvent('change');
    await expect(v.getByText(/Short days \(about 10 minutes\), 5 days a week/)).toBeVisible();
    await v.getByRole('radio', { name: '3', exact: true }).click();
    await expect(v.getByText(/Standard days \(about 20 minutes\), 3 days a week: about 1 hr a week/)).toBeVisible();
  });

  test('close to the test the plan is review and a full mock', async ({ page }) => {
    await open(page, withGoal({ level: 'N5', date: '2026-11-15' }));
    const v = view(page);
    await expect(v.getByText(/too close for new material to settle/)).toBeVisible();
    await page.goto('./#/');
    await expect(view(page).locator('.plan-card')).toContainText('keep to review now');
  });

  test('after the test day: mark a pass, which finishes N5 and removes the goal', async ({ page }) => {
    await open(page, withGoal({ level: 'N5', date: '2026-10-20', from: '2026-06-01' }));
    const v = view(page);
    await v.getByRole('button', { name: 'I passed the N5' }).click();
    await expect(page).toHaveURL(/#\/progress/);
    const s = await saved(page);
    expect(s.exam.real.N5.on).toBe(true);
    expect(s.exam.goal.level).toBe(null);
  });

  test('Progress links to the planner, and removing the goal goes back to the form', async ({ page }) => {
    await open(page, withGoal({ level: 'N5', date: '2027-07-04' }), '#/progress');
    await view(page).getByRole('link', { name: /Your N5 test plan/ }).click();
    await expect(page).toHaveURL(/#\/plan/);
    await view(page).getByRole('button', { name: 'Remove the goal' }).click();
    await expect(view(page).getByRole('heading', { name: /Set a test goal/ })).toBeVisible();
    expect((await saved(page)).exam.goal.level).toBe(null);
  });
});

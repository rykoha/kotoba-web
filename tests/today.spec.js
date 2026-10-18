// The guided "Today" plan: its shape for every weekday, Short and Quiet sessions, beginners, and running its blocks.
import { test, expect, seed, saved, readerState, view, gradeGardenCard } from './helpers.js';

// Two weeks from Monday 5 October 2026: an A week, then a B week (the skill block alternates between them).
// Speaking rotates Speak Slice, Sentence Builder, Rhythm day by day; Quiet mode swaps in a listening mode instead
// (Listening Lab, Numbers & Time, Pitch Duel), never the same as the day's skill block.
// skill: the plan with the course off. courseSkill: with the course on (the default) and its first unit current,
// which has Particle Train practice but no Shopkeeper practice, so Particle Train and Shopkeeper days practise the
// unit's trains (unitPractice).
const WEEK = [
  { day: 'Monday A', date: '2026-10-05', speak: 'Speak Slice', quiet: 'Listening Lab', skill: 'Particle Train', courseSkill: 'Particle Train', unitPractice: true },
  { day: 'Tuesday A', date: '2026-10-06', speak: 'Sentence Builder', quiet: 'Numbers & Time', skill: 'Pitch Duel', courseSkill: 'Pitch Duel' },
  { day: 'Wednesday A', date: '2026-10-07', speak: 'Rhythm', quiet: 'Pitch Duel', skill: 'Kanji Forge', courseSkill: 'Kanji Forge' },
  { day: 'Thursday A', date: '2026-10-08', speak: 'Speak Slice', quiet: 'Listening Lab', skill: 'Shopkeeper', courseSkill: 'Particle Train', unitPractice: true },
  { day: 'Friday A', date: '2026-10-09', speak: 'Sentence Builder', quiet: 'Numbers & Time', skill: 'Listening Lab', courseSkill: 'Listening Lab' },
  { day: 'Saturday A', date: '2026-10-10', speak: 'Rhythm', quiet: 'Pitch Duel', skill: 'Free choice', courseSkill: 'Free choice' },
  { day: 'Sunday A', date: '2026-10-11', speak: 'Speak Slice', quiet: 'Listening Lab', skill: null, courseSkill: null },
  { day: 'Monday B', date: '2026-10-12', speak: 'Sentence Builder', quiet: 'Numbers & Time', skill: 'Conjugation Dojo', courseSkill: 'Conjugation Dojo' },
  { day: 'Tuesday B', date: '2026-10-13', speak: 'Rhythm', quiet: 'Pitch Duel', skill: 'Listening Lab', courseSkill: 'Listening Lab' },
  { day: 'Wednesday B', date: '2026-10-14', speak: 'Speak Slice', quiet: 'Listening Lab', skill: 'Katakana Rush', courseSkill: 'Katakana Rush' },
  { day: 'Thursday B', date: '2026-10-15', speak: 'Sentence Builder', quiet: 'Pitch Duel', skill: 'Numbers & Time', courseSkill: 'Numbers & Time' },
  { day: 'Friday B', date: '2026-10-16', speak: 'Rhythm', quiet: 'Listening Lab', skill: 'Pitch Duel', courseSkill: 'Pitch Duel' },
  { day: 'Saturday B', date: '2026-10-17', speak: 'Speak Slice', quiet: 'Listening Lab', skill: 'Free choice', courseSkill: 'Free choice' },
  { day: 'Sunday B', date: '2026-10-18', speak: 'Sentence Builder', quiet: 'Numbers & Time', skill: null, courseSkill: null },
];
/** With the course on, the Input block is the current unit's lesson (the first unit for a new course). */
const LESSON = 'Lesson · Say hello and introduce yourself';
const COURSE_OFF = { course: { on: false } };

const blockTitles = (page) => view(page).locator('.block-row .strong').allInnerTexts();

async function openHomeOn(page, date, extra) {
  const state = await readerState(page, extra);
  await page.clock.setFixedTime(new Date(`${date}T10:00:00`));
  await seed(page, state);
  await page.goto('./#/');
  await expect(view(page).locator('.block-row').first()).toBeVisible();
}

test.describe('Today plan (reader who finished the Dojo)', () => {
  for (const w of WEEK) {
    test(`${w.day}: standard session following the course`, async ({ page }) => {
      await openHomeOn(page, w.date);
      const want = ['Garden review', LESSON, `Speaking · ${w.speak}`];
      if (w.courseSkill) want.push(`Skill focus · ${w.courseSkill}`);
      expect(await blockTitles(page)).toEqual(want);
      if (w.unitPractice) {
        await expect(view(page).locator('.block-row', { hasText: 'Skill focus' })).toContainText('Unit 0.1 practice');
      }
      const sundayNote = view(page).getByText('Sunday: review only.', { exact: false });
      if (w.day.startsWith('Sunday')) await expect(sundayNote).toBeVisible(); else await expect(sundayNote).toHaveCount(0);
    });

    test(`${w.day}: standard session with the course off`, async ({ page }) => {
      await openHomeOn(page, w.date, COURSE_OFF);
      const want = ['Garden review', 'Story', `Speaking · ${w.speak}`];
      if (w.skill) want.push(`Skill focus · ${w.skill}`);
      expect(await blockTitles(page)).toEqual(want);
      const sundayNote = view(page).getByText('Sunday: review only.', { exact: false });
      if (w.day.startsWith('Sunday')) await expect(sundayNote).toBeVisible(); else await expect(sundayNote).toHaveCount(0);
    });

    test(`${w.day}: quiet mode swaps speaking for listening`, async ({ page }) => {
      await openHomeOn(page, w.date, { settings: { quiet: true, hideIosHint: true } });
      const titles = await blockTitles(page);
      expect(titles[2]).toBe(`Speaking · ${w.quiet}`);
      expect(titles.join()).not.toMatch(/Rhythm|Speak Slice|Sentence Builder/);
      if (w.courseSkill) expect(titles[3]).toBe(`Skill focus · ${w.courseSkill}`);
      await expect(page.locator('#quiet-badge')).toBeVisible();
    });

    test(`${w.day}: short session is review and input only`, async ({ page }) => {
      await openHomeOn(page, w.date, { settings: { length: 'short', hideIosHint: true } });
      expect(await blockTitles(page)).toEqual(['Garden review', LESSON]);
      await expect(view(page).getByRole('radio', { name: /Short/ })).toHaveAttribute('aria-checked', 'true');
    });
  }

  test('over two weeks every practice mode gets a block, and every skill area is covered', async ({ page }) => {
    // The rotation itself, with the course off (with it on, unit practice replaces some skill days).
    await openHomeOn(page, '2026-10-05', COURSE_OFF);
    const modes = await page.evaluate(async () => {
      const { todayPlan } = await import('./js/today.js');
      const out = new Set();
      for (let d = 5; d <= 18; d++) for (const b of todayPlan(new Date(2026, 9, d)).blocks) if (b.mode) out.add(b.mode);
      return [...out].sort();
    });
    expect(modes).toEqual(['build', 'conj', 'duel', 'forge', 'garden', 'kata', 'listen', 'numbers', 'particle', 'rhythm', 'shop', 'slice', 'story'].sort());
  });

  test('Saturday free choice opens a mode picker that runs inside the plan', async ({ page }) => {
    await openHomeOn(page, '2026-10-10');
    await view(page).locator('.block-row', { hasText: 'Free choice' }).getByRole('link', { name: 'Start' }).click();
    await expect(page.locator('#title')).toHaveText('Free choice');
    await view(page).locator('.mode-card', { hasText: 'Pitch Duel' }).click();
    await expect(page.locator('#title')).toHaveText('Pitch Duel');
    await expect(page.locator('#banner')).toContainText('Today · block 4');
    await page.locator('#banner').getByRole('button', { name: /Done/ }).click();
    await expect(view(page).locator('.block-row.done', { hasText: 'Free choice' })).toBeVisible();
  });

  test('Session length switch on the home screen', async ({ page }) => {
    await openHomeOn(page, '2026-10-05');
    await view(page).getByRole('radio', { name: /Short/ }).click();
    expect(await blockTitles(page)).toEqual(['Garden review', LESSON]);
    await view(page).getByRole('radio', { name: /Standard/ }).click();
    expect(await blockTitles(page)).toHaveLength(4);
    expect((await saved(page)).settings.length).toBe('standard');
  });

  test('Quiet switch on the home screen', async ({ page }) => {
    await openHomeOn(page, '2026-10-05');
    await view(page).getByRole('switch').check();
    expect((await blockTitles(page))[2]).toBe('Speaking · Listening Lab');
    expect((await saved(page)).settings.quiet).toBe(true);
  });
});

test.describe('Today plan (beginner)', () => {
  test('a new learner starts with the Reading Dojo and no skill block', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T10:00:00'));
    await page.goto('./#/');
    expect(await blockTitles(page)).toEqual(['Reading Dojo', 'Garden review', LESSON, 'Speaking · Speak Slice']);
    await expect(view(page).locator('.block-row').getByText(/Next lesson: Hiragana/)).toBeVisible();
  });

  test('a beginner\'s short session is reading and review', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T10:00:00'));
    await seed(page, { items: {}, settings: { length: 'short' } });
    await page.goto('./#/');
    expect(await blockTitles(page)).toEqual(['Reading Dojo', 'Garden review']);
  });
});

test.describe('running the plan', () => {
  test('every block of a standard day can be started, and the day finishes with a summary', async ({ page }) => {
    test.setTimeout(60_000);
    await openHomeOn(page, '2026-10-07');   // Wednesday: Garden, the course lesson, Rhythm, Kanji Forge
    const n = (await blockTitles(page)).length;
    for (let i = 0; i < n; i++) {
      const row = view(page).locator('.block-row').nth(i);
      await row.getByRole('link', { name: 'Start' }).click();
      await expect(page.locator('#banner')).toContainText(`block ${i + 1}`);
      await expect(page.locator('#back')).toBeVisible();
      const done = page.locator('#banner').getByRole('button', { name: /Done/ });
      if (await done.isVisible()) await done.click();
      else await page.locator('#banner').getByRole('link', { name: 'Back to Today' }).click();
      await expect(view(page).locator('.block-row').nth(i)).toHaveClass(/done/);
    }
    await expect(view(page).getByText("Today's done", { exact: false })).toBeVisible();
    const s = await saved(page);
    expect(s.days['2026-10-07'].blocks).toEqual({ garden: 'done', input: 'done', speak: 'done', skill: 'done' });
    expect(s.days['2026-10-07'].studied).toBe(true);
  });

  test('skipping a block is remembered, and it can still be done', async ({ page }) => {
    await openHomeOn(page, '2026-10-07');
    const row = () => view(page).locator('.block-row').nth(1);
    await row().getByRole('button', { name: 'Skip' }).click();
    await expect(row()).toHaveClass(/skipped/);
    await expect(row().getByRole('link', { name: 'Do it' })).toBeVisible();
    expect((await saved(page)).days['2026-10-07'].blocks.input).toBe('skipped');
  });

  test('the Garden block finishes itself after watering today\'s plants', async ({ page }) => {
    await openHomeOn(page, '2026-10-07');
    await view(page).locator('.block-row', { hasText: 'Garden review' }).getByRole('link', { name: 'Start' }).click();
    const v = view(page);
    for (let i = 0; i < 25; i++) {
      if (await page.locator('#banner .banner.done').isVisible()) break;
      await gradeGardenCard(v);
    }
    await expect(page.locator('#banner')).toContainText('Block 1 done');
    expect((await saved(page)).days['2026-10-07'].rev).toBe(5);   // 5 new words a day
  });
});

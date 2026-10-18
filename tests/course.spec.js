// The guided course: the path, a unit, playing examples, the grammar reference, Today drawing from the current unit,
// unit completion from practice, and the saved course field (migration and round-trip).
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, readerState, view, expectNoHorizontalScroll, pastWords } from './helpers.js';

const FIXTURE_V1 = JSON.parse(readFileSync(new URL('./fixtures/progress-v1.json', import.meta.url), 'utf8'));
const FIXTURE_V2 = JSON.parse(readFileSync(new URL('./fixtures/progress-v2.json', import.meta.url), 'utf8'));
const FIXTURE_COURSE = JSON.parse(readFileSync(new URL('./fixtures/progress-course.json', import.meta.url), 'utf8'));
const DEFAULT_COURSE = { on: true, current: null, reached: [], done: [], read: [], tally: {} };

/** A reader (Reading Dojo done) on `date` with the given course state. */
async function openAt(page, date, course, extra = {}) {
  const state = await readerState(page, { course, ...extra });
  await page.clock.setFixedTime(new Date(`${date}T10:00:00`));
  await seed(page, state);
}

/** Wait for the screen-change slide to finish (it briefly pokes past the edge). */
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))));

const blockTitles = (page) => view(page).locator('.block-row .strong').allInnerTexts();

test.describe('course path and units', () => {
  test('the path shows every phase, the current unit, and Phases 2-3 (N4, N3) locked until N5 is done', async ({ page }) => {
    await page.goto('./#/course');
    await expect(page.locator('#title')).toHaveText('Course');
    const v = view(page);
    await expect(v.locator('.section-label')).toHaveText(['PHASE 0 · RE-ENTRY', 'PHASE 1 · N5 CORE', 'PHASE 2 · N4 BRIDGE', 'PHASE 3 · N3 INTERMEDIATE']);
    await expect(v.locator('a.unit-row')).toHaveCount(12);
    await expect(v.locator('.unit-row.locked')).toHaveCount(29);
    await expect(v.getByText('Unlocks when you pass a full mock N5, or mark the real N5 as passed.')).toBeVisible();
    const current = v.locator('.unit-row[aria-current=step]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText('Say hello and introduce yourself');
    await expect(v.locator('.course-now')).toContainText('Unit 0.1');
    await settle(page);
    await expectNoHorizontalScroll(page);
    // Browsing ahead is always allowed.
    await v.locator('a.unit-row', { hasText: 'Order food' }).click();
    await expect(page.locator('#title')).toHaveText('Unit 1.4');
    await settle(page);
    await expectNoHorizontalScroll(page);
  });

  test('done units are ticked and the chosen current unit is highlighted', async ({ page }) => {
    await seed(page, FIXTURE_COURSE);
    await page.goto('./#/course');
    const v = view(page);
    await expect(v.locator('.unit-row.cleared')).toHaveCount(4);
    await expect(v.locator('.unit-row[aria-current=step]')).toContainText('Order food');
    await expect(v.locator('.unit-row.cleared', { hasText: 'Say hello' }).locator('.ch-num .ico-check')).toHaveCount(1);
  });

  test('a unit shows its goal, grammar with examples, pitch melodies and tagged practice', async ({ page }) => {
    await page.goto('./#/course/p1-3');
    const v = view(page);
    await expect(v.locator('h2.section-title')).toHaveText("Say where you're going and how");
    await expect(v.getByText('Goal:', { exact: false })).toBeVisible();
    await expect(v.locator('.gp')).toHaveCount(4);
    const examples = await v.locator('.ex-row').count();
    expect(examples).toBeGreaterThanOrEqual(4);
    expect(examples).toBeLessThanOrEqual(6);
    await expect(v.locator('.ex-reading').first()).toHaveText('どうじょうに いきます。');
    await expect(v.locator('.practice-card')).toHaveCount(3);
    await expect(v.locator('.practice-card[data-mode=particle]')).toContainText('I go to the dojo.');
    // Key words from the N5 deck, with pitch from its accents: 行く (いく) is flat, 駅 (えき) drops after the first mora.
    await expect(v.locator('.word-item')).toHaveCount(8);
    await expect(v.locator('.word-item', { hasText: 'to go' }).first()).toContainText('flat (heiban)');
    await expect(v.locator('.word-item', { hasText: 'station' })).toContainText('high first');
    await v.locator('.word-item', { hasText: 'station' }).click();
    await expect(v.locator('[data-act=phrase]')).toHaveCount(2);
    await settle(page);
    await expectNoHorizontalScroll(page);

    await v.getByRole('button', { name: 'Make this my current unit' }).click();
    const s = await saved(page);
    expect(s.course.current).toBe('p1-3');
    expect(s.course.reached).toContain('p1-3');
    await expect(v.getByRole('button', { name: 'Make this my current unit' })).toHaveCount(0);
  });

  test('every unit has 3-5 grammar points, examples with readings, and practice (Phase 0-1: 4-6 examples; N4 and N3: a grammar card per point)', async ({ page }) => {
    await page.goto('./');
    const report = await page.evaluate(async () => {
      const { STUDY_UNITS, UNITS } = await import('./js/course-data.js');
      const { practiceList } = await import('./js/course.js');
      const { unitCardKeys } = await import('./js/grammar-cards.js');
      return { total: UNITS.length, units: STUDY_UNITS.map((u) => ({
        id: u.id, n4: u.level === 'N4' || u.level === 'N3', points: u.points.length, examples: u.points.reduce((a, p) => a + p.examples.length, 0),
        readings: u.points.every((p) => p.examples.every((e) => /^[ぁ-ゖー\s、。！？「」…]+$/.test(e.reading) && [0, 1, 2, 3, 4, 5].includes(e.voice))),
        practice: practiceList(u).length, cards: unitCardKeys(u.id).length,
      })) };
    });
    expect(report.units).toHaveLength(41);
    for (const u of report.units.filter((x) => x.n4)) {
      expect(u.points, u.id).toBeGreaterThanOrEqual(3);
      expect(u.points, u.id).toBeLessThanOrEqual(5);
      expect(u.readings, u.id).toBe(true);
      expect(u.cards, u.id).toBe(u.points);   // every N4 and N3 point has a sentence to blank
      expect(u.practice, u.id).toBeGreaterThanOrEqual(1);   // its trains
    }
    for (const u of report.units.filter((x) => !x.n4)) {
      expect(u.points, u.id).toBeGreaterThanOrEqual(3);
      expect(u.points, u.id).toBeLessThanOrEqual(5);
      expect(u.examples, u.id).toBeGreaterThanOrEqual(4);
      expect(u.examples, u.id).toBeLessThanOrEqual(6);
      expect(u.readings, u.id).toBe(true);
      expect(u.practice, u.id).toBeGreaterThanOrEqual(2);
    }
  });

  test('playing an example with no voice clip falls back to the device voice without errors', async ({ page }) => {
    await page.goto('./#/course/p0-1');
    const v = view(page);
    // Every line ships with a clip, so take this one's clips away to exercise the fallback.
    const hasClip = await page.evaluate(async () => {
      const { CLIPS } = await import('./js/clips.js');
      for (const k of Object.keys(CLIPS)) if (k.startsWith('師匠は 先生です。#')) delete CLIPS[k];
      return (await import('./js/audio.js')).speaker.hasClip('師匠は 先生です。');
    });
    expect(hasClip).toBe(false);
    await v.locator('section.gp[aria-label="は marks the topic"]').getByRole('button', { name: /Play/ }).click();
    await page.waitForTimeout(300);
    const method = await page.evaluate(async () => (await import('./js/audio.js')).speaker.lastMethod);
    expect(['device', 'none']).toContain(method);
    // A line that does have a clip still plays the clip.
    await page.goto('./#/course/p1-4');
    await v.locator('section.gp[aria-label^="いくら"]').getByRole('button', { name: /Play: Welcome/ }).click();
    expect(await page.evaluate(async () => (await import('./js/audio.js')).speaker.lastMethod)).toBe('clip');
  });

  test('the lesson walks through every example and marks the unit read', async ({ page }) => {
    await page.goto('./#/course/p0-2/lesson');
    const v = view(page);
    const n = Number((await v.locator('.mono').innerText()).split('/')[1]);
    for (let i = 0; i < n; i++) {
      await v.locator('.btn[data-act=meaning]').click();
      await expect(v.locator('.trace-c')).toBeVisible();
      await v.getByRole('button', { name: /Next|Finish/ }).click();
    }
    // A short recap comes first; the lesson already counts as read, and the recap can be skipped.
    await expect(v.getByText('LESSON RECAP')).toBeVisible();
    expect((await saved(page)).course.read).toEqual(['p0-2']);
    await v.getByRole('button', { name: 'Skip recap' }).click();
    await expect(v.getByText('Lesson read', { exact: true })).toBeVisible();
  });
});

test.describe('grammar reference', () => {
  test('shows only grammar from units reached so far', async ({ page }) => {
    await page.goto('./#/grammar');
    await expect(page.locator('#title')).toHaveText('Grammar');
    await expect(view(page).locator('.gp')).toHaveCount(4);   // the first unit only
    await settle(page);
    await expectNoHorizontalScroll(page);
  });

  test('searches by English, Japanese and romaji, with playable examples', async ({ page }) => {
    await seed(page, FIXTURE_COURSE);   // reached up to Unit 1.4
    await page.goto('./#/grammar');
    const v = view(page);
    const all = await v.locator('.gp').count();
    expect(all).toBeGreaterThan(20);
    const search = v.getByRole('searchbox', { name: 'Search grammar' });
    await search.fill('object');
    await expect(v.locator('.gp')).toHaveCount(1);
    await expect(v.locator('.gp')).toContainText('を marks the object');
    await search.fill('ください');
    await expect(v.locator('.gp').first()).toContainText('ください');
    expect(await v.locator('.gp').count()).toBeLessThan(all);
    await search.fill('ikimasu');
    await expect(v.locator('.gp', { hasText: 'に / へ' })).toBeVisible();
    await search.fill('zzzz');
    await expect(v.getByText('Nothing matches yet')).toBeVisible();
    await search.fill('');
    await expect(v.locator('.gp')).toHaveCount(all);
    // Units not reached yet (past tense is Unit 1.5) stay out.
    await search.fill('ました');
    await expect(v.locator('.gp', { hasText: 'past tense' })).toHaveCount(0);
    await search.fill('はい');
    await v.getByRole('button', { name: /Play/ }).first().click();
    await settle(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Today follows the course', () => {
  test('Input is the unit lesson, then the next story chapter; the skill block practises the unit', async ({ page }) => {
    await openAt(page, '2026-10-05', { current: 'p1-3', reached: ['p1-3'] });   // Monday
    await page.goto('./#/');
    expect(await blockTitles(page)).toEqual(['Garden review', "Lesson · Say where you're going and how", 'Speaking · Speak Slice', 'Skill focus · Particle Train']);
    await expect(view(page).locator('.block-row', { hasText: 'Skill focus' })).toContainText('Unit 1.3 practice, 6 trains');
    await expect(view(page).locator('.course-card')).toContainText("Say where you're going and how");

    // Read the lesson inside the plan.
    await view(page).locator('.block-row', { hasText: 'Lesson' }).getByRole('link', { name: 'Start' }).click();
    await expect(page.locator('#banner')).toContainText('Today · block 2');
    const v = view(page);
    for (let i = 0; i < 6 && !(await v.locator('.recap').isVisible()); i++) await v.getByRole('button', { name: /Next|Finish/ }).click();
    await expect(page.locator('#banner')).toContainText('Block 2 done');   // done as soon as it's read, before the recap
    await v.getByRole('button', { name: 'Skip recap' }).click();
    await expect(v.getByText('Lesson read', { exact: true })).toBeVisible();
    expect((await saved(page)).course.read).toContain('p1-3');

    // Tomorrow's input is the next story chapter, played whole so it clears.
    await page.clock.setFixedTime(new Date('2026-10-06T10:00:00'));
    await page.goto('./#/');
    await expect(view(page).locator('.block-row').nth(1)).toContainText('Next chapter: 1.');
    await view(page).locator('.block-row').nth(1).getByRole('link', { name: 'Start' }).click();
    await expect(page.locator('#banner')).toContainText('1/8');
  });

  test('Thursday practises the unit in the shop when it has counters', async ({ page }) => {
    await openAt(page, '2026-10-08', { current: 'p1-8', read: ['p1-8'] });
    await page.goto('./#/');
    const titles = await blockTitles(page);
    expect(titles[3]).toBe('Skill focus · Shopkeeper');
    // Its lesson is read, so the input is the story.
    expect(titles[1]).toBe('Story');
    await view(page).locator('.block-row', { hasText: 'Skill focus' }).getByRole('link', { name: 'Start' }).click();
    await expect(page.locator('#title')).toHaveText('Shopkeeper');
  });

  test('doing only the daily story moves the saga on while a unit is still in progress', async ({ page }) => {
    // Unit 1.1 is read but far from done; chapters 1 and 2 are cleared.
    await openAt(page, '2026-10-06', { current: 'p1-1', read: ['p1-1'] }, { chapters: ['ch1', 'ch2'] });
    await page.goto('./#/');
    await expect(view(page).locator('.block-row').nth(1)).toContainText('Next chapter: 3.');
  });

  test('Quiet, Short and Sunday keep their shape with the course on', async ({ page }) => {
    await openAt(page, '2026-10-11', { current: 'p1-1' }, { settings: { quiet: true, hideIosHint: true } });
    await page.goto('./#/');
    expect(await blockTitles(page)).toEqual(['Garden review', 'Lesson · Talk about what you like', 'Speaking · Listening Lab']);
    await view(page).getByRole('radio', { name: /Short/ }).click();
    expect(await blockTitles(page)).toEqual(['Garden review', 'Lesson · Talk about what you like']);
  });

  test('switching the course off brings back the standard plan', async ({ page }) => {
    await openAt(page, '2026-10-08', { current: 'p1-8' });
    await page.goto('./#/course');
    await view(page).getByRole('switch', { name: 'Follow the course in Today' }).uncheck();
    expect((await saved(page)).course.on).toBe(false);
    await page.goto('./#/');
    expect(await blockTitles(page)).toEqual(['Garden review', 'Story', 'Speaking · Speak Slice', 'Skill focus · Shopkeeper']);
  });
});

test.describe('unit completion', () => {
  test('practice answers count toward the unit, and it completes at the accuracy target', async ({ page }) => {
    await page.goto('./#/course/p1-3/particle');
    const v = view(page);
    await expect(page.locator('#banner')).toContainText('Unit 1.3 practice');
    // Only this unit's trains come up.
    const en = await v.locator('.lead.dim').innerText();
    expect(["I run in town every day.", 'I go to the dojo.', 'I talk with the master.', 'I meet a friend in Japan.']).toContain(en);

    // A real answer: couple the first gap with its right particle.
    const right = await page.evaluate(async (text) => {
      const { TRAINS } = await import('./js/data.js');
      const t = TRAINS.find((x) => x.en === text);
      return t.gaps.find(Boolean).correct[0];
    }, en);
    await v.locator(`[data-act=place][data-p="${right}"]`).click();
    await expect(page.locator('#banner')).toContainText('1 answer ·');

    // A miss shows why and only counts once; then 19 more right first tries hit the target (≥85% over ≥20).
    await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      store.grade({ skill: 'grammar', id: 'x', ok: false, firstTry: true });
      store.grade({ skill: 'grammar', id: 'x', ok: true, firstTry: false });   // a retry: not counted
      store.grade({ skill: 'pitch', id: 'x', ok: false, firstTry: true });     // pitch: not counted
    });
    await expect(page.locator('#banner')).toContainText('2 answers · 50%');
    let s = await saved(page);
    expect(s.course.tally['p1-3']).toEqual({ ok: 1, tot: 2, last: '10' });
    await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      for (let i = 0; i < 17; i++) store.grade({ skill: 'grammar', id: 'x', ok: true, firstTry: true });
    });
    await expect(page.locator('#banner')).toContainText('19 answers');
    expect((await saved(page)).course.done).toEqual([]);
    await page.evaluate(async () => (await import('./js/store.js')).store.grade({ skill: 'grammar', ok: true }));
    await expect(page.locator('#banner')).toContainText('Unit complete');
    s = await saved(page);
    expect(s.course.done).toEqual(['p1-3']);
    expect(s.course.tally['p1-3'].tot).toBe(20);

    // The path ticks it; answers outside a unit's practice don't count anywhere.
    await page.goto('./#/play/particle');
    await page.evaluate(async () => (await import('./js/store.js')).store.grade({ skill: 'grammar', ok: true }));
    expect((await saved(page)).course.tally['p1-3'].tot).toBe(20);
    await page.goto('./#/course');
    await expect(view(page).locator('.unit-row.cleared')).toContainText("Say where you're going and how");
  });

  test('completing the current unit moves the course on to the next one', async ({ page }) => {
    await seed(page, { v: 2, items: {}, course: { current: 'p0-1' } });
    await page.goto('./#/course/p0-1/rhythm');
    await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      for (let i = 0; i < 22; i++) store.grade({ skill: 'speaking', ok: i !== 3 });
    });
    await expect(page.locator('#banner')).toContainText('Unit complete');
    const s = await saved(page);
    expect(s.course.done).toEqual(['p0-1']);
    expect(s.course.current).toBe(null);
    expect(s.course.reached).toEqual(expect.arrayContaining(['p0-1', 'p0-2']));
    await page.goto('./#/course');
    await expect(view(page).locator('.unit-row[aria-current=step]')).toContainText('Ask what things are, and whose');
  });

  test('the shop and story practices take their unit filters', async ({ page }) => {
    await page.goto('./#/course/p1-8/shop');
    const v = view(page);
    await v.locator('[data-act=greet]').first().click();
    await expect(page.locator('#banner')).toContainText('1 answer ·');
    await page.goto('./#/course/p1-3/story');
    await pastWords(view(page));
    // Chapter 2, lines 1-6: six beats, then the scene ends without clearing the chapter.
    for (let i = 0; i < 12 && !(await view(page).locator('.recap').isVisible()); i++) {
      const choice = view(page).locator('[data-act=choice]').first();
      if (await choice.isVisible()) await choice.click(); else await view(page).getByRole('button', { name: 'Next' }).click();
    }
    await view(page).getByRole('button', { name: 'Skip recap' }).click();   // the scene's recap (tests/recap.spec.js)
    await expect(view(page).getByText('シーン クリア')).toBeVisible();
    expect((await saved(page)).chapters).toEqual([]);
  });
});

test.describe('saved course progress', () => {
  test('v1 and v2 progress load with nothing lost and get the default course', async ({ page }) => {
    await page.goto('./');
    const out = await page.evaluate(async ([a, b]) => {
      const { store } = await import('./js/store.js');
      return [store.parseImport(JSON.stringify(a)), store.parseImport(JSON.stringify(b))];
    }, [FIXTURE_V1, FIXTURE_V2]);
    for (const [before, after] of [[FIXTURE_V1, out[0]], [FIXTURE_V2, out[1]]]) {
      // Items gain scheduler fields (v3); everything they had stays.
      for (const [id, p] of Object.entries(before.items)) expect(after.items[id], id).toEqual(expect.objectContaining(p));
      expect(after.chapters).toEqual(before.chapters);
      expect(after.dojo).toEqual(before.dojo);
      expect(after.days).toEqual(before.days);
      expect(after.settings).toEqual(expect.objectContaining(before.settings));
      expect(after.course).toEqual(DEFAULT_COURSE);
      expect(after.v).toBeGreaterThanOrEqual(3);
    }
  });

  test('migrateCourse only adds the course field', async ({ page }) => {
    await page.goto('./');
    const out = await page.evaluate(async (blob) => (await import('./js/store.js')).migrateCourse(blob), FIXTURE_V2);
    expect(out).toEqual({ ...FIXTURE_V2, course: DEFAULT_COURSE });
  });

  test('a saved course round-trips through storage, reload and export/import', async ({ page }) => {
    await seed(page, FIXTURE_COURSE);
    await page.goto('./#/course');
    await expect(view(page).locator('.unit-row.cleared')).toHaveCount(4);
    let s = await saved(page);
    expect(s.course).toEqual(FIXTURE_COURSE.course);
    for (const [id, p] of Object.entries(FIXTURE_COURSE.items)) expect(s.items[id], id).toEqual(expect.objectContaining(p));
    await page.reload();
    s = await saved(page);
    expect(s.course).toEqual(FIXTURE_COURSE.course);
    const back = await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      return store.parseImport(store.exportCode());
    });
    expect(back.course).toEqual(FIXTURE_COURSE.course);
  });

  test('a damaged course field is cleaned up instead of breaking the app', async ({ page }) => {
    await seed(page, { v: 3, items: {}, course: { on: 'yes', current: 42, reached: ['p1-1', 'nope', 7], done: 'p0-1', tally: { 'p1-1': { ok: 9, tot: 3, last: '1x1' }, bad: {} } } });
    await page.goto('./#/course');
    await expect(view(page).locator('.unit-row[aria-current=step]')).toHaveCount(1);
    const s = await saved(page);
    expect(s.course).toEqual({ on: true, current: null, reached: ['p1-1'], done: [], read: [], tally: { 'p1-1': { ok: 3, tot: 3, last: '11' } } });
  });
});

// The quick recap quiz (js/recap.js) at the end of each place that teaches something new: course lessons, story
// scenes that stop partway through a chapter, the Garden's new words and a round of new kanji in Kanji Forge.
import { test, expect, seed, saved, view, expectNoHorizontalScroll, pastWords, gradeGardenCard } from './helpers.js';

/**
 * With Math.random pinned to 0, the app's shuffle always moves the first item to the end, so the right answer
 * (listed first in each question) is always the last option, and order tiles never start in order.
 */
async function pinRandom(page) {
  await page.addInitScript(() => { Math.random = () => 0; });
}

/** Answers the current recap question: right or wrong on purpose. */
async function answer(page, right) {
  const v = view(page);
  const opts = v.locator('[data-act=rc-pick]');
  if (await opts.count()) {
    await (right ? opts.last() : opts.first()).click();
    return;
  }
  // An order question: tiles carry their place in the sentence.
  const idx = (await v.locator('[data-act=rc-tile]').evaluateAll((els) => els.map((e) => +e.dataset.i))).sort((a, b) => (right ? a - b : b - a));
  for (const i of idx) await v.locator(`[data-act=rc-tile][data-i="${i}"]`).click();
}

/** "2/5" in the recap header. */
async function counter(page) {
  const [at, of] = (await view(page).locator('.recap-head .mono').innerText()).split('/').map(Number);
  return { at, of };
}

async function readLesson(page, unit) {
  await page.goto(`./#/course/${unit}/lesson`);
  const v = view(page);
  for (let i = 0; i < 20 && !(await v.locator('.recap').isVisible()); i++) await v.getByRole('button', { name: /Next|Finish/ }).click();
  await expect(v.getByText('LESSON RECAP')).toBeVisible();
}

test.describe('lesson recap', () => {
  test('4-6 questions; a miss shows the answer and a reason and comes back once; then the practice list', async ({ page }) => {
    await pinRandom(page);
    await readLesson(page, 'p1-3');
    const v = view(page);
    const { of: n } = await counter(page);
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(6);
    await expectNoHorizontalScroll(page);

    // Miss the first one: the answer and a one-line reason show, and it's queued again at the end.
    await answer(page, false);
    await expect(v.locator('.recap-feedback')).toContainText('Answer:');
    await expect(v.locator('.recap-feedback .small').first()).not.toBeEmpty();
    await expect(v.getByText('It comes back once at the end.')).toBeVisible();
    expect((await counter(page)).of).toBe(n + 1);
    await expectNoHorizontalScroll(page);
    await v.locator('[data-act=rc-next]').click();

    for (let i = 1; i < n; i++) {
      await answer(page, true);
      await expect(v.getByText('Right!', { exact: true })).toBeVisible();
      await v.locator('[data-act=rc-next]').click();
    }
    // The missed one again, once.
    await expect(v.getByText('One more try at this one.')).toBeVisible();
    await answer(page, true);
    await v.locator('[data-act=rc-next]').click();
    await expect(v.getByText(`${n - 1} of ${n}`)).toBeVisible();
    await v.getByRole('button', { name: 'On to practice', exact: true }).click();
    await expect(v.getByText('Lesson read', { exact: true })).toBeVisible();
    await expect(v.getByText(`Recap: ${n - 1} of ${n} right on the first try.`)).toBeVisible();
    await expect(v.locator('.mode-card').first()).toBeVisible();

    // First tries were graded for the skill model (the retry isn't counted again).
    const s = await saved(page);
    const graded = Object.values(s.engine.tally).flatMap((d) => Object.values(d)).reduce((a, t) => a + t[1], 0);
    expect(graded).toBe(n);
  });

  test('a fill-the-particle question: reading help is off on the options, and the sentence is spoken after', async ({ page }) => {
    await pinRandom(page);
    await readLesson(page, 'p1-3');   // its first point teaches に / へ
    const v = view(page);
    await expect(v.locator('.recap-ask')).toContainText('Fill in the particle');
    await expect(v.locator('.recap-show-jp')).toContainText('（　）');
    for (const b of await v.locator('[data-act=rc-pick]').all()) await expect(b).toHaveAttribute('data-noruby', '');
    await answer(page, true);
    expect(await page.evaluate(async () => (await import('./js/audio.js')).speaker.lastMethod)).toBe('clip');
  });

  test('skipping works at any point, and the lesson still counts as read', async ({ page }) => {
    await readLesson(page, 'p0-1');
    expect((await saved(page)).course.read).toEqual(['p0-1']);
    await view(page).getByRole('button', { name: 'Skip recap' }).click();
    await expect(view(page).getByText('Lesson read', { exact: true })).toBeVisible();
    await expect(view(page).getByText(/Recap:/)).toHaveCount(0);
  });

  test('quiet mode: a listening question shows the Japanese instead of playing it', async ({ page }) => {
    await seed(page, { v: 5, items: {}, settings: { quiet: true } });
    await pinRandom(page);
    await readLesson(page, 'p1-5');   // no particle points: its first question is a listening one
    const v = view(page);
    await expect(v.locator('.recap-ask')).toContainText('Read the line');
    await expect(v.locator('.recap-show-jp')).toBeVisible();
    await expect(v.locator('[data-act=rc-play]')).toHaveCount(0);
  });
});

test.describe('story scene recap', () => {
  test('a scene that stops partway through a chapter ends with 2-3 questions on its words and lines', async ({ page }) => {
    await pinRandom(page);
    await page.goto('./#/course/p1-3/story');
    const v = view(page);
    await pastWords(v);   // the scene's new words come first (they can be skipped)
    for (let i = 0; i < 14 && !(await v.locator('.recap').isVisible()); i++) {
      const choices = v.locator('[data-act=choice]');
      // Try each option until the right one (a wrong one just shows a reply).
      if (await choices.count()) { for (let c = 0; c < 4 && await v.locator('[data-act=choice]').count(); c++) await v.locator('[data-act=choice]').nth(c).click(); continue; }
      await v.getByRole('button', { name: 'Next' }).click();
    }
    await expect(v.getByText('SCENE RECAP')).toBeVisible();
    const { of: n } = await counter(page);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
    await expectNoHorizontalScroll(page);
    for (let i = 0; i < n; i++) {
      await answer(page, true);
      await v.locator('[data-act=rc-next]').click();
    }
    await v.getByRole('button', { name: /Continue/ }).click();
    await expect(v.getByText('シーン クリア')).toBeVisible();
    expect((await saved(page)).chapters).toEqual([]);   // a scene never clears the chapter
  });

  test('a whole chapter keeps its own comprehension questions and gets no recap', async ({ page }) => {
    await page.goto('./#/play/story');
    const v = view(page);
    await v.locator('[data-act=open]').first().click();
    await pastWords(v);
    for (let i = 0; i < 60; i++) {
      if (await v.locator('.quiz-q, .recap').first().isVisible().catch(() => false)) break;
      if (await v.getByText(/クリア/).isVisible()) break;
      const choices = v.locator('[data-act=choice]');
      if (await choices.count()) { for (let c = 0; c < await choices.count(); c++) if (await v.locator('[data-act=choice]').count()) await v.locator('[data-act=choice]').nth(c).click(); continue; }
      await v.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(v.locator('.recap')).toHaveCount(0);
  });
});

test.describe('Garden new-words recap', () => {
  test('after watering, the new words are recapped; a missed one comes back by tomorrow', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-09T10:00:00'));
    await pinRandom(page);
    await page.goto('./#/play/garden');
    const v = view(page);
    await v.getByRole('button', { name: /Water \d+ plant/ }).click();
    const total = Number((await v.locator('.card-review .mono').innerText()).split('/')[1]);
    for (let i = 0; i < total; i++) {
      await gradeGardenCard(v);
    }
    await expect(v.getByText('NEW WORDS RECAP')).toBeVisible();
    const { of: n } = await counter(page);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(6);
    // The first question is a listening one: hear the word, pick its meaning (no Japanese on screen).
    await expect(v.locator('[data-act=rc-play]')).toBeVisible();
    await expect(v.locator('.recap-show-jp')).toHaveCount(0);
    expect(await page.evaluate(async () => (await import('./js/audio.js')).speaker.lastMethod)).toBe('clip');

    const before = await saved(page);
    await answer(page, false);
    const right = await v.locator('.recap-opts .btn.good').innerText();
    await v.locator('[data-act=rc-next]').click();
    await v.getByRole('button', { name: 'Skip recap' }).click();   // skipping still keeps the miss
    await expect(v.locator('.recap')).toHaveCount(0);
    await expect(v.locator('.plant-grid')).toBeVisible();

    const s = await saved(page);
    const missed = Object.entries(s.items).find(([id, p]) => p.due !== before.items[id].due);
    expect(missed, `the missed word (${right}) comes back sooner`).toBeTruthy();
    expect(missed[1].due).toBe(new Date('2026-10-10T00:00:00').getTime());
    expect(missed[1].level).toBe(before.items[missed[0]].level);   // nothing is taken away
  });

  test('a Garden round with no new words has no recap', async ({ page }) => {
    const old = { level: 2, due: 0, best: 0, r: 3, pl: 1, s: 3, d: 5, lr: 1 };
    // Today's 5 new words were already met, so this round is reviews only.
    await seed(page, { v: 5, items: { ohayou: old, arigatou: old }, days: { '2026-10-09': { ok: 0, tot: 0, rev: 0, newc: 5, studied: true, blocks: {} } } });
    await page.clock.setFixedTime(new Date('2026-10-09T10:00:00'));
    await page.goto('./#/play/garden');
    const v = view(page);
    await v.getByRole('button', { name: /Water 2 plants/ }).click();
    for (let i = 0; i < 2; i++) {
      await gradeGardenCard(v);
    }
    await expect(v.locator('.recap')).toHaveCount(0);
  });
});

test.describe('Kanji Forge recap', () => {
  test('after forging three new kanji, a recap: see the word, pick its meaning; hear it, pick how it is written', async ({ page }) => {
    await pinRandom(page);
    await page.goto('./#/play/forge');
    const v = view(page);
    const kanji = await page.evaluate(async () => (await import('./js/data.js')).KANJI.slice(0, 3));
    for (const k of kanji) {
      for (const part of k.parts) {
        await v.locator('.part-grid [data-act=add]').filter({ has: page.locator('.part-k', { hasText: new RegExp(`^${part}`) }) }).first().click();
      }
      await v.getByRole('button', { name: /Strike the anvil/ }).click();
      await expect(v.locator('.forged-k')).toBeVisible();
      await v.getByRole('button', { name: /Next kanji/ }).click();
    }
    await expect(v.getByText('KANJI RECAP')).toBeVisible();
    expect((await counter(page)).of).toBe(6);
    await expect(v.locator('.recap-ask')).toHaveText('What does this word mean?');
    for (let i = 0; i < 3; i++) { await answer(page, true); await v.locator('[data-act=rc-next]').click(); }
    // Hearing questions: reading help is off on the written options, since furigana would give the answer away.
    await expect(v.locator('.recap-ask')).toHaveText('Listen. Which word is it?');
    for (const b of await v.locator('[data-act=rc-pick]').all()) await expect(b).toHaveAttribute('data-noruby', '');
    for (let i = 0; i < 3; i++) { await answer(page, true); await v.locator('[data-act=rc-next]').click(); }
    await expect(v.getByText('6 of 6')).toBeVisible();
    await v.getByRole('button', { name: 'Back to the forge' }).click();
    await expect(v.getByRole('button', { name: /Strike the anvil/ })).toBeVisible();
    expect((await saved(page)).forged).toHaveLength(3);
  });
});

test.describe('recap building blocks', () => {
  test('every line a recap can speak has its VOICEVOX clip', async ({ page }) => {
    await page.goto('./');
    const missing = await page.evaluate(async () => {
      const { CLIPS } = await import('./js/clips.js');
      const { lessonRecap } = await import('./js/course.js');
      const { STUDY_UNITS } = await import('./js/course-data.js');
      const { KANJI, CHAPTERS } = await import('./js/data.js');
      const has = (t, v = 0) => !!(CLIPS[`${t}#${v}`] || CLIPS[`${t}#0`]);
      const out = [];
      for (let run = 0; run < 4; run++) {
        for (const u of STUDY_UNITS) {
          for (const q of lessonRecap(u)) for (const s of [q.say, q.after]) if (s && !has(s.text, s.voice)) out.push(`${u.id}: ${s.text}`);
        }
      }
      for (const k of KANJI) if (!has(k.reading)) out.push(k.reading);
      for (const c of CHAPTERS) for (const b of c.beats) {
        if (!has(b.jp, b.speaker.voice)) out.push(b.jp);
        for (const w of b.words) if (!has(w.reading)) out.push(w.reading);
      }
      return [...new Set(out)];
    });
    expect(missing).toEqual([]);
  });

  test('order questions accept any order of particle-marked phrases, but not around の', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { orderQuestion } = await import('./js/recap.js');
      return {
        free: orderQuestion({ jp: 'わたしは がっこうに いきます。', en: 'x' }).free,
        tied: orderQuestion({ jp: 'あれは だれの かばんですか。', en: 'x' }).free,
        short: orderQuestion({ jp: 'はい、学生です。', en: 'x' }),
      };
    });
    expect(r).toEqual({ free: true, tied: false, short: null });
  });

  test('a missed word comes back by tomorrow; an unplanted Garden word is planted; nothing is lowered', async ({ page }) => {
    const now = new Date('2026-10-09T15:00:00').getTime();
    const far = { level: 4, due: now + 20 * 86_400_000, best: 0.9, r: 6, pl: 1, s: 20, d: 4, lr: now - 86_400_000 };
    const soon = { ...far, due: now - 1000 };
    await seed(page, { v: 5, items: { ohayou: far, arigatou: soon } });
    await page.goto('./');
    const items = await page.evaluate(async (t) => {
      const { store } = await import('./js/store.js');
      store.recapMissed(['ohayou', 'arigatou', 'konnichiwa', 'not-a-word'], t);
      return store.s.items;
    }, now);
    expect(items.ohayou).toMatchObject({ level: 4, s: 20, best: 0.9, due: new Date('2026-10-10T00:00:00').getTime() });
    expect(items.arigatou.due).toBe(now - 1000);   // already due: left alone
    expect(items.konnichiwa).toMatchObject({ level: 0, r: 0 });
    expect(items['not-a-word']).toBeUndefined();
  });
});

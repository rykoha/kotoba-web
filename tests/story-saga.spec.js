// Story saga: chapters 5-12, comprehension questions, the chapter map with challenge replays, line mining
// ("Paste a line") into the Garden, and the v3 saved shape (migration and round-trip).
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, view, expectNoHorizontalScroll, plainText, pastWords, gradeGardenCard } from './helpers.js';

const FIXTURE_V1 = JSON.parse(readFileSync(new URL('./fixtures/progress-v1.json', import.meta.url), 'utf8'));
const FIXTURE_V2 = JSON.parse(readFileSync(new URL('./fixtures/progress-v2.json', import.meta.url), 'utf8'));
// A complete v4 save (engine fields plus the saga block).
const FIXTURE_STORY = JSON.parse(readFileSync(new URL('./fixtures/progress-story.json', import.meta.url), 'utf8'));
const EMPTY_SAGA = { mined: [], seq: 0, quiz: {}, challenge: {} };
const cleared = (n) => Array.from({ length: n }, (_, i) => 'ch' + (i + 1));

/** Reads beats (picking the right answer for in-story choices) until the comprehension questions show. */
async function readToQuestions(page) {
  const v = view(page);
  for (let i = 0; i < 40; i++) {
    if (await v.locator('.saga-quiz').isVisible()) return;
    const choices = v.locator('[data-act=choice]');
    if (await choices.count()) {
      const ans = await page.evaluate(async () => {
        const { CHAPTERS } = await import('./js/data.js');
        const title = document.querySelector('#view .row-between .small').textContent;
        const ch = CHAPTERS.find((c) => title.startsWith(c.number + '.'));
        const pct = parseFloat(document.querySelector('#view .bar span').style.width);
        return ch.beats[Math.round((pct / 100) * ch.beats.length) - 1].choice.answer;
      });
      await v.locator(`[data-act=choice][data-i="${ans}"]`).click();
      continue;
    }
    await v.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(v.locator('.saga-quiz')).toBeVisible();
}

test.describe('story saga data', () => {
  test('chapters 5-24 are complete, valid and graded; chapters 1-4 are unchanged', async ({ page }) => {
    await page.goto('./');
    const problems = await page.evaluate(async () => {
      const { CHAPTERS, CAST, GARDEN_CATALOG, QUIZZES, ARCS } = await import('./js/data.js');
      const { SKILLS } = await import('./js/store.js');
      const { readingOf } = await import('./js/furigana.js');
      const { toHiragana } = await import('./js/romaji.js');
      const out = [];
      const speakers = new Set(Object.values(CAST));
      const str = (x) => typeof x === 'string' && x.trim().length > 0;
      const kana = (s) => toHiragana(s).replace(/[^ぁ-ゖー]/g, '');
      if (CHAPTERS.map((c) => c.id).join() !== Array.from({ length: 24 }, (_, i) => 'ch' + (i + 1)).join()) out.push('chapter ids');
      // Chapters 1-12 are N5 (the last arc leaning toward N4); 13-17 are the N4 Journey arc (js/story-n4.js); 18-24 the
      // N3 Rivals arc (js/story-n3.js).
      if (CHAPTERS.map((c) => c.level).join() !== [...Array(12).fill('N5'), ...Array(5).fill('N4'), ...Array(7).fill('N3')].join()) out.push('chapter levels');
      // Chapters 1-4 stay exactly as they were (saved progress refers to them).
      if (CHAPTERS.slice(0, 4).map((c) => c.beats.length).join() !== '8,9,8,8') out.push('ch1-4 beat counts changed');
      if (CHAPTERS[3].title !== 'さいごの しょうぶ' || CHAPTERS[0].beats[0].jp !== 'ここは 小さい 町です。') out.push('ch1-4 content changed');
      for (const ch of CHAPTERS.slice(4)) {
        const [lo, hi] = { N3: [15, 26], N4: [12, 20] }[ch.level] || [7, 10];   // later chapters are longer
        if (ch.beats.length < lo || ch.beats.length > hi) out.push(`${ch.id}: ${ch.beats.length} beats`);
        if (!ch.beats.some((b) => b.choice)) out.push(`${ch.id}: no choice`);
        ch.beats.forEach((b, i) => {
          const at = `${ch.id}[${i}]`;
          if (!speakers.has(b.speaker)) out.push(`${at}: unknown speaker`);
          if (!Number.isInteger(b.speaker?.voice)) out.push(`${at}: speaker has no voice`);
          if (!str(b.jp) || !str(b.reading) || !str(b.en)) out.push(`${at}: missing text`);
          if (/[一-鿿]/.test(b.reading)) out.push(`${at}: reading has kanji`);
          // Furigana from js/readings.js agrees with the line's own reading.
          const segs = b.jp.match(/[ぁ-ゖァ-ヺー一-鿿々]+/g) || [];
          const fur = segs.map((s) => readingOf(s) ?? '?').join('');
          if (fur.includes('?') || kana(fur) !== kana(b.reading)) out.push(`${at}: furigana ${fur} ≠ ${b.reading}`);
          for (const w of b.words) {
            if (!str(w.jp) || !str(w.reading) || !str(w.en)) out.push(`${at}: word missing text`);
            if (!GARDEN_CATALOG[w.gardenID]) out.push(`${at}: ${w.jp} has no Garden entry (${w.gardenID})`);
          }
          if (b.choice) {
            const c = b.choice;
            if (!str(c.prompt) || !str(c.wrongReply) || c.options.length < 2 || !(c.answer >= 0 && c.answer < c.options.length)) out.push(`${at}: bad choice`);
          }
        });
        if (ch.number >= 9 && ch.number <= 12 && !ch.beats.some((b) => b.note && /ねえ|ぜ|じゃねえ|casual|rough/.test(b.note))) out.push(`${ch.id}: no casual-speech note`);
      }
      for (const ch of CHAPTERS) {
        const qs = QUIZZES[ch.id];
        const [qlo, qhi] = { N3: [4, 6], N4: [3, 4] }[ch.level] || [2, 3];
        if (!qs || qs.length < qlo || qs.length > qhi) { out.push(`${ch.id}: needs ${qlo}-${qhi} questions`); continue; }
        qs.forEach((q, i) => {
          if (!str(q.q) || !str(q.why) || q.options.length < 2 || !(q.answer >= 0 && q.answer < q.options.length)) out.push(`${ch.id} q${i}: bad`);
          if (!SKILLS.includes(q.skill)) out.push(`${ch.id} q${i}: skill ${q.skill}`);
          if (q.line != null && !ch.beats[q.line]) out.push(`${ch.id} q${i}: line ${q.line}`);
        });
      }
      const arcIds = ARCS.flatMap((a) => a.chapters);
      if (arcIds.join() !== CHAPTERS.map((c) => c.id).join()) out.push('arcs do not cover every chapter once');
      return out;
    });
    expect(problems).toEqual([]);
  });

  test('story words that are in the N5 deck share its Garden card', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { CHAPTERS, N5_WORDS } = await import('./js/data.js');
      const n5 = new Set(N5_WORDS.map((w) => w.jp));
      const words = CHAPTERS.slice(4).flatMap((c) => c.beats.flatMap((b) => b.words));
      return { dupes: words.filter((w) => n5.has(w.jp) && !w.gardenID.startsWith('n5:')).map((w) => w.jp),
        matsu: words.find((w) => w.jp === 'まつ').gardenID };
    });
    expect(r.dupes).toEqual([]);
    expect(r.matsu).toBe('n5:待つ');
  });
});

test.describe('chapter map', () => {
  test('a new learner sees all 24 chapters (the N4 and N3 arcs too), the first one next and the rest locked but visible', async ({ page }) => {
    await page.goto('./#/play/story');
    const v = view(page);
    await expect(v.locator('.saga-node')).toHaveCount(24);
    await expect(v.locator('.saga-node.next')).toHaveCount(1);
    await expect(v.locator('.saga-node').first()).toHaveClass(/next/);
    await expect(v.locator('.saga-node.locked')).toHaveCount(23);
    await expect(v.locator('.saga-node.locked button')).toHaveCount(23);
    await expect(v.getByText('Journey Arc', { exact: false })).toBeVisible();
    for (const b of await v.locator('.saga-node.locked button').all()) await expect(b).toBeDisabled();
    await expect(v.getByText('Tournament Arc', { exact: false })).toBeVisible();
    await expect(v.getByText('Final Arc', { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('cleared chapters offer Replay and the challenge; the next one is open', async ({ page }) => {
    await seed(page, { v: 2, items: {}, chapters: cleared(4), settings: { hideIosHint: true } });
    await page.goto('./#/play/story');
    const v = view(page);
    await expect(v.locator('[aria-label=cleared]')).toHaveCount(4);
    await expect(v.locator('.saga-node.next')).toContainText('The Tournament Notice');
    await expect(v.getByRole('button', { name: /^Replay chapter/ })).toHaveCount(4);
    await expect(v.getByRole('button', { name: /^No-furigana challenge/ })).toHaveCount(4);
    await expect(v.locator('.saga-node.locked')).toHaveCount(19);   // 6-12, and the N4 (13-17) and N3 (18-24) arcs until they open
    await expectNoHorizontalScroll(page);
  });
});

test.describe('reading a new chapter', () => {
  test('chapter 5 through to its questions: generous scoring, misses show the answer, results saved', async ({ page }) => {
    test.setTimeout(60_000);
    await seed(page, { v: 2, items: {}, chapters: cleared(4), settings: { hideIosHint: true } });
    await page.goto('./#/play/story');
    const v = view(page);
    await v.locator('.saga-node.next [data-act=open]').click();
    await pastWords(v);
    expect(await plainText(v.locator('.line-jp'))).toBe('ある 日、町に ポスターが ありました。');
    await readToQuestions(page);
    await expectNoHorizontalScroll(page);

    // Q1 right, Q2 wrong (the answer is revealed, no penalty), Q3 right.
    await expect(v.getByText('QUESTION 1 OF 3')).toBeVisible();
    await v.locator('[data-act=choice][data-i="0"]').click();
    await expect(v.getByText('Right!', { exact: true })).toBeVisible();
    await v.getByRole('button', { name: 'Next', exact: true }).click();
    await v.locator('[data-act=choice][data-i="1"]').click();
    await expect(v.getByText("Here's the answer:")).toBeVisible();
    await expect(v.locator('.saga-feedback')).toContainText('Work');
    await expect(v.locator('[data-act=choice]')).toHaveCount(0);
    await v.getByRole('button', { name: 'Next', exact: true }).click();
    await v.locator('[data-act=choice][data-i="0"]').click();
    await v.getByRole('button', { name: 'Next', exact: true }).click();

    await expect(v.getByText(/第5話 クリア/)).toBeVisible();
    await expect(v.locator('.saga-score')).toContainText('2/3');
    const s = await saved(page);
    expect(s.v).toBeGreaterThanOrEqual(4);
    expect(s.chapters).toContain('ch5');
    expect(s.saga.quiz.ch5).toEqual(expect.objectContaining({ ok: 2, tot: 3, best: 2 }));
    const day = Object.values(s.days)[0];
    expect(day.tot).toBe(4);   // the in-story choice plus three questions
    expect(day.ok).toBe(3);
    expect(s.items['w:大会']).toBeTruthy();   // a new story word was planted
    expect(s.items['n5:お金']).toBeTruthy();  // an N5 word reuses the deck's card
    await v.getByRole('button', { name: /Chapter 6/ }).click();
    await pastWords(v);
    expect(await plainText(v.locator('.line-jp'))).toContain('だんごの 店で');
  });

  test('a final-arc chapter shows its casual-speech notes', async ({ page }) => {
    await seed(page, { v: 2, items: {}, chapters: cleared(8), settings: { hideIosHint: true } });
    await page.goto('./#/play/story');
    const v = view(page);
    await v.locator('.saga-node.next [data-act=open]').click();
    await pastWords(v);
    await v.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(v.locator('.note')).toBeVisible();
    expect(await plainText(v.locator('.note'))).toContain('ねえ is rough speech for ない');
    await expect(v.locator('.avatar')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('no-furigana challenge', () => {
  test('forces reading help off for that replay, and its result is remembered on the map', async ({ page }) => {
    test.setTimeout(60_000);
    await seed(page, { v: 2, items: {}, chapters: ['ch1'], settings: { hideIosHint: true, readingHelp: 'kana' } });
    // A normal replay keeps the reading help (furigana over kanji)...
    await page.goto('./#/play/story');
    const v = view(page);
    await v.getByRole('button', { name: 'Replay chapter 1' }).click();
    await expect(v.locator('.line-jp rt')).not.toHaveCount(0);
    await v.getByRole('button', { name: 'Chapters' }).click();
    // ...the challenge turns it all off.
    await v.getByRole('button', { name: /No-furigana challenge, chapter 1/ }).click();
    await expect(v.locator('.saga-challenge-tag')).toBeVisible();
    await expect(v.locator('[data-act=furi]')).toHaveCount(0);
    await expect(v.locator('.reading')).toHaveCount(0);
    await expect(v.locator('#view rt')).toHaveCount(0);
    await readToQuestions(page);
    await expect(v.locator('#view rt')).toHaveCount(0);
    for (let i = 0; i < 3; i++) {
      await v.locator('[data-act=choice][data-i="0"]').click();
      await v.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(v.getByText(/第1話 クリア/)).toBeVisible();
    await expect(v.locator('.saga-score')).toContainText('No-furigana challenge');
    const s = await saved(page);
    expect(s.saga.challenge.ch1).toEqual(expect.objectContaining({ ok: 3, tot: 3, best: 3, runs: 1 }));
    expect(s.saga.quiz.ch1).toBeUndefined();
    expect(s.storyReplays.ch1).toBeGreaterThan(0);
    await v.getByRole('button', { name: 'Back to chapters' }).click();
    await expect(v.locator('.saga-results')).toContainText('Challenge best 3/3');
  });
});

test.describe('Paste a line (line mining)', () => {
  test('add a line, review it in the Garden, then delete it', async ({ page }) => {
    test.setTimeout(60_000);
    const existing = { 'n5:人': { level: 3, due: 1, best: 0, r: 4, pl: 1 }, 'w:町': { level: 5, due: 4e12, best: 0, r: 7, pl: 1 } };
    await seed(page, { v: 2, items: existing, settings: { hideIosHint: true } });
    await page.goto('./#/play/story');
    const v = view(page);
    await v.getByRole('button', { name: /Paste a line/ }).click();
    await v.getByLabel('Japanese line').fill('本気の 拳だ！');
    await v.getByRole('button', { name: /Show readings/ }).click();
    // 本気 is known (filled in); 拳 is not, so it asks.
    await expect(v.getByLabel('Reading of 本気 in hiragana')).toHaveValue('ほんき');
    await expect(v.getByLabel('Reading of 拳 in hiragana')).toHaveValue('');
    await expectNoHorizontalScroll(page);
    await v.getByRole('button', { name: /Add to Garden/ }).click();
    await expect(v.getByRole('alert')).toContainText('拳');
    await v.getByLabel('Reading of 拳 in hiragana').fill('こぶし');
    await v.getByRole('button', { name: /Add to Garden/ }).click();
    await expect(v.getByRole('alert')).toContainText('means');
    await v.getByLabel('Meaning in English').fill('A fist with everything behind it!');
    await v.getByRole('button', { name: /Add to Garden/ }).click();
    await expect(v.locator('.mine-row')).toHaveCount(1);
    await expect(v.locator('.mine-row')).toContainText('ほんきの こぶしだ！');

    let s = await saved(page);
    expect(s.saga.mined).toEqual([expect.objectContaining({ id: 'mine:1', jp: '本気の 拳だ！', reading: 'ほんきの こぶしだ！', en: 'A fist with everything behind it!' })]);
    expect(s.items['mine:1']).toEqual(expect.objectContaining({ level: 0, due: 0, r: 0 }));

    // It's a Garden card, due now, and comes first among today's new plants.
    await page.goto('./#/garden');
    await view(page).getByRole('button', { name: /Water \d+ plant/ }).click();
    for (let i = 0; i < 8; i++) {
      // A grown word can also bring a Listen card (no text shown): just answer it.
      if (!(await view(page).locator('.card-dir', { hasText: 'Meaning' }).count())) {
        await gradeGardenCard(view(page));
        continue;
      }
      const jp = await plainText(view(page).locator('.review-jp'));
      if (jp === '本気の 拳だ！') {
        // A new line opens to study, its meaning already showing.
        await expect(view(page).getByText('A fist with everything behind it!')).toBeVisible();
        await gradeGardenCard(view(page));
        break;
      }
      await gradeGardenCard(view(page));
    }
    s = await saved(page);
    expect(s.items['mine:1']).toEqual(expect.objectContaining({ level: 1, r: 1 }));
    const others = Object.keys(s.items).filter((id) => id !== 'mine:1');
    expect(s.items['w:町']).toEqual(expect.objectContaining(existing['w:町']));   // a plant that wasn't due is untouched

    // Delete takes two taps and removes the card, leaving every other plant alone.
    await page.goto('./#/play/story');
    await view(page).getByRole('button', { name: /Paste a line/ }).click();
    await view(page).getByRole('button', { name: 'Delete' }).click();
    expect((await saved(page)).saga.mined).toHaveLength(1);
    await view(page).getByRole('button', { name: 'Tap again to delete' }).click();
    await expect(view(page).locator('.mine-row')).toHaveCount(0);
    const after = await saved(page);
    expect(after.saga.mined).toEqual([]);
    expect(after.items['mine:1']).toBeUndefined();
    expect(Object.keys(after.items).sort()).toEqual(others.sort());
    expect(after.items['w:町']).toEqual(expect.objectContaining(existing['w:町']));
    expect(after.saga.seq).toBe(1);   // ids are never reused
  });

  test('a line with no Japanese gets a friendly message', async ({ page }) => {
    await page.goto('./#/play/story');
    const v = view(page);
    await v.getByRole('button', { name: /Paste a line/ }).click();
    await v.getByLabel('Japanese line').fill('hello');
    await v.getByRole('button', { name: /Show readings/ }).click();
    await expect(v.getByRole('alert')).toContainText('Japanese');
    expect((await saved(page))?.saga?.mined ?? []).toEqual([]);
  });
});

test.describe('saved progress with the story saga (v4)', () => {
  const parse = (page, blob) => page.evaluate(async (b) => (await import('./js/store.js')).store.parseImport(JSON.stringify(b)), blob);
  // Items gain scheduler fields in v3 (s, d, lr); everything they had before must be unchanged.
  const itemsKept = (before, after) => {
    for (const [id, p] of Object.entries(before)) expect(after[id], id).toEqual(expect.objectContaining(p));
  };

  test('v1 and v2 blobs migrate to v4 with nothing lost and empty saga defaults', async ({ page }) => {
    await page.goto('./');
    for (const fx of [FIXTURE_V1, FIXTURE_V2]) {
      const out = await parse(page, fx);
      expect(out.v).toBeGreaterThanOrEqual(4);
      expect(out.saga).toEqual(EMPTY_SAGA);
      itemsKept(fx.items, out.items);
      for (const k of ['chapters', 'forged', 'dojo', 'storyReplays', 'days', 'lastSession']) expect(out[k], k).toEqual(fx[k]);
      expect(out.settings).toEqual(expect.objectContaining(fx.settings));
    }
  });

  test('a v2 blob in storage loads, is saved as the current version, and its garden is untouched', async ({ page }) => {
    await seed(page, FIXTURE_V2);
    await page.goto('./#/play/story');
    await expect(view(page).locator('[aria-label=cleared]')).toHaveCount(2);
    const s = await saved(page);
    expect(s.v).toBeGreaterThanOrEqual(4);
    itemsKept(FIXTURE_V2.items, s.items);
    expect(s.chapters).toEqual(FIXTURE_V2.chapters);
    expect(s.settings).toEqual(expect.objectContaining(FIXTURE_V2.settings));
    expect(s.days).toEqual(FIXTURE_V2.days);
    expect(s.saga).toEqual(EMPTY_SAGA);
  });

  test('mined lines and chapter results round-trip, and mined cards are Garden plants', async ({ page }) => {
    await seed(page, FIXTURE_STORY);
    await page.goto('./#/play/story');
    const out = await parse(page, FIXTURE_STORY);
    // Later versions only add blocks (and v7 one setting).
    expect(out).toEqual(expect.objectContaining({ ...FIXTURE_STORY, v: out.v, settings: { ...FIXTURE_STORY.settings, pronCheck: true, autoMic: false, voice: null, showAllLevels: false } }));
    const s = await saved(page);
    expect(s).toEqual(expect.objectContaining({ ...FIXTURE_STORY, v: s.v, lastSession: s.lastSession, settings: { ...FIXTURE_STORY.settings, pronCheck: true, autoMic: false, voice: null, showAllLevels: false } }));
    await expect(view(page).locator('.saga-results').first()).toContainText('Questions 3/3 · Challenge best 2/3');
    const planted = await page.evaluate(async () => (await import('./js/store.js')).store.planted().map((p) => p.item.id));
    expect(planted).toEqual(expect.arrayContaining(['mine:2', 'mine:5', 'arigatou', 'w:大会']));
    // Export → import keeps it all.
    const code = await page.evaluate(async () => (await import('./js/store.js')).store.exportCode());
    const back = await page.evaluate(async (c) => (await import('./js/store.js')).store.parseImport(c), code);
    expect(back.saga).toEqual(FIXTURE_STORY.saga);
    // The mined list shows them with their furigana.
    await view(page).getByRole('button', { name: /Paste a line/ }).click();
    await expect(view(page).locator('.mine-row')).toHaveCount(2);
    await expect(view(page).locator('.mine-row rt').first()).toHaveText('ほんき');
    await expectNoHorizontalScroll(page);
  });

  test('broken saga data keeps the good parts and never touches other progress', async ({ page }) => {
    await page.goto('./');
    const blob = { ...FIXTURE_V2, v: 4, saga: {
      mined: [{ id: 'mine:3', jp: 'いくぞ', reading: 'いくぞ', en: "Let's go", parts: [['いくぞ', null]], at: 5 },
        { id: 'bad', jp: 'x' }, { id: 'mine:4', jp: '' }, null, { id: 'mine:3', jp: 'dupe' }],
      seq: 'nope', quiz: { ch1: { ok: '2', tot: 3 }, ch2: 'x' }, challenge: [] } };
    const out = await parse(page, blob);
    itemsKept(FIXTURE_V2.items, out.items);
    expect(out.saga).toEqual({ mined: [blob.saga.mined[0]], seq: 3, quiz: { ch1: { ok: 2, tot: 3, best: 0, at: 0 } }, challenge: {} });
  });
});

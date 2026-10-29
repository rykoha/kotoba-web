// The Garden's review cards beyond Meaning: Listen and Say it directions for well-grown words, grammar cards (course
// grammar points and conjugation forms), the needs-help mark, and the v6 saved shape they live in.
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, view, expectNoHorizontalScroll, plainText } from './helpers.js';

const FIXTURE_V5 = JSON.parse(readFileSync(new URL('./fixtures/progress-v5.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-10T10:00:00');
const T = NOW.getTime();
const DAY = 86_400_000;

/** A word grown to stage `level`, due now unless told otherwise. */
const grown = (extra = {}) => ({ level: 4, due: T - 1000, best: 0, r: 6, pl: T - 30 * DAY, s: 8, d: 5, lr: T - 8 * DAY, ...extra });
const later = (extra = {}) => grown({ due: T + 5 * DAY, ...extra });

async function open(page, state, hash = '#/play/garden') {
  await page.clock.setFixedTime(NOW);
  await seed(page, { v: 6, settings: { hideIosHint: true }, days: {}, ...state });
  await page.goto('./' + hash);
}

const queue = (page) => page.evaluate(async () => (await import('./js/store.js')).store.dailyGardenQueue(20).queue
  .map((c) => `${c.kind}:${c.dir || ''}:${c.id}${c.isNew ? '*' : ''}`));

/** Answers whatever card is showing: right or wrong. Returns its label. */
async function answerCard(page, ok) {
  const v = view(page);
  if (await v.locator('[data-act=helpdone]').count()) await v.locator('[data-act=helpdone]').click();
  const label = await v.locator('.card-dir').innerText();
  if (await v.locator('[data-act=gpick]').count()) {
    const right = await page.evaluate(() => document.querySelector('#view .gram-show') && true);
    expect(right).toBe(true);
    // The right option is the one that turns green once answered: pick by trying the first, which is a fair test.
    await v.locator('[data-act=gpick]').first().click();
    await v.locator('[data-act=gnext]').click();
    return label;
  }
  await v.getByRole('button', { name: /Check/ }).click();
  if (await v.getByRole('button', { name: 'Next', exact: true }).count()) await v.getByRole('button', { name: 'Next', exact: true }).click();
  else await v.getByRole('button', { name: ok ? /Knew it/ : /Forgot/ }).click();
  return label;
}

test.describe('saved progress v5 → v6', () => {
  test('the v5 fixture loads with nothing lost, and gets grammar cards for lessons read and forms practised', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await seed(page, FIXTURE_V5);
    await page.goto('./');
    const s = await saved(page);
    expect(s.v).toBe(14);   // migrated on to the current version
    for (const [id, p] of Object.entries(FIXTURE_V5.items)) {
      for (const k of ['level', 'due', 'best', 'r', 'pl', 's', 'd', 'lr']) expect(s.items[id][k], `${id}.${k}`).toBe(p[k]);
    }
    expect(s.chapters).toEqual(FIXTURE_V5.chapters);
    expect(s.forged).toEqual(FIXTURE_V5.forged);
    expect(s.dojo).toEqual(FIXTURE_V5.dojo);
    expect(s.saga).toEqual(FIXTURE_V5.saga);
    expect(s.course).toEqual(FIXTURE_V5.course);
    expect(s.engine.mastery).toEqual(FIXTURE_V5.engine.mastery);
    for (const [k, v] of Object.entries(FIXTURE_V5.settings)) expect(s.settings[k]).toEqual(v);
    for (const [k, d] of Object.entries(FIXTURE_V5.days)) expect(s.days[k]).toEqual(d);
    // Grammar cards: every point of the units read or done (p0-1, p0-2), and the two conjugation forms practised.
    const keys = Object.keys(s.grammar);
    const want = await page.evaluate(async () => {
      const { unitCardKeys } = await import('./js/grammar-cards.js');
      return [...unitCardKeys('p0-1'), ...unitCardKeys('p0-2'), 'cj:食べる|te', 'cj:行く|ta'];
    });
    expect(keys.sort()).toEqual(want.sort());
    for (const c of Object.values(s.grammar)) expect(c).toMatchObject({ r: 0, due: 0 });
    // And it stays that way after a reload.
    await page.reload();
    expect((await saved(page)).grammar).toEqual(s.grammar);
  });
});

test.describe('Listen and Say it cards', () => {
  test('only a well-grown word gets them, at most 3 new a day, within the daily cap', async ({ page }) => {
    const items = { 'n5:猫': grown(), 'n5:犬': later(), 'n5:木': later(), 'n5:本': later(), 'n5:水': later(), young: grown({ level: 2, s: 2 }) };
    items['n5:魚'] = later({ level: 2, s: 2.6 });   // stage 2: no extra directions yet
    await open(page, { items });
    const q = await queue(page);
    const dirs = q.filter((x) => /:(listen|say):/.test(x));
    expect(dirs).toHaveLength(3);
    expect(dirs.every((x) => x.endsWith('*'))).toBe(true);
    expect(q.join()).not.toMatch(/:(listen|say):n5:魚/);
    expect(q.length).toBeLessThanOrEqual(20);
    // Once three were introduced today, no more are (a fourth word waits for tomorrow).
    await page.evaluate(async () => { const { store } = await import('./js/store.js'); store.day().newd = 3; });
    expect((await queue(page)).filter((x) => /:(listen|say):/.test(x))).toHaveLength(0);
  });

  test('Listen: the clip plays with no text, check reveals it, and it gets its own schedule', async ({ page }) => {
    await open(page, { items: { 'n5:猫': later() }, days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    await expect(v.locator('.card-dir')).toHaveText('Listen');
    await expect(v.locator('.review-jp')).toHaveCount(0);   // no text before checking
    expect(await page.evaluate(async () => (await import('./js/audio.js')).speaker.lastMethod)).toBe('clip');
    await expectNoHorizontalScroll(page);
    await v.getByRole('button', { name: /Check/ }).click();
    await expect(v.locator('.review-jp')).toContainText('猫');
    await v.getByRole('button', { name: /Knew it/ }).click();
    const p = (await saved(page)).items['n5:猫'];
    expect(p.dirs.listen.r).toBe(1);
    expect(p.dirs.listen.due).toBeGreaterThan(T);
    expect(p.level).toBe(4);              // the growth stage follows the Meaning card only
    expect(p.due).toBe(later().due);      // and the Meaning card's schedule is untouched
    expect((await saved(page)).days['2026-10-10'].newd).toBe(1);
  });

  test('Say it without speech recognition: English (with an example hint), then check and grade yourself', async ({ page }) => {
    await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    const p = later({ dirs: { listen: { due: T + 9 * DAY, s: 9, d: 5, lr: T - DAY, r: 2, pl: T - 9 * DAY } } });
    await open(page, { items: { 'n5:猫': p }, days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    await expect(v.locator('.card-dir')).toHaveText('Say it');
    await expect(v.locator('.say-en')).toHaveText('cat');
    await expect(v.getByText(/grade yourself/)).toBeVisible();
    await v.getByRole('button', { name: /Example hint/ }).click();
    await expect(v.getByText(/Used like:/)).toBeVisible();
    await v.getByRole('button', { name: /Check/ }).click();
    await expect(v.locator('.review-jp')).toContainText('猫');
    await v.getByRole('button', { name: /Knew it/ }).click();
    const s = await saved(page);
    expect(s.items['n5:猫'].dirs.say.r).toBe(1);
    expect(s.items['n5:猫'].dirs.listen).toEqual(p.dirs.listen);
    expect(Object.values(s.engine.tally).some((d) => d.speaking)).toBe(true);
  });

  test('Say it with speech recognition: saying it right is graded for you', async ({ page }) => {
    await page.addInitScript(() => {
      // A stand-in recognizer that "hears" ねこ shortly after it starts.
      window.webkitSpeechRecognition = window.SpeechRecognition = class {
        start() {
          setTimeout(() => { this.onstart && this.onstart(); }, 20);
          setTimeout(() => { const r = [{ transcript: 'ねこ' }]; r.isFinal = true; this.onresult && this.onresult({ results: [r], resultIndex: 0 }); }, 150);
        }
        stop() {}
        abort() {}
      };
    });
    const p = later({ dirs: { listen: { due: T + 9 * DAY, s: 9, d: 5, lr: T - DAY, r: 2, pl: T - 9 * DAY } } });
    await open(page, { items: { 'n5:猫': p }, days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    // The mic waits for a tap: nothing listens until 🎤 is pressed.
    await expect(v.getByRole('button', { name: /Tap to answer out loud/ })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(v.getByText(/Heard it/)).toHaveCount(0);
    await v.getByRole('button', { name: /Tap to answer out loud/ }).click();
    await expect(v.getByText(/Heard it/)).toBeVisible();
    await v.getByRole('button', { name: 'Next', exact: true }).click();
    const say = (await saved(page)).items['n5:猫'].dirs.say;
    expect(say.r).toBe(1);
    expect(say.due).toBeGreaterThan(T);   // graded right
  });

  test('with "Start the mic on its own" on, Say it listens without a tap', async ({ page }) => {
    await page.addInitScript(() => {
      window.webkitSpeechRecognition = window.SpeechRecognition = class {
        start() {
          setTimeout(() => { this.onstart && this.onstart(); }, 20);
          setTimeout(() => { const r = [{ transcript: 'ねこ' }]; r.isFinal = true; this.onresult && this.onresult({ results: [r], resultIndex: 0 }); }, 150);
        }
        stop() {}
        abort() {}
      };
    });
    const p = later({ dirs: { listen: { due: T + 9 * DAY, s: 9, d: 5, lr: T - DAY, r: 2, pl: T - 9 * DAY } } });
    await open(page, { items: { 'n5:猫': p }, settings: { autoMic: true, hideIosHint: true }, days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    await expect(v.getByText(/Heard it/)).toBeVisible();
    await expect(v.getByRole('button', { name: /Tap to answer out loud/ })).toHaveCount(0);
  });

  test('quiet mode: Say it is graded by yourself, no mic', async ({ page }) => {
    const p = later({ dirs: { listen: { due: T + 9 * DAY, s: 9, d: 5, lr: T - DAY, r: 2, pl: T - 9 * DAY } } });
    await open(page, { items: { 'n5:猫': p }, settings: { quiet: true, hideIosHint: true }, days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    await expect(v.getByText(/Quiet mode: say it in your head/)).toBeVisible();
    await expect(v.locator('#gd-heard')).toHaveCount(0);
  });

  test('fewer new directions and grammar cards while accuracy is low, never more', async ({ page }) => {
    await open(page, { items: {} });
    const caps = await page.evaluate(async () => {
      const { newDirsPerDay, newGrammarPerDay } = await import('./js/tuning.js');
      const e = (r) => ({ recent: { vocab: r, listening: r, speaking: r, grammar: r } });
      return {
        fresh: [newDirsPerDay({ recent: {} }), newGrammarPerDay({ recent: {} })],
        good: [newDirsPerDay(e('1111111110')), newGrammarPerDay(e('1111111110'))],
        shaky: [newDirsPerDay(e('1111111000')), newGrammarPerDay(e('1111111000'))],
        low: [newDirsPerDay(e('1111100000')), newGrammarPerDay(e('1111100000'))],
      };
    });
    expect(caps).toEqual({ fresh: [3, 2], good: [3, 2], shaky: [1, 1], low: [0, 0] });
  });
});

test.describe('grammar cards', () => {
  test('reading a lesson plants a card for each of its grammar points', async ({ page }) => {
    await open(page, { items: {} }, '#/course/p1-3/lesson');
    const v = view(page);
    for (let i = 0; i < 20 && !(await v.locator('.recap').isVisible()); i++) await v.getByRole('button', { name: /Next|Finish/ }).click();
    const s = await saved(page);
    expect(Object.keys(s.grammar).sort()).toEqual(['g:p1-3:de-means', 'g:p1-3:de-place', 'g:p1-3:ni-he', 'g:p1-3:to-with']);
  });

  test('a practised conjugation form gets a card', async ({ page }) => {
    await open(page, { items: {} }, '#/play/conj');
    await view(page).locator('[data-act=pick]').first().click();
    const key = await page.evaluate(() => document.querySelector('#view .conj').dataset.qid);
    expect(Object.keys((await saved(page)).grammar)).toEqual([`cj:${key}`]);
  });

  test('a grammar card in the watering: blank, English, pick; a miss shows the answer and the point', async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0; });   // the right option ends up last
    await open(page, { items: {}, grammar: { 'g:p0-1:wa': { due: 0, s: 0, d: 0, lr: 0, r: 0, pl: T - DAY } },
      days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    await expect(v.locator('.card-dir')).toHaveText('Grammar');
    await expect(v.locator('.gram-show')).toContainText('（　）');
    await expect(v.getByText('The Master is a teacher.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await v.locator('[data-act=gpick]').first().click();   // wrong
    await expect(v.getByText('Answer:')).toBeVisible();
    await expect(v.getByText(/marks what you are talking about/)).toBeVisible();
    expect(await plainText(v.locator('.gram-show'))).toBe('師匠は 先生です。');
    const s = await saved(page);
    expect(s.grammar['g:p0-1:wa']).toMatchObject({ r: 1, lapses: 1 });
    expect(s.days['2026-10-10'].newg).toBe(1);
    expect(Object.values(s.engine.tally)[0].grammar).toEqual([0, 1]);
    await v.getByRole('button', { name: 'Next', exact: true }).click();
  });

  test('the keyboard picks an answer (1-4) and moves on (Enter)', async ({ page }) => {
    await open(page, { items: {}, grammar: { 'g:p1-2:wo': { due: 0, s: 0, d: 0, lr: 0, r: 0, pl: T - DAY } },
      days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    await page.keyboard.press('2');
    await expect(v.locator('[data-act=gnext]')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(v.locator('.card-review')).toHaveCount(0);
    expect((await saved(page)).grammar['g:p1-2:wo'].r).toBe(1);
  });

  test('examples rotate between reviews, at most 2 new grammar cards a day, and a helper lists due cards', async ({ page }) => {
    await open(page, { items: {}, grammar: {
      'g:p0-1:greetings': { due: 0, s: 0, d: 0, lr: 0, r: 0, pl: 1 },
      'g:p0-1:desu': { due: 0, s: 0, d: 0, lr: 0, r: 0, pl: 2 },
      'g:p0-1:wa': { due: 0, s: 0, d: 0, lr: 0, r: 0, pl: 3 },
      'g:p1-2:wo': { due: T - DAY, s: 3, d: 5, lr: T - 4 * DAY, r: 2, pl: 4 },
    } });
    const r = await page.evaluate(async () => {
      const { cardQuestion } = await import('./js/grammar-cards.js');
      const { store } = await import('./js/store.js');
      return {
        first: cardQuestion('g:p0-1:greetings', 0).blanked, second: cardQuestion('g:p0-1:greetings', 1).blanked,
        q: store.dailyGardenQueue(20).queue.filter((c) => c.kind === 'gram').map((c) => c.id + (c.isNew ? '*' : '')),
        due: store.dueGrammar(),
      };
    });
    expect(r.first).not.toBe(r.second);
    expect(r.q).toEqual(['g:p1-2:wo', 'g:p0-1:greetings*', 'g:p0-1:desu*']);
    expect(r.due).toEqual([{ key: 'g:p1-2:wo', due: T - DAY, help: false }]);
    // Another mode records a result through the same schedule.
    const after = await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      store.reviewGrammar('g:p1-2:wo', true);
      return { card: store.s.grammar['g:p1-2:wo'], due: store.dueGrammar() };
    });
    expect(after.card.r).toBe(3);
    expect(after.due).toEqual([]);
  });

  test('every grammar point that has a card blanks a piece that appears in its sentence', async ({ page }) => {
    await page.goto('./');
    const bad = await page.evaluate(async () => {
      const { STUDY_UNITS } = await import('./js/course-data.js');
      const { unitCardKeys, cardQuestion } = await import('./js/grammar-cards.js');
      const out = [];
      for (const u of STUDY_UNITS) {
        for (const key of unitCardKeys(u.id)) {
          for (let n = 0; n < 3; n++) {
            const q = cardQuestion(key, n, 4);
            if (!q || !q.blanked.includes('（　）') || q.blanked.replace('（　）', q.options[0]) !== q.show || new Set(q.options).size !== q.options.length) out.push(key);
          }
        }
      }
      return out;
    });
    expect(bad).toEqual([]);
  });
});

test.describe('help for stuck words', () => {
  test('4 misses mark a word as needing help: 🩹 on the plant, a help panel next time, cleared after two right', async ({ page }) => {
    await open(page, { items: { 'n5:切る': grown({ lapses: 3 }), 'n5:猫': later() }, days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, newd: 3, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    await answerCard(page, false);   // the 4th miss
    let p = (await saved(page)).items['n5:切る'];
    expect(p).toMatchObject({ lapses: 4, help: true, level: 4 });   // nothing is taken away
    await expect(v.locator('.plant.needs-help')).toHaveCount(1);
    await expect(v.locator('.plant.needs-help .bandage .ico-bandage')).toHaveCount(1);   // drawn as a line icon
    await expect(v.locator('.plant')).toHaveCount(2);   // never hidden

    // Practise it on purpose: the help panel comes first.
    await v.getByRole('button', { name: /Needs help \(1\)/ }).click();
    await expect(v.getByRole('heading', { name: /A little help first/ })).toBeVisible();
    await expect(v.locator('.mnemonic')).not.toBeEmpty();
    await expect(v.getByText('In a sentence')).toBeVisible();
    await expect(v.locator('.alike-jp', { hasText: '着る' })).toBeVisible();   // sounds alike: きる
    await expectNoHorizontalScroll(page);
    await v.getByRole('button', { name: /Hear it slowly/ }).click();
    expect(await page.evaluate(async () => (await import('./js/audio.js')).speaker.lastMethod)).toBe('clip');
    await v.getByRole('button', { name: /test me/ }).click();
    await v.getByRole('button', { name: /Check/ }).click();
    await v.getByRole('button', { name: /Knew it/ }).click();
    p = (await saved(page)).items['n5:切る'];
    expect(p).toMatchObject({ help: true, ok2: 1 });
    await v.getByRole('button', { name: /Needs help \(1\)/ }).click();
    await v.getByRole('button', { name: /test me/ }).click();
    await v.getByRole('button', { name: /Check/ }).click();
    await v.getByRole('button', { name: /Knew it/ }).click();
    p = (await saved(page)).items['n5:切る'];
    expect(p.help).toBeUndefined();
    expect(p.lapses).toBeUndefined();
    await expect(v.locator('.plant.needs-help')).toHaveCount(0);
    await expect(v.getByRole('button', { name: /Needs help/ })).toHaveCount(0);
  });

  test('a grammar card can need help too, and its panel shows the point with every example', async ({ page }) => {
    await open(page, { items: {}, grammar: { 'g:p0-1:ka': { due: T - DAY, s: 1, d: 7, lr: T - 2 * DAY, r: 6, pl: 1, lapses: 4, help: true } },
      days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    await expect(v.getByRole('heading', { name: /A little help first/ })).toBeVisible();
    expect(await plainText(v.locator('.help-panel .gp-title'))).toBe('か makes a question');
    await expect(v.locator('.help-ex')).toHaveCount(2);
    await page.keyboard.press('Enter');
    await expect(v.locator('.gram-show')).toBeVisible();
  });

  test('keyboard shortcuts still work on word cards', async ({ page }) => {
    await open(page, { items: { 'n5:猫': grown() }, days: { '2026-10-10': { ok: 0, tot: 0, rev: 0, newc: 5, newd: 3, studied: true, blocks: {} } } });
    const v = view(page);
    await v.getByRole('button', { name: /Water 1 plant/ }).click();
    await page.keyboard.press(' ');
    await expect(v.getByRole('button', { name: /Knew it/ })).toBeVisible();
    await page.keyboard.press('2');
    await expect(v.locator('.card-review')).toHaveCount(0);
    expect((await saved(page)).items['n5:猫'].r).toBe(7);
  });
});

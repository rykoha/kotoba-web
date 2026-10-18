// Rival Battle: attacks only from what's been learned, mixed kinds, combos and the finisher, counters that say the
// answer and bring the item back later, the training montage (you can't lose), Quiet mode, rivals unlocking with the
// story, grading through the store, every line voiced, and the optional weekend block on Today.
import { test, expect, seed, saved, view, expectNoHorizontalScroll } from './helpers.js';

const DAY = 86_400_000;

/** A learner with a few reviewed Garden words (half due), kana, and some practice-game history. */
async function learnerState(page, extra = {}) {
  await page.goto('./');
  const st = await page.evaluate(async (DAY) => {
    const { GARDEN_CATALOG } = await import('./js/data.js');
    const { CONJ_WORDS, NUMBER_SCENES } = await import('./js/practice-data.js');
    const { dayNumber } = await import('./js/skills.js');
    const now = Date.now();
    const items = {};
    Object.keys(GARDEN_CATALOG).filter((id) => id.startsWith('n5:')).slice(0, 8).forEach((id, i) => {
      items[id] = { level: 3, due: i % 2 ? now - DAY : now + 5 * DAY, best: 0, r: 3, pl: now - 9 * DAY, s: 3, d: 5, lr: now - 3 * DAY };
    });
    for (const k of 'あいうえお') items['kana:' + k] = { level: 3, due: now + 4 * DAY, best: 0, r: 2, pl: now - 9 * DAY, s: 4, d: 5, lr: now - 2 * DAY };
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dn = dayNumber(key);
    const mastery = {
      [`grammar|conj:${CONJ_WORDS[0].jp}|te`]: [80, 2, dn],
      'grammar|train:0': [80, 2, dn],
      [`counters|num:${NUMBER_SCENES[0].id}`]: [80, 2, dn],
    };
    return { v: 9, items, dojo: ['h1'], chapters: [], settings: { hideIosHint: true }, days: {},
      engine: { tally: {}, recent: {}, mastery, placement: null, placementSkip: true, checkin: null } };
  }, DAY);
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  return { ...st, ...extra };
}

/** The current attack's right answer, from the same pool the fight uses. */
async function rightIndex(page) {
  return page.evaluate(async () => {
    const key = document.querySelector('.rival[data-key]')?.dataset.key;
    const { attackPool } = await import('./js/rival-items.js');
    const a = attackPool().find((x) => x.key === key);
    const btns = [...document.querySelectorAll('.practice-opts button')];
    const text = (b) => { const c = b.cloneNode(true); c.querySelectorAll('rt').forEach((r) => r.remove()); return c.textContent.trim(); };
    return btns.findIndex((b) => text(b) === a.answer);
  });
}

async function answer(page, right) {
  const v = view(page);
  await expect(v.locator('.rival[data-key]')).toBeVisible();
  const ri = await rightIndex(page);
  expect(ri).toBeGreaterThanOrEqual(0);
  const n = await v.locator('.practice-opts button').count();
  await v.locator('.practice-opts button').nth(right ? ri : (ri + 1) % n).click();
}

async function next(page) {
  await expect(view(page).locator('.rival-finisher')).toHaveCount(0, { timeout: 4000 });
  await view(page).locator('[data-act=next]').click();
}

async function startFight(page) {
  await page.goto('./#/play/rival');
  await view(page).locator('[data-act=start]').click();
  await expect(view(page).locator('.rival[data-key]')).toBeVisible();
}

test.describe('Rival Battle', () => {
  test('choose a rival: Kaito first; others wait calmly for their story chapter', async ({ page }) => {
    await seed(page, await learnerState(page));
    await page.goto('./#/play/rival');
    const v = view(page);
    await expect(v.locator('[data-act=choose][data-id=kaito]')).toBeEnabled();
    await expect(v.locator('[data-act=choose][data-id=master]')).toBeDisabled();
    await expect(v.locator('[data-act=choose][data-id=master]')).toContainText('after story chapter 4');
    await expect(v.locator('[data-act=start]')).toContainText('Kaito');
    await expectNoHorizontalScroll(page);
  });

  test('clearing chapters brings in more rivals', async ({ page }) => {
    await seed(page, await learnerState(page, { chapters: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'] }));
    await page.goto('./#/play/rival');
    const v = view(page);
    await expect(v.locator('[data-act=choose][data-id=master]')).toBeEnabled();
    await expect(v.locator('[data-act=choose][data-id=sora]')).toBeEnabled();
    await expect(v.locator('[data-act=choose][data-id=kiku]')).toBeDisabled();
    await v.locator('[data-act=choose][data-id=master]').click();
    await expect(v.locator('[data-act=start]')).toContainText('Master');
  });

  test('with too little learned, the rivals wait (no fight, no blame)', async ({ page }) => {
    await seed(page, { v: 9, items: {}, settings: { hideIosHint: true } });
    await page.goto('./#/play/rival');
    await expect(view(page)).toContainText("The rivals wait until you've learned a little more");
    await expect(view(page).locator('[data-act=start]')).toBeDisabled();
  });

  test('attacks come only from what was learned, mixed; four right in a row is a finisher; the rival goes down', async ({ page }) => {
    await seed(page, await learnerState(page));
    await startFight(page);
    const keys = [];
    const kinds = new Set();
    for (let n = 0; n < 12; n++) {
      if (await view(page).locator('.rival-kicker').count()) break;   // the end screen
      keys.push(await view(page).locator('.rival[data-key]').getAttribute('data-key'));
      kinds.add(await view(page).locator('.rival[data-kind]').getAttribute('data-kind'));
      await answer(page, true);
      if (n === 3) {
        await expect(view(page).locator('.rival-finisher')).toBeVisible();
        await expectNoHorizontalScroll(page);
      }
      await next(page);
    }
    await expect(view(page).locator('.rival-kicker')).toContainText('KAITO IS DOWN');
    await expect(view(page)).toContainText("you've gotten stronger");
    // Kaito has 8 stamina: 4 hits with a finisher (1+1+1+3) and 2 more.
    expect(keys.length).toBe(6);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    const pool = await page.evaluate(async () => (await import('./js/rival-items.js')).attackPool().map((a) => a.key));
    for (const k of keys) expect(pool).toContain(k);
    // Graded through the store: today's tallies grew, and due Garden words were reviewed (no longer due).
    const s = await saved(page);
    const tally = Object.values(s.engine.tally)[0];
    expect(Object.values(tally).reduce((a, t) => a + t[1], 0)).toBeGreaterThanOrEqual(6);
    const reviewed = keys.filter((k) => k.startsWith('w:')).map((k) => k.slice(2));
    for (const id of reviewed) expect(s.items[id].due).toBeGreaterThan(Date.now() - 1000);
  });

  test('a miss costs nothing: the rival counters with the answer, and the attack comes back later', async ({ page }) => {
    await seed(page, await learnerState(page));
    await startFight(page);
    const first = await view(page).locator('.rival[data-key]').getAttribute('data-key');
    const before = await saved(page);
    await answer(page, false);
    await expect(view(page)).toContainText('Kaito counters');
    await expect(view(page).locator('.rival-text')).not.toHaveClass(/quiet/);   // the rival's counter line
    await expect(view(page).locator('.me-hp')).toHaveAttribute('aria-valuenow', '15');   // the attack took some stamina
    await expect(view(page).locator('.practice-opts .good')).toHaveCount(1);   // the answer is shown
    const after = await saved(page);
    for (const [id, p] of Object.entries(before.items)) expect(after.items[id].level).toBe(p.level);   // nothing knocked down
    const seen = [];
    for (let n = 0; n < 4; n++) {
      await next(page);
      seen.push(await view(page).locator('.rival[data-key]').getAttribute('data-key'));
      await answer(page, true);
    }
    expect(seen.slice(0, 2)).not.toContain(first);
    expect(seen).toContain(first);
  });

  test("you can't lose: running out of stamina turns into a training montage, then the rival respects you", async ({ page }) => {
    await seed(page, await learnerState(page));
    await startFight(page);
    for (let n = 0; n < 4; n++) {
      await answer(page, false);
      if (n === 3) {
        await expect(view(page).locator('.me-hp')).toHaveAttribute('aria-valuenow', '0');
        await expect(view(page).locator('.me-sprite')).toHaveClass(/ko/);
        await expect(view(page).locator('[data-act=next]')).toContainText('Train');
      }
      await next(page);
    }
    const v = view(page);
    await expect(v.locator('.montage')).toBeVisible();
    await expect(v).toContainText('TRAINING MONTAGE');
    for (let n = 0; n < 4 && await v.locator('[data-act=drill]').count(); n++) {   // one drill per missed item
      await v.locator('[data-act=drill]').click();
      const ri = await rightIndex(page);
      await v.locator('.practice-opts button').nth(ri).click();
      await v.locator('[data-act=mnext]').click();
    }
    await expect(v.locator('.rival-kicker')).toContainText('KAITO BOWS');
    await expect(v).toContainText("I don't hate people who don't give up");
    await expect(v).toContainText('THESE GOT THROUGH');
    await expectNoHorizontalScroll(page);
  });

  test('an attack that lands before you answer counts as a miss: stamina drops and the answer is shown', async ({ page }) => {
    await page.clock.install();
    await seed(page, await learnerState(page));
    await startFight(page);
    await page.clock.runFor(30_000);
    await expect(view(page)).toContainText("Too slow: Kaito's attack landed");
    await expect(view(page).locator('.practice-opts .good')).toHaveCount(1);
    await expect(view(page).locator('.me-hp')).toHaveAttribute('aria-valuenow', '15');
    await expect(view(page).locator('.atk-bubble')).toHaveClass(/landed/);
  });

  test('stamina bars run green, yellow, then red, and drain all the way before the rival goes down', async ({ page }) => {
    await page.goto('./');
    const bands = await page.evaluate(async () => {
      const { hpBand } = await import('./js/modes/rival.js');
      return [100, 60, 50, 30, 20, 5, 0].map(hpBand);
    });
    expect(bands).toEqual(['hp-high', 'hp-high', 'hp-mid', 'hp-mid', 'hp-low', 'hp-low', 'hp-low']);
    await seed(page, await learnerState(page));
    await startFight(page);
    const bar = view(page).locator('.foe-hp > span');
    await expect(bar).toHaveClass('hp-high');
    for (let n = 0; n < 7 && !(await view(page).locator('.foe-sprite.ko').count()); n++) {
      await answer(page, true);
      if (n === 4) await expect(bar).toHaveClass('hp-low');   // 8 stamina: 4 hits with a finisher (6) and one more leave 1
      await expect(view(page).locator('.rival-finisher')).toHaveCount(0, { timeout: 4000 });
      if (await view(page).locator('[data-act=next]', { hasText: 'Finish' }).count()) break;
      await next(page);
    }
    await expect(view(page).locator('[data-act=next]')).toContainText('Finish');
    await expect(bar).toHaveAttribute('style', /width: 0%/);
    await expect(view(page).locator('.foe-sprite')).toHaveClass(/ko/);
    await expect(view(page).locator('.rival-text')).toContainText('Kaito is down');
    await expect(view(page).locator('.rival-kicker')).toHaveCount(0);   // the end screen waits for you
    await next(page);
    await expect(view(page).locator('.rival-kicker')).toContainText('KAITO IS DOWN');
  });

  test('pick your own fighter: Ren and Aoi from the start, story characters once met; the pick is remembered', async ({ page }) => {
    await seed(page, await learnerState(page));
    await page.goto('./#/play/rival');
    const v = view(page);
    await expect(v.locator('[data-act=fighter][data-id=ren]')).toHaveAttribute('aria-checked', 'true');
    await expect(v.locator('[data-act=fighter][data-id=kaito]')).toBeEnabled();
    await expect(v.locator('[data-act=fighter][data-id=master]')).toBeDisabled();
    await v.locator('[data-act=fighter][data-id=aoi]').click();
    await expect(v.locator('[data-act=start]')).toContainText('as Aoi');
    await page.reload();
    await expect(v.locator('[data-act=fighter][data-id=aoi]')).toHaveAttribute('aria-checked', 'true');
    await v.locator('[data-act=start]').click();
    await expect(v.locator('.me-card')).toContainText('Aoi');
    await expect(v.locator('.foe-card')).toContainText('Kaito');
    await expectNoHorizontalScroll(page);
  });

  test('Quiet mode: tap answers only, no mic', async ({ page }) => {
    await seed(page, await learnerState(page, { settings: { hideIosHint: true, quiet: true } }));
    await page.goto('./#/play/rival');
    await expect(view(page)).toContainText('Quiet mode: tap answers only');
    await view(page).locator('[data-act=start]').click();
    await expect(view(page).locator('.rival[data-key]')).toBeVisible();
    await expect(view(page).locator('[data-act=mic]')).toHaveCount(0);
  });

  test('saying the answer counts as a hit (fake recognizer)', async ({ page }) => {
    await page.addInitScript(() => {
      class FakeSR {
        constructor() { window.__sr = this; this.lang = ''; }
        start() { setTimeout(() => this.onstart && this.onstart(), 10); }
        stop() { this.onend && this.onend(); }
        abort() { this.stop(); }
      }
      window.SpeechRecognition = FakeSR;
      window.webkitSpeechRecognition = FakeSR;
    });
    await seed(page, await learnerState(page));
    await page.goto('./#/play/rival');
    await view(page).locator('[data-act=start]').click();
    // Find an attack that can be said.
    for (let n = 0; n < 10 && !(await view(page).locator('[data-act=mic]').count()); n++) { await answer(page, true); await next(page); }
    const say = await page.evaluate(async () => {
      const key = document.querySelector('.rival[data-key]').dataset.key;
      return (await import('./js/rival-items.js')).attackPool().find((x) => x.key === key).sayable;
    });
    await view(page).locator('[data-act=mic]').click();
    await page.waitForFunction(() => window.__sr && window.__sr.onresult);
    await page.evaluate((text) => {
      const alt = { transcript: text, confidence: 0.9 };
      const result = Object.assign([alt], { isFinal: true });
      window.__sr.onresult({ resultIndex: 0, results: [result] });
    }, say);
    await expect(view(page).locator('.good-panel')).toContainText('Hit');
  });

  test('every rival line and finisher shout has a clip in its character\'s voice', async ({ page }) => {
    await page.goto('./');
    const missing = await page.evaluate(async () => {
      const { rivalLines } = await import('./js/rival-data.js');
      const { CLIPS } = await import('./js/clips.js');
      return rivalLines().flatMap(([l, v]) => [`${l.jp}#${v}`, `${l.jp}#${v}#slow`]).filter((k) => !CLIPS[k]);
    });
    expect(missing).toEqual([]);
    // And they play: each one decodes to a second or more of real audio.
    const lengths = await page.evaluate(async () => {
      const { rivalLines } = await import('./js/rival-data.js');
      const { CLIPS } = await import('./js/clips.js');
      const ctx = new OfflineAudioContext(1, 1, 24000);
      const out = [];
      for (const [l, v] of rivalLines()) {
        const buf = await (await fetch('./audio/' + CLIPS[`${l.jp}#${v}`])).arrayBuffer();
        out.push((await ctx.decodeAudioData(buf)).duration);
      }
      return out;
    });
    expect(lengths.length).toBe(108);   // 12 rivals (4 each at N5, N4, N3) × 7 lines, and 3 finishers and the montage line in 6 fighters' voices
    for (const d of lengths) expect(d).toBeGreaterThan(0.8);
  });

  test("every rival line's furigana matches its reading", async ({ page }) => {
    await page.goto('./');
    const wrong = await page.evaluate(async () => {
      const { rivalLines } = await import('./js/rival-data.js');
      const { readingOf } = await import('./js/furigana.js');
      const { toHiragana } = await import('./js/romaji.js');
      const clean = (s) => toHiragana(s).replace(/[、。！？「」…・\s]/g, '');
      const split = (s) => s.split(/[\s、。！？「」…]+/).filter(Boolean);
      const out = [];
      for (const [l] of rivalLines()) {
        const js = split(l.jp), ks = split(l.reading);
        if (js.length !== ks.length) { out.push(l.jp); continue; }
        js.forEach((seg, i) => { const r = readingOf(seg); if (r == null || clean(r) !== clean(ks[i])) out.push(seg); });
      }
      return out;
    });
    expect(wrong).toEqual([]);
  });

  test('listed in Modes', async ({ page }) => {
    await page.goto('./#/modes');
    await expect(view(page).locator('a[href="#/play/rival"]')).toContainText('Rival Battle');
  });
});

test.describe('Today: optional weekend Rival Battle', () => {
  test('Saturday offers it as optional; it never holds up finishing the day', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-17T10:00:00'));   // a Saturday
    await seed(page, await learnerState(page));
    await page.goto('./#/');
    const row = view(page).locator('.block-row', { hasText: 'Rival Battle' });
    await expect(row).toContainText('Optional');
    const plan = await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      const { todayPlan } = await import('./js/today.js');
      for (const b of todayPlan().blocks) if (!b.optional) store.setBlock(b.id, 'done');
      const p = todayPlan();
      return { finished: p.finished, rival: p.blocks.find((b) => b.id === 'rival') };
    });
    expect(plan.finished).toBe(true);
    expect(plan.rival.status).toBe(null);
    // The meter shows the bonus slot in its own colour, labelled as a bonus challenge.
    await page.reload();
    await expect(view(page).locator('.hero .pip.bonus')).toHaveCount(1);
    await expect(view(page).locator('.hero .pip.bonus.done')).toHaveCount(0);
    await expect(view(page).locator('.hero')).toContainText('+ bonus challenge');
    await expect(row).toContainText('bonus challenge');
    await expectNoHorizontalScroll(page);
  });

  test('it runs as a Today block and finishes it', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-18T10:00:00'));   // a Sunday
    await seed(page, await learnerState(page));
    await page.goto('./#/today/rival');
    await expect(page.locator('#banner')).toContainText('Rival Battle');
    for (let n = 0; n < 12; n++) {
      if (await view(page).locator('.rival-kicker').count()) break;
      await answer(page, true);
      await next(page);
    }
    await expect(view(page).locator('.rival-kicker')).toBeVisible();
    await expect(page.locator('#banner')).toContainText('done');
  });

  test('weekdays have no rival block', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T10:00:00'));   // a Wednesday
    await seed(page, await learnerState(page));
    await page.goto('./#/');
    await expect(view(page).locator('.block-row').first()).toBeVisible();
    await expect(view(page).locator('.block-row', { hasText: 'Rival Battle' })).toHaveCount(0);
  });
});

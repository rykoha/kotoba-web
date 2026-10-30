// Kana Brush: the stroke checker on made-up drawings, drawing with the mouse and with touch (no page scroll), misses
// that show the strokes and allow a retry, the guide fading, only Dojo kana, the Reading Dojo's schedule, the Today
// reading block, Settings credits, and the v9 -> v10 migration (tests/fixtures/progress-v9.json) and sync merge.
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, view, expectNoHorizontalScroll, studiedDays } from './helpers.js';

const FIXTURE_V9 = JSON.parse(readFileSync(new URL('./fixtures/progress-v9.json', import.meta.url), 'utf8'));
const DAY = 86_400_000;

/** A learner who has done the first two hiragana lessons (あ row and か row) and drawn nothing yet. */
function learner(extra = {}) {
  const items = {};
  const now = Date.now();
  for (const k of 'あいうえおかきくけこ') items['kana:' + k] = { level: 2, due: now + 5 * DAY, best: 0, r: 2, pl: now - 3 * DAY, s: 3, d: 5, lr: now - DAY };
  return {
    v: 9, items, lastSession: null, chapters: [], forged: [], dojo: ['h1', 'h2'], storyReplays: {},
    settings: { hideIosHint: true, readingHelp: 'romaji' }, days: {}, ...extra,
  };
}

/** Draws strokes (in KanjiVG's 109 box) on the pad with the mouse. */
async function drawStrokes(page, strokes) {
  const box = await view(page).locator('.brush-canvas').boundingBox();
  const at = ([x, y]) => [box.x + (x / 109) * box.width, box.y + (y / 109) * box.height];
  for (const s of strokes) {
    const [x0, y0] = at(s[0]);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (const p of s.slice(1)) { const [x, y] = at(p); await page.mouse.move(x, y); }
    await page.mouse.up();
  }
}

/** The model strokes of a kana as points, a little wobbly (like a real hand), moved and resized a bit. */
async function modelStrokes(page, kana, { wobble = 2, scale = 0.9, dx = 3, dy = -2 } = {}) {
  return page.evaluate(async ([k, wobble, scale, dx, dy]) => {
    const { STROKES } = await import('./js/kana-strokes.js');
    const { modelPoints, resample } = await import('./js/brush-check.js');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    return modelPoints(STROKES[k].map((s) => s[0])).map((s) => resample(s, 14)
      .map(([x, y]) => [(x - 54.5) * scale + 54.5 + dx + rnd() * wobble, (y - 54.5) * scale + 54.5 + dy + rnd() * wobble]));
  }, [kana, wobble, scale, dx, dy]);
}

const currentKana = (page) => view(page).locator('.brush').getAttribute('data-k');

async function startRound(page) {
  await view(page).locator('[data-act=start]').click();
  await expect(view(page).locator('.brush-canvas')).toBeVisible();
}

test.describe('stroke checker', () => {
  test('every kana passes as itself, sloppily drawn, and never as a different-looking kana', async ({ page }) => {
    test.setTimeout(120_000);   // ~19,000 drawings checked: close to 30 s even on an idle machine
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { STROKES } = await import('./js/kana-strokes.js');
      const { BRUSH_KANA } = await import('./js/brush-data.js');
      const { modelPoints, checkDrawing } = await import('./js/brush-check.js');
      const P = Object.fromEntries(BRUSH_KANA.map((x) => [x.k, STROKES[x.k].map((s) => s[0])]));
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
      const fails = [];
      const confused = [];
      for (const k of Object.keys(P)) {
        for (const [scale, dx, dy] of [[1, 0, 0], [0.75, 8, -6], [1.15, -4, 4]]) {
          const drawn = modelPoints(P[k]).map((s) => {
            const ox = rnd() * 4, oy = rnd() * 4;
            return s.map(([x, y]) => [(x - 54.5) * scale + 54.5 + dx + ox + rnd() * 2, (y - 54.5) * scale + 54.5 + dy + oy + rnd() * 2]);
          });
          if (checkDrawing(drawn, P[k], { others: P, self: k }).verdict === 'miss') fails.push(`${k}@${scale}`);
        }
        for (const j of Object.keys(P)) {
          if (j === k) continue;
          const v = checkDrawing(modelPoints(P[j]), P[k], { others: P, self: k }).verdict;
          if (v !== 'miss') confused.push(`${j} as ${k}`);
        }
      }
      return { n: Object.keys(P).length, fails, confused };
    });
    expect(r.n).toBeGreaterThan(130);
    expect(r.fails).toEqual([]);
    // Only kana written exactly the same way in both scripts count as each other.
    expect(r.confused.sort()).toEqual(['ぺ as ペ', 'ベ as べ', 'ペ as ぺ', 'べ as ベ', 'へ as ヘ', 'ヘ as へ'].sort());
  });

  test('generous: strokes out of order, two joined, or one split are "close"; wrong count, shape or look-alike miss', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { STROKES } = await import('./js/kana-strokes.js');
      const { BRUSH_KANA } = await import('./js/brush-data.js');
      const { modelPoints, checkDrawing } = await import('./js/brush-check.js');
      const P = Object.fromEntries(BRUSH_KANA.map((x) => [x.k, STROKES[x.k].map((s) => s[0])]));
      const m = (k) => modelPoints(P[k]);
      const check = (drawn, k) => checkDrawing(drawn, P[k], { others: P, self: k });
      const [i1, i2] = m('い');
      const ki = m('き');
      const ri = m('り');
      const sa = m('さ');
      const ke = m('け');
      const ka = m('か');
      const half = Math.floor(ka[0].length / 2);
      return {
        great: check(m('あ'), 'あ'),
        order: check([i2, i1], 'い'),
        joined: check([ki[0], ki[1], ki[2].concat(ki[3])], 'き'),
        joinedRi: check([ri[0].concat(ri[1])], 'り'),
        joinedSa: check([sa[0], sa[1].concat(sa[2])], 'さ'),
        split: check([ka[0].slice(0, half + 1), ka[0].slice(half), ka[1], ka[2]], 'か'),
        count: check([ke[0]], 'け'),
        dashes: check([0, 1, 2, 3, 4, 5].map((n) => [[5 + n * 3, 100], [7 + n * 3, 100]]), 'あ'),
        shape: check([[[10, 10], [100, 100]], [[100, 10], [10, 100]]], 'い'),
        like: check(m('ぬ'), 'め'),
        empty: check([], 'あ'),
      };
    });
    expect(r.great).toMatchObject({ verdict: 'great', why: 'ok' });
    expect(r.order).toMatchObject({ verdict: 'close', why: 'order' });
    expect(r.joined).toMatchObject({ verdict: 'close', why: 'joined', at: 3 });
    expect(r.joinedRi).toMatchObject({ verdict: 'close', why: 'joined', at: 1 });
    expect(r.joinedSa).toMatchObject({ verdict: 'close', why: 'joined', at: 2 });
    expect(r.split).toMatchObject({ verdict: 'close', why: 'split' });
    // け's first stroke alone is a miss, said as a stroke count or as the kana it looks like (し, レ…).
    expect(r.count).toMatchObject({ verdict: 'miss', drawn: 1, expected: 3 });
    expect(['count', 'like']).toContain(r.count.why);
    expect(r.dashes).toMatchObject({ verdict: 'miss', why: 'count', drawn: 6, expected: 3 });
    expect(r.shape.verdict).toBe('miss');
    expect(r.like).toMatchObject({ verdict: 'miss', why: 'like', like: 'ぬ' });
    expect(r.empty).toMatchObject({ verdict: 'miss', why: 'empty' });
  });

  test('a stroke drawn backwards is "close" and named; a look-alike pair has its own tip', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { STROKES } = await import('./js/kana-strokes.js');
      const { BRUSH_KANA, lookalikeTip } = await import('./js/brush-data.js');
      const { modelPoints, checkDrawing, length } = await import('./js/brush-check.js');
      const P = Object.fromEntries(BRUSH_KANA.map((x) => [x.k, STROKES[x.k].map((s) => s[0])]));
      const m = (k) => modelPoints(P[k]);
      const check = (drawn, k) => checkDrawing(drawn, P[k], { others: P, self: k });
      const ke = m('け');
      const ta = m('た');
      // Every kana with each single stroke reversed: only dots and ticks (they read the same both ways) pass as is.
      const passed = [];
      let flagged = 0;
      for (const k of Object.keys(P)) {
        m(k).forEach((s, i) => {
          const why = check(m(k).map((t, j) => (j === i ? t.slice().reverse() : t)), k).why;
          if (why === 'ok' && length(s) >= 20) passed.push(`${k}${i + 1}`);
          if (why === 'backwards') flagged++;
        });
      }
      return {
        ke: check([ke[0], ke[1].slice().reverse(), ke[2]], 'け'),
        ta: check([ta[0].slice().reverse(), ta[1], ta[2], ta[3].slice().reverse()], 'た'),
        // ン drawn for ソ is ン, not ソ backwards.
        nAsSo: check(m('ン'), 'ソ'),
        passed,
        flagged,
        tip: lookalikeTip('ツ', 'シ'),
        same: lookalikeTip('シ', 'ツ'),
        general: lookalikeTip('あ', 'お'),
      };
    });
    expect(r.ke).toMatchObject({ verdict: 'close', why: 'backwards', strokes: [2] });
    expect(r.ta).toMatchObject({ verdict: 'close', why: 'backwards', strokes: [1, 4] });
    expect(r.nAsSo).toMatchObject({ verdict: 'miss', why: 'like', like: 'ン' });
    expect(r.passed).toEqual([]);
    expect(r.flagged).toBeGreaterThan(300);
    expect(r.tip).toContain('sweeping UP');
    expect(r.same).toBe(r.tip);
    expect(r.general).toMatch(/starts/);
  });

  test('each brush kana has stroke data and its own writing mnemonic; sound-alikes are left out', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { BRUSH_KANA, SOUND_ALIKES } = await import('./js/brush-data.js');
      const { STROKES } = await import('./js/kana-strokes.js');
      const { LESSONS } = await import('./js/dojo-data.js');
      const dojoM = new Set(LESSONS.flatMap((l) => l.chars.map((c) => c.m)).filter(Boolean));
      return {
        missing: BRUSH_KANA.filter((x) => !STROKES[x.k] || !x.m).map((x) => x.k),
        reused: BRUSH_KANA.filter((x) => dojoM.has(x.m)).map((x) => x.k),
        alikes: BRUSH_KANA.filter((x) => SOUND_ALIKES.has(x.k)).map((x) => x.k),
        sounds: BRUSH_KANA.filter((x, i) => BRUSH_KANA.some((y, j) => j !== i && y.track === x.track && y.r === x.r)).map((x) => x.k),
      };
    });
    expect(r.missing).toEqual([]);
    expect(r.reused).toEqual([]);   // original wording, not the Dojo's reading hooks
    expect(r.alikes).toEqual([]);
    expect(r.sounds).toEqual([]);   // one sound, one kana per script: the prompt is never ambiguous
  });
});

test.describe('Kana Brush mode', () => {
  test('with no Dojo kana met yet, it points to the Reading Dojo', async ({ page }) => {
    await seed(page, { v: 9, items: {}, dojo: [], settings: { hideIosHint: true } });
    await page.goto('./#/play/brush');
    await expect(view(page)).toContainText("Kana Brush uses the kana you've met in the Reading Dojo");
    await expect(view(page).locator('a[href="#/play/dojo"]')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('draw the kana you hear with the mouse: it passes and schedules its drawing card', async ({ page }) => {
    await seed(page, learner());
    await page.goto('./#/play/brush');
    await expect(view(page)).toContainText('10');   // kana met
    await expectNoHorizontalScroll(page);
    await startRound(page);
    const k = await currentKana(page);
    expect('あいうえおかきくけこ').toContain(k);
    // The prompt is the sound, not the printed kana.
    await expect(view(page).locator('.brush-ask')).not.toContainText(k);
    await expect(view(page).locator('[data-act=hear-cur]')).toBeVisible();
    // A new kana gets the full guide and its mnemonic up front.
    await expect(view(page).locator('.brush-guide')).toHaveCount(1);
    await expect(view(page).locator('.brush-hint')).toBeVisible();
    await view(page).locator('[data-act=romaji]').click();
    await expect(view(page).locator('.brush-romaji .mono')).toBeVisible();

    await drawStrokes(page, await modelStrokes(page, k));
    await view(page).locator('[data-act=check]').click();
    await expect(view(page).locator('.brush-feedback')).toContainText(/Great|Right|Now you have it/);
    await expect(view(page).locator('.brush-answer-k')).toHaveText(k);
    await expectNoHorizontalScroll(page);
    const s = await saved(page);
    const card = s.items['kana:' + k].dirs.draw;
    expect(card.r).toBe(1);
    expect(card.due).toBeGreaterThan(Date.now());
    // The reading item itself is untouched.
    expect(s.items['kana:' + k].r).toBe(2);
  });

  test('a miss draws the strokes in order, then a retry with the guide on; nothing is lost', async ({ page }) => {
    await seed(page, learner());
    await page.goto('./#/play/brush');
    await startRound(page);
    const k = await currentKana(page);
    await drawStrokes(page, [[[20, 90], [40, 90]]]);   // a short dash: wrong for every kana here
    await view(page).locator('[data-act=check]').click();
    const strokes = await page.evaluate(async (kk) => (await import('./js/kana-strokes.js')).STROKES[kk].length, k);
    await expect(view(page).locator('.brush-model')).toHaveCount(strokes);
    await expect(view(page).locator('.brush-num')).toHaveCount(strokes);
    await expect(view(page).locator('.brush-feedback')).toContainText(k);
    let s = await saved(page);
    const missCard = s.items['kana:' + k].dirs.draw;
    expect(missCard.due).toBeLessThanOrEqual(Date.now() + DAY / 2 + 1000);   // comes back soon
    expect(s.items['kana:' + k].level).toBe(2);                               // never knocked down

    await view(page).locator('[data-act=retry]').click();
    await expect(view(page).locator('.brush-guide')).toHaveCount(1);
    await drawStrokes(page, await modelStrokes(page, k));
    await view(page).locator('[data-act=check]').click();
    await expect(view(page).locator('.brush-feedback')).toContainText('Now you have it');
    s = await saved(page);
    expect(s.items['kana:' + k].dirs.draw.r).toBe(1);   // the retry is practice: only the first try is graded
  });

  test('a new kana plays its strokes first; touching the pad skips ahead; a drawn kana does not', async ({ page }) => {
    const now = Date.now();
    const st = learner();
    st.items = { 'kana:あ': st.items['kana:あ'], 'kana:い': { ...st.items['kana:い'], dirs: { draw: { due: now - 1000, s: 2, d: 5, lr: now - 2 * DAY, r: 2, pl: now - 5 * DAY } } } };
    await seed(page, st);
    await page.goto('./#/play/brush');
    await startRound(page);
    for (let n = 0; n < 2; n++) {
      const k = await currentKana(page);
      if (k === 'あ') {
        await expect(view(page).locator('.brush-pad.demo')).toHaveCount(1);
        await expect(view(page).locator('.brush-model')).toHaveCount(3);
        await expect(view(page).locator('.brush-instr')).toContainText('New one: watch the strokes');
        // The demo clears on its own once the strokes have played…
        await expect(view(page).locator('.brush-model')).toHaveCount(0, { timeout: 6000 });
        await expect(view(page).locator('.brush-pad.demo')).toHaveCount(0);
        await expect(view(page).locator('.brush-guide')).toHaveCount(1);
      } else {
        await expect(view(page).locator('.brush-pad.demo')).toHaveCount(0);
        await expect(view(page).locator('.brush-model')).toHaveCount(0);
      }
      await drawStrokes(page, await modelStrokes(page, k));
      await view(page).locator('[data-act=check]').click();
      await expect(view(page).locator('.brush-feedback')).toContainText(/Great|Right/);
      await view(page).locator('[data-act=next]').click();
    }
    // …or as soon as the learner starts drawing.
    await view(page).locator('[data-act=start]').click();
    await expect(view(page).locator('.brush-canvas')).toBeVisible();
    while ((await currentKana(page)) !== 'あ') {
      await drawStrokes(page, await modelStrokes(page, await currentKana(page)));
      await view(page).locator('[data-act=check]').click();
      await view(page).locator('[data-act=next]').click();
    }
    // あ has been drawn now, so no demo the second time round.
    await expect(view(page).locator('.brush-pad.demo')).toHaveCount(0);
  });

  test('a demo is skipped by drawing; a look-alike shows both kana with a tip; an off stroke is marked', async ({ page }) => {
    const st = learner();
    for (const k of 'ぬめ') st.items['kana:' + k] = { ...st.items['kana:あ'] };
    st.items = { 'kana:ぬ': st.items['kana:ぬ'], 'kana:め': st.items['kana:め'] };
    await seed(page, st);
    await page.goto('./#/play/brush');
    await startRound(page);
    const k = await currentKana(page);
    const other = k === 'ぬ' ? 'め' : 'ぬ';
    await expect(view(page).locator('.brush-pad.demo')).toHaveCount(1);
    await drawStrokes(page, await modelStrokes(page, other, { wobble: 0.5 }));
    await expect(view(page).locator('.brush-pad.demo')).toHaveCount(0);
    await view(page).locator('[data-act=check]').click();
    await expect(view(page).locator('.brush-pair-k')).toHaveCount(2);
    await expect(view(page).locator('.brush-pair-k.asked')).toContainText(k);
    await expect(view(page).locator('.brush-pair-k.other')).toContainText(other);
    await expect(view(page).locator('.brush-pair-tip')).toContainText('little loop');
    await expect(view(page).locator('.brush-feedback')).toContainText('comes back at the end of this round');
    await expectNoHorizontalScroll(page);
    await view(page).locator('[data-act=retry]').click();
    await expect(view(page).locator('.brush-pad.demo')).toHaveCount(0);   // the demo is once per kana
    // A drawing with the right stroke count but one stroke way off marks that stroke.
    const strokes = await modelStrokes(page, k);
    strokes[0] = strokes[0].map(([x, y]) => [x * 0.3 + 70, y * 0.3 + 70]);
    await drawStrokes(page, strokes);
    await view(page).locator('[data-act=check]').click();
    await expect(view(page).locator('.brush-feedback')).toContainText('Close, but stroke 1 is off');
    await expect(view(page).locator('.brush-model.mark')).toHaveCount(1);
    await expect(view(page).locator('.brush-feedback')).not.toContainText('comes back at the end');   // said once
  });

  test('"show me" reveals the answer without drawing; Undo and Clear work', async ({ page }) => {
    await seed(page, learner());
    await page.goto('./#/play/brush');
    await startRound(page);
    const k = await currentKana(page);
    await drawStrokes(page, [[[20, 20], [80, 20]], [[20, 60], [80, 60]]]);
    const ink = () => page.evaluate(() => {
      const c = document.querySelector('.brush-canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
      return n;
    });
    const two = await ink();
    await view(page).locator('[data-act=undo]').click();
    const one = await ink();
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(two);
    await view(page).locator('[data-act=clear]').click();
    expect(await ink()).toBe(0);
    await view(page).locator('[data-act=check]').click();
    await expect(view(page).locator('.brush-feedback')).toContainText('Draw it in the box first');
    expect((await saved(page)).items['kana:' + k].dirs).toBeUndefined();   // an empty check isn't graded

    await view(page).locator('[data-act=giveup]').click();
    await expect(view(page).locator('.brush-model').first()).toBeAttached();
    await expect(view(page).locator('[data-act=retry]')).toBeVisible();
    expect((await saved(page)).items['kana:' + k].dirs.draw.r).toBe(1);
  });

  test('only kana met in the Dojo come up, due ones first; a whole round finishes', async ({ page }) => {
    test.setTimeout(90_000);   // 8 drawings, then 8 comebacks
    const now = Date.now();
    const st = learner();
    st.items['kana:え'].dirs = { draw: { due: now - DAY, s: 2, d: 5, lr: now - 3 * DAY, r: 2, pl: now - 5 * DAY } };
    await seed(page, st);
    await page.goto('./#/play/brush');
    await expect(view(page).locator('.brush-cell')).toHaveCount(10);
    await startRound(page);
    const seen = [];
    for (let n = 0; n < 8; n++) {
      const k = await currentKana(page);
      seen.push(k);
      await view(page).locator('[data-act=giveup]').click();
      await view(page).locator('[data-act=retry]').click();
      await drawStrokes(page, await modelStrokes(page, k));
      await view(page).locator('[data-act=check]').click();
      await view(page).locator('[data-act=next]').click();
    }
    // Each miss comes back once at the end of the round, from memory (no guide), and isn't graded again.
    for (let n = 0; n < 8; n++) {
      const k = await currentKana(page);
      expect(seen).toContain(k);
      await expect(view(page).locator('.brush-guide')).toHaveCount(0);
      await expect(view(page).locator('.brush-guide-word')).toHaveText('Comeback: from memory');
      if (n < 3) await drawStrokes(page, await modelStrokes(page, k));
      else await drawStrokes(page, [[[20, 90], [40, 90]]]);
      await view(page).locator('[data-act=check]').click();
      if (n >= 3) {
        await expect(view(page).locator('.brush-feedback')).not.toContainText('comes back at the end');
        await view(page).locator('[data-act=retry]').click();
        await drawStrokes(page, await modelStrokes(page, k));
        await view(page).locator('[data-act=check]').click();
      }
      await view(page).locator('[data-act=next]').click();
    }
    await expect(view(page).locator('.score-huge')).toHaveText('0/8');
    await expect(view(page).locator('.brush-comeback-sum')).toHaveText('Comeback: 3 of 8 missed kana drawn from memory.');
    await expect(view(page).locator('.chips .chip')).toHaveCount(5);
    expect(seen).toContain('え');
    for (const k of seen) expect('あいうえおかきくけこ').toContain(k);
    expect(new Set(seen).size).toBe(8);
    const s = await saved(page);
    expect(Object.keys(s.items).filter((id) => s.items[id].dirs?.draw).length).toBe(8);
    // Comebacks are practice, not graded: one review each (え had two before this round).
    for (const k of seen) expect(s.items['kana:' + k].dirs.draw.r).toBe(k === 'え' ? 3 : 1);
    const order = await page.evaluate(async () => {
      const { pickRound } = await import('./js/modes/brush.js');
      return pickRound(3);
    });
    expect(order.length).toBe(3);
  });

  test('the guide fades as a kana gets stronger', async ({ page }) => {
    const now = Date.now();
    const st = learner();
    const card = (s) => ({ due: now - 1000, s, d: 5, lr: now - 2 * DAY, r: 3, pl: now - 9 * DAY });
    st.items = { 'kana:あ': { ...st.items['kana:あ'], dirs: { draw: card(30) } } };
    await seed(page, st);
    await page.goto('./#/play/brush');
    await startRound(page);
    await expect(view(page).locator('.brush-guide')).toHaveCount(0);
    await expect(view(page).locator('.brush-hint')).toHaveCount(0);
    await expect(view(page)).toContainText('From memory');
    const levels = await page.evaluate(async () => {
      const { guideLevel } = await import('./js/modes/brush.js');
      return [null, { r: 0, s: 0 }, { r: 1, s: 0.5 }, { r: 2, s: 2 }, { r: 4, s: 9 }, { r: 9, s: 9, help: true }].map(guideLevel);
    });
    expect(levels).toEqual([1, 1, 0.6, 0.3, 0, 1]);
  });

  test('touch drawing on a phone draws and never scrolls the page', async ({ page, browserName }, info) => {
    test.skip(info.project.name !== 'phone', 'touch is a phone test');
    await seed(page, learner());
    await page.goto('./#/play/brush');
    await startRound(page);
    const k = await currentKana(page);
    await view(page).locator('.brush-pad').scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    const box = await view(page).locator('.brush-canvas').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const strokes = await modelStrokes(page, k);
    for (const s of strokes) {
      const pts = s.map(([x, y]) => ({ x: box.x + (x / 109) * box.width, y: box.y + (y / 109) * box.height }));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
      for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    // A swipe straight down the pad would scroll the page anywhere else.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height - 10 }] });
    for (let n = 1; n <= 10; n++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height - 10 - n * 25 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await view(page).locator('[data-act=undo]').click();   // drop the swipe
    await view(page).locator('[data-act=check]').click();
    await expect(view(page).locator('.brush-feedback')).toContainText(/Great|Right|Now you have it/);
  });

  test('listed in Modes; the Reading Dojo links to it with the due count', async ({ page }) => {
    const now = Date.now();
    const st = learner();
    st.items['kana:い'].dirs = { draw: { due: now - DAY, s: 2, d: 5, lr: now - 3 * DAY, r: 2, pl: now - 5 * DAY } };
    await seed(page, st);
    await page.goto('./#/modes');
    await expect(view(page).locator('a[href="#/play/brush"]')).toContainText('Kana Brush');
    await page.goto('./#/play/dojo');
    await expect(view(page).locator('a[href="#/play/brush"]')).toContainText('Draw 1 kana that is due');
    await expectNoHorizontalScroll(page);
  });

  test('Settings credits KanjiVG', async ({ page }) => {
    await page.goto('./#/settings');
    await expect(view(page)).toContainText('KanjiVG');
    await expect(view(page)).toContainText('CC BY-SA 3.0');
  });
});

test.describe('Today', () => {
  // 2026-10-13 is day 20739 since 1970 (a multiple of 3): a Kana Brush day. The 14th is not.
  test('every third day while kana are being learned, the reading block is Kana Brush, and it runs', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
    await seed(page, learner());
    await page.goto('./#/');
    const row = view(page).locator('.block-row').first();
    await expect(row).toContainText('Reading · Kana Brush');
    await page.goto('./#/today/dojo');
    await expect(view(page).locator('.brush-canvas')).toBeVisible();
    await expect(page.locator('#banner')).toContainText('Kana Brush');
    for (let n = 0; n < 6; n++) {
      const k = await currentKana(page);
      await drawStrokes(page, await modelStrokes(page, k));
      await view(page).locator('[data-act=check]').click();
      await view(page).locator('[data-act=next]').click();
    }
    await expect(page.locator('#banner')).toContainText('done');
    const s = await saved(page);
    expect(s.days['2026-10-13'].blocks.dojo).toBe('done');
  });

  test('other days keep the Dojo lesson; so do readers who finished the kana', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T10:00:00'));
    await seed(page, learner());
    await page.goto('./#/');
    await expect(view(page).locator('.block-row').first()).toContainText('Reading Dojo');
    const finished = await page.evaluate(async () => {
      const { todayPlan, brushDay } = await import('./js/today.js');
      return { brush: brushDay(new Date('2026-10-13T10:00:00'), { beginner: false, dojoDue: 0 }), first: todayPlan(new Date('2026-10-13T10:00:00')).blocks[0].mode };
    });
    expect(finished.brush).toBe(false);
    expect(finished.first).toBe('brush');   // this learner is still a beginner
  });
});

test.describe('saved progress v9 → v10', () => {
  test('the v9 fixture loads with every word, review date, chapter and setting kept', async ({ page }) => {
    await seed(page, FIXTURE_V9);
    await page.goto('./');
    const s = await saved(page);
    expect(s.v).toBe(17);
    expect(s.items).toEqual(FIXTURE_V9.items);
    expect(s.settings).toEqual({ ...FIXTURE_V9.settings, showAllLevels: false });
    expect(s.coach).toEqual(FIXTURE_V9.coach);
    for (const k of ['chapters', 'forged', 'dojo', 'saga', 'course', 'engine', 'grammar', 'days', 'storyReplays', 'exam']) expect(k === 'days' ? studiedDays(s[k]) : s[k], k).toEqual(k === 'exam' ? { ...FIXTURE_V9[k], goal: null } : k === 'days' ? studiedDays(FIXTURE_V9[k]) : FIXTURE_V9[k]);   // v14 adds the test date goal
  });

  test('migrated kana can be drawn; drawing cards survive reload, export and import, and the sync merge', async ({ page }) => {
    await seed(page, FIXTURE_V9);
    await page.goto('./#/play/brush');
    await expect(view(page).locator('.brush-cell')).toHaveCount(8);   // あいうえおかくキ: met in the Dojo
    await startRound(page);
    const k = await currentKana(page);
    await drawStrokes(page, await modelStrokes(page, k));
    await view(page).locator('[data-act=check]').click();
    await expect(view(page).locator('.brush-feedback')).toContainText(/Great|Right|Now you have it/);
    await page.reload();
    const s = await saved(page);
    const card = s.items['kana:' + k].dirs.draw;
    expect(card.r).toBe(1);
    // Everything else from the fixture is still there.
    for (const [id, p] of Object.entries(FIXTURE_V9.items)) {
      if (id !== 'kana:' + k) expect(s.items[id]).toEqual(p);
      else expect({ ...s.items[id], dirs: undefined }).toEqual({ ...p, dirs: undefined });
    }
    const r = await page.evaluate(async ([fx, kk]) => {
      const { store, mergeProgress } = await import('./js/store.js');
      const back = store.parseImport(store.exportCode());
      // Another device that never drew: the merge keeps this device's drawing card, and the newer review wins.
      const merged = mergeProgress(fx, JSON.parse(localStorage.getItem('kotobaBeat.v1')));
      const merged2 = mergeProgress(JSON.parse(localStorage.getItem('kotobaBeat.v1')), fx);
      // A drawing card on a garden word is not a thing: it is dropped, its Listen card kept.
      const odd = store.parseImport(JSON.stringify({ ...fx, items: { ...fx.items, arigatou: { ...fx.items.arigatou, dirs: { ...fx.items.arigatou.dirs, draw: { due: 1, r: 1 } } } } }));
      return { back: back.items['kana:' + kk].dirs.draw, merged: merged.items['kana:' + kk].dirs.draw, merged2: merged2.items['kana:' + kk].dirs.draw, odd: odd.items.arigatou.dirs };
    }, [FIXTURE_V9, k]);
    expect(r.back).toEqual(card);
    expect(r.merged).toEqual(card);
    expect(r.merged2).toEqual(card);
    expect(Object.keys(r.odd)).toEqual(['listen']);
  });
});

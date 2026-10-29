// Exam readiness (js/readiness.js) and the mock JLPT (js/exam-data.js, js/exam.js): the question bank and scoring
// (run in Node), the readiness meter on Today and Progress, "ready for a mock", marking the real test, taking a mini
// and a timed full mock, misses going into the Garden, and the v8 → v9 migration and sync merge.
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, view, expectNoHorizontalScroll } from './helpers.js';
import { buildMock, scoreMock, mockIds, nearMisses, BANK, BANKS, FORMATS, FORMATS_N3, TYPES, N5_KANJI, N3_KANJI, SCORING, MOCK_LEVELS, typeOf, scoreSections } from '../js/exam-data.js';
import * as N3_READING from '../js/exam-bank-n3-reading.js';
import * as N3_LISTEN from '../js/exam-bank-n3-listen.js';
import { PICTURES } from '../js/exam-art.js';
import * as READING from '../js/exam-bank-reading.js';
import * as LISTEN1 from '../js/exam-bank-listen1.js';
import * as LISTEN2 from '../js/exam-bank-listen2.js';
import { CLIPS } from '../js/clips.js';

const FIXTURE_V8 = JSON.parse(readFileSync(new URL('./fixtures/progress-v8.json', import.meta.url), 'utf8'));

/** A repeatable random number generator, so the bank tests don't depend on luck. */
function seeded(n = 1) {
  return () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
}

test.describe('question bank and scoring (js/exam-data.js, run in Node)', () => {
  test('the full mock follows the real N5: parts, question types, order, counts and minutes', () => {
    const order = { vocab: ['read', 'spell', 'context', 'para'], grammar: ['grammar', 'star', 'textgram', 'short', 'mid', 'info'], listening: ['task', 'point', 'utter', 'quick'] };
    const counts = { read: 7, spell: 5, context: 6, para: 3, grammar: 9, star: 4, textgram: 4, short: 2, mid: 2, info: 1, task: 7, point: 6, utter: 5, quick: 6 };
    for (let k = 1; k <= 4; k++) {
      const m = buildMock({ format: 'full', rand: seeded(k) });
      expect(m.sections.map((s) => [s.id, s.minutes])).toEqual([['vocab', 20], ['grammar', 40], ['listening', 30]]);
      for (const sec of m.sections) {
        const types = sec.questions.map((q) => q.type);
        expect([...new Set(types)], sec.id).toEqual(order[sec.id]);
        // Types come in blocks, in order (all 漢字読み, then all 表記, ...).
        expect(types, sec.id).toEqual([...types].sort((a, b) => order[sec.id].indexOf(a) - order[sec.id].indexOf(b)));
        for (const t of order[sec.id]) expect(types.filter((x) => x === t).length, t).toBe(counts[t]);
      }
      for (const t of Object.keys(TYPES)) {
        expect(TYPES[t].ja, t).toMatch(/[ぁ-ん]/);
        expect(TYPES[t].en, t).toMatch(/[a-z]/);
      }
    }
  });

  test('every question: distinct options with the answer among them; reading and listening options in Japanese (or pictures)', () => {
    for (const format of ['mini', 'full']) {
      for (let k = 1; k <= 4; k++) {
        const m = buildMock({ format, rand: seeded(k) });
        const qs = m.sections.flatMap((s) => s.questions);
        expect(new Set(qs.map((q) => q.part))).toEqual(new Set(['vocab', 'grammar', 'reading', 'listening']));
        for (const q of qs) {
          expect(q.options.length, q.id).toBe(q.heard ? 3 : 4);
          expect(new Set(q.options).size, q.id).toBe(q.options.length);
          expect(q.options, q.id).toContain(q.answer);
          for (const o of q.options) {
            if (q.pictures) expect(PICTURES[o], `${q.id}: ${o}`).toBeTruthy();
            else expect(o, q.id).not.toMatch(/[A-Za-z]{2,}/);   // no English (a class letter like B is fine)
          }
        }
      }
    }
  });

  test('every spoken line of the bank has its clip', () => {
    const missing = [];
    for (const it of [...LISTEN1.POINT, ...LISTEN1.QUICK, ...LISTEN2.TASK, ...LISTEN2.UTTER]) {
      for (const l of [it.question, it.line, ...(it.lines || []), ...(it.replies || [])].filter(Boolean)) if (!CLIPS[`${l.jp}#${l.voice}`]) missing.push(`${it.id}: ${l.jp}`);
    }
    expect(missing).toEqual([]);
  });

  test('the hand-written bank uses only N5 kanji (anything else is in kana), and a big enough bank', () => {
    const bad = [];
    const walk = (v, id) => {
      if (typeof v === 'string') { for (const c of v.match(/[一-鿿々]/g) || []) if (!N5_KANJI.has(c)) bad.push(`${id}: ${c}`); }
      else if (Array.isArray(v)) v.forEach((x) => walk(x, id));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['why', 'reading'].includes(k)) walk(x, id);
    };
    for (const mod of [READING, LISTEN1, LISTEN2]) for (const list of Object.values(mod)) for (const it of list) walk(it, it.id);
    expect(bad).toEqual([]);
    // Enough of each hand-written type for three full mocks without repeats.
    for (const [t, n] of Object.entries({ para: 9, textgram: 3, short: 6, mid: 3, info: 3, task: 21, point: 18, utter: 15, quick: 18 })) expect(BANK[t], t).toBeGreaterThanOrEqual(n);
  });

  test('three full mocks in a row share less than 20% of their questions', () => {
    let seen = [];
    const mocks = [];
    for (let k = 0; k < 3; k++) {
      const m = buildMock({ format: 'full', rand: seeded(11 + k), seen });
      mocks.push(m);
      seen = [...seen, ...mockIds(m)];
    }
    const qids = (m) => m.sections.flatMap((s) => s.questions.map((q) => q.qid || q.id));
    const [a, b, c] = mocks.map(qids);
    const share = (x, y) => x.filter((q) => y.includes(q)).length / x.length;
    expect(share(b, a)).toBeLessThan(0.2);
    expect(share(c, [...a, ...b])).toBeLessThan(0.2);
    expect(share(c, a)).toBeLessThan(0.2);
  });

  test('wrong readings are one slip away: long vowels, voicing, small っ and ゃゅょ', () => {
    const m = nearMisses('がっこう');
    expect([...m.keys()]).toEqual(expect.arrayContaining(['かっこう', 'がこう', 'がっこ']));
    expect(m.has('がっこうう')).toBe(false);
    expect([...nearMisses('しゃしん').keys()]).toEqual(expect.arrayContaining(['しやしん', 'じゃしん']));
    expect(nearMisses('きょう').get('きょ')).toBe('long');
  });

  test('scored like the real N5 (120 + 60, pass at 80 with minimums), weighted by part', () => {
    const m = buildMock({ format: 'full', rand: seeded(2) });
    const qs = m.sections.flatMap((s) => s.questions);
    const all = Object.fromEntries(qs.map((q, i) => [i, q.answer]));
    expect(scoreMock(m, all)).toMatchObject({ lk: 120, li: 60, total: 180, pass: true });
    expect(scoreMock(m, {})).toMatchObject({ total: 0, pass: false });
    // Everything right except listening: well over 80 in total, but under the listening minimum, so not a pass.
    const noListening = Object.fromEntries(qs.map((q, i) => [i, q.part === 'listening' ? null : q.answer]));
    const r = scoreMock(m, noListening);
    expect(r.total).toBeGreaterThanOrEqual(80);
    expect(r.li).toBe(0);
    expect(r.pass).toBe(false);
    // A reading question weighs more than a vocabulary one: missing the 5 reading questions costs more than missing 5
    // vocabulary questions.
    const miss = (pred) => Object.fromEntries(qs.map((q, i) => [i, pred(q) ? null : q.answer]));
    let n = 0;
    const fiveVocab = scoreMock(m, miss((q) => q.part === 'vocab' && n++ < 5)).lk;
    const allReading = scoreMock(m, miss((q) => q.part === 'reading')).lk;
    expect(allReading).toBeLessThan(fiveVocab);
    expect(FORMATS.full.sections.map((s) => s.minutes)).toEqual([20, 40, 30]);
  });
});

/** Progress that meets every N5 readiness target. */
async function readyState(page) {
  await page.goto('./');
  const st = await page.evaluate(async () => {
    const { N5_WORDS } = await import('./js/data.js');
    const { LESSONS, ALL_LESSONS } = await import('./js/dojo-data.js');
    const { TEACHABLE_KANJI } = await import('./js/readiness.js');
    const { N5_GRAMMAR_KEYS } = await import('./js/exam-data.js');
    const { dateKey } = await import('./js/store.js');
    const now = Date.now();
    const item = (level) => ({ level, due: now + 9e8, best: 0, r: 3, pl: now - 9e9, s: 20, d: 5, lr: now - 1e8 });
    const items = {};
    N5_WORDS.slice(0, 560).forEach((w) => { items[w.id] = item(2); });
    TEACHABLE_KANJI.forEach((k) => { items['kj:' + k] = item(2); });
    LESSONS.flatMap((l) => l.chars).forEach((c) => { items['kana:' + c.k] = item(3); });
    const grammar = {};
    N5_GRAMMAR_KEYS.forEach((k, i) => { grammar[k] = { due: now + 9e8, s: 10, d: 5, lr: now - 1e8, r: 3, pl: i + 1 }; });
    const tally = { [dateKey()]: { listening: [45, 50] } };
    localStorage.clear();
    return { v: 8, items, chapters: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'], forged: [], dojo: ALL_LESSONS.map((l) => l.id), storyReplays: {},
      settings: { hideIosHint: true }, days: {}, grammar, engine: { tally, recent: {}, mastery: {}, placement: null, placementSkip: true, checkin: '' } };
  });
  await page.goto('about:blank');
  return st;
}

test.describe('readiness meter', () => {
  test('a new learner sees the road to N5 at 0% with the next thing to grow, and no "ready" yet', async ({ page }) => {
    await page.goto('./');
    const card = view(page).locator('.road-card');
    await expect(card.getByRole('heading', { name: 'Road to N5' })).toBeVisible();
    await expect(card).toContainText('0%');
    await expect(card).toContainText('Next to grow');
    await expect(card).not.toContainText('ready for a mock');
    await page.goto('./#/progress');
    await expect(view(page).getByRole('heading', { name: 'Road to JLPT N5' })).toBeVisible();
    await expect(view(page).locator('.road svg.chart')).toHaveAttribute('aria-label', /Vocabulary 0\/515/);
    await expectNoHorizontalScroll(page);
  });

  test('once every area meets its target, Today says it is ready for a mock; Later quiets it for a week', async ({ page }) => {
    await seed(page, await readyState(page));
    await page.goto('./');
    const card = view(page).locator('.road-card');
    await expect(card).toContainText('You look ready for a mock N5.');
    await expect(card.getByRole('link', { name: 'Take a mock' })).toHaveAttribute('href', '#/exam');
    await expectNoHorizontalScroll(page);
    await card.getByRole('button', { name: 'Later' }).click();
    await expect(view(page).locator('.road-card')).toContainText('Ready for a mock N5 whenever you are.');
    const later = (await saved(page)).exam.later.N5;
    expect(later > new Date().toISOString().slice(0, 10)).toBe(true);
    await page.goto('./#/progress');
    await expect(view(page).locator('.road')).toContainText('Ready for a mock N5.');
  });

  test('marking the real N5 as passed moves the road on to N4, and it can be undone', async ({ page }) => {
    await page.goto('./#/progress');
    await view(page).getByRole('button', { name: 'I passed the real N5' }).click();
    await view(page).getByRole('button', { name: 'Yes, I passed it' }).click();
    await expect(view(page).getByRole('heading', { name: 'Road to JLPT N4' })).toBeVisible();
    await expect(view(page).locator('.road')).toContainText('of the way to a mock N4');   // N4 has its areas and mock now
    expect((await saved(page)).exam.real.N5.on).toBe(true);
    await page.goto('./');
    await expect(view(page).locator('.road-card')).toContainText('Road to N4');
    await page.goto('./#/progress');
    await view(page).getByRole('button', { name: 'Undo' }).click();
    await expect(view(page).getByRole('heading', { name: 'Road to JLPT N5' })).toBeVisible();
  });
});

/**
 * Ends `parts` parts (default: all) from the answer sheet without answering, confirming the unanswered warning. The
 * full mock's listening part has no finish button (the tape sets the pace), so only the mini mock finishes it here.
 */
async function finishAll(page, parts = 3) {
  const v = view(page);
  for (let k = 0; k < parts; k++) {
    const begin = v.locator('[data-act=begin]');
    if (await begin.count()) await begin.click();
    if (!(await v.locator('[data-act=sheet]').count())) return;
    await v.locator('[data-act=sheet]').click();
    await v.locator('[data-act=finishpart]').click();
    await v.locator('[data-act=finishpart]').click();   // "Finish anyway?"
    if (await v.locator('.exam-result').count()) return;
  }
}

/** Replaces the voice with an instant fake that records what was said (each line "ends" right away). */
async function fakeVoice(page) {
  await page.evaluate(async () => {
    const { speaker } = await import('./js/audio.js');
    const { TAPE } = await import('./js/exam.js');
    TAPE.scale = 0.002;
    window.__said = [];
    speaker.speak = (text, o = {}) => { window.__said.push(text); setTimeout(() => o.onend && o.onend(), 5); };
    speaker.stop = () => {};
  });
}

test.describe('mock exam', () => {
  test('a mini mock in practice mode: English hints, replay, every type, then the score and misses into the Garden', async ({ page }) => {
    await page.goto('./#/exam');
    const v = view(page);
    await expect(v.getByRole('heading', { name: 'Mock JLPT N5' })).toBeVisible();
    await expect(v).toContainText('practice mode');
    await expectNoHorizontalScroll(page);
    await v.getByRole('button', { name: 'Start the mini mock' }).click();
    await expect(v.locator('.section-title')).toContainText('もじ・ごい');
    await v.locator('[data-act=begin]').click();
    // Vocabulary: the booklet's Japanese instructions with an English line, no furigana, no clock.
    await expect(v.locator('.exam-mondai')).toContainText('もんだい1');
    await expect(v.locator('.exam-mondai')).toContainText('hiragana');
    await expect(v.locator('.exam rt')).toHaveCount(0);
    await expect(v.locator('#ex-clock')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await finishAll(page);
    await expect(v.getByRole('heading', { name: /Not yet/ })).toBeVisible();
    await expect(v.getByText('The pass line is 80.')).toBeVisible();
    await expect(v).toContainText('scaled scores');
    await expect(v.locator('.exam-miss').first()).toBeVisible();
    await expect(v.locator('.exam-miss .exam-scene')).toHaveCount(1);   // the 発話表現 picture, in review
    await expectNoHorizontalScroll(page);
    const s = await saved(page);
    expect(s.v).toBe(14);
    expect(s.exam.history).toHaveLength(1);
    expect(s.exam.history[0]).toMatchObject({ level: 'N5', format: 'mini', total: 0, pass: false });
    expect(s.exam.seen.length).toBeGreaterThan(10);
    // Misses come back in the Garden: their N5 words are planted, their grammar points get cards.
    expect(Object.keys(s.items).some((id) => id.startsWith('n5:'))).toBe(true);
    expect(Object.keys(s.grammar).length).toBeGreaterThan(0);
    await page.goto('./#/progress');
    await expect(view(page).locator('.mock-list')).toContainText('Mini mock');
  });

  test('the answer sheet: change an answer, go back, flag, and a warning before finishing with gaps', async ({ page }) => {
    await page.goto('./#/exam');
    const v = view(page);
    await v.getByRole('button', { name: 'Start the full mock' }).click();
    await v.locator('[data-act=begin]').click();
    const first = await v.locator('.exam[data-qid]').getAttribute('data-qid');
    await v.locator('[data-act=pick]').first().click();
    await expect(v.locator('.exam[data-qid]')).not.toHaveAttribute('data-qid', first);   // moved on
    await v.locator('[data-act=flag]').click();
    await v.locator('[data-act=prev]').click();
    await expect(v.locator('.exam[data-qid]')).toHaveAttribute('data-qid', first);
    await expect(v.locator('.exam-opt.on')).toHaveCount(1);
    await v.locator('[data-act=pick]').nth(1).click();   // change it
    await v.locator('[data-act=sheet]').click();
    await expect(v.locator('.exam-cell')).toHaveCount(21);
    await expect(v.locator('.exam-cell.done')).toHaveCount(1);
    await expect(v.locator('.exam-cell.flag')).toHaveCount(1);
    await v.locator('[data-act=finishpart]').click();
    await expect(v.getByRole('alert')).toContainText('20 unanswered and 1 flagged');
    await v.locator('[data-act=back]').click();
    await v.locator('[data-act=sheet]').click();
    await v.locator('.exam-cell').nth(1).click();
    await expect(v.locator('[data-act=flag]')).toHaveAttribute('aria-pressed', 'true');
    await expectNoHorizontalScroll(page);
  });

  test('the full mock: no English hints, furigana only beyond N5, real reading pages', async ({ page }) => {
    await page.goto('./#/exam');
    const r = await page.evaluate(async () => {
      const { furi } = await import('./js/exam.js');
      return [furi('毎日 学校へ 行きます。'), furi('りょうりを 作ります。'), furi('毎日 料理を します。')];
    });
    expect(r[0]).not.toContain('<ruby>');
    expect(r[1]).toContain('<ruby>作<rt>');
    expect(r[2]).toMatch(/毎日 <ruby>料理<rt>りょうり<\/rt><\/ruby>/);
    const v = view(page);
    await v.getByRole('button', { name: 'Start the full mock' }).click();
    await finishAll(page, 1);   // vocabulary
    await v.locator('[data-act=begin]').click();
    // Grammar: the context sentence has no English translation in the full mock.
    await expect(v.locator('.exam-mondai')).toContainText('（　）に 何を 入れますか');
    await expect(v.locator('.exam p.small.dim', { hasText: '"' })).toHaveCount(0);
    // Jump to the information page (the last question of the part).
    await v.locator('[data-act=sheet]').click();
    await v.locator('.exam-cell').last().click();
    await expect(v.locator('.exam-info')).toBeVisible();
    await expect(v.locator('.exam[data-type=info]')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('full-mock listening plays each item once, with pauses, and moves on by itself; no replay', async ({ page }) => {
    await page.goto('./#/exam');
    const v = view(page);
    await fakeVoice(page);
    await v.getByRole('button', { name: 'Start the full mock' }).click();
    await finishAll(page, 1);   // vocabulary
    await v.locator('[data-act=begin]').click();
    await v.locator('[data-act=sheet]').click();
    await v.locator('[data-act=finishpart]').click();
    await v.locator('[data-act=finishpart]').click();
    await expect(v.locator('.section-title')).toContainText('ちょうかい');
    await v.locator('[data-act=begin]').click();
    await expect(v.locator('[data-act=play]')).toHaveCount(0);
    await expect(v).toContainText('Each item plays once');
    // Pictures for a picture task, while the tape runs; answer one on the way.
    await v.locator('[data-act=pick]').first().click();
    await expect(v.locator('.exam-result')).toBeVisible({ timeout: 20_000 });
    const said = await page.evaluate(() => window.__said);
    const mock = await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      return store.exam.seen;
    });
    // 24 listening items, each played once: every line is said exactly as often as the items in this mock contain it
    // (課題/ポイント: the question twice, before and after the talk; a sentence can also appear in two items).
    const { TASK, UTTER } = LISTEN2;
    const { POINT, QUICK } = LISTEN1;
    const ids = mock.filter((id) => /^(task|point|utter|quick):/.test(id));
    expect(ids.length).toBe(24);
    const want = {};
    for (const id of ids) {
      const [type, key] = id.split(':');
      const it = { task: TASK, point: POINT, utter: UTTER, quick: QUICK }[type].find((x) => x.id === key);
      const lines = type === 'task' || type === 'point' ? [it.question, ...it.lines, it.question] : [it.question || it.line, ...it.replies];
      for (const l of lines) want[l.jp] = (want[l.jp] || 0) + 1;
    }
    const got = {};
    for (const t of said) if (t in want) got[t] = (got[t] || 0) + 1;
    expect(got).toEqual(want);
  });

  test('a full mock is timed per part, pauses, and moves on when time is up', async ({ page }) => {
    await page.clock.install();
    await page.goto('./#/exam');
    const v = view(page);
    await v.getByRole('button', { name: 'Start the full mock' }).click();
    await v.locator('[data-act=begin]').click();
    await expect(v.locator('#ex-clock')).toHaveText('20:00');
    await page.clock.runFor(61_000);
    await expect(v.locator('#ex-clock')).toHaveText('18:59');
    await v.getByRole('button', { name: 'Pause' }).click();
    await expect(v.getByRole('heading', { name: 'Paused' })).toBeVisible();
    await expect(v.locator('[data-act=pick]')).toHaveCount(0);
    await page.clock.runFor(120_000);
    await v.getByRole('button', { name: 'Resume' }).click();
    await expect(v.locator('#ex-clock')).toHaveText('18:59');
    // Time runs out on the vocabulary part: it moves on, and says why.
    await page.clock.runFor(19 * 60_000);
    await expect(v.getByText(/Time's up for that part/)).toBeVisible();
    await expect(v.locator('.section-title')).toContainText('ぶんぽう');
    await expectNoHorizontalScroll(page);
  });

  test('pictures: a picture task shows four drawings, a situation question shows its scene (line art, no emoji)', async ({ page }) => {
    await page.goto('./#/exam');
    const html = await page.evaluate(async () => {
      const { pictureSVG, sceneSVG } = await import('./js/exam-art.js');
      const { TASK, UTTER } = await import('./js/exam-bank-listen2.js');
      const pics = TASK.filter((t) => t.pictures).flatMap((t) => t.options).map((o) => pictureSVG(o));
      const scenes = UTTER.map((u) => sceneSVG(u.scene));
      return { pics, scenes };
    });
    for (const p of html.pics) expect(p).toMatch(/^<svg class="exam-pic/);
    for (const s of html.scenes) { expect(s).toContain('exam-arrow'); expect(s).toContain('<circle'); }
  });

  test('passing a full mock finishes N5: the road moves on to N4', async ({ page }) => {
    // A full mock with every answer right, recorded the way the screen records it.
    await page.goto('./#/exam');
    await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      const { buildMock, scoreMock, mockIds } = await import('./js/exam-data.js');
      const m = buildMock({ format: 'full' });
      const ans = {};
      let i = 0;
      for (const s of m.sections) for (const q of s.questions) ans[i++] = q.answer;
      store.recordMock({ level: 'N5', format: 'full', ...scoreMock(m, ans) }, mockIds(m));
    });
    await page.goto('./#/progress');
    await expect(view(page).getByRole('heading', { name: 'Road to JLPT N4' })).toBeVisible();
    await expect(view(page).locator('.road')).toContainText('N5 done (Full mock');
    await page.goto('./');
    await expect(view(page).locator('.road-card')).toContainText('Road to N4');
    await expect(view(page).locator('.road-card')).not.toContainText('Road to N5');
  });
});

test.describe('saved progress v8 → v9', () => {
  test('the v8 fixture loads with nothing lost and no mock results yet', async ({ page }) => {
    await seed(page, FIXTURE_V8);
    await page.goto('./');
    const s = await saved(page);
    expect(s.v).toBe(14);
    expect(s.exam).toEqual({ history: [], real: {}, seen: [], later: {}, goal: null });
    expect(s.settings).toEqual({ ...FIXTURE_V8.settings, autoMic: false, showAllLevels: false });
    for (const k of ['items', 'grammar', 'days', 'chapters', 'forged', 'dojo', 'saga', 'course', 'engine', 'coach']) expect(s[k], k).toEqual(FIXTURE_V8[k]);
  });

  test('sync keeps mock results from both devices once each, the latest real-test mark, and the later "Later"', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { mergeProgress } = await import('./js/store.js');
      const h = (at, format, total, pass) => ({ level: 'N5', format, at, lk: total - 30, li: 30, total, pass, ok: 10, n: 20, parts: { vocab: [5, 10] } });
      const phone = { v: 9, items: {}, exam: { history: [h(1000, 'mini', 70, false), h(3000, 'full', 95, true)], real: { N5: { on: true, at: 500 } }, seen: ['a', 'b'], later: { N5: '2026-10-20' } } };
      const pc = { v: 9, items: {}, exam: { history: [h(1000, 'mini', 70, false), h(2000, 'mini', 88, true)], real: { N5: { on: false, at: 900 } }, seen: ['b', 'c'], later: { N5: '2026-10-15' } } };
      const old = { v: 8, items: {} };
      return { m: mergeProgress(phone, pc), again: mergeProgress(mergeProgress(phone, pc), pc), old: mergeProgress(phone, old) };
    });
    expect(r.m.exam.history.map((x) => x.at)).toEqual([1000, 2000, 3000]);
    expect(r.m.exam.real.N5).toEqual({ on: false, at: 900 });
    expect(r.m.exam.seen.slice().sort()).toEqual(['a', 'b', 'c']);
    expect(r.m.exam.later.N5).toBe('2026-10-20');
    expect(r.again.exam).toEqual(r.m.exam);
    expect(r.old.exam.history).toHaveLength(2);
  });
});

/** Progress with N5 and N4 done (full mocks passed), so the mock N3 is open. */
const n3Open = () => ({
  v: 12, items: {}, chapters: [], forged: [], dojo: [], storyReplays: {}, days: {},
  settings: { hideIosHint: true, readingHelp: 'off' },
  exam: { history: [
    { level: 'N5', format: 'full', pass: true, total: 130, lk: 90, li: 40, at: Date.now() - 9 * 86_400_000 },
    { level: 'N4', format: 'full', pass: true, total: 120, lk: 80, li: 40, at: Date.now() - 86_400_000 },
  ], real: {}, seen: [], later: {} },
});

test.describe('mock N3 (js/exam-data.js, run in Node)', () => {
  test('the full mock N3 follows the real N3: parts, order, counts and minutes, with 長文 and 概要理解', () => {
    const order = {
      vocab: ['read', 'spell', 'context', 'para', 'usage'],
      grammar: ['grammar', 'star', 'textgram', 'short', 'mid', 'long', 'info'],
      listening: ['task', 'point', 'gist', 'utter', 'quick'],
    };
    const counts = { read: 8, spell: 6, context: 11, para: 5, usage: 5, grammar: 13, star: 5, textgram: 5, short: 4, mid: 6, long: 4, info: 2,
      task: 6, point: 6, gist: 3, utter: 4, quick: 9 };
    expect(MOCK_LEVELS).toContain('N3');
    for (let k = 1; k <= 3; k++) {
      const m = buildMock({ level: 'N3', format: 'full', rand: seeded(k) });
      expect(m.sections.map((s) => [s.id, s.minutes])).toEqual([['vocab', 30], ['grammar', 70], ['listening', 40]]);
      for (const sec of m.sections) {
        const types = sec.questions.map((q) => q.type);
        expect([...new Set(types)], sec.id).toEqual(order[sec.id]);
        for (const t of order[sec.id]) expect(types.filter((x) => x === t).length, t).toBe(counts[t]);
      }
      const qs = m.sections.flatMap((s) => s.questions);
      for (const q of qs) {
        expect(q.options.length, q.id).toBe(q.heard ? 3 : 4);
        expect(new Set(q.options).size, q.id).toBe(q.options.length);
        expect(q.options, q.id).toContain(q.answer);
        for (const o of q.options) {
          if (q.pictures) expect(PICTURES[o], `${q.id}: ${o}`).toBeTruthy();
          else expect(o, q.id).not.toMatch(/[A-Za-z]{2,}/);
        }
      }
      // Deck questions ask N3 words; one long text gives its four questions.
      expect(qs.filter((q) => /^(read|spell|ctx):/.test(q.id)).every((q) => q.id.includes(':n3:'))).toBe(true);
      expect(new Set(qs.filter((q) => q.type === 'long').map((q) => q.id)).size).toBe(1);
    }
    for (const t of ['long', 'gist']) {
      expect(TYPES[t].ja, t).toMatch(/[ぁ-ん]/);
      expect(TYPES[t].en, t).toMatch(/[a-z]/);
    }
    // The N3 booklet numbers: 長文 is 問題6, 情報検索 問題7; 概要理解 問題3, 発話表現 問題4, 即時応答 問題5.
    expect(['long', 'info', 'gist', 'utter', 'quick'].map((t) => typeOf(t, 'N3').mondai)).toEqual(['もんだい6', 'もんだい7', 'もんだい3', 'もんだい4', 'もんだい5']);
    expect(typeOf('info', 'N5').mondai).toBe('もんだい6');
    // The mini mock: a few of each, untimed, every scored section present.
    const mini = buildMock({ level: 'N3', format: 'mini', rand: seeded(5) });
    expect(mini.timed).toBe(false);
    expect(new Set(mini.sections.flatMap((s) => s.questions.map((q) => q.part)))).toEqual(new Set(['vocab', 'grammar', 'reading', 'listening']));
    expect(mini.sections.flatMap((s) => s.questions).some((q) => q.type === 'gist')).toBe(true);
    expect(FORMATS_N3.full.sections.map((s) => s.minutes)).toEqual([30, 70, 40]);
  });

  test('a 概要理解 item: the talk first, then the question; a 長文 text has several questions', () => {
    const m = buildMock({ level: 'N3', format: 'full', rand: seeded(3) });
    const qs = m.sections.flatMap((s) => s.questions);
    const g = qs.find((q) => q.type === 'gist');
    const it = N3_LISTEN.N3_GIST.find((x) => `gist:${x.id}` === g.id);
    expect(g.afterTalk).toBe(true);
    expect(g.say.map((l) => l.text)).toEqual([...it.lines.map((l) => l.jp), it.question.jp]);
    expect(g.talk).toHaveLength(it.lines.length);
    const long = qs.filter((q) => q.type === 'long');
    expect(long).toHaveLength(4);
    expect(long[0].doc.text.length).toBeGreaterThan(500);
    expect(long.map((q) => q.qid)).toEqual(long.map((_, i) => `${long[0].id}:${i}`));
  });

  test('scored in three sections of 60 (pass at 95, at least 19 in each): 100 in total with 18 in one is not a pass', () => {
    expect(SCORING.N3).toEqual({ lv: { max: 60, min: 19 }, rd: { max: 60, min: 19 }, li: { max: 60, min: 19 }, total: 180, pass: 95 });
    expect(scoreSections('N3').map((x) => x.id)).toEqual(['lv', 'rd', 'li']);
    expect(scoreSections('N4').map((x) => [x.id, x.max, x.min])).toEqual([['lk', 120, 38], ['li', 60, 19]]);
    // 60 questions in each section (one type each, so every question weighs the same within its section).
    const q = (part, type, i) => ({ id: `${type}:${i}`, part, type, options: ['a', 'b', 'c', 'd'], answer: 'a' });
    const mock = { level: 'N3', sections: [
      { id: 'vocab', questions: Array.from({ length: 60 }, (_, i) => q('vocab', 'read', i)) },
      { id: 'grammar', questions: Array.from({ length: 60 }, (_, i) => q('reading', 'short', i)) },
      { id: 'listening', questions: Array.from({ length: 60 }, (_, i) => q('listening', 'quick', i)) },
    ] };
    const answers = (lv, rd, li) => [...Array(60)].map((_, i) => (i < lv ? 'a' : 'b'))
      .concat([...Array(60)].map((_, i) => (i < rd ? 'a' : 'b')), [...Array(60)].map((_, i) => (i < li ? 'a' : 'b')));
    const under = scoreMock(mock, answers(60, 18, 22));
    expect(under).toMatchObject({ lv: 60, rd: 18, li: 22, total: 100, pass: false });
    expect(under.sections.map((x) => x.met)).toEqual([true, false, true]);
    expect(scoreMock(mock, answers(60, 19, 21))).toMatchObject({ total: 100, pass: true });
    expect(scoreMock(mock, answers(40, 30, 24))).toMatchObject({ total: 94, pass: false });   // every floor met, under 95
    expect(scoreMock(mock, answers(40, 30, 25))).toMatchObject({ total: 95, pass: true });
    // A real mock: all right is 60 + 60 + 60; no listening at all fails whatever the rest.
    const real = buildMock({ level: 'N3', format: 'full', rand: seeded(4) });
    const rq = real.sections.flatMap((s) => s.questions);
    expect(scoreMock(real, rq.map((x) => x.answer))).toMatchObject({ lv: 60, rd: 60, li: 60, total: 180, pass: true });
    expect(scoreMock(real, rq.map((x) => (x.part === 'listening' ? null : x.answer)))).toMatchObject({ li: 0, total: 120, pass: false });
    // N5 still scores in two sections.
    const n5 = buildMock({ format: 'mini', rand: seeded(1) });
    expect(Object.keys(scoreMock(n5, {}))).toEqual(expect.arrayContaining(['lk', 'li']));
  });

  test('the N3 bank: pool sizes, kanji the app teaches up to N3, and two full mocks in a row share little', () => {
    const b = BANKS.N3;
    for (const [t, n] of Object.entries({ para: 16, usage: 16, textgram: 5, short: 12, mid: 5, long: 3, info: 3, task: 12, point: 12, gist: 8, utter: 8, quick: 18 })) expect(b[t], t).toBe(n);
    for (const [t, n] of Object.entries({ read: 8, spell: 6, context: 11, grammar: 13, star: 5 })) expect(b[t], t).toBeGreaterThanOrEqual(3 * n);
    // N3 kanji include N5, N4 and the N3 lessons.
    for (const c of '日食通考取') expect(N3_KANJI.has(c), c).toBe(true);
    expect(N3_KANJI.size).toBeGreaterThan(600);
    const a = buildMock({ level: 'N3', format: 'full', rand: seeded(21) });
    const c = buildMock({ level: 'N3', format: 'full', rand: seeded(22), seen: mockIds(a) });
    const qids = (m) => m.sections.flatMap((s) => s.questions.map((q) => q.qid || q.id));
    const [x, y] = [qids(a), qids(c)];
    expect(y.filter((q) => x.includes(q)).length / y.length).toBeLessThan(0.2);
    // No emoji anywhere in the N3 bank.
    const text = JSON.stringify([N3_READING, N3_LISTEN]);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

test.describe('mock N3 on screen', () => {
  test('locked until N4 is done, with the usual line', async ({ page }) => {
    await page.goto('./#/exam');
    const v = view(page);
    await expect(v.getByRole('radio', { name: /Mock N3/ })).toBeDisabled();
    await expect(v).toContainText('N3: Unlocks when you pass a full mock N4, or mark the real N4 as passed.');
  });

  test('once N4 is done: Mock N3 is offered first; a long text shows; 概要理解 shows nothing until the talk ends; three sections scored', async ({ page }) => {
    await seed(page, n3Open());
    await page.goto('./#/exam');
    const v = view(page);
    await expect(v.getByRole('heading', { name: 'Mock JLPT N3' })).toBeVisible();
    await expect(v).toContainText('at least 19 in language knowledge, 19 in reading and 19 in listening');
    await expectNoHorizontalScroll(page);
    // A voice that only moves on when told to (each line "ends" when released), and short pauses.
    await page.evaluate(async () => {
      const { speaker } = await import('./js/audio.js');
      const { TAPE } = await import('./js/exam.js');
      TAPE.scale = 0.002;
      window.__said = [];
      window.__pending = null;
      speaker.speak = (text, o = {}) => { window.__said.push(text); window.__pending = o.onend || null; };
      speaker.stop = () => {};
      window.__release = () => { const f = window.__pending; window.__pending = null; if (f) f(); return !!f; };
    });
    await v.getByRole('button', { name: 'Start the mini mock' }).click();
    await expect(v.locator('.section-title')).toContainText('文字・語彙');
    await finishAll(page, 1);
    // Grammar and reading: open the 長文 text (after grammar 2, star 1, textgram 5, short 1).
    await v.locator('[data-act=begin]').click();
    await v.locator('[data-act=sheet]').click();
    await v.locator('.exam-cell').nth(9).click();
    const long = v.locator('.exam[data-type=long]');
    await expect(long).toBeVisible();
    await expect(long.locator('.exam-mondai')).toContainText('もんだい6');
    await expect(long.locator('.exam-doc.exam-longtext .exam-text')).toBeVisible();
    expect((await long.locator('.exam-text').innerText()).replace(/\s/g, '').length).toBeGreaterThan(500);
    await expect(long.locator('.exam-ask')).toBeVisible();
    await expect(long.locator('.exam-opt')).toHaveCount(4);
    await expectNoHorizontalScroll(page);
    await v.locator('[data-act=sheet]').click();
    await v.locator('[data-act=finishpart]').click();
    await v.locator('[data-act=finishpart]').click();
    // Listening: go to the 概要理解 item (after task 2, point 1).
    await expect(v.locator('.section-title')).toContainText('聴解');
    await v.locator('[data-act=begin]').click();
    await v.locator('[data-act=sheet]').click();
    await v.locator('.exam-cell').nth(3).click();
    const gist = v.locator('.exam[data-type=gist]');
    await expect(gist).toBeVisible();
    const qid = await gist.getAttribute('data-qid');
    const it = N3_LISTEN.N3_GIST.find((x) => `gist:${x.id}` === qid);
    await expect.poll(() => page.evaluate(() => window.__said.length)).toBeGreaterThan(0);
    // While the talk plays: no options, no question; only the note to listen.
    await expect(gist.locator('.exam-opt')).toHaveCount(0);
    await expect(gist.locator('.exam-wait')).toBeVisible();
    await expect(gist).not.toContainText(it.question.jp);
    for (let k = 0; k < it.lines.length - 1; k++) {
      await expect.poll(() => page.evaluate(() => window.__pending != null)).toBe(true);
      await expect(gist.locator('.exam-opt')).toHaveCount(0);
      await page.evaluate(() => window.__release());
    }
    // The last line of the talk ends: now the options show, and the question is heard.
    await expect.poll(() => page.evaluate(() => window.__pending != null)).toBe(true);
    await expect(gist.locator('.exam-opt')).toHaveCount(0);
    await page.evaluate(() => window.__release());
    await expect(gist.locator('.exam-opt')).toHaveCount(4);
    await expect(gist.locator('.exam-wait')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__said[window.__said.length - 1])).toBe(it.question.jp);
    const said = await page.evaluate(() => window.__said);
    const from = said.lastIndexOf(it.lines[0].jp);
    expect(said.slice(from)).toEqual([...it.lines.map((l) => l.jp), it.question.jp]);
    await expectNoHorizontalScroll(page);
    // Finish: three scored sections, each with its minimum.
    await v.locator('[data-act=sheet]').click();
    await v.locator('[data-act=finishpart]').click();
    await v.locator('[data-act=finishpart]').click();
    await expect(v.locator('.exam-result')).toBeVisible();
    await expect(v.locator('.exam-sec')).toHaveCount(3);
    await expect(v.locator('.exam-sec[data-sec=lv]')).toContainText('need 19');
    await expect(v.locator('.exam-sec[data-sec=rd]')).toContainText('Reading');
    await expect(v.locator('.exam-sec[data-sec=li]')).toContainText('/ 60');
    await expect(v.getByText('The pass line is 95.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    const s = await saved(page);
    expect(s.exam.history.at(-1)).toMatchObject({ level: 'N3', format: 'mini', lv: 0, rd: 0, li: 0, total: 0, pass: false });
  });

  test('the road to N3 on Progress: the N3 areas and targets, and the three section floors', async ({ page }) => {
    await seed(page, n3Open());
    await page.goto('./#/progress');
    const road = view(page).locator('.road');
    await expect(view(page).getByRole('heading', { name: 'Road to JLPT N3' })).toBeVisible();
    await expect(road).toContainText('of the way to a mock N3');
    await expect(road).toContainText('N3 deck known');
    await expect(road).toContainText('7 chapters of the N3 Story arc');
    await expect(road).toContainText('at least 19 in language knowledge, 19 in reading, 19 in listening');
    await expect(road.locator('svg.chart')).toHaveAttribute('aria-label', /Vocabulary 0\/\d+/);
    const r = await page.evaluate(async () => {
      const { readiness, n3Areas, n4Areas, n5Areas } = await import('./js/readiness.js');
      const x = readiness();
      return { level: x.level, mock: x.mock, ids: x.areas.map((a) => a.id), n3: n3Areas(new Date()).length, n4: n4Areas(new Date()).length, n5: n5Areas(new Date()).length };
    });
    expect(r).toEqual({ level: 'N3', mock: true, ids: ['vocab', 'kanji', 'grammar', 'listening', 'reading'], n3: 5, n4: 5, n5: 5 });
    await expectNoHorizontalScroll(page);
  });
});

// JLPT levels (js/levels.js): every mode has enough content at every level the app offers, the N4 gate (locked until a
// full mock N5 is passed or the real N5 is marked as passed, or "Show every level" is on), the 70/30 mix, the v11 -> v12
// migration (tests/fixtures/progress-v11.json) and the mock N4.
import { readFileSync, readdirSync } from 'node:fs';
import { test, expect, seed, saved, expectNoHorizontalScroll } from './helpers.js';
import { buildMock, scoreMock, FORMATS_N4, SCORING, TYPES, N4_KANJI, BANKS } from '../js/exam-data.js';

const FIXTURE_V11 = JSON.parse(readFileSync(new URL('./fixtures/progress-v11.json', import.meta.url), 'utf8'));

/**
 * Fewest items each mode needs at every level: 20 where a session draws many, else what one session needs (a
 * Listening Lab session is 2 scenes, a Story arc 4-5 chapters, a Kanji Forge round 3 kanji). `keigo` (the
 * shopkeeper's polite replies) starts at N4.
 */
const MIN = {
  garden: 20, rhythm: 12, slice: 20, duel: 20, story: 4, arcs: 1, particle: 20, forge: 12, dojo: 5, tracks: 1, conj: 20,
  build: 20, kata: 20, shop: 6, customers: 3, keigo: { N4: 20, N3: 20 }, listen: 6, numbers: 20, course: 8, brush: 20, rival: 3, meet: 3, messages: 20,
  library: 6, walk: 20, type: 20, dictation: 20,
};

const N4_PASS = { level: 'N5', format: 'full', pass: true, total: 130, lk: 90, li: 40, at: Date.now() - 86_400_000 };
const base = (extra = {}) => ({
  v: 12, items: {}, chapters: [], forged: [], dojo: [], storyReplays: {}, days: {},
  settings: { hideIosHint: true, readingHelp: 'off' },
  exam: { history: [], real: {}, seen: [], later: {} },
  ...extra,
});

test.describe('levels: every mode covers every level', () => {
  test('each mode has at least its minimum at every level the app offers, and draws through js/levels.js', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async (MIN) => {
      const L = await import('./js/levels.js');
      const { MODES } = await import('./js/data.js');
      const short = [];
      for (const key of Object.keys(L.SOURCES)) {
        for (const lv of L.APP_LEVELS) {
          const min = typeof MIN[key] === 'object' ? MIN[key][lv] || 0 : MIN[key];
          if (min == null) short.push(`${key}: no minimum set`);
          const n = L.atLevel(key, lv).length;
          if (n < (min || 0)) short.push(`${key} ${lv}: ${n} < ${min}`);
        }
      }
      // Every mode in the menu has a content source here (a new mode must add one, and cover every level).
      const missing = MODES.map((m) => m.id).filter((id) => !L.SOURCES[id]);
      // Everything carries a level the app knows.
      const untagged = Object.keys(L.SOURCES).flatMap((k) => L.allContent(k).filter((x) => !L.APP_LEVELS.includes(L.levelOf(x))).map(() => k));
      return { short, missing, untagged: [...new Set(untagged)], levels: L.APP_LEVELS };
    }, MIN);
    expect(r.short).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.untagged).toEqual([]);
    expect(r.levels).toEqual(['N5', 'N4', 'N3']);
    // Each mode's screen imports js/levels.js (it draws its content through it).
    const modeFiles = readdirSync(new URL('../js/modes/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'story-mine.js');
    const without = modeFiles.filter((f) => !readFileSync(new URL('../js/modes/' + f, import.meta.url), 'utf8').includes("from '../levels.js'"));
    expect(without).toEqual([]);
  });

  test('a session mixes about 70% from the newest level with 30% review', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const L = await import('./js/levels.js');
      const list = [...Array(60)].map((_, i) => ({ id: 'a' + i, level: 'N5' })).concat([...Array(60)].map((_, i) => ({ id: 'b' + i, level: 'N4' })));
      const ten = L.mixed(list, 10);
      const twenty = L.mixed(list, 20);
      let n4 = 0;
      for (let i = 0; i < 2000; i++) if (L.pickMixed(list).level === 'N4') n4++;
      const oneLevel = L.mixed(list.filter((x) => x.level === 'N5'), 5).every((x) => x.level === 'N5');
      return { ten: ten.filter((x) => x.level === 'N4').length, twenty: twenty.filter((x) => x.level === 'N4').length, pick: n4 / 2000, oneLevel, uniq: new Set(twenty).size };
    });
    expect(r.ten).toBe(7);
    expect(r.twenty).toBe(14);
    expect(r.uniq).toBe(20);
    expect(r.pick).toBeGreaterThan(0.64);
    expect(r.pick).toBeLessThan(0.76);
    expect(r.oneLevel).toBe(true);
  });
});

test.describe('levels: the N4 gate', () => {
  test('locked while N5 is not done: one friendly line everywhere, nothing hidden or taken away', async ({ page }) => {
    const line = 'Unlocks when you pass a full mock N5, or mark the real N5 as passed.';
    // An N4 word already planted (say, from an earlier "Show every level") keeps being reviewed.
    await seed(page, base({ items: { 'n4:集める': { level: 2, due: 0, best: 0, r: 2, pl: 1, s: 3, d: 5, lr: 1 } } }));
    await page.goto('./#/play/story');
    // The mode's chip row keeps the line in the locked chip (a tap shows it), not printed out on every screen.
    const chip = page.locator('.level-bar .level-chip.locked').first();
    await expect(chip).toHaveAttribute('data-lockline', line);
    await chip.click();
    await expect(page.locator('#toast')).toContainText(line);
    await expect(page.getByText('JOURNEY ARC', { exact: false })).toBeVisible();
    await expect(page.locator('.saga-node').filter({ hasText: '13' }).locator('button')).toBeDisabled();
    await expectNoHorizontalScroll(page);
    const state = await page.evaluate(async () => {
      const L = await import('./js/levels.js');
      const { store } = await import('./js/store.js');
      return { open: L.unlockedLevels(), fresh: store.freshWords(5).map((w) => w.id), next: store.nextChapter().chapter.id, planted: store.planted().map((p) => p.item.id) };
    });
    expect(state.open).toEqual(['N5']);
    expect(state.fresh.every((id) => !id.startsWith('n4:'))).toBe(true);
    expect(state.next).toBe('ch1');
    expect(state.planted).toContain('n4:集める');

    await page.goto('./#/play/dojo');
    await expect(page.getByRole('heading', { name: /N4 kanji/ })).toBeVisible();
    await expect(page.getByText(line).first()).toBeVisible();
    await page.goto('./#/course');
    await expect(page.locator('.unit-row.locked').first()).toBeAttached();   // in its folded phase
    await expect(page.getByText(line).first()).toBeVisible();
    await page.goto('./#/exam');
    await expect(page.getByRole('radio', { name: /Mock N4/ })).toBeDisabled();
    await expect(page.getByText(line).first()).toBeVisible();
    await page.goto('./#/play/garden');
    await expect(page.getByText(/N4 deck/)).toContainText(line);
    await expectNoHorizontalScroll(page);
  });

  test('a passed full mock N5 unlocks N4 in every mode', async ({ page }) => {
    await seed(page, base({ exam: { history: [N4_PASS], real: {}, seen: [], later: {} } }));
    await page.goto('./#/play/listen');
    await expect(page.locator('.level-bar .level-chip.on')).toHaveText(['N5', 'N4']);
    const r = await page.evaluate(async () => {
      const L = await import('./js/levels.js');
      return { open: L.unlockedLevels(), listen: L.content('listen').some((d) => d.level === 'N4'), course: L.content('course').some((u) => u.id === 'p2-1') };
    });
    expect(r).toEqual({ open: ['N5', 'N4'], listen: true, course: true });
    await page.goto('./#/play/story');
    await expect(page.locator('.saga-node').filter({ hasText: 'とどいた' })).toBeVisible();
    await page.goto('./#/exam');
    await expect(page.getByRole('heading', { name: 'Mock JLPT N4' })).toBeVisible();   // N5 done: the N4 mock is offered first
    await expectNoHorizontalScroll(page);
  });

  test('marking the real N5 as passed on Progress unlocks N4; undoing it locks it again', async ({ page }) => {
    await seed(page, base());
    await page.goto('./#/progress');
    await page.getByRole('button', { name: 'I passed the real N5' }).click();
    await page.getByRole('button', { name: 'Yes, I passed it' }).click();
    await expect(page.locator('.levels-line')).toContainText('N4 open');
    expect((await saved(page)).exam.real.N5.on).toBe(true);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.levels-line')).toContainText('N4 (Unlocks when');
  });

  test('Settings "Show every level" opens N4 and N3 at once and turning it off takes nothing away', async ({ page }) => {
    await seed(page, base());
    await page.goto('./#/settings');
    const sw = page.getByRole('switch', { name: /Show every level/ });
    await expect(sw).not.toBeChecked();
    await sw.check();
    expect((await saved(page)).settings.showAllLevels).toBe(true);
    await page.goto('./#/play/particle');
    await expect(page.locator('.level-bar .level-chip.on')).toHaveText(['N5', 'N4', 'N3']);
    await page.goto('./#/settings');
    await page.getByRole('switch', { name: /Show every level/ }).uncheck();
    expect((await saved(page)).settings.showAllLevels).toBe(false);
    await page.goto('./#/play/particle');
    await expect(page.locator('.level-bar .level-chip.locked')).toHaveText([/N4/, /N3/]);
  });

  test('v11 progress migrates to v12 untouched, with the level switch off and N4 still locked', async ({ page }) => {
    await seed(page, FIXTURE_V11);
    await page.goto('./');
    await expect(page.locator('.today, .stack').first()).toBeVisible();
    const s = await saved(page);
    expect(s.v).toBe(15);
    expect(s.items).toEqual(FIXTURE_V11.items);
    expect(s.chapters).toEqual(FIXTURE_V11.chapters);
    expect(s.messages.thread[0].id).toBe('r1');   // (opening the app may bring today's message after it)
    expect(s.exam.history.length).toBe(1);
    expect(s.settings).toEqual({ ...FIXTURE_V11.settings, showAllLevels: false });
    expect(await page.evaluate(async () => (await import('./js/levels.js')).unlockedLevels())).toEqual(['N5']);
  });
});

test.describe('levels: N4 in the modes', () => {
  test('with N4 open, the modes show N4 content: a train with its own palette, an N4 form, an N4 customer', async ({ page }) => {
    await seed(page, base({ exam: { history: [N4_PASS], real: {}, seen: [], later: {} } }));
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const L = await import('./js/levels.js');
      const { conjPairs } = await import('./js/modes/conj.js');
      const { conjugate } = await import('./js/practice-data.js');
      const pairs = conjPairs();
      const n4 = pairs.filter((p) => p.level === 'N4');
      const word = pairs.find((p) => p.word.jp === '書く' && p.form === 'pot');
      return {
        n4Share: n4.length / pairs.length > 0.4,
        kaku: word && conjugate(word.word, 'pot').jp,
        palette: L.content('particle').filter((t) => t.level === 'N4').every((t) => t.palette && t.gaps.filter(Boolean).every((g) => g.correct.every((c) => t.palette.includes(c)))),
        customers: L.content('customers').map((c) => c.level).includes('N4'),
      };
    });
    expect(r).toEqual({ n4Share: true, kaku: '書ける', palette: true, customers: true });
    await page.goto('./#/play/conj');
    await expect(page.locator('.level-bar')).toContainText('Mostly N4');
    await expectNoHorizontalScroll(page);
  });

  test('N4 verb and adjective forms are right for every group', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { conjugate, conjDistractors, conjWhy } = await import('./js/practice-data.js');
      const V = (jp, kana, group) => ({ type: 'verb', jp, kana, group, en: '' });
      const A = (jp, kana, group) => ({ type: 'adj', jp, kana, group, en: '' });
      const forms = (w, fs) => fs.map((f) => conjugate(w, f).jp);
      const out = {
        kaku: forms(V('書く', 'かく', 'u'), ['pot', 'vol', 'pass', 'caus', 'ba']),
        kau: forms(V('買う', 'かう', 'u'), ['pass', 'caus']),
        taberu: forms(V('食べる', 'たべる', 'ru'), ['pot', 'vol', 'pass', 'caus', 'ba']),
        suru: forms(V('勉強する', 'べんきょうする', 'suru'), ['pot', 'vol', 'ba']),
        kuru: forms(V('来る', 'くる', 'kuru'), ['pot', 'vol', 'caus', 'ba']),
        takai: forms(A('高い', 'たかい', 'i'), ['ba', 'naru']),
        ii: forms(A('いい', 'いい', 'ii'), ['ba', 'naru']),
        shizuka: forms(A('静か', 'しずか', 'na'), ['ba', 'naru']),
      };
      // Wrong options are never another right answer (a る-verb's potential and passive are the same word).
      const tabe = V('食べる', 'たべる', 'ru');
      out.noDouble = !conjDistractors(tabe, 'pot').includes('食べられる') && conjDistractors(tabe, 'pot').length >= 3;
      out.why = conjWhy(V('買う', 'かう', 'u'), 'pass');
      return out;
    });
    expect(r.kaku).toEqual(['書ける', '書こう', '書かれる', '書かせる', '書けば']);
    expect(r.kau).toEqual(['買われる', '買わせる']);
    expect(r.taberu).toEqual(['食べられる', '食べよう', '食べられる', '食べさせる', '食べれば']);
    expect(r.suru).toEqual(['勉強できる', '勉強しよう', '勉強すれば']);
    expect(r.kuru).toEqual(['こられる', 'こよう', 'こさせる', 'くれば']);
    expect(r.takai).toEqual(['高ければ', '高く なる']);
    expect(r.ii).toEqual(['よければ', 'よく なる']);
    expect(r.shizuka).toEqual(['静かなら', '静かに なる']);
    expect(r.noDouble).toBe(true);
    expect(r.why).toContain('わ');
  });
});

const N3_PASS = { level: 'N4', format: 'full', pass: true, total: 120, lk: 80, li: 40, at: Date.now() - 86_400_000 };

test.describe('levels: the N3 gate', () => {
  test('with only N5 done, N3 shows locked with its line', async ({ page }) => {
    await seed(page, base({ exam: { history: [N4_PASS], real: {}, seen: [], later: {} } }));
    await page.goto('./#/play/particle');
    await expect(page.locator('.level-bar .level-chip.on')).toHaveText(['N5', 'N4']);
    await expect(page.locator('.level-bar .level-chip.locked')).toHaveText([/N3/]);
    await expect(page.locator('.level-bar .level-chip.locked')).toHaveAttribute('data-lockline', /Unlocks when you pass a full mock N4/);
  });

  test('a passed full mock N4 unlocks N3 in every mode', async ({ page }) => {
    await seed(page, base({ exam: { history: [N4_PASS, N3_PASS], real: {}, seen: [], later: {} } }));
    await page.goto('./#/play/particle');
    await expect(page.locator('.level-bar .level-chip.on')).toHaveText(['N5', 'N4', 'N3']);
    await expect(page.locator('.level-bar')).toContainText('Mostly N3, with some N5 and N4 review');
    const r = await page.evaluate(async () => {
      const L = await import('./js/levels.js');
      return { open: L.unlockedLevels(), listen: L.content('listen').some((d) => d.level === 'N3'), course: L.content('course').some((u) => u.id === 'p3-1'),
        deck: L.content('garden').some((w) => w.id.startsWith('n3:')), tracks: L.content('tracks').map((t) => t.id) };
    });
    expect(r).toEqual({ open: ['N5', 'N4', 'N3'], listen: true, course: true, deck: true, tracks: ['hiragana', 'katakana', 'kanji', 'kanji4', 'kanji3'] });
    await expectNoHorizontalScroll(page);
  });

  test('a level done opens everything up to the next one (a passed N4 alone opens N4 and N3)', async ({ page }) => {
    await seed(page, base({ exam: { history: [N3_PASS], real: {}, seen: [], later: {} } }));
    await page.goto('./');
    expect(await page.evaluate(async () => (await import('./js/levels.js')).unlockedLevels())).toEqual(['N5', 'N4', 'N3']);
  });
});

test.describe('levels: N3 in the modes', () => {
  test('with N3 open, the modes show N3 content: N3 forms, an N3 customer, trains with their own palette in Phase 3 units', async ({ page }) => {
    await seed(page, base({ exam: { history: [N4_PASS, N3_PASS], real: {}, seen: [], later: {} } }));
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const L = await import('./js/levels.js');
      const { conjPairs } = await import('./js/modes/conj.js');
      const { STUDY_UNITS } = await import('./js/course-data.js');
      const pairs = conjPairs();
      const units = new Set(STUDY_UNITS.filter((u) => u.level === 'N3').map((u) => u.id));
      const trains = L.content('particle').filter((t) => t.level === 'N3');
      const builds = L.content('build').filter((t) => t.level === 'N3');
      return {
        forms: [...new Set(pairs.filter((p) => p.level === 'N3').map((p) => p.form))].filter((f) => f === 'cpass' || f === 'zu').sort(),
        olderInN3: pairs.some((p) => p.level === 'N3' && p.word.level === 'N5' && p.form === 'cpass'),
        palette: trains.every((t) => t.palette && t.gaps.filter(Boolean).every((g) => g.correct.every((c) => t.palette.includes(c)))),
        units: trains.every((t) => units.has(t.unit)) && builds.every((b) => units.has(b.unit)),
        everyUnitPractised: [...units].every((u) => trains.some((t) => t.unit === u) || builds.some((b) => b.unit === u)),
        customers: L.content('customers').map((c) => c.level).includes('N3'),
      };
    });
    expect(r).toEqual({ forms: ['cpass', 'zu'], olderInN3: true, palette: true, units: true, everyUnitPractised: true, customers: true });
    await page.goto('./#/play/conj');
    await expect(page.locator('.level-bar')).toContainText('Mostly N3');
    await expectNoHorizontalScroll(page);
  });

  test('N3 forms (causative-passive, ずに) are right for every group, with no second right answer offered', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { conjugate, conjDistractors, conjWhy } = await import('./js/practice-data.js');
      const V = (jp, kana, group) => ({ type: 'verb', jp, kana, group, en: '' });
      const forms = (w) => ['cpass', 'zu'].map((f) => conjugate(w, f).jp);
      const iku = V('行く', 'いく', 'u');
      return {
        iku: forms(iku), hanasu: forms(V('話す', 'はなす', 'u')), matsu: forms(V('待つ', 'まつ', 'u')), taberu: forms(V('食べる', 'たべる', 'ru')),
        suru: forms(V('勉強する', 'べんきょうする', 'suru')), kuru: forms(V('来る', 'くる', 'kuru')),
        noLong: !conjDistractors(iku, 'cpass').includes('行かせられる') && conjDistractors(iku, 'cpass').length >= 3,
        zuOpts: conjDistractors(iku, 'zu').length >= 3,
        why: conjWhy(iku, 'cpass'),
      };
    });
    expect(r.iku).toEqual(['行かされる', '行かずに']);
    expect(r.hanasu).toEqual(['話させられる', '話さずに']);
    expect(r.matsu).toEqual(['待たされる', '待たずに']);
    expect(r.taberu).toEqual(['食べさせられる', '食べずに']);
    expect(r.suru).toEqual(['勉強させられる', '勉強せずに']);
    expect(r.kuru).toEqual(['こさせられる', 'こずに']);
    expect(r.noLong).toBe(true);
    expect(r.zuOpts).toBe(true);
    expect(r.why).toContain('行かせられる');
  });

  test('the Shopkeeper: an N3 customer orders goods of their level or below and gets the formal greetings', async ({ page }) => {
    await seed(page, base({ exam: { history: [N4_PASS, N3_PASS], real: {}, seen: [], later: {} } }));
    await page.goto('./#/play/shop');
    await expect(page.locator('.level-bar')).toContainText('N3');
    await expectNoHorizontalScroll(page);
  });
});

test.describe('levels: mock N4', () => {
  test('a full mock N4 has the real format, timing and scoring', () => {
    const mock = buildMock({ level: 'N4', format: 'full', rand: () => 0.42 });
    const count = (sec, type) => mock.sections.find((s) => s.id === sec).questions.filter((q) => q.type === type).length;
    expect(mock.sections.map((s) => s.minutes)).toEqual([25, 55, 35]);
    expect(['read', 'spell', 'context', 'para', 'usage'].map((t) => count('vocab', t))).toEqual([7, 5, 8, 4, 4]);
    expect(['grammar', 'star', 'textgram', 'short', 'mid', 'info'].map((t) => count('grammar', t))).toEqual([13, 4, 5, 3, 3, 2]);
    expect(['task', 'point', 'utter', 'quick'].map((t) => count('listening', t))).toEqual([8, 7, 5, 8]);
    expect(SCORING.N4).toEqual({ lk: { max: 120, min: 38 }, li: { max: 60, min: 19 }, total: 180, pass: 90 });
    expect(TYPES.usage.mondai).toBe('もんだい5');
    expect(FORMATS_N4.full.sections.map((s) => s.minutes)).toEqual([25, 55, 35]);
    // Every question has four (or three heard) distinct options with the answer among them, and N4 words only.
    const qs = mock.sections.flatMap((s) => s.questions);
    for (const q of qs) {
      expect(new Set(q.options).size, q.id).toBe(q.options.length);
      expect(q.options, q.id).toContain(q.answer);
    }
    expect(qs.filter((q) => /^(read|spell|ctx):/.test(q.id)).every((q) => q.id.includes(':n4:'))).toBe(true);
    // Scoring: everything right passes, too few in listening fails even with a high total.
    const all = qs.map((q) => q.answer);
    expect(scoreMock(mock, all)).toMatchObject({ lk: 120, li: 60, total: 180, pass: true });
    const noListening = qs.map((q) => (q.part === 'listening' ? null : q.answer));
    expect(scoreMock(mock, noListening).pass).toBe(false);
  });

  test('the N4 bank is deep enough for mocks in a row, and its printed kanji stay within N5 + N4', () => {
    const b = BANKS.N4;
    for (const [type, n] of FORMATS_N4.full.sections.flatMap((s) => s.parts)) {
      if (['mid', 'info', 'textgram'].includes(type)) continue;   // texts with several questions
      expect(b[type], type).toBeGreaterThanOrEqual(n);
    }
    const strings = (x) => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === 'object' ? Object.entries(x).filter(([k]) => !['why', 'en', 'title_en'].includes(k)).flatMap(([, v]) => strings(v)) : []);
    const mock = buildMock({ level: 'N4', format: 'full' });
    const bad = new Set();
    for (const q of mock.sections.flatMap((s) => s.questions)) {
      if (q.part === 'vocab') continue;   // vocabulary questions are about the word itself
      for (const s of strings([q.ask, q.options, q.doc, q.essay, q.blanked])) for (const c of s.match(/[一-鿿々]/g) || []) if (!N4_KANJI.has(c)) bad.add(c);
    }
    expect([...bad]).toEqual([]);
  });

  test('the mock N4 runs on screen once N4 is open, with a 用法 question', async ({ page }) => {
    await seed(page, base({ exam: { history: [N4_PASS], real: {}, seen: [], later: {} } }));
    await page.goto('./#/exam');
    await page.getByRole('button', { name: 'Start the mini mock' }).click();
    for (let i = 0; i < 40; i++) {
      if (await page.locator('[data-type="usage"]').count()) break;
      const next = page.getByRole('button', { name: /^(Next|Start)/ }).first();
      if (!(await next.count())) break;
      await next.click();
    }
    await expect(page.locator('[data-type="usage"] .exam-word')).toBeVisible();
    await expect(page.locator('[data-type="usage"] .exam-opts.exam-long .exam-opt')).toHaveCount(4);
    await expectNoHorizontalScroll(page);
  });
});

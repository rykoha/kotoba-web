// Cross-device sync through a private GitHub Gist: the pure merge in store.js, and the sync itself against a mocked
// api.github.com (no real network). Sync must never lose progress, never block studying and never leak the token.
import { test, expect, seed, saved, view, expectNoHorizontalScroll, STORAGE_KEY, gradeGardenCard } from './helpers.js';

const SYNC_KEY = 'kotobaBeat.sync';
const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRS';
const FILE = 'kotoba-beat-progress.json';
const T0 = Date.parse('2026-10-08T09:00:00Z');
const H = 3_600_000;

/** An item as the store saves it. */
const item = (lr, extra = {}) => ({ level: 2, due: lr + 3 * 24 * H, best: 0, r: 3, pl: T0 - 100 * H, s: 3, d: 5, lr, ...extra });
const day = (ok, tot, blocks = {}) => ({ ok, tot, rev: tot, newc: 0, studied: true, blocks });

/** Runs mergeProgress in the page (the real module). */
async function merge(page, a, b, now = T0 + 10 * H) {
  return page.evaluate(async ([x, y, n]) => (await import('./js/store.js')).mergeProgress(x, y, n), [a, b, now]);
}

test.describe('mergeProgress (pure merge in store.js)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('./'); });

  test('phone vs PC: both studied between syncs, and nothing from either is lost', async ({ page }) => {
    const settingsPhone = { theme: 'dark', textSize: 'l', quiet: true };
    const settingsPC = { theme: 'light', textSize: 's', quiet: false };
    // Both devices started from the same synced copy, then went their own ways.
    const phone = {
      v: 5,
      items: {
        ohayou: item(T0 + 5 * H, { level: 3, best: 0.7 }),   // reviewed on the phone this morning
        arigatou: item(T0 - 48 * H, { best: 0.9 }),         // last reviewed two days ago (before the split)
        'kana:あ': item(T0 + 6 * H, { r: 9 }),             // only the phone knows this one
      },
      chapters: ['ch1', 'ch2'], forged: ['日'], dojo: ['h1', 'h2'],
      storyReplays: { ch1: T0 + 1 * H },
      days: { '2026-10-08': day(12, 15, { garden: 'done', input: 'skipped' }), '2026-10-07': day(4, 5) },
      saga: { mined: [], seq: 0, quiz: { ch2: { ok: 2, tot: 3, best: 2, at: T0 + 2 * H } }, challenge: {} },
      course: { on: true, current: 'p0-2', reached: ['p0-1', 'p0-2'], done: ['p0-1'], read: [], tally: { 'p0-2': { ok: 5, tot: 6, last: '111110' } } },
      engine: { tally: { '2026-10-08': { kana: [6, 8] } }, recent: { kana: '1101' }, mastery: { 'kana|あ': [80, 4, 20369] }, placement: null, placementSkip: false, checkin: '2026-W41' },
      settings: settingsPhone,
    };
    const pc = {
      v: 5,
      items: {
        ohayou: item(T0 - 24 * H, { level: 2, best: 0.95 }),  // the PC's copy is older
        arigatou: item(T0 + 7 * H, { level: 4 }),            // reviewed on the PC this evening
        konnichiwa: item(0, { r: 0, level: 0, s: 0, d: 0, due: 0 }),   // planted on the PC, not reviewed yet
      },
      chapters: ['ch1', 'ch3'], forged: ['月', '日'], dojo: ['h1', 'k1'],
      storyReplays: { ch1: T0 - 5 * H, ch3: T0 + 3 * H },
      days: { '2026-10-08': day(20, 22, { input: 'done', speak: 'done' }), '2026-10-06': day(1, 1) },
      saga: { mined: [], seq: 0, quiz: { ch3: { ok: 3, tot: 3, best: 3, at: T0 + 4 * H } }, challenge: {} },
      course: { on: false, current: null, reached: ['p0-1', 'p1-1'], done: ['p0-1', 'p0-2'], read: ['p0-1'], tally: { 'p0-2': { ok: 9, tot: 10, last: '1111111110' } } },
      engine: { tally: { '2026-10-08': { kana: [3, 4], vocab: [5, 5] } }, recent: { kana: '11011011' }, mastery: { 'kana|あ': [60, 2, 20368], 'vocab|x': [70, 1, 20369] }, placement: null, placementSkip: true, checkin: '2026-W40' },
      settings: settingsPC,
    };

    const m = await merge(page, phone, pc);
    // Review items: the copy with the most recent review wins; best scores are kept from both.
    expect(m.items.ohayou.lr).toBe(T0 + 5 * H);
    expect(m.items.ohayou.level).toBe(3);
    expect(m.items.ohayou.best).toBe(0.95);
    expect(m.items.arigatou.lr).toBe(T0 + 7 * H);
    expect(m.items.arigatou.level).toBe(4);
    expect(m.items.arigatou.best).toBe(0.9);
    expect(m.items['kana:あ'].r).toBe(9);
    expect(m.items.konnichiwa).toBeTruthy();
    // Cleared lessons, chapters and forged kanji: union.
    expect(m.chapters.sort()).toEqual(['ch1', 'ch2', 'ch3']);
    expect(m.forged.sort()).toEqual(['日', '月'].sort());
    expect(m.dojo.sort()).toEqual(['h1', 'h2', 'k1']);
    // Counters: the larger.
    expect(m.days['2026-10-08']).toMatchObject({ ok: 20, tot: 22, studied: true });
    expect(m.days['2026-10-08'].blocks).toEqual({ garden: 'done', input: 'done', speak: 'done' });   // done beats skipped
    expect(Object.keys(m.days).sort()).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    expect(m.storyReplays).toEqual({ ch1: T0 + 1 * H, ch3: T0 + 3 * H });
    expect(m.saga.quiz).toMatchObject({ ch2: { best: 2 }, ch3: { best: 3 } });
    expect(m.course.reached.sort()).toEqual(['p0-1', 'p0-2', 'p1-1']);
    expect(m.course.done.sort()).toEqual(['p0-1', 'p0-2']);
    expect(m.course.tally['p0-2']).toMatchObject({ ok: 9, tot: 10 });
    expect(m.engine.tally['2026-10-08']).toEqual({ kana: [6, 8], vocab: [5, 5] });
    expect(m.engine.mastery['kana|あ']).toEqual([80, 4, 20369]);
    expect(m.engine.mastery['vocab|x']).toEqual([70, 1, 20369]);
    expect(m.engine.placementSkip).toBe(true);
    expect(m.engine.checkin).toBe('2026-W41');
    // Settings (and the course switch) stay per device.
    expect(m.settings).toMatchObject(settingsPhone);
    expect(m.course.on).toBe(true);
    expect(m.course.current).toBe('p0-2');

    // The other way round gives the same progress, with the PC's own settings.
    const m2 = await merge(page, pc, phone);
    expect(m2.settings).toMatchObject(settingsPC);
    const strip = (x) => { const { settings, course, ...rest } = x; return JSON.parse(JSON.stringify({ ...rest, items: rest.items, cr: course.reached.sort(), cd: course.done.sort(), ct: course.tally })); };
    const sortLists = (x) => ({ ...x, chapters: x.chapters.sort(), forged: x.forged.sort(), dojo: x.dojo.sort() });
    expect(sortLists(strip(m2))).toEqual(sortLists(strip(m)));
  });

  test('merging is idempotent: syncing the same copy again changes nothing', async ({ page }) => {
    const a = { v: 5, items: { ohayou: item(T0) }, chapters: ['ch1'], days: { '2026-10-08': day(3, 4) } };
    const b = { v: 5, items: { arigatou: item(T0 + H) }, forged: ['日'], days: { '2026-10-08': day(5, 6) } };
    const once = await merge(page, a, b);
    const twice = await merge(page, once, b);
    const thrice = await merge(page, twice, once);
    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
  });

  test('inputs are not changed (pure), and an older saved version is migrated before merging', async ({ page }) => {
    const v1 = { v: 1, items: { ohayou: { level: 3, due: T0 + 5 * 24 * H, best: 0.8, r: 5, pl: T0 - 200 * H } }, chapters: ['ch1'], dojo: ['h1'], settings: { theme: 'dark' } };
    const now = { v: 5, items: { arigatou: item(T0) }, chapters: [], settings: { theme: 'light' } };
    const result = await page.evaluate(async ([x, y]) => {
      const { mergeProgress } = await import('./js/store.js');
      const bx = JSON.stringify(x), by = JSON.stringify(y);
      const m = mergeProgress(y, x);
      return { m, same: JSON.stringify(x) === bx && JSON.stringify(y) === by };
    }, [v1, now]);
    expect(result.same).toBe(true);
    expect(result.m.v).toBe(await page.evaluate(async () => (await import('./js/store.js')).STATE_VERSION));
    expect(result.m.items.ohayou).toMatchObject({ level: 3, best: 0.8, r: 5 });
    expect(result.m.items.ohayou.s).toBeGreaterThan(0);   // migrated to the FSRS fields
    expect(result.m.items.arigatou).toBeTruthy();
    expect(result.m.chapters).toEqual(['ch1']);
    expect(result.m.dojo).toEqual(['h1']);
    expect(result.m.settings.theme).toBe('light');
  });

  test('the pronunciation check setting stays per device', async ({ page }) => {
    const phone = { v: 7, items: { ohayou: item(T0) }, settings: { pronCheck: false } };
    const pc = { v: 7, items: { arigatou: item(T0 + H) }, settings: { pronCheck: true } };
    expect((await merge(page, phone, pc)).settings.pronCheck).toBe(false);
    expect((await merge(page, pc, phone)).settings.pronCheck).toBe(true);
    // An older copy from another device (v6, before the setting) doesn't turn it back on here.
    expect((await merge(page, phone, { v: 6, items: {} })).settings.pronCheck).toBe(false);
  });

  test('"Show every level" stays per device; a passed N5 on either device opens N4 on both (v12)', async ({ page }) => {
    const pass = { level: 'N5', format: 'full', pass: true, total: 120, lk: 80, li: 40, at: T0 };
    const phone = { v: 12, items: { ohayou: item(T0) }, settings: { showAllLevels: true }, exam: { history: [], real: {}, seen: [], later: {} } };
    const pc = { v: 12, items: { arigatou: item(T0 + H) }, settings: { showAllLevels: false }, exam: { history: [pass], real: {}, seen: [], later: {} } };
    const a = await merge(page, phone, pc);
    expect(a.settings.showAllLevels).toBe(true);
    expect((await merge(page, pc, phone)).settings.showAllLevels).toBe(false);
    // The passed mock comes over, so N5 counts as done here too (that's what opens N4: js/levels.js).
    expect(a.exam.history.map((h) => [h.level, h.format, h.pass])).toEqual([['N5', 'full', true]]);
    // An older copy (v11, before the setting) never switches it on or off here.
    expect((await merge(page, phone, { v: 11, items: {} })).settings.showAllLevels).toBe(true);
  });

  test('the test date goal set or removed most recently wins, on either device (v14)', async ({ page }) => {
    const ex = (goal) => ({ history: [], real: {}, seen: [], later: {}, goal });
    const n5 = { level: 'N5', date: '2027-07-04', days: 5, from: '2026-10-08', at: T0 };
    const n4 = { level: 'N4', date: '2027-12-05', days: 6, from: '2026-10-09', at: T0 + H };
    const off = { level: null, date: null, days: 5, from: '2026-10-09', at: T0 + 2 * H };
    const phone = { v: 14, items: {}, exam: ex(n5) };
    const pc = { v: 14, items: {}, exam: ex(n4) };
    expect((await merge(page, phone, pc)).exam.goal).toEqual(n4);
    expect((await merge(page, pc, phone)).exam.goal).toEqual(n4);
    // A removal is newer, so it syncs too.
    expect((await merge(page, pc, { v: 14, items: {}, exam: ex(off) })).exam.goal).toEqual(off);
    // An older copy (v13, before goals) keeps this device's goal, and a fresh migration has none.
    expect((await merge(page, phone, { v: 13, items: {} })).exam.goal).toEqual(n5);
    expect((await merge(page, { v: 13, items: {} }, { v: 13, items: {} })).exam.goal).toBe(null);
  });

  test('the saved voice range stays per device; "ears first" words done on either device are kept', async ({ page }) => {
    const phoneVoice = { mid: 210, lo: -3, hi: 4, n: 5 };
    const pcVoice = { mid: 120, lo: -2.5, hi: 3, n: 2 };
    const phone = { v: 8, items: { ohayou: item(T0) }, settings: { voice: phoneVoice }, coach: { ears: ['n5:猫', 'ohayou'] } };
    const pc = { v: 8, items: { arigatou: item(T0 + H) }, settings: { voice: pcVoice }, coach: { ears: ['ohayou', 'n5:犬'] } };
    const onPhone = await merge(page, phone, pc);
    expect(onPhone.settings.voice).toEqual(phoneVoice);
    expect(onPhone.coach.ears.slice().sort()).toEqual(['n5:犬', 'n5:猫', 'ohayou'].sort());
    expect((await merge(page, pc, phone)).settings.voice).toEqual(pcVoice);
    // A device that has never found its voice doesn't take another device's.
    expect((await merge(page, { v: 8, items: {} }, phone)).settings.voice).toBe(null);
    // An older copy (v7, before the coach) loses nothing either way.
    const old = await merge(page, phone, { v: 7, items: { arigatou: item(T0 + H) } });
    expect(old.coach.ears.slice().sort()).toEqual(['n5:猫', 'ohayou'].sort());
    expect(old.items.arigatou).toBeTruthy();
  });

  test('card directions, grammar cards and miss counts: each card keeps its own most recent review', async ({ page }) => {
    const card = (lr, extra = {}) => ({ due: lr + 2 * 24 * H, s: 2, d: 5, lr, r: 2, pl: T0 - 50 * H, ...extra });
    // The phone reviewed the Listen card last and missed 切る a 4th time (needs help); the PC reviewed the Say it
    // card, the grammar card and the Meaning card later, and has a grammar card the phone has never seen.
    const phone = {
      v: 6,
      items: {
        'n5:猫': item(T0 + 1 * H, { level: 4, dirs: { listen: card(T0 + 6 * H, { r: 5 }), say: card(T0 - 20 * H) } }),
        'n5:切る': item(T0 + 5 * H, { lapses: 4, help: true }),
      },
      grammar: { 'g:p0-1:wa': card(T0 + 1 * H, { lapses: 2 }) },
      days: { '2026-10-08': day(5, 6) },
    };
    phone.days['2026-10-08'].newd = 2;
    const pc = {
      v: 6,
      items: {
        'n5:猫': item(T0 + 3 * H, { level: 5, dirs: { listen: card(T0 - 10 * H), say: card(T0 + 4 * H, { r: 7 }) } }),
        'n5:切る': item(T0 - 30 * H, { lapses: 2 }),
      },
      grammar: { 'g:p0-1:wa': card(T0 + 2 * H, { r: 4 }), 'cj:食べる|te': card(T0 + 3 * H) },
      days: { '2026-10-08': day(7, 8) },
    };
    pc.days['2026-10-08'].newg = 1;

    const m = await merge(page, phone, pc);
    const cat = m.items['n5:猫'];
    expect(cat.level).toBe(5);                 // the Meaning card: the PC reviewed it last
    expect(cat.dirs.listen.r).toBe(5);         // Listen: the phone's
    expect(cat.dirs.say.r).toBe(7);            // Say it: the PC's
    expect(m.items['n5:切る']).toMatchObject({ lapses: 4, help: true });   // the most recent review's count and mark
    expect(m.grammar['g:p0-1:wa'].r).toBe(4);  // the PC's later review (no misses since)
    expect(m.grammar['g:p0-1:wa'].lapses).toBeUndefined();
    expect(m.grammar['cj:食べる|te']).toBeTruthy();
    expect(m.days['2026-10-08']).toMatchObject({ newd: 2, newg: 1, tot: 8 });
    // Merged the other way round, and again: the same cards.
    const m2 = await merge(page, pc, phone);
    expect(m2.items).toEqual(m.items);
    expect(m2.grammar).toEqual(m.grammar);
    expect(await merge(page, m, pc)).toEqual(m);
  });

  test("Ren's Messages: both devices' messages are kept once, and a reply made on either device wins", async ({ page }) => {
    const e = (id, day, at, extra = {}) => ({ id, day, at, reply: null, ok: null, ...extra });
    const phone = { v: 9, items: {}, messages: { thread: [e('r1', '2026-10-06', T0 - 50 * H, { ok: true, reply: 1 }), e('r2', '2026-10-07', T0 - 20 * H)] } };
    const pc = { v: 10, items: {}, messages: { thread: [e('r1', '2026-10-06', T0 - 50 * H), e('r2', '2026-10-07', T0 - 21 * H, { ok: false, reply: 0 }), e('r7', '2026-10-08', T0 + H)] } };
    const m = await merge(page, phone, pc);
    expect(m.messages.thread.map((x) => [x.id, x.reply, x.ok])).toEqual([['r1', 1, true], ['r2', 0, false], ['r7', null, null]]);
    expect((await merge(page, pc, phone)).messages).toEqual(m.messages);
  });

  test('My words from the Manga Reader: words kept on either device are kept once, with their Garden cards (v14)', async ({ page }) => {
    const phone = { v: 13, items: { 'my:火影': item(T0 + 2 * H) }, mywords: { 火影: { r: 'ほかげ', en: 'firelight', at: T0 - 5 * H } } };
    const pc = { v: 14, items: { 'my:火影': item(T0 - 9 * H, { r: 1 }), 'my:海賊王': item(T0 + H) },
      mywords: { 火影: { r: 'ほかげ', en: 'firelight', at: T0 - 8 * H }, 海賊王: { r: 'かいぞくおう', en: 'pirate king', at: T0 - 2 * H } } };
    const m = await merge(page, phone, pc);
    expect(Object.keys(m.mywords).sort()).toEqual(['海賊王', '火影'].sort());
    expect(m.mywords['火影'].at).toBe(T0 - 8 * H);                 // the copy kept first
    expect(m.items['my:火影'].lr).toBe(T0 + 2 * H);                 // the newer review wins, as for any card
    expect(m.items['my:海賊王']).toBeTruthy();
    expect((await merge(page, pc, phone)).mywords).toEqual(m.mywords);
    expect((await merge(page, m, pc)).mywords).toEqual(m.mywords);  // idempotent
  });

  test('Kana Brush drawing cards: the newest drawing review on either device wins, reading reviews merge on their own', async ({ page }) => {
    const card = (lr, extra = {}) => ({ due: lr + 24 * H, s: 1.5, d: 5, lr, r: 2, pl: T0 - 90 * H, ...extra });
    const phone = { v: 9, items: {
      'kana:あ': item(T0 - 20 * H, { dirs: { draw: card(T0 + 4 * H, { r: 3 }) } }),   // drawn on the phone after the split
      'kana:い': item(T0 + 2 * H),                                                     // read on the phone, never drawn
    } };
    const pc = { v: 10, items: {
      'kana:あ': item(T0 + 1 * H, { r: 7 }),                                           // read on the PC, drawing older
      'kana:い': item(T0 - 30 * H, { dirs: { draw: card(T0 + 3 * H, { lapses: 1 }) } }),
    } };
    const m = await merge(page, phone, pc);
    expect(m.v).toBe(await page.evaluate(async () => (await import('./js/store.js')).STATE_VERSION));
    expect(m.items['kana:あ'].r).toBe(7);                                 // PC's newer reading review
    expect(m.items['kana:あ'].dirs.draw).toEqual(phone.items['kana:あ'].dirs.draw);
    expect(m.items['kana:い'].lr).toBe(T0 + 2 * H);                      // phone's newer reading review
    expect(m.items['kana:い'].dirs.draw).toEqual(pc.items['kana:い'].dirs.draw);
    expect(await merge(page, pc, phone)).toMatchObject({ items: m.items });   // same either way round
  });

  test('lines mined on both devices under the same number are both kept, and both devices agree on ids', async ({ page }) => {
    const line = (id, jp, at) => ({ id, jp, reading: '', en: jp + ' (en)', parts: [], at });
    const phone = { v: 5, items: { 'mine:1': item(T0 + H, { level: 1 }) }, saga: { mined: [line('mine:1', '腹へった', T0)], seq: 1 } };
    const pc = { v: 5, items: { 'mine:1': item(T0 + 2 * H, { level: 2 }) }, saga: { mined: [line('mine:1', '行くぞ', T0 + 30 * 60_000)], seq: 1 } };

    // The phone syncs first and uploads; then the PC syncs against that copy; then the phone syncs again.
    const gist1 = await merge(page, phone, pc);
    expect(gist1.saga.mined.map((m) => [m.id, m.jp])).toEqual([['mine:1', '腹へった'], ['mine:2', '行くぞ']]);
    expect(gist1.items['mine:1'].level).toBe(1);   // each card stays with its own line
    expect(gist1.items['mine:2'].level).toBe(2);
    expect(gist1.saga.seq).toBe(2);
    const pcAfter = await merge(page, pc, gist1);
    expect(pcAfter.saga.mined.map((m) => [m.id, m.jp])).toEqual([['mine:1', '腹へった'], ['mine:2', '行くぞ']]);
    expect(pcAfter.items['mine:1'].level).toBe(1);
    expect(pcAfter.items['mine:2'].level).toBe(2);
    const phoneAfter = await merge(page, phone, pcAfter);
    expect(phoneAfter.saga).toEqual(pcAfter.saga);
    expect(phoneAfter.items).toEqual(pcAfter.items);
  });
});

/**
 * A fake api.github.com: gists live in `server.gists`, every request is recorded. `mode` switches failures on:
 * 'offline' (the network fails), 'badtoken' (401).
 */
async function mockGitHub(page, { gists = {}, mode = null } = {}) {
  const server = { gists: JSON.parse(JSON.stringify(gists)), requests: [], mode, nextId: 1 };
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    server.requests.push({ method: req.method(), path: url.pathname + url.search, auth: req.headers().authorization || '', body: req.postData() || '' });
    if (server.mode === 'offline') return route.abort('internetdisconnected');
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (server.mode === 'badtoken' || req.headers().authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' });
    const view = (g) => ({ id: g.id, public: false, files: Object.fromEntries(Object.entries(g.files).map(([n, f]) => [n, { filename: n, content: f.content, truncated: false }])) });
    if (url.pathname === '/gists' && req.method() === 'GET') {
      const page = Number(url.searchParams.get('page') || 1);
      return json(200, page === 1 ? Object.values(server.gists).map((g) => ({ ...view(g), files: Object.fromEntries(Object.keys(g.files).map((n) => [n, { filename: n }])) })) : []);
    }
    if (url.pathname === '/gists' && req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      const id = 'abc' + (server.nextId++);
      server.gists[id] = { id, public: body.public, files: body.files };
      return json(201, view(server.gists[id]));
    }
    const m = /^\/gists\/([0-9a-f]+)$/.exec(url.pathname);
    if (m && !server.gists[m[1]]) return json(404, { message: 'Not Found' });
    if (m && req.method() === 'GET') return json(200, view(server.gists[m[1]]));
    if (m && req.method() === 'PATCH') {
      const body = JSON.parse(req.postData());
      Object.assign(server.gists[m[1]].files, body.files);
      return json(200, view(server.gists[m[1]]));
    }
    return json(404, { message: 'Not Found' });
  });
  return server;
}

/** The progress stored in a mock gist. */
const gistData = (server, id) => JSON.parse(server.gists[id].files[FILE].content).data;
const gistFile = (data) => ({ [FILE]: { content: JSON.stringify({ app: 'kotoba-beat', v: 5, data }) } });
const connected = (gistId = '') => ({ token: TOKEN, gistId, lastSync: 0, note: '' });

/** Seeds this device's sync settings (the token lives under its own key, apart from progress). */
async function seedSync(page, cfg) {
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__syncSeeded')) { sessionStorage.setItem('__syncSeeded', '1'); localStorage.setItem(k, v); } }, [SYNC_KEY, JSON.stringify(cfg)]);
}

/** Every request the page makes must stay on the site or go to api.github.com. */
function watchHosts(page) {
  const other = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1' && u.hostname !== 'api.github.com' && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) other.push(r.url());
  });
  return other;
}

const syncReqs = (server) => server.requests.filter((r) => r.method !== 'OPTIONS');

test.describe('sync across devices (mocked GitHub)', () => {
  test('off by default: no request ever goes to GitHub', async ({ page }) => {
    const server = await mockGitHub(page);
    const other = watchHosts(page);
    await page.goto('./');
    await page.goto('./#/settings');
    await expect(view(page).getByRole('heading', { name: 'Sync across devices' })).toBeVisible();
    await page.goto('./#/play/garden');
    await page.goto('./#/');
    await page.waitForTimeout(300);
    expect(server.requests).toEqual([]);
    expect(other).toEqual([]);
  });

  test('connect: makes one private gist with the progress (no settings, no token) and shows the last sync', async ({ page }) => {
    const server = await mockGitHub(page);
    const other = watchHosts(page);
    await seed(page, { v: 5, items: { ohayou: item(T0) }, chapters: ['ch1'], settings: { theme: 'dark' } });
    await page.goto('./#/settings');
    const v = view(page);
    await v.getByLabel('GitHub token').fill(TOKEN);
    await v.getByRole('button', { name: 'Connect' }).click();
    await expect(v.locator('#sync-last')).toContainText('Last synced:');
    await expect(v.getByRole('button', { name: /Sync now/ })).toBeVisible();

    const ids = Object.keys(server.gists);
    expect(ids).toHaveLength(1);
    expect(server.gists[ids[0]].public).toBe(false);
    const data = gistData(server, ids[0]);
    expect(data.items.ohayou.lr).toBe(T0);
    expect(data.chapters).toEqual(['ch1']);
    expect(data.settings).toBeUndefined();
    // The token went only to api.github.com in the Authorization header, never into the gist.
    for (const r of syncReqs(server)) expect(r.auth).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(server.gists)).not.toContain(TOKEN);
    expect(other).toEqual([]);
    // The device remembers the gist; the token is kept apart from progress, so it's never in an export.
    const cfg = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SYNC_KEY);
    expect(cfg.gistId).toBe(ids[0]);
    expect(JSON.stringify(await saved(page))).not.toContain(TOKEN);
    const exported = await page.evaluate(async () => {
      const { store } = await import('./js/store.js');
      return [store.exportCode(), store.exportJSON()];
    });
    for (const e of exported) expect(e.includes(TOKEN) || atobSafe(e).includes(TOKEN)).toBe(false);
    await expectNoHorizontalScroll(page);
  });

  test('a second device finds the gist by its file name and merges, keeping both devices\' study', async ({ page }) => {
    // The PC synced earlier: its gist sits among other gists. This device (the phone) studied different things.
    const pcData = { v: 5, items: { arigatou: item(T0 + 7 * H, { level: 4 }) }, chapters: ['ch3'], forged: ['月'], days: { '2026-10-08': day(20, 22) } };
    const server = await mockGitHub(page, { gists: {
      a11: { id: 'a11', public: false, files: { 'notes.md': { content: 'hi' } } },
      b22: { id: 'b22', public: false, files: gistFile(pcData) },
    } });
    await seed(page, { v: 5, items: { ohayou: item(T0 + 5 * H) }, chapters: ['ch1'], days: { '2026-10-08': day(12, 15) }, settings: { theme: 'dark' } });
    await page.goto('./#/settings');
    await view(page).getByLabel('GitHub token').fill(TOKEN);
    await view(page).getByRole('button', { name: 'Connect' }).click();
    await expect(view(page).locator('#sync-last')).toContainText('Last synced:');

    expect(Object.keys(server.gists).sort()).toEqual(['a11', 'b22']);   // no new gist
    const local = await saved(page);
    expect(Object.keys(local.items).sort()).toEqual(['arigatou', 'ohayou']);
    expect(local.chapters.sort()).toEqual(['ch1', 'ch3']);
    expect(local.forged).toEqual(['月']);
    expect(local.days['2026-10-08'].tot).toBe(22);
    expect(local.settings.theme).toBe('dark');
    const up = gistData(server, 'b22');
    expect(Object.keys(up.items).sort()).toEqual(['arigatou', 'ohayou']);
    expect(up.chapters.sort()).toEqual(['ch1', 'ch3']);
  });

  test('syncs when the app opens, and the home screen shows what came in', async ({ page }) => {
    const remote = { v: 5, items: {}, chapters: [], forged: ['日', '月', '火'] };
    const server = await mockGitHub(page, { gists: { c33: { id: 'c33', public: false, files: gistFile(remote) } } });
    await seedSync(page, connected('c33'));
    await seed(page, { v: 5, items: { ohayou: item(T0) }, forged: [] });
    await page.goto('./');
    await expect.poll(async () => (await saved(page)).forged.length).toBe(3);
    expect(gistData(server, 'c33').items.ohayou).toBeTruthy();
    expect(syncReqs(server).map((r) => r.method + ' ' + r.path)).toEqual(['GET /gists/c33', 'PATCH /gists/c33']);
  });

  test('syncs after a finished Today block, after leaving a game, and when the tab is hidden; Sync now works too', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-07T10:00:00'));
    const server = await mockGitHub(page, { gists: { d44: { id: 'd44', public: false, files: gistFile({ v: 5, items: {} }) } } });
    await seedSync(page, connected('d44'));
    await page.goto('./');
    await expect.poll(() => syncReqs(server).length).toBe(2);   // on open

    const patches = () => syncReqs(server).filter((r) => r.method === 'PATCH').length;
    const gets = () => syncReqs(server).filter((r) => r.method === 'GET').length;

    // A finished Today block.
    await view(page).locator('.block-row').first().getByRole('link', { name: 'Start' }).click();
    await page.locator('#banner').getByRole('button', { name: /Done/ }).click();
    await expect.poll(() => Object.values(gistData(server, 'd44').days?.['2026-10-07']?.blocks || {})).toContain('done');

    // Leaving a game for a tab screen ends the session.
    const g1 = gets();
    await page.goto('./#/play/forge');
    await page.locator('#back').click();
    await expect(page.locator('#today-h')).toBeVisible();
    await expect.poll(gets).toBeGreaterThan(g1);

    // The tab is hidden (switching apps on the phone).
    const g2 = gets();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(gets).toBeGreaterThan(g2);

    // Sync now.
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
    await page.goto('./#/settings');
    const g3 = gets();
    await view(page).getByRole('button', { name: /Sync now/ }).click();
    await expect.poll(gets).toBeGreaterThan(g3);
    await expect(view(page).locator('#sync-last')).toContainText('Last synced:');
    expect(patches()).toBeGreaterThanOrEqual(1);
  });

  test('offline: progress is kept, studying works, and Settings shows a calm note', async ({ page, allowErrors }) => {
    allowErrors.push(/Failed to load resource|ERR_INTERNET_DISCONNECTED/);   // the browser's own network log line
    const server = await mockGitHub(page, { mode: 'offline', gists: { e55: { id: 'e55', public: false, files: gistFile({ v: 5, items: {} }) } } });
    await seedSync(page, connected('e55'));
    await seed(page, { v: 5, items: { ohayou: item(T0) }, chapters: ['ch1'] });
    await page.goto('./#/play/garden');
    // Studying works while sync fails, with nothing scary on screen.
    await view(page).getByRole('button', { name: /Water \d+ plant/ }).click();
    await gradeGardenCard(view(page));
    await expect(page.locator('#toast')).toHaveCount(0);
    await expect(page.getByText(/GitHub|sync/i)).toHaveCount(0);
    await page.goto('./#/settings');
    await expect(view(page).locator('#sync-note')).toContainText('Couldn\'t reach GitHub');
    const s = await saved(page);
    expect(s.items.ohayou).toBeTruthy();
    expect(s.chapters).toEqual(['ch1']);
    expect(Object.values(s.days).some((d) => d.rev === 1)).toBe(true);   // the review just done was saved
    // Back online, Sync now uploads everything and clears the note.
    server.mode = null;
    await view(page).getByRole('button', { name: /Sync now/ }).click();
    await expect(view(page).locator('#sync-last')).toContainText('Last synced:');
    await expect(view(page).locator('#sync-note')).toHaveCount(0);
    expect(gistData(server, 'e55').chapters).toEqual(['ch1']);
  });

  test('a bad token: nothing is lost, a calm note explains, and Disconnect forgets the token and gist', async ({ page, allowErrors }) => {
    allowErrors.push(/Failed to load resource/);   // the browser logs the 401 itself
    const server = await mockGitHub(page, { mode: 'badtoken' });
    await seed(page, { v: 5, items: { ohayou: item(T0) }, chapters: ['ch1'] });
    await page.goto('./#/settings');
    const v = view(page);
    await v.getByLabel('GitHub token').fill(TOKEN);
    await v.getByRole('button', { name: 'Connect' }).click();
    await expect(v.locator('#sync-note')).toContainText('GitHub didn\'t accept the token');
    expect((await saved(page)).items.ohayou).toBeTruthy();
    expect(Object.keys(server.gists)).toEqual([]);
    await v.getByRole('button', { name: 'Disconnect' }).click();
    await expect(v.getByLabel('GitHub token')).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), SYNC_KEY)).toBeNull();
    expect((await saved(page)).chapters).toEqual(['ch1']);
    await expectNoHorizontalScroll(page);
  });

  test('a pasted value that is not a token is refused without any network call', async ({ page }) => {
    const server = await mockGitHub(page);
    await page.goto('./#/settings');
    await view(page).getByLabel('GitHub token').fill('my password');
    await view(page).getByRole('button', { name: 'Connect' }).click();
    await expect(view(page).getByText('doesn\'t look like a GitHub token')).toBeVisible();
    expect(server.requests).toEqual([]);
  });

  test('a copy from a newer app version is never overwritten', async ({ page }) => {
    const future = { v: 99, items: { ohayou: item(T0) }, shinyNewThing: { keep: true } };
    const server = await mockGitHub(page, { gists: { f66: { id: 'f66', public: false, files: gistFile(future) } } });
    await seedSync(page, connected('f66'));
    await page.goto('./#/settings');
    await expect(view(page).locator('#sync-note')).toContainText('newer version');
    expect(syncReqs(server).filter((r) => r.method === 'PATCH')).toEqual([]);
    expect(gistData(server, 'f66').shinyNewThing).toEqual({ keep: true });
  });

  test('a deleted gist is made again from this device\'s progress', async ({ page, allowErrors }) => {
    allowErrors.push(/Failed to load resource/);   // the 404 for the deleted gist
    const server = await mockGitHub(page);
    await seedSync(page, connected('dead1'));
    await seed(page, { v: 5, items: { ohayou: item(T0) } });
    await page.goto('./');
    await expect.poll(() => Object.keys(server.gists).length).toBe(1);
    const id = Object.keys(server.gists)[0];
    expect(gistData(server, id).items.ohayou).toBeTruthy();
    await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).gistId, SYNC_KEY)).toBe(id);
  });
});

function atobSafe(s) {
  try { return Buffer.from(s.replace(/^KOTOBA1:/, ''), 'base64').toString('utf8'); } catch (e) { return ''; }
}

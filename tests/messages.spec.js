// Ren's Messages: one message a day at most, pitched at the learner's level (kana-only polite first, then casual, then
// N4 grammar; kanji only once known), at most one new word (tap to plant it), the "what did they mean?" check, replies
// that pick the next message, story-tied messages, Kaito and the Master joining later, a warm welcome back after time
// away, every message voiced with matching furigana, and the v10 -> v11 migration (tests/fixtures/progress-v10.json).
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, view, expectNoHorizontalScroll, plainText } from './helpers.js';

const FIXTURE_V10 = JSON.parse(readFileSync(new URL('./fixtures/progress-v10.json', import.meta.url), 'utf8'));
const DAY = 86_400_000;
const T = (d) => new Date(`${d}T10:00:00`);

/** A beginner (nothing learned) or a learner with every N5 word reviewed, hiragana done and the course started. */
async function learner(page, { words = 0, dojo = [], kanji = [], chapters = [], course = null, thread = [], lastSession = null } = {}) {
  await page.goto('./');
  const st = await page.evaluate(async ({ words, dojo, kanji, chapters, course, thread, lastSession }) => {
    const { N5_WORDS } = await import('./js/data.js');
    const now = Date.now();
    const items = {};
    for (const w of N5_WORDS.slice(0, words)) items[w.id] = { level: 3, due: now + 9e8, best: 0, r: 3, pl: now - 9e8, s: 5, d: 5, lr: now - 1e8 };
    for (const k of kanji) items['kj:' + k] = { level: 3, due: now + 9e8, best: 0, r: 2, pl: now - 9e8, s: 5, d: 5, lr: now - 1e8 };
    for (const id of ['konnichiwa', 'arigatou', 'sumimasen', 'daijoubu', 'neko', 'inu', 'nihon']) if (words) items[id] = { level: 3, due: now + 9e8, best: 0, r: 3, pl: now - 9e8, s: 5, d: 5, lr: now - 1e8 };
    return { v: 10, items, dojo, chapters, settings: { hideIosHint: true }, days: {}, lastSession, ...(course ? { course } : {}), messages: { thread } };
  }, { words, dojo, kanji, chapters, course, thread, lastSession });
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  return st;
}
const HIRAGANA = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12'];

test.describe("Ren's Messages", () => {
  test('opening the app brings one message, shown on Today; opening again the same day brings no more', async ({ page }) => {
    await page.clock.setFixedTime(T('2026-10-13'));
    await seed(page, await learner(page));
    await page.goto('./#/');
    const card = view(page).locator('a.msg-card');
    await expect(card).toContainText('1 new message');
    await expect(card).toContainText('Ren');
    await page.reload();
    await expect(card).toContainText('1 new message');
    const s = await saved(page);
    expect(s.messages.thread).toHaveLength(1);
    expect(s.messages.thread[0]).toMatchObject({ id: 'r1', day: '2026-10-13', reply: null, ok: null });
    await expectNoHorizontalScroll(page);
  });

  test('a long preview on the Today card never widens a phone screen', async ({ page }) => {
    await page.clock.setFixedTime(T('2026-10-13'));
    // The Master's longest note, at the top of the thread.
    const thread = [{ id: 'm3', day: '2026-10-13', at: T('2026-10-13').getTime(), reply: null, ok: null }];
    await seed(page, await learner(page, { thread, words: 700, dojo: HIRAGANA, chapters: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'] }));
    await page.goto('./#/');
    await expect(view(page).locator('a.msg-card')).toContainText('Master');
    await expectNoHorizontalScroll(page);
  });

  test('the inbox: hear it, a "what did Ren mean?" tap (a miss reveals the answer), then a reply', async ({ page }) => {
    await page.clock.setFixedTime(T('2026-10-13'));
    await seed(page, await learner(page));
    await page.goto('./#/');
    await view(page).locator('a.msg-card').click();
    const v = view(page);
    await expect(v.locator('.msg-text').first()).toContainText('レン');
    expect(await plainText(v.locator('.msg-text').first())).toContain('レンです');
    await expect(v.locator('[data-act=hear]')).toBeVisible();
    // Pick a wrong meaning: the right one is shown, nothing else happens.
    const right = "Ren is saying hello and introducing himself.";
    const wrong = v.locator('[data-act=mean]').filter({ hasNotText: right }).first();
    await wrong.click();
    await expect(v.locator('.miss-c')).toContainText(right);
    let s = await saved(page);
    expect(s.messages.thread[0].ok).toBe(false);
    await v.locator('[data-act=reply]').first().click();
    await expect(v.locator('.msg-bubble.mine')).toContainText('はじめまして');
    s = await saved(page);
    expect(s.messages.thread[0].reply).toBe(0);
    await expectNoHorizontalScroll(page);
  });

  test('the reply picks the next message, which arrives the next day', async ({ page }) => {
    await page.clock.setFixedTime(T('2026-10-14'));
    const thread = [{ id: 'r1', day: '2026-10-13', at: T('2026-10-13').getTime(), reply: 1, ok: true }];
    await seed(page, await learner(page, { thread, words: 20, lastSession: T('2026-10-13').getTime() }));
    await page.goto('./#/');
    const s = await saved(page);
    expect(s.messages.thread.map((e) => e.id)).toEqual(['r1', 'r2']);
  });

  test('skipped days lose nothing; after 4+ days away Ren says 久しぶり, warmly', async ({ page }) => {
    await page.clock.setFixedTime(T('2026-10-20'));
    const thread = [{ id: 'r1', day: '2026-10-10', at: T('2026-10-10').getTime(), reply: null, ok: null }];
    await seed(page, await learner(page, { thread, lastSession: T('2026-10-10').getTime() }));
    await page.goto('./#/messages');
    const v = view(page);
    await expect(v.locator('.msg-row')).toHaveCount(2);
    await expect(v.locator('.msg-text').last()).toContainText('ひさしぶり');
    await expect(v).not.toContainText(/miss(ed)? you|where were you|lost/i);
    // The older, unanswered message is still there and can still be answered.
    await expect(v.locator('.msg-text').first()).toContainText('レン');
    expect(await plainText(v.locator('.msg-text').first())).toContain('レンです');
  });

  test('beginners get kana-only polite messages; at most one word is new, and tapping it plants it', async ({ page }) => {
    await page.clock.setFixedTime(T('2026-10-13'));
    await seed(page, await learner(page));
    await page.goto('./#/messages');
    const v = view(page);
    const text = await v.locator('.msg-text').first().evaluate((el) => { const c = el.cloneNode(true); c.querySelectorAll('rt').forEach((r) => r.remove()); return c.textContent; });
    expect(text).not.toMatch(/[一-鿿]/);
    await expect(v.locator('[data-act=plant]')).toHaveCount(1);
    await v.locator('[data-act=plant]').click();
    expect((await saved(page)).items.konnichiwa).toBeTruthy();
    await expect(v.locator('[data-act=plant]')).toHaveCount(0);
  });

  test('levels: casual speech once hiragana is done and words are known; N4 grammar later; kanji only once known', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { MESSAGE_BY_ID } = await import('./js/messages-data.js');
      const { shownText } = await import('./js/messages.js');
      const m = MESSAGE_BY_ID.r22;
      return { none: shownText(m, new Set()), all: shownText(m, new Set([...'週末映画見行'])), some: shownText(m, new Set(['映'])) };
    });
    expect(r.none).toBe('ねえ、しゅうまつ ひま？ えいが みに いかない？');
    expect(r.some).toBe(r.none);
    expect(r.all).toBe('ねえ、週末 ひま？ 映画 見に 行かない？');

  });

  for (const [name, opts, tier] of [['a beginner', {}, 1], ['hiragana done, 100 words', { words: 100, dojo: HIRAGANA }, 2], ['300 words', { words: 300, dojo: HIRAGANA }, 3]]) {
    test(`tier for ${name}: ${tier}`, async ({ page }) => {
      await seed(page, await learner(page, opts));
      await page.goto('./#/progress');
      expect(await page.evaluate(async () => (await import('./js/messages.js')).learnerTier())).toBe(tier);
    });
  }

  test('story moments: clearing a chapter brings its message first; Kaito writes after chapter 2', async ({ page }) => {
    await seed(page, await learner(page, { words: 700, dojo: HIRAGANA, chapters: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7'] }));
    await page.goto('./#/progress');
    const r = await page.evaluate(async () => {
      const { pickNext, eligible } = await import('./js/messages.js');
      const { MESSAGE_BY_ID } = await import('./js/messages-data.js');
      return { next: pickNext().id, kaito: eligible(MESSAGE_BY_ID.k1), kiku: eligible(MESSAGE_BY_ID.r31) };
    });
    expect(r.next).toBe('r30');   // round one, the latest chapter reached
    expect(r.kaito).toBe(true);
    expect(r.kiku).toBe(false);   // chapter 8 not reached
  });

  test('before chapter 2, Kaito and the Master stay quiet', async ({ page }) => {
    await seed(page, await learner(page, { words: 700, dojo: HIRAGANA, chapters: ['ch1'] }));
    await page.goto('./#/progress');
    const r = await page.evaluate(async () => {
      const { eligible } = await import('./js/messages.js');
      const { MESSAGE_BY_ID } = await import('./js/messages-data.js');
      return [eligible(MESSAGE_BY_ID.k1), eligible(MESSAGE_BY_ID.m1)];
    });
    expect(r).toEqual([false, false]);
  });

  test('a pool of 40+ original messages, all well-formed', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { MESSAGES, WELCOME_BACK, MESSAGE_BY_ID } = await import('./js/messages-data.js');
      const { GARDEN_CATALOG } = await import('./js/data.js');
      const bad = [];
      for (const m of [...MESSAGES, ...WELCOME_BACK]) {
        if (m.words.some((w) => !GARDEN_CATALOG[w])) bad.push(m.id + ' word');
        if (m.replies.length < 2 || m.replies.length > 3) bad.push(m.id + ' replies');
        if (m.replies.some((x) => x.next && !MESSAGE_BY_ID[x.next])) bad.push(m.id + ' next');
        if (m.meaning.length !== 3) bad.push(m.id + ' meaning');
        if (/[一-鿿]/.test(m.kana) || (m.tier === 1 && /[一-鿿]/.test(m.jp))) bad.push(m.id + ' kanji');
      }
      const tiers = [1, 2, 3].map((t) => MESSAGES.filter((m) => m.tier === t).length);
      return { n: MESSAGES.length + WELCOME_BACK.length, bad, tiers, senders: [...new Set(MESSAGES.map((m) => m.from))].sort(), story: MESSAGES.filter((m) => m.after).length };
    });
    expect(r.n).toBeGreaterThanOrEqual(40);
    expect(r.bad).toEqual([]);
    for (const n of r.tiers) expect(n).toBeGreaterThanOrEqual(8);
    expect(r.senders).toEqual(['kaito', 'kiku', 'master', 'ren', 'sora']);
    expect(r.story).toBeGreaterThanOrEqual(10);
  });

  test("every message is voiced in its sender's voice, plays, and its furigana matches its kana", async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { ALL_MESSAGES, SENDERS } = await import('./js/messages-data.js');
      const { CLIPS } = await import('./js/clips.js');
      const { readingOf } = await import('./js/furigana.js');
      const { toHiragana } = await import('./js/romaji.js');
      const missing = ALL_MESSAGES.flatMap((m) => [`${m.jp}#${SENDERS[m.from].voice}`, `${m.jp}#${SENDERS[m.from].voice}#slow`]).filter((k) => !CLIPS[k]);
      const ctx = new OfflineAudioContext(1, 1, 24000);
      let short = 0;
      for (const m of ALL_MESSAGES) {
        const buf = await (await fetch('./audio/' + CLIPS[`${m.jp}#${SENDERS[m.from].voice}`])).arrayBuffer();
        if ((await ctx.decodeAudioData(buf)).duration < 0.8) short++;
      }
      const clean = (s) => toHiragana(s).replace(/[、。！？「」…・\s]/g, '');
      const split = (s) => s.split(/[\s、。！？「」…]+/).filter(Boolean);
      const wrong = [];
      for (const m of ALL_MESSAGES) {
        const js = split(m.jp), ks = split(m.kana);
        if (js.length !== ks.length) { wrong.push(m.id); continue; }
        js.forEach((seg, i) => { const rd = readingOf(seg); if (rd == null || clean(rd) !== clean(ks[i])) wrong.push(`${m.id}:${seg}`); });
      }
      return { missing, short, wrong };
    });
    expect(r.missing).toEqual([]);
    expect(r.short).toBe(0);
    expect(r.wrong).toEqual([]);
  });
});

test.describe('switching who you message', () => {
  const STORY = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'];

  test('everyone met has messages at every tier, so switching always has someone to talk to', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const { MESSAGES, CONTACTS } = await import('./js/messages-data.js');
      return CONTACTS.map((id) => [id, [1, 2, 3, 4, 5].filter((t) => !MESSAGES.some((m) => m.from === id && m.tier === t))]);
    });
    for (const [id, missing] of r) expect(missing, id).toEqual([]);
  });

  test('the contact row: Ren to start, the others locked until met in the story', async ({ page }) => {
    await page.clock.setFixedTime(T('2026-10-13'));
    await seed(page, await learner(page));
    await page.goto('./#/messages');
    const v = view(page);
    await expect(v.locator('[data-act=who]')).toHaveCount(5);
    await expect(v.locator('[data-act=who][aria-pressed=true]')).toHaveAttribute('data-who', 'ren');
    await expect(v.locator('.msg-contact.locked')).toHaveCount(4);
    await v.locator('[data-act=who][data-who=sora]').click();
    await expect(v).toContainText("You'll meet Sora in Story chapter 6");
    await expect(v.locator('.msg-row')).toHaveCount(0);
    await v.locator('[data-act=who][data-who=ren]').click();
    await expect(v.locator('.msg-text').first()).toContainText('レン');
    expect(await plainText(v.locator('.msg-text').first())).toContain('レンです');
    await expectNoHorizontalScroll(page);
  });

  // Granny Kiku is written to politely, Sora casually. One opener in the wrong speech level, one in the right one.
  for (const [who, pick, ok] of [['kiku', 'Hey Kiku', false], ['sora', 'Hey Sora', true]]) {
    test(`messaging ${who} first: pick the opener (${ok ? 'right' : 'wrong'} speech level), they say hello, and the chat keeps going`, async ({ page }) => {
      await page.clock.setFixedTime(T('2026-10-13'));
      const thread = [{ id: 'r1', day: '2026-10-13', at: T('2026-10-13').getTime(), reply: 0, ok: true }];
      await seed(page, await learner(page, { thread, words: 700, dojo: HIRAGANA, chapters: STORY, lastSession: T('2026-10-13').getTime() }));
      await page.goto('./#/messages');
      const v = view(page);
      await v.locator(`[data-act=who][data-who=${who}]`).click();
      await expect(v.locator('.msg-about')).toContainText(who === 'kiku' ? 'Polite' : 'Casual');
      await v.locator('[data-act=greet]').filter({ hasText: pick }).click();
      // A miss names the speech level that fits, and they still write back.
      await expect(v.locator(`.msg-fit.${ok ? 'good-c' : 'miss-c'}`)).toContainText(ok ? 'Right' : 'fits better');
      await expect(v.locator('.msg-bubble.mine').first()).toContainText(pick);
      let s = await saved(page);
      expect(s.messages.thread.map((e) => e.id)).toEqual(['r1', who === 'kiku' ? 'q1' : 's1']);   // someone new says hello first
      // Answer and reply: the reply carries the chat on, so their answer comes right away, no waiting for tomorrow.
      await v.locator('[data-act=mean]').first().click();
      await v.locator('[data-act=reply]').first().click();
      const second = who === 'kiku' ? 'q2' : 's2';
      await expect(v.locator(`.msg-row[data-msg=${second}]`)).toBeVisible();
      s = await saved(page);
      expect(s.messages.thread.map((e) => e.id)).toEqual(['r1', who === 'kiku' ? 'q1' : 's1', second]);
      // That conversation ends with the next reply; a new chat can start straight away, the same day.
      await v.locator('[data-act=mean]').first().click();
      await v.locator('[data-act=reply]').first().click();
      await expect(v.locator('.msg-start')).toContainText('Start a new chat');
      await v.locator('[data-act=greet]').first().click();
      s = await saved(page);
      expect(s.messages.thread).toHaveLength(4);
      // Back to Ren: his chat is untouched.
      await v.locator('[data-act=who][data-who=ren]').click();
      await expect(v.locator('.msg-row:not(.mine)')).toHaveCount(1);
      await expectNoHorizontalScroll(page);
    });
  }

  test("a reply's follow-up comes from the same person, even after someone else wrote", async ({ page }) => {
    await page.clock.setFixedTime(T('2026-10-14'));
    const thread = [
      { id: 's1', day: '2026-10-12', at: T('2026-10-12').getTime(), reply: 0, ok: true },
      { id: 'r1', day: '2026-10-13', at: T('2026-10-13').getTime(), reply: 0, ok: true },
    ];
    await seed(page, await learner(page, { thread, words: 700, dojo: HIRAGANA, chapters: STORY }));
    await page.goto('./#/progress');
    const r = await page.evaluate(async () => (await import('./js/messages.js')).pickNext('sora')?.id);
    expect(r).toBe('s2');
  });

  test('Kaito and the Master have kana-only notes for beginners once met', async ({ page }) => {
    await seed(page, await learner(page, { chapters: ['ch1', 'ch2', 'ch3', 'ch4'] }));
    await page.goto('./#/progress');
    const r = await page.evaluate(async () => {
      const { pickNext, learnerTier } = await import('./js/messages.js');
      return { tier: learnerTier(), kaito: pickNext('kaito')?.id, master: pickNext('master')?.id };
    });
    expect(r.tier).toBe(1);
    expect(r.kaito).toMatch(/^k1\d$/);
    expect(r.master).toMatch(/^m1\d$/);
  });
});

test.describe('saved progress v10 → v11', () => {
  test('the v10 fixture loads with every word, review date, chapter, setting and exam result kept, and an empty thread', async ({ page }) => {
    await seed(page, FIXTURE_V10);
    await page.goto('./#/settings');
    const s = await saved(page);
    expect(s.v).toBe(16);
    expect(s.items).toEqual(FIXTURE_V10.items);
    expect(s.settings).toEqual({ ...FIXTURE_V10.settings, showAllLevels: false });
    for (const k of ['chapters', 'forged', 'dojo', 'saga', 'course', 'engine', 'grammar', 'days', 'coach', 'exam', 'storyReplays']) expect(s[k], k).toEqual(k === 'exam' ? { ...FIXTURE_V10[k], goal: null } : FIXTURE_V10[k]);   // v14 adds the test date goal
    expect(s.messages).toEqual({ thread: [], letters: [] });
  });

  test('a bad thread entry is dropped, good ones kept in order', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async (fx) => {
      const { store } = await import('./js/store.js');
      return store.parseImport(JSON.stringify({ ...fx, v: 11, messages: { thread: [
        { id: 'r2', day: '2026-10-14', at: 2, reply: 0, ok: true },
        { id: 'r1', day: '2026-10-13', at: 1, reply: 9, ok: 'x' },
        { id: '<script>', day: '2026-10-15', at: 3 },
        { id: 'r3', day: 'yesterday', at: 4 },
      ] } })).messages.thread;
    }, FIXTURE_V10);
    expect(r).toEqual([
      { id: 'r1', day: '2026-10-13', at: 1, reply: null, ok: null },
      { id: 'r2', day: '2026-10-14', at: 2, reply: 0, ok: true },
    ]);
  });
});

// The optional pronunciation check (js/pron.js, pron-analysis.js, pron-tips.js): the analysis on synthetic data,
// where the 🎤 button appears, and the whole flow with Chromium's fake microphone and a stand-in recognizer.
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, view, expectNoHorizontalScroll } from './helpers.js';

const FIXTURE_V6 = JSON.parse(readFileSync(new URL('./fixtures/progress-v6.json', import.meta.url), 'utf8'));

/** A stand-in speech recognizer that "hears" `text` shortly after it starts. */
async function fakeRecognizer(page, text) {
  await page.addInitScript((heard) => {
    window.webkitSpeechRecognition = window.SpeechRecognition = class {
      start() {
        setTimeout(() => this.onstart && this.onstart(), 20);
        setTimeout(() => { const r = [{ transcript: heard }]; r.isFinal = true; this.onresult && this.onresult({ results: [r], resultIndex: 0 }); }, 300);
      }
      stop() {}
      abort() {}
    };
  }, text);
}

/** Runs the analysis in the page on synthetic frames: segs are [seconds, level, hz]. */
async function analyzeSynthetic(page, target, userSegs, modelSegs, transcripts = null) {
  return page.evaluate(async ([t, u, m, tr]) => {
    const a = await import('./js/pron-analysis.js');
    const mk = (segs) => { const f = []; let time = 0; for (const [d, level, hz] of segs) for (let x = 0; x < Math.max(1, Math.round(d / 0.03)); x++) { f.push({ time, level, hz }); time += 0.03; } return f; };
    const r = a.analyze(t, { user: { frames: mk(u), floor: 0.001 }, model: m ? { frames: mk(m) } : null, transcripts: tr });
    return { verdict: r.verdict, issues: r.issues.map((x) => x.id), pitch: r.pitch.available, length: r.length.available };
  }, [target, userSegs, modelSegs, transcripts]);
}

const S = [0.1, 0.001, null];
const C = (d = 0.05) => [d, 0.03, null];
const V = (d, hz = 180, l = 0.2) => [d, l, hz];

test.describe('analysis', () => {
  test.beforeEach(async ({ page }) => { await page.goto('./'); });

  test('mora types: long vowels, small っ, ん as a beat, and the い/う that go quiet', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { moraInfo } = await import('./js/pron-analysis.js');
      const f = (w) => moraInfo(w).map((m) => m.kana + ':' + m.type + (m.devoice ? '*' : '')).join(' ');
      return { obaasan: f('おばあさん'), kitte: f('きって'), desu: f('です'), gakkou: f('がっこう'), biiru: f('ビール'), konnichiwa: f('こんにちは'), ashita: f('あした'), ee: f('ええ') };
    });
    expect(r).toEqual({
      obaasan: 'お:cv ば:cv あ:long さ:cv ん:n',
      kitte: 'き:cv っ:sokuon て:cv',
      desu: 'で:cv す:cv*',
      gakkou: 'が:cv っ:sokuon こ:cv う:long',
      biiru: 'び:cv い:long る:cv',
      konnichiwa: 'こ:cv ん:n に:cv ち:cv* は:cv',
      ashita: 'あ:cv し:cv* た:cv',   // a word's first あ is an ordinary beat, not a held vowel
      ee: 'え:cv え:long',
    });
  });

  test('sounds: compared mora by mora; kanji or katakana spellings of the word count as a match', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { soundCheck } = await import('./js/pron-analysis.js');
      const t = { jp: 'おばあさん', reading: 'おばあさん' };
      const s = (heard) => { const x = soundCheck(t, [heard], () => 'おばあさん'); return [x.per.map((p) => (p.ok ? 1 : 0)).join(''), x.issues.map((i) => i.id).join()]; };
      return {
        short: s('おばさん'), right: s('おばあさん'), kanji: s('お婆さん'), swap: s('あばあさん'), dash: s('おばーさん'),
        kitte: soundCheck({ jp: '切手', reading: 'きって' }, ['きて']).issues.map((i) => i.id),
        kona: soundCheck({ jp: 'こんな', reading: 'こんな' }, ['こな']).issues.map((i) => i.id),
      };
    });
    expect(r.short).toEqual(['11011', 'long_short']);
    expect(r.right).toEqual(['11111', '']);
    expect(r.kanji).toEqual(['11111', '']);
    expect(r.swap).toEqual(['01111', 'sound_swap']);
    expect(r.dash).toEqual(['11111', '']);
    expect(r.kitte).toEqual(['sokuon_missing']);
    expect(r.kona).toEqual(['n_short']);
  });

  test('length: a long vowel held too short, a missing っ pause, and a short vowel held long', async ({ page }) => {
    const model = [S, V(0.12, 190), C(0.04), V(0.24, 185), C(0.08), V(0.1, 170), V(0.12, 150, 0.12), S];
    const good = [S, S, V(0.15, 210), C(0.05), V(0.3, 205), C(0.1), V(0.12, 190), V(0.15, 170, 0.12), S];
    const short = [S, S, V(0.15, 210), C(0.05), V(0.13, 205), C(0.1), V(0.12, 190), V(0.15, 170, 0.12), S];
    expect((await analyzeSynthetic(page, { reading: 'おばあさん' }, good, model)).issues).toEqual([]);
    expect((await analyzeSynthetic(page, { reading: 'おばあさん' }, short, model)).issues).toContain('long_short');
    const model2 = [S, V(0.12, 190), C(0.04), V(0.12, 185), C(0.08), V(0.1, 170), V(0.12, 150, 0.12), S];
    expect((await analyzeSynthetic(page, { reading: 'おばさん' }, good, model2)).issues).toContain('long_added');
    expect((await analyzeSynthetic(page, { reading: 'おばさん' }, short, model2)).issues).toEqual([]);
    const kitteModel = [S, C(0.04), V(0.1, 200), [0.15, 0.002, null], C(0.04), V(0.12, 170), S];
    const withPause = [S, C(0.05), V(0.12, 210), [0.18, 0.002, null], C(0.05), V(0.14, 180), S];
    const noPause = [S, C(0.05), V(0.12, 210), C(0.05), V(0.14, 180), S];
    expect((await analyzeSynthetic(page, { reading: 'きって' }, withPause, kitteModel)).issues).toEqual([]);
    expect((await analyzeSynthetic(page, { reading: 'きって' }, noPause, kitteModel)).issues).toContain('sokuon_missing');
  });

  test('pitch: はし (chopsticks) starts high and drops; rising instead gets a pitch tip', async ({ page }) => {
    const hl = [S, C(0.05), V(0.15, 220), C(0.06), V(0.15, 170), S];
    const lh = [S, C(0.05), V(0.15, 170), C(0.06), V(0.15, 220), S];
    const chopsticks = { jp: '箸', reading: 'はし', accent: 1 };
    const right = await analyzeSynthetic(page, chopsticks, hl, hl);
    expect(right).toMatchObject({ verdict: 'great', issues: [], pitch: true });
    const wrong = await analyzeSynthetic(page, chopsticks, lh, hl);
    expect(wrong.issues).toEqual(['pitch_start_high', 'pitch_rise_end']);
    expect(wrong.verdict).not.toBe('great');
  });

  test('scored generously, at most two tips, and nothing measurable gives no result', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { verdict, pickIssues } = await import('./js/pron-analysis.js');
      return {
        nearly: verdict({ sounds: { available: true, score: 0.8 }, pitch: { available: true, match: 0.6, issues: [] }, length: { available: true, issues: [] } }),
        rough: verdict({ sounds: { available: true, score: 0.2 }, pitch: { available: true, match: 0.3, issues: [{}] }, length: { available: true, issues: [{}, {}] } }),
        none: verdict({}),
        two: pickIssues([{ id: 'devoice' }, { id: 'pitch_flat' }, { id: 'long_short' }, { id: 'long_short' }, { id: 'sokuon_missing' }]).map((x) => x.id),
      };
    });
    expect(r).toEqual({ nearly: 'great', rough: 'try', none: 'none', two: ['long_short', 'sokuon_missing'] });
  });

  test('every issue has a tip and an example in the rule table, filled in for the word', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { TIPS, tipFor } = await import('./js/pron-tips.js');
      const { moraInfo } = await import('./js/pron-analysis.js');
      const ids = ['silent', 'not_heard', 'sound_swap', 'long_short', 'long_added', 'sokuon_missing', 'n_short', 'devoice',
        'pitch_start_high', 'pitch_start_low', 'pitch_no_drop', 'pitch_end_drop', 'pitch_rise_end', 'pitch_flat', 'rushed'];
      const missing = ids.filter((id) => !TIPS[id] || !TIPS[id].tip || !TIPS[id].example);
      const t = { jp: 'おばあさん', reading: 'おばあさん' };
      const long = tipFor({ id: 'long_short', at: 2 }, t, moraInfo(t.reading), [false, true, false, false, false]);
      const pitch = tipFor({ id: 'pitch_rise_end' }, { jp: '箸', reading: 'はし' }, moraInfo('はし'), [true, false]);
      const sok = tipFor({ id: 'sokuon_missing', at: 1 }, { jp: '切手', reading: 'きって' }, moraInfo('きって'), null);
      return { missing, long: long.tip, pitch: pitch.tip, sok: sok.tip, left: [long, pitch, sok].some((x) => /\{/.test(x.tip)) };
    });
    expect(r.missing).toEqual([]);
    expect(r.long).toBe('Hold the ば longer: おばあさん has a long あ, two full beats.');
    expect(r.pitch).toBe('Your pitch went up at the end; in 箸 it starts high and drops.');
    expect(r.sok).toBe('Give っ a tiny pause before the て: hold your breath for one beat.');
    expect(r.left).toBe(false);
  });
});

test.describe('where the 🎤 button appears', () => {
  test('on new Garden cards (the N5 deck and starter phrases), which open with the answer showing', async ({ page }) => {
    await page.goto('./#/play/garden');
    const v = view(page);
    await v.getByRole('button', { name: /Water \d+ plant/ }).click();
    await expect(v.locator('.new-tag')).toBeVisible();
    await expect(v.getByRole('button', { name: /Check my pronunciation of/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('on course lesson examples and a unit\'s N5 words', async ({ page }) => {
    await page.goto('./#/course/p0-1/lesson');
    await expect(view(page).locator('.pron-btn')).toHaveText('Check my pronunciation');
    await page.goto('./#/course/p0-1');
    await expect(view(page).locator('.word-cell .pron-btn')).not.toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test('on the story\'s "New words in this scene" screen', async ({ page }) => {
    await page.goto('./#/play/story');
    await view(page).locator('[data-act=open]').first().click();
    await expect(view(page).getByRole('heading', { name: 'New words in this scene' })).toBeVisible();
    const n = await view(page).locator('.learn-card').count();
    await expect(view(page).locator('.learn-item .pron-btn')).toHaveCount(n);
    await expectNoHorizontalScroll(page);
  });

  test('not on kana or kanji letter lessons', async ({ page }) => {
    await page.goto('./#/play/dojo');
    await view(page).getByRole('button', { name: /Next lesson:/ }).click();
    await expect(view(page).locator('.learn-card').first()).toBeVisible();
    await expect(view(page).locator('.pron-btn')).toHaveCount(0);
  });

  test('hidden by the Settings switch, and in Quiet mode', async ({ page }) => {
    await page.goto('./#/settings');
    const sw = view(page).getByRole('switch', { name: /Pronunciation check/ });
    await expect(sw).toBeChecked();
    await sw.uncheck();
    expect((await saved(page)).settings.pronCheck).toBe(false);
    await page.goto('./#/course/p0-1/lesson');
    await expect(view(page).locator('.line-jp')).toBeVisible();
    await expect(view(page).locator('.pron-btn')).toHaveCount(0);
    await page.goto('./#/settings');
    await view(page).getByRole('switch', { name: /Pronunciation check/ }).check();
    await view(page).getByRole('switch', { name: /Quiet mode/ }).check();
    await page.goto('./#/course/p0-1/lesson');
    await expect(view(page).locator('.line-jp')).toBeVisible();
    await expect(view(page).locator('.pron-btn')).toHaveCount(0);
  });
});

test.describe('the check itself (fake mic and recognizer)', () => {
  test('say it, get Great / Close / Try again, the morae heard, your pitch line and at most two tips', async ({ page }) => {
    test.setTimeout(60_000);
    await fakeRecognizer(page, 'おばさん');
    await page.goto('./');
    await page.evaluate(async () => {
      const { openPron, wordTarget } = await import('./js/pron.js');
      const { GARDEN_CATALOG } = await import('./js/data.js');
      openPron(wordTarget(GARDEN_CATALOG['n5:おばあさん']));
    });
    const p = page.locator('.pron-sheet');
    await expect(p.getByRole('dialog').or(page.getByRole('dialog'))).toBeVisible();
    await expect(p.locator('.pron-melody')).toBeVisible();   // the target melody, before trying
    await expectNoHorizontalScroll(page);
    await p.getByRole('button', { name: 'Start', exact: true }).click();
    // It waits for the mic to be live, counts down from 3, then listens, drawing your pitch over the melody.
    await expect(p.locator('#pron-count')).toHaveText('3');
    await expect(p.locator('canvas.pron-live')).toBeVisible();
    await expect(p.getByText(/Go!/)).toBeVisible({ timeout: 6_000 });
    await expect(p.locator('canvas.pron-live')).toBeVisible();
    await expect(p.locator('.pron-title')).toHaveText(/Great!|Close!|Try again/, { timeout: 20_000 });
    // The missing あ was heard as missing, and said kindly.
    await expect(p.locator('.pron-mora.miss')).toHaveCount(1);
    await expect(p.getByText(/close enough, not perfect/)).toBeVisible();
    await expect(p.getByText(/Hold the ば\w* longer/)).toBeVisible();   // (reading help adds romaji over the kana)
    expect(await p.locator('.pron-tips li').count()).toBeLessThanOrEqual(2);
    for (const name of [/Hear it/, /Slowly/, /Try again/, /Side by side/]) await expect(p.getByRole('button', { name })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // Fed to the skill model as speaking; nothing else in the saved progress changes.
    const s = await saved(page);
    expect(Object.values(s.engine.tally)[0].speaking[1]).toBe(1);
    expect(s.items).toEqual({});
    await p.getByRole('button', { name: /Close the pronunciation check/ }).click();
    await expect(page.locator('.pron-overlay')).toHaveCount(0);
  });

  test('a phone mic that sends silence at first: it waits for the mic before counting down', async ({ page }) => {
    // getUserMedia hands back a stream that is silent for 1.2 s (like an iPhone waking its mic), then a tone.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext();
        await ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        const dest = ctx.createMediaStreamDestination();
        gain.connect(dest);
        osc.start();
        gain.gain.setValueAtTime(0.01, ctx.currentTime + 1.2);
        window.__liveAt = performance.now() + 1200;
        return dest.stream;
      };
    });
    await page.goto('./#/course/p0-1/lesson');
    await view(page).locator('.pron-btn').click();
    const p = page.locator('.pron-sheet');
    await p.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(p.getByText(/Turning the mic on/)).toBeVisible();
    await expect(p.locator('#pron-count')).toHaveText('3', { timeout: 4_000 });
    const early = await page.evaluate(() => window.__liveAt - performance.now());
    expect(early).toBeLessThan(150);   // the count only starts once sound is coming in
    await expect(p.locator('#pron-count')).toHaveText('2');
    await page.keyboard.press('Escape');   // still closable mid-count
    await expect(page.locator('.pron-overlay')).toHaveCount(0);
  });

  test('without speech recognition: one line says why, and pitch and length are still checked', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    await page.goto('./#/course/p0-1/lesson');
    await view(page).locator('.pron-btn').click();
    const p = page.locator('.pron-sheet');
    await p.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(p.locator('.pron-title')).toBeVisible({ timeout: 20_000 });
    await expect(p.getByText(/^Sound check off:/)).toHaveCount(1);
    await expect(p.getByText(/Pitch and rhythm are still checked/)).toBeVisible();
    await expect(p.locator('.pron-mora.ok, .pron-mora.miss')).toHaveCount(0);   // no sound marks without recognition
  });

  test('a blocked mic explains how to allow it and points to the sound & mic check', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await page.goto('./#/course/p0-1/lesson');
    await view(page).locator('.pron-btn').click();
    const p = page.locator('.pron-sheet');
    await p.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(p.locator('.miss-c')).toContainText(/microphone|mic/i);
    await expect(p.getByRole('link', { name: /sound & mic check/ })).toHaveAttribute('href', '#/check');
  });

  test('skippable: Escape closes it, nothing is recorded, and the lesson carries on', async ({ page }) => {
    await page.goto('./#/course/p0-1/lesson');
    await view(page).locator('.pron-btn').click();
    await expect(page.locator('.pron-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pron-overlay')).toHaveCount(0);
    expect((await saved(page))?.engine?.tally || {}).toEqual({});
    await view(page).getByRole('button', { name: /Next|Finish/ }).click();
    await expect(view(page).locator('.mono')).toContainText('2/');
  });
});

test.describe('saved progress v6 → v7', () => {
  test('the v6 fixture loads with nothing lost and the check switched on', async ({ page }) => {
    await seed(page, FIXTURE_V6);
    await page.goto('./');
    const s = await saved(page);
    expect(s.v).toBe(14);
    expect(s.settings.pronCheck).toBe(true);
    for (const [k, v] of Object.entries(FIXTURE_V6.settings)) expect(s.settings[k]).toEqual(v);
    expect(s.items).toEqual(FIXTURE_V6.items);
    expect(s.grammar).toEqual(FIXTURE_V6.grammar);
    expect(s.days).toEqual(FIXTURE_V6.days);
    for (const k of ['chapters', 'forged', 'dojo', 'saga', 'course']) expect(s[k]).toEqual(FIXTURE_V6[k]);
    // A saved "off" stays off.
    const off = await page.evaluate(async (f) => (await import('./js/store.js')).store.parseImport(JSON.stringify({ ...f, settings: { ...f.settings, pronCheck: false } })).settings.pronCheck, FIXTURE_V6);
    expect(off).toBe(false);
  });
});

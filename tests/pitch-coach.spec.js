// The Pitch Coach (js/pitch-coach.js, js/pitch-score.js): the semitone scale and scoring as plain functions, then the
// live line, the ladder, "just this step", "ears first" and the warm-up buttons, driven by a fake microphone that
// sings known pitch curves (an oscillator standing in for getUserMedia).
import { readFileSync } from 'node:fs';
import { test, expect, seed, saved, view, expectNoHorizontalScroll, studiedDays } from './helpers.js';

const FIXTURE_V7 = JSON.parse(readFileSync(new URL('./fixtures/progress-v7.json', import.meta.url), 'utf8'));

const VOICE = { mid: 180, lo: -3, hi: 3.5, n: 3 };
const AME = { id: 'n5:雨', jp: '雨', reading: 'あめ', say: 'あめ', voice: 0, en: 'rain', accent: 1 };     // あ high, め low
const HANA_NOSE = { id: 'n5:鼻', jp: '鼻', reading: 'はな', say: 'はな', voice: 0, en: 'nose', accent: 0 };
const HANA_FLOWER = { id: 'n5:花', jp: '花', reading: 'はな', say: 'はな', voice: 0, en: 'flower', accent: 2 };
const st = (base, n) => base * 2 ** (n / 12);

/**
 * A fake microphone: getUserMedia returns an oscillator's stream, silent until a test calls
 * window.__mic.sing([[seconds, hz | null], ...]) (null is a pause).
 */
async function fakeMic(page) {
  await page.addInitScript(() => {
    let mic = null;
    const make = () => {
      if (mic) return mic;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      osc.start();
      mic = { ctx, osc, gain };
      return mic;
    };
    window.__mic = {
      sing(curve) {
        const m = make();
        if (m.ctx.state === 'suspended') m.ctx.resume();
        let t = m.ctx.currentTime + 0.02;
        for (const [dur, hz] of curve) {
          if (hz) { m.osc.frequency.setValueAtTime(hz, t); m.gain.gain.setValueAtTime(0.3, t); } else m.gain.gain.setValueAtTime(0, t);
          t += dur;
        }
        m.gain.gain.setValueAtTime(0, t);
        return new Promise((r) => setTimeout(r, (t - m.ctx.currentTime) * 1000 + 50));
      },
      gets: 0,
    };
    navigator.mediaDevices.getUserMedia = async () => { window.__mic.gets++; const m = make(); if (m.ctx.state === 'suspended') await m.ctx.resume(); const dest = m.ctx.createMediaStreamDestination(); m.gain.connect(dest); return dest.stream; };   // a fresh stream each time (stopping one doesn't end the next)
  });
}

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

async function open(page, target, opts = {}) {
  await page.evaluate(async ([t, o]) => { (await import('./js/pitch-coach.js')).openCoach(t, o); }, [target, opts]);
  await expect(page.locator('.coach-overlay')).toBeVisible();
}

/** Start a go, wait for "Your turn", then sing the curve. */
async function attempt(page, curve) {
  const sheet = page.locator('.coach-sheet');
  await sheet.getByRole('button', { name: /Start|Again/ }).click();
  await expect(sheet.getByRole('status').filter({ hasText: 'Your turn' })).toBeVisible({ timeout: 10_000 });
  await page.evaluate((c) => window.__mic.sing(c), curve);
  await expect(sheet.locator('.pron-verdict')).toBeVisible({ timeout: 10_000 });
  return (await sheet.locator('.pron-title').textContent()).trim();
}

const ready = (extra = {}) => ({ v: 8, items: {}, settings: { voice: VOICE }, coach: { ears: [AME.id, HANA_NOSE.id, HANA_FLOWER.id, 'itadakimasu', 'ohayou', 'hello'] }, ...extra });

test.describe('pitch maths (pitch-score.js)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('./'); });

  test('semitones and the fixed scale: an octave is 12, a small wobble stays small on screen', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const p = await import('./js/pitch-score.js');
      return {
        oct: p.semitones(440, 220), down: p.semitones(200, 400), back: p.fromSemitones(12, 100),
        mid: p.yFor(0, 190), top: p.yFor(p.SCALE_ST, 190), clampTop: p.yFor(40, 190), bottom: p.yFor(-p.SCALE_ST, 190),
        wobble: p.yFor(0, 190) - p.yFor(0.5, 190), step: p.yFor(0, 190) - p.yFor(p.STEP_ST, 190), big: p.yFor(0, 190) - p.yFor(p.BIG_STEP_ST, 190),
      };
    });
    expect(r.oct).toBeCloseTo(12, 6);
    expect(r.down).toBeCloseTo(-12, 6);
    expect(r.back).toBeCloseTo(200, 6);
    expect(r.mid).toBe(95);
    expect(r.top).toBe(14);
    expect(r.clampTop).toBe(14);           // off the scale: pinned to the edge, not stretched
    expect(r.bottom).toBe(176);
    expect(r.wobble).toBeLessThan(6);      // half a semitone: a few pixels, not the whole chart
    expect(r.big).toBeCloseTo(2 * r.step, 6);
  });

  test('the median filter ignores a single bad reading; the voice range is learned slowly', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const p = await import('./js/pitch-score.js');
      const hzs = Array.from({ length: 40 }, (_, i) => 200 * 2 ** (((i % 5) - 2) / 12));
      const v = p.voiceFrom(hzs);
      return {
        filtered: p.medianFilter([0, 0, 0, 12, 0, 0, null, 1, 1, 1], 5),
        none: p.medianFilter([1, null, 2], 5),
        v, tooFew: p.voiceFrom([200, 210]),
        first: p.learnVoice(null, hzs),
        drift: p.learnVoice({ mid: 200, lo: -2, hi: 2, n: 5 }, hzs.map((h) => h * 2)),   // an octave up, once
      };
    });
    expect(r.filtered.slice(2, 6)).toEqual([0, 0, 0, 0]);   // the octave jump (12) never shows
    expect(r.filtered[6]).toBe(null);
    expect(r.none).toEqual([null, null, null]);
    expect(r.v.mid).toBeCloseTo(200, 0);
    expect(r.v.lo).toBeLessThanOrEqual(-2);
    expect(r.v.hi).toBeGreaterThanOrEqual(2);
    expect(r.tooFew).toBe(null);
    expect(r.first.n).toBe(1);
    // One odd attempt moves the middle only a fifth of the way (12 st × 0.2 ≈ 2.4 st), not the whole octave.
    expect(12 * Math.log2(r.drift.mid / 200)).toBeCloseTo(2.4, 1);
    expect(r.drift.n).toBe(6);
  });

  test('scoring counts the drop and the direction of each step, not height or size', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const p = await import('./js/pitch-score.js');
      const tamago = [false, true, false];   // ta-MA-go: up, then drop after ま
      return {
        great: p.scorePitch(tamago, [-1, 1, -2]),
        tiny: p.scorePitch(tamago, [0, 0.8, 0.4]),                  // steps smaller than the minimum
        huge: p.scorePitch(tamago, [-6, 6, -9]),                 // far bigger steps: still just up and down
        high: p.scorePitch(tamago, [9, 11, 8]),                  // all of it very high: height doesn't count
        early: p.scorePitch([false, true, true, false], [0, 2, 0, -1]),
        flatOk: p.scorePitch([false, true, true], [0, 2, 2.4]),  // a little drift on a level step is fine
        flatDrop: p.scorePitch([false, true, true], [0, 2, -1]), // no drop wanted, but it fell
        skipped: p.scorePitch([false, true, true, false], [0, 2, null, -1], { skip: [false, false, true, false] }),
        none: p.scorePitch([true, false], [null, null]),
      };
    });
    expect(r.great.verdict).toBe('great');
    expect(r.great.drop).toEqual({ want: 1, got: 1, ok: true });
    expect(r.great.steps.map((s) => s.got)).toEqual(['up', 'down']);
    expect(r.tiny.steps.map((s) => s.got)).toEqual(['up', 'level']);
    expect(r.tiny.drop.ok).toBe(false);
    expect(r.huge.verdict).toBe('great');
    expect(r.high.verdict).toBe('great');
    expect(r.early.drop.ok).toBe(false);
    expect(r.early.firstMiss).toEqual(expect.objectContaining({ from: 1, to: 2, want: 'level', got: 'down' }));
    expect(r.early.verdict).toBe('close');   // generous: most of it was right
    expect(r.flatOk.verdict).toBe('great');
    expect(r.flatDrop.drop.ok).toBe(false);
    expect(r.skipped.steps.map((s) => [s.from, s.to])).toEqual([[0, 1], [1, 3]]);   // the whispered beat is left out
    expect(r.skipped.verdict).toBe('great');
    expect(r.none.verdict).toBe('none');
  });

  test('with が: only here do flat words and words that drop after their last beat differ', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const p = await import('./js/pitch-score.js');
      const word = [false, true];
      return { nose: p.withParticle(word, 0), flower: p.withParticle(word, 2), rain: p.withParticle([true, false], 1), guess: p.withParticle(word) };
    });
    expect(r.nose).toEqual([false, true, true]);      // はなが (nose): が stays up
    expect(r.flower).toEqual([false, true, false]);   // はなが (flower): drops onto が
    expect(r.rain).toEqual([true, false, false]);
    expect(r.guess).toEqual([false, true, true]);
  });

  test('beats from a hum (even split) and from ma-ma-ma (split at the dips)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const p = await import('./js/pitch-score.js');
      const f = (hz, level = 0.2) => ({ hz, level, time: 0 });
      const hum = [...Array(10).fill(f(200)), ...Array(10).fill(f(150))];
      const ma = [...Array(6).fill(f(150)), f(null, 0), f(null, 0), ...Array(3).fill(f(200)), f(null, 0), ...Array(7).fill(f(160))];
      return { hum: p.beatsPitch(hum, 2, 200), ma: p.beatsPitch(ma, 3, 150, { segmented: true }), quiet: p.beatsPitch([f(null, 0)], 2, 200) };
    });
    expect(r.hum[0]).toBeCloseTo(0, 6);
    expect(r.hum[1]).toBeCloseTo(12 * Math.log2(150 / 200), 6);
    expect(r.ma[0]).toBeCloseTo(0, 6);
    expect(r.ma[1]).toBeCloseTo(12 * Math.log2(200 / 150), 6);
    expect(r.ma[2]).toBeCloseTo(12 * Math.log2(160 / 150), 6);
    expect(r.quiet).toEqual([null, null]);
  });
});

test.describe('the Pitch Coach (fake mic singing known curves)', () => {
  test.beforeEach(async ({ page }) => { await fakeMic(page); });

  test('hum it: the live line is drawn over the melody, a right curve is Great and suggests the next step', async ({ page }) => {
    await seed(page, ready());
    await page.goto('./');
    await open(page, AME);
    const sheet = page.locator('.coach-sheet');
    await expect(sheet.getByRole('tab', { name: '1. Hum' })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet.locator('canvas.coach-line')).toHaveAttribute('aria-label', /あ high, め low/);
    // High then low (あ↘め), well inside the comfortable band.
    const title = await attempt(page, [[0.45, st(180, 2)], [0.45, st(180, -2)]]);
    expect(title).toBe('Great!');
    await expect(sheet.locator('.coach-step.ok')).toHaveCount(1);
    await expect(sheet.locator('canvas.coach-line')).toHaveAttribute('aria-label', /Your steps: down/);
    // The live line has points, and the drawing is a real picture (not blank).
    const line = await page.evaluate(async () => {
      const c = document.querySelector('canvas.coach-line');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]) ink++;
      return ink;
    });
    expect(line).toBeGreaterThan(500);
    await expect(sheet.getByRole('button', { name: /Next step/ })).toBeVisible();
    await expect(sheet.locator('.seg-btn.suggested')).toHaveText('2. Ma-ma');
    // Graded as pitch practice; the voice range keeps learning.
    const s = await saved(page);
    const today = Object.values(s.engine.tally).pop();
    expect(today.pitch[1]).toBeGreaterThanOrEqual(1);
    expect(s.settings.voice.n).toBe(VOICE.n + 1);
    await expectNoHorizontalScroll(page);
  });

  test('the wrong direction is Try again, shows the answer, and moving up is never forced', async ({ page }) => {
    await seed(page, ready());
    await page.goto('./');
    await open(page, AME);
    const sheet = page.locator('.coach-sheet');
    const title = await attempt(page, [[0.45, st(180, -2)], [0.45, st(180, 2)]]);   // low then high: backwards
    expect(title).toBe('Try again');
    // The expected direction, drawn as a falling arrow (with "down" for screen readers).
    await expect(sheet.locator('.coach-step.miss svg.ico-fall')).toHaveCount(1);
    await expect(sheet.locator('.coach-step.miss')).toContainText('(down)');
    await expect(sheet.getByText('Listen for the drop after あ')).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Next step/ })).toHaveCount(0);
    // Any step can be chosen at any time.
    await sheet.getByRole('tab', { name: '4. + が' }).click();
    await expect(sheet.getByRole('tab', { name: '4. + が' })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet.locator('canvas.coach-line')).toHaveAttribute('aria-label', /あ high, め low, が low/);
  });

  test('ma-ma-ma: three syllables split at the dips; Bigger exaggerates the target', async ({ page }) => {
    await seed(page, ready());
    await page.goto('./');
    await open(page, AME, { step: 'ma' });
    const sheet = page.locator('.coach-sheet');
    await expect(sheet.getByRole('tab', { name: '2. Ma-ma' })).toHaveAttribute('aria-selected', 'true');
    const title = await attempt(page, [[0.3, st(180, 1.5)], [0.12, null], [0.3, st(180, -1.5)]]);
    expect(title).toBe('Great!');
    const ink = () => page.evaluate(() => {
      const c = document.querySelector('canvas.coach-line');
      const d = c.getContext('2d').getImageData(0, 0, c.width, 45 * (window.devicePixelRatio || 1)).data;   // the top strip
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
      return n;
    });
    const before = await ink();
    await sheet.getByRole('switch', { name: /Bigger/ }).check();
    expect(await ink()).toBeGreaterThan(before);   // the high step moved up into the top strip
  });

  test('a flat word vs one that drops after its last beat: told apart only with が', async ({ page }) => {
    await seed(page, ready());
    await page.goto('./');
    await open(page, HANA_NOSE, { step: 'ga' });
    await expect(page.locator('canvas.coach-line')).toHaveAttribute('aria-label', /は low, な high, が high/);
    await page.evaluate(async () => (await import('./js/pitch-coach.js')).closeCoach());
    await open(page, HANA_FLOWER, { step: 'ga' });
    await expect(page.locator('canvas.coach-line')).toHaveAttribute('aria-label', /は low, な high, が low/);
    // On the word alone they look the same: no drop marked.
    await page.locator('.coach-sheet').getByRole('tab', { name: '3. Word' }).click();
    await expect(page.locator('canvas.coach-line')).toHaveAttribute('aria-label', 'Target melody: は low, な high.');
  });

  test('whispered beats are left out, with a note saying why', async ({ page }) => {
    await seed(page, ready());
    await page.goto('./');
    await page.evaluate(async () => {
      const { PHRASE_BY_ID } = await import('./js/data.js');
      const { openCoach, phraseTarget } = await import('./js/pitch-coach.js');
      openCoach(phraseTarget(PHRASE_BY_ID.itadakimasu));
    });
    const sheet = page.locator('.coach-sheet');
    await expect(sheet.getByText(/whispered in normal speech/)).toContainText('す');
    const label = await sheet.locator('canvas.coach-line').getAttribute('aria-label');
    expect(label).toContain('ま high');
    expect(label).not.toContain('す');
  });

  test('just this step: loops two beats until right twice, then back to the whole word', async ({ page }) => {
    await seed(page, ready());
    await page.goto('./');
    await open(page, AME, { focus: { a: 0, b: 1 } });
    const sheet = page.locator('.coach-sheet');
    await expect(sheet.getByText('Just this step:')).toContainText(/あ.*→.*め/);
    await expect(sheet.getByRole('tab')).toHaveCount(0);
    expect(await attempt(page, [[0.35, st(180, 2)], [0.35, st(180, -2)]])).toBe('Great!');
    await expect(sheet.locator('.mono')).toHaveText('1/2');
    expect(await attempt(page, [[0.35, st(180, 2)], [0.35, st(180, -2)]])).toBe('Great!');
    await expect(sheet.getByText('Right twice in a row. Back to the whole word.')).toBeVisible();
    await expect(sheet.getByRole('tab', { name: '3. Word' })).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
  });

  test('ears first: before the first session on a word, pick where the pitch drops; a miss shows it and replays', async ({ page }) => {
    await seed(page, ready({ coach: { ears: [] } }));
    await page.goto('./');
    await open(page, AME);
    const sheet = page.locator('.coach-sheet');
    await expect(sheet.getByText('Ears first: where does the pitch drop?')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'め' })).toBeDisabled();   // a drop after the last beat can't be heard here
    await sheet.getByRole('button', { name: 'No drop' }).click();
    await expect(sheet.getByRole('status')).toContainText('Not quite. It drops after あ');
    await expect(sheet.getByRole('button', { name: 'あ' })).toHaveClass(/good/);
    const s = await saved(page);
    expect(Object.values(s.engine.tally).pop().pitch).toEqual([0, 1]);
    await sheet.getByRole('button', { name: /On to the Pitch Coach/ }).click();
    await expect(sheet.getByRole('tab', { name: '1. Hum' })).toBeVisible();
    expect((await saved(page)).coach.ears).toContain(AME.id);
    // Next time it goes straight to the ladder; the warm-up is still there to open.
    await page.evaluate(async () => (await import('./js/pitch-coach.js')).closeCoach());
    await open(page, AME);
    await expect(sheet.getByRole('tab', { name: '1. Hum' })).toBeVisible();
    await sheet.getByRole('button', { name: /Ears first/ }).click();
    await sheet.getByRole('button', { name: 'あ' }).click();
    await expect(sheet.getByRole('status')).toContainText('Yes!');
  });

  test('ears first plays real voices 1 and 3 when the word has clips in them, otherwise the clip lower and higher', async ({ page }) => {
    await seed(page, ready({ coach: { ears: [] }, settings: { voice: VOICE, speed: 'slow' } }));
    await page.goto('./');
    const watch = () => page.evaluate(async () => {
      const { speaker } = await import('./js/audio.js');
      window.__spoken = [];
      const speak = speaker.speak.bind(speaker);
      speaker.speak = (text, o = {}) => { window.__spoken.push({ text, voice: o.voice, file: speaker.clipFor(text, o.voice, o.speed || speaker.speed) }); speak(text, o); };
    });
    const sheet = page.locator('.coach-sheet');
    // An N5 word: voice 0, then voices 1 and 3, each its own normal-speed clip even with 🐢 on.
    await watch();
    const RAIN = { ...AME, say: '雨' };
    const clips = await page.evaluate(async () => { const { CLIPS } = await import('./js/clips.js'); return [0, 1, 3].map((v) => CLIPS[`雨#${v}`]); });
    expect(clips.every(Boolean)).toBe(true);
    await open(page, RAIN);
    await expect(sheet.getByText('Listen to it 3 ways')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__spoken.length), { timeout: 15000 }).toBe(3);
    const spoken = await page.evaluate(() => window.__spoken);
    expect(spoken.map((s) => s.voice)).toEqual([0, 1, 3]);
    expect(spoken.map((s) => s.file)).toEqual(clips);
    // A text with no clips in the other voices keeps the playbackRate fallback (no extra voices spoken).
    await page.evaluate(async () => (await import('./js/pitch-coach.js')).closeCoach());
    await watch();
    const odd = await page.evaluate(async () => { const { CLIPS } = await import('./js/clips.js'); return !CLIPS['あめ#1'] && !CLIPS['あめ#2'] && !CLIPS['あめ#3']; });
    expect(odd).toBe(true);
    await open(page, AME);
    await expect(sheet.getByText('Listen to it 3 ways')).toBeVisible();
    await page.waitForTimeout(1500);
    expect((await page.evaluate(() => window.__spoken)).filter((s) => s.voice > 0)).toEqual([]);
  });

  test('the first time ever: a 2-second あ finds your middle pitch, saved on this device', async ({ page }) => {
    await seed(page, ready({ settings: {} }));
    await page.goto('./');
    await open(page, AME);
    const sheet = page.locator('.coach-sheet');
    await expect(sheet.getByText('First, find your voice')).toBeVisible();
    await sheet.getByRole('button', { name: /Say あ.* now/ }).click();
    await expect(sheet.getByRole('status').filter({ hasText: /Say あ/ })).toBeVisible();
    await page.evaluate(() => window.__mic.sing([[2.1, 140]]));
    await expect(sheet.getByRole('tab', { name: '1. Hum' })).toBeVisible({ timeout: 5000 });
    const v = (await saved(page)).settings.voice;
    expect(v.mid).toBeGreaterThan(130);
    expect(v.mid).toBeLessThan(150);
    expect(v.n).toBe(1);
  });

  test('from the pronunciation check: a Pitch Coach button, and "Practise just this step" after a pitch problem', async ({ page }) => {
    test.setTimeout(60_000);
    await fakeRecognizer(page, 'あめ');
    await seed(page, ready());
    await page.goto('./');
    await page.evaluate(async (t) => (await import('./js/pron.js')).openPron(t), AME);
    const pron = page.locator('.pron-sheet');
    await pron.getByRole('button', { name: /Pitch Coach/ }).click();
    await expect(page.locator('.coach-sheet')).toBeVisible();
    await expect(page.locator('.pron-overlay:not(.coach-overlay)')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.coach-overlay')).toHaveCount(0);
    // A result with a pitch problem between あ and め offers that step on its own.
    await page.evaluate(async (t) => (await import('./js/pron.js')).openPron(t), AME);
    await pron.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(pron.getByText(/Go!/)).toBeVisible({ timeout: 10_000 });   // after the mic is on and a 3-second count
    await page.evaluate(() => window.__mic.sing([[0.35, 150], [0.35, 200]]));   // low then high: backwards
    await expect(pron.locator('.pron-title')).toBeVisible({ timeout: 20_000 });
    const step = pron.getByRole('button', { name: /Practise just this step/ });
    await expect(step).toContainText(/あ.*→.*め/);
    await expect(pron.locator('.pron-user-dot')).toHaveCount(2);   // your line, on the fixed scale
    await step.click();
    await expect(page.locator('.coach-sheet').getByText('Just this step:')).toBeVisible();
    await expect(page.locator('.pron-overlay:not(.coach-overlay)')).toHaveCount(0);
  });

  test('warm-ups: Rhythm and Pitch Duel open the coach for their phrase', async ({ page }) => {
    await seed(page, ready());
    await page.goto('./#/play/rhythm');
    await view(page).getByRole('button', { name: 'Pitch Coach warm-up' }).click();
    await expect(page.locator('.coach-sheet')).toBeVisible();
    // A phrase not practised before starts with "ears first"; Skip goes straight to the ladder.
    await expect(page.locator('.coach-sheet').getByText('Ears first: where does the pitch drop?')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.locator('.coach-sheet').getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.locator('canvas.coach-line')).toHaveAttribute('aria-label', /Target melody/);
    await expectNoHorizontalScroll(page);
    await page.locator('.coach-sheet').getByRole('button', { name: /Close/ }).click();
    await expect(page.locator('.coach-overlay')).toHaveCount(0);
    await page.goto('./#/play/duel');
    await view(page).locator('.duel-opt').first().click();
    await view(page).getByRole('button', { name: /Pitch Coach warm-up/ }).click();
    await expect(page.locator('.coach-sheet')).toBeVisible();
    // Leaving the screen closes it.
    await page.goto('./#/');
    await expect(page.locator('.coach-overlay')).toHaveCount(0);
  });

  test('no mic permission: a calm explanation and a link to the sound & mic check', async ({ page }) => {
    await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
    await seed(page, ready());
    await page.goto('./');
    await open(page, AME);
    await page.locator('.coach-sheet').getByRole('button', { name: /Start/ }).click();
    await expect(page.locator('.coach-sheet').getByRole('link', { name: 'sound & mic check' })).toBeVisible();
  });
});

test.describe('saved progress v7 → v8', () => {
  test('the v7 fixture loads with nothing lost, no voice yet and no words warmed up', async ({ page }) => {
    await seed(page, FIXTURE_V7);
    await page.goto('./');
    const s = await saved(page);
    expect(s.v).toBe(17);
    expect(s.settings).toEqual({ ...FIXTURE_V7.settings, autoMic: false, voice: null, showAllLevels: false });
    expect(s.coach).toEqual({ ears: [] });
    expect(s.items).toEqual(FIXTURE_V7.items);
    expect(s.grammar).toEqual(FIXTURE_V7.grammar);
    expect(studiedDays(s.days)).toEqual(studiedDays(FIXTURE_V7.days));
    for (const k of ['chapters', 'forged', 'dojo', 'saga', 'course', 'engine']) expect(s[k]).toEqual(FIXTURE_V7[k]);
  });

  test('a bad saved voice is dropped, a good one kept, and the warmed-up list is tidied', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async (fx) => {
      const { store } = await import('./js/store.js');
      const bad = store.parseImport(JSON.stringify({ ...fx, v: 8, settings: { ...fx.settings, voice: { mid: 5000, lo: 0, hi: 0, n: 1 } } }));
      const good = store.parseImport(JSON.stringify({ ...fx, v: 8, settings: { ...fx.settings, voice: { mid: 150, lo: -3, hi: 3, n: 2 } }, coach: { ears: ['a', 'a', 'b', 3] } }));
      return { bad: bad.settings.voice, good: good.settings.voice, ears: good.coach.ears };
    }, FIXTURE_V7);
    expect(r.bad).toBe(null);
    expect(r.good).toEqual({ mid: 150, lo: -3, hi: 3, n: 2 });
    expect(r.ears).toEqual(['a', 'b']);
  });
});

// Every mode loads and completes at least one real interaction, and the result is saved.
import { test, expect, seed, saved, plainText, view, pastWords, expectNoHorizontalScroll, gradeGardenCard } from './helpers.js';

test.describe('modes', () => {
  test('Reading Dojo: learn the first lesson and clear its quiz', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('./#/play/dojo');
    const v = view(page);
    await v.getByRole('button', { name: /Next lesson:/ }).click();
    await expect(v.locator('.learn-card').first()).toBeVisible();
    await v.locator('.learn-card').first().click();
    await v.getByRole('button', { name: /Practice these/ }).click();
    // Answer every question (option 1 each time). Misses come back once, so the quiz always ends.
    for (let i = 0; i < 80; i++) {
      if (await v.getByText(/cleared!/).isVisible()) break;
      await v.locator('[data-act=pick]:enabled').first().click();
      await expect(v.getByText(/Right!|Not quite/)).toBeVisible();
      // Next moves on (a right answer also moves on by itself after a moment).
      await v.locator('[data-act=next]').click().catch(() => {});
      await expect(v.getByText(/Right!|Not quite/)).toHaveCount(0);
    }
    await expect(v.getByText(/cleared!/)).toBeVisible();
    const s = await saved(page);
    expect(s.dojo).toContain('h1');
    expect(Object.keys(s.items).some((id) => id.startsWith('kana:'))).toBe(true);
  });

  test('Reading Dojo: hiragana chart plays a character', async ({ page }) => {
    await page.goto('./#/play/dojo');
    const v = view(page);
    await v.getByRole('button', { name: /Hiragana chart/ }).click();
    await expect(v.locator('.kana-cell')).not.toHaveCount(0);
    await v.locator('.kana-cell').first().click();
    await v.getByRole('button', { name: 'Back to the Dojo' }).click();
    await expect(v.getByRole('button', { name: /Next lesson:/ })).toBeVisible();
  });

  test('Garden: water a plant and grade it', async ({ page }) => {
    await page.goto('./#/play/garden');
    const v = view(page);
    await v.getByRole('button', { name: /Water \d+ plant/ }).click();
    await gradeGardenCard(v);
    await expect(v.locator('.card-review .mono')).toHaveText(/^2 \//);
    const s = await saved(page);
    const reviewed = Object.values(s.items).filter((p) => p.r === 1);
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0].level).toBe(1);
    expect(reviewed[0].due).toBeGreaterThan(Date.now());
  });

  test('Story: open chapter 1 and read to the next line', async ({ page }) => {
    await page.goto('./#/play/story');
    const v = view(page);
    await v.locator('[data-act=open]').first().click();
    await pastWords(v);
    await v.getByRole('button', { name: 'Meaning', exact: true }).click();
    await expect(v.locator('.line-card .trace-c')).toBeVisible();
    await v.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(v.locator('.bar span')).not.toHaveAttribute('style', /width:\s*0/);
    const s = await saved(page);
    expect(Object.keys(s.items).length).toBeGreaterThan(0);   // the words met were planted
  });

  test('Story: read chapter 1 to the end', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('./#/play/story');
    const v = view(page);
    await v.locator('[data-act=open]').first().click();
    await pastWords(v);
    for (let i = 0; i < 60; i++) {
      if (await v.getByText(/クリア/).isVisible()) break;
      const choices = v.locator('[data-act=choice]');
      if (await choices.count()) {
        // Try each option until the right one; a wrong one just shows a reply.
        for (let c = 0; c < await choices.count(); c++) {
          if (!(await v.locator('[data-act=choice]').count())) break;
          await v.locator('[data-act=choice]').nth(c).click();
        }
        continue;
      }
      await v.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(v.getByText(/クリア/)).toBeVisible();
    expect((await saved(page)).chapters).toContain('ch1');
  });

  test('Particle Train: couple a train and send it off', async ({ page }) => {
    await page.goto('./#/play/particle');
    const v = view(page);
    const palette = v.locator('[data-act=place]');
    const n = await palette.count();
    // Departed: the 出発進行！ line shows (with furigana now, so look for its Next train button).
    const departed = v.getByRole('button', { name: /Next train/ });
    for (let i = 0; i < 60 && !(await departed.isVisible()); i++) {
      await palette.nth(i % n).click();
    }
    await expect(v.locator('.lead.good-c')).toContainText('出発');
    await v.getByRole('button', { name: /Next train/ }).click();
    await expect(v.locator('.coupling.active')).toHaveCount(1);
    const day = Object.values((await saved(page)).days)[0];
    expect(day.tot).toBeGreaterThan(0);
  });

  test('Kanji Forge: forge the first kanji', async ({ page }) => {
    await page.goto('./#/play/forge');
    const v = view(page);
    const target = await page.evaluate(async () => (await import('./js/data.js')).KANJI[0]);
    for (const part of target.parts) {
      await v.locator('.part-grid [data-act=add]').filter({ has: page.locator('.part-k', { hasText: new RegExp(`^${part}`) }) }).first().click();
    }
    await v.getByRole('button', { name: /Strike the anvil/ }).click();
    await expect(v.locator('.forged-k')).toBeVisible();
    expect(await plainText(v.locator('.forged-k'))).toBe(target.kanji);
    const s = await saved(page);
    expect(s.forged).toEqual([target.kanji]);
    expect(s.items[target.gardenID]).toBeTruthy();
  });

  test('Kanji Forge: a wrong strike explains and lets you retry', async ({ page }) => {
    await page.goto('./#/play/forge');
    const v = view(page);
    const target = await page.evaluate(async () => (await import('./js/data.js')).KANJI[0]);
    const wrong = v.locator('.part-grid [data-act=add]').filter({ hasNot: page.locator('.part-k', { hasText: new RegExp(`^(${target.parts.join('|')})`) }) });
    await wrong.first().click();
    await v.getByRole('button', { name: /Strike the anvil/ }).click();
    await expect(v.getByText(/Not quite/)).toBeVisible();
    await expect(v.getByRole('button', { name: /Strike the anvil/ })).toBeDisabled();
  });

  test('Rhythm: sing a line with the mic and get a score', async ({ page }) => {
    await page.goto('./#/play/rhythm');
    const v = view(page);
    await v.getByRole('button', { name: /Sing it/ }).click();
    await expect(v.getByText('RHYTHM')).toBeVisible({ timeout: 15_000 });
    await expect(v.locator('.score-big')).toHaveText(/\d+%/);
    const s = await saved(page);
    expect(Object.values(s.items).some((p) => p.pl > 0)).toBe(true);
  });

  test('Rhythm: a live mic meter while singing, and a pointer to the mic check when only silence came in', async ({ page }) => {
    await page.addInitScript(() => {
      // A microphone that delivers nothing but silence.
      navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
    });
    await page.goto('./#/play/rhythm');
    const v = view(page);
    await v.getByRole('button', { name: /Sing it/ }).click();
    await expect(v.locator('.mic-meter')).toBeVisible();
    await expect(v.getByText('The mic only sent silence.')).toBeVisible({ timeout: 15_000 });
    await expect(v.getByRole('link', { name: 'sound and mic check' })).toHaveAttribute('href', '#/check');
    await expect(v.locator('.mic-meter')).toHaveCount(0);
  });

  test('Rhythm: quiet mode grades yourself', async ({ page }) => {
    await seed(page, { items: {}, settings: { quiet: true } });
    await page.goto('./#/play/rhythm');
    const v = view(page);
    await expect(v.getByText(/Quiet mode: Rhythm needs your voice/)).toBeVisible();
    await v.getByRole('button', { name: /Sing it/ }).click();
    await v.getByRole('button', { name: /I said it/ }).click({ timeout: 15_000 });
    await expect(v.locator('.score-big')).toHaveText('85%');
    await v.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(v.getByRole('button', { name: /Sing it/ })).toBeEnabled();
  });

  test('Pitch Duel: answer a question', async ({ page }) => {
    await page.goto('./#/play/duel');
    const v = view(page);
    await v.locator('[data-act=choose]').first().click();
    await expect(v.getByText(/Yes! Listen once more|Not quite. The green one/)).toBeVisible();
    await expect(v.getByText(/^[01]\/1 correct$/)).toBeVisible();
    await v.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(v.getByText(/\/1 correct/)).toBeVisible();
    await expect(v.locator('[data-act=choose]').first()).toBeEnabled();
  });

  test('Speak Slice: self-grade when speech recognition is missing', async ({ page }) => {
    await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    await page.goto('./#/play/slice');
    const v = view(page);
    await expect(v.getByText(/you grade yourself/)).toBeVisible();
    await v.getByRole('button', { name: /Start a 60-second round/ }).click();
    const ok = v.getByRole('button', { name: /I said it/ });
    await expect(ok).toBeEnabled({ timeout: 10_000 });
    await ok.click();
    await expect(v.locator('#sl-score')).not.toHaveText('0');
  });

  test('Speak Slice: quiet mode listen-and-choose, through to the round summary', async ({ page }) => {
    // The game advances at most 50 ms per animation frame, so playing out a 60-second round takes ~1,200 frames.
    test.setTimeout(90_000);
    await page.clock.install();
    await seed(page, { items: {}, settings: { quiet: true } });
    await page.goto('./#/play/slice');
    const v = view(page);
    await v.getByRole('button', { name: /Start a 60-second round/ }).click();
    await page.clock.runFor(5000);
    const choice = v.locator('[data-act=choose]').first();
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(v.locator('#sl-reveal .reveal').or(v.locator('.flyer.sliced'))).not.toHaveCount(0);
    await page.clock.runFor(60_000);
    await expect(v.getByText(/sliced · \d+ got away/)).toBeVisible();
    await expect(v.getByRole('button', { name: /Play again/ })).toBeVisible();
  });

  test('Speak Slice: the review list names each missed word, and same-sound pairs get their pitch', async ({ page }) => {
    test.setTimeout(90_000);
    await page.clock.install();
    await seed(page, { items: {}, settings: { quiet: true } });
    await page.goto('./#/play/slice');
    const v = view(page);
    await v.getByRole('button', { name: /Start a 60-second round/ }).click();
    await page.clock.runFor(65_000);   // answer nothing: everything that fell is in the review list
    const rows = v.locator('.review-row');
    await expect(rows.first()).toBeVisible();
    const info = await page.evaluate(async () => {
      const { PHRASE_BY_ID } = await import('./js/data.js');
      return [...document.querySelectorAll('#view .review-row')].map((r) => {
        const p = PHRASE_BY_ID[r.dataset.review];
        const label = r.querySelector('.w110').textContent;
        return { id: p.id, boss: p.isBoss, named: label.includes(p.meaning.replace(/\s*\(\+ が\)$/, '')), melody: !!r.querySelector('svg.melody'), hear: !!r.querySelector('[data-act=hear]') };
      });
    });
    for (const r of info) {
      expect(r.named, r.id).toBe(true);
      expect(r.melody, r.id).toBe(r.boss);
      expect(r.hear, r.id).toBe(r.boss);
    }
    await expectNoHorizontalScroll(page);
  });

  test('Shopkeeper: serve one customer', async ({ page }) => {
    await page.goto('./#/play/shop');
    const v = view(page);
    await v.getByRole('button', { name: /^いらっしゃいませ/ }).click();
    const order = await plainText(v.locator('.customer .lead'));
    const { index, count } = await page.evaluate(async (text) => {
      const { SHOP_STOCK, COUNTERS } = await import('./js/data.js');
      for (const [i, s] of SHOP_STOCK.entries()) {
        const n = COUNTERS[s.counter].say.findIndex((w) => text.includes(w + s.name) || text.includes(s.name + 'を' + w) || text.includes(s.name + 'を、' + w));
        if (text.includes(s.name) && n >= 0) return { index: i, count: n + 1 };
      }
      for (const [i, s] of SHOP_STOCK.entries()) {
        if (!text.includes(s.name)) continue;
        // Longest counter word that appears wins (so 十一 doesn't match as 一).
        const say = COUNTERS[s.counter].say;
        const hits = say.map((w, n) => [w, n]).filter(([w]) => text.includes(w)).sort((a, b) => b[0].length - a[0].length);
        if (hits.length) return { index: i, count: hits[0][1] + 1 };
      }
      return null;
    }, order);
    for (let i = 0; i < count; i++) await v.locator('[data-act=add]').nth(index).click();
    await v.getByRole('button', { name: /Hand it over/ }).click();
    await expect(v.getByText(/Right:/)).toBeVisible();
    await v.locator('[data-act=reply][data-i="0"]').click();   // ありがとうございました (its romaji is chunked into the name)
    await expect(v.getByText(/1 served · 1 perfect/)).toBeVisible();
    await v.getByRole('button', { name: /Next customer/ }).click();
    await expect(v.getByRole('button', { name: /^いらっしゃいませ/ })).toBeVisible();
  });
});

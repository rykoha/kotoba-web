// Navigation, game feel, readability and accessibility of the redesigned UI.
import { test, expect, seed, saved, readerState, view } from './helpers.js';

const isPhone = (testInfo) => testInfo.project.name === 'phone';

test.describe('navigation', () => {
  test('the tab bar reaches every top-level screen and marks the current one', async ({ page }, testInfo) => {
    await page.goto('./');
    const tabs = page.locator('#tabs');
    await expect(tabs).toBeVisible();
    if (isPhone(testInfo)) {
      const box = await tabs.boundingBox();
      expect(box.y + box.height).toBeGreaterThan(800);   // bottom of a 844px screen
    }
    for (const [name, title] of [['Modes', 'Modes'], ['Garden', 'Garden'], ['Progress', 'Progress'], ['Settings', 'Settings'], ['Today', 'Kotoba Beat']]) {
      await tabs.getByRole('link', { name }).click();
      await expect(page.locator('#title')).toHaveText(title);
      await expect(tabs.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
      await expect(tabs.locator('[aria-current=page]')).toHaveCount(1);
    }
  });

  test('inside a mode the phone tab bar steps aside for the game, and back returns', async ({ page }, testInfo) => {
    await page.goto('./#/modes');
    await view(page).locator('.mode-card', { hasText: 'Kanji Forge' }).click();
    await expect(page.locator('#title')).toHaveText('Kanji Forge');
    if (isPhone(testInfo)) await expect(page.locator('#tabs')).toBeHidden();
    await page.locator('#back').click();
    await expect(page.locator('#title')).toHaveText('Modes');
  });

  test('browser back and the ‹ button walk the same history', async ({ page }) => {
    await page.goto('./');
    await page.locator('#tabs').getByRole('link', { name: 'Modes' }).click();
    await view(page).locator('.mode-card', { hasText: 'Pitch Duel' }).click();
    await expect(page.locator('#title')).toHaveText('Pitch Duel');
    await page.goBack();
    await expect(page.locator('#title')).toHaveText('Modes');
    await page.goForward();
    await expect(page.locator('#title')).toHaveText('Pitch Duel');
    await page.locator('#back').click();
    await page.locator('#back').waitFor({ state: 'hidden' });
    await expect(page.locator('#title')).toHaveText('Modes');
  });

  test('a deep link gets Today underneath it, so back never leaves the app', async ({ page }) => {
    await page.goto('./#/play/shop');
    await expect(page.locator('#title')).toHaveText('Shopkeeper');
    await page.goBack();
    await expect(page.locator('#today-h')).toBeVisible();
    expect(page.url()).toContain('/kotoba-web/');
  });

  test('screen transitions never widen the page, even mid-animation', async ({ page }) => {
    await page.goto('./');
    const widest = await page.evaluate(async () => {
      let max = 0;
      const sample = () => { max = Math.max(max, document.documentElement.scrollWidth - document.documentElement.clientWidth); };
      for (const hash of ['#/modes', '#/progress', '#/play/forge', '#/settings', '#/']) {
        location.hash = hash;
        for (let i = 0; i < 20; i++) { sample(); await new Promise((r) => requestAnimationFrame(r)); }
        history.back();
        for (let i = 0; i < 20; i++) { sample(); await new Promise((r) => requestAnimationFrame(r)); }
      }
      return max;
    });
    expect(widest).toBe(0);
  });

  test('Escape goes back on PC', async ({ page }) => {
    await page.goto('./#/modes');
    await view(page).locator('.mode-card', { hasText: 'Garden' }).first().click();
    await expect(page.locator('#back')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#title')).toHaveText('Modes');
  });

  test('finishing a Today block returns to Today without piling up history', async ({ page }) => {
    const state = await readerState(page);
    await seed(page, state);
    await page.goto('./');
    await view(page).locator('.hero').getByRole('link', { name: /Start/ }).click();
    await page.locator('#banner').getByRole('button', { name: /Done/ }).click();
    await expect(page.locator('#today-h')).toBeVisible();
    expect(await page.evaluate(() => history.state.kbDepth)).toBe(0);
  });
});

test.describe('game feel', () => {
  test('a right answer bursts and a wrong one nudges gently (and nothing is taken away)', async ({ page }) => {
    await page.goto('./#/play/forge');
    const v = view(page);
    const target = await page.evaluate(async () => (await import('./js/data.js')).KANJI[0]);
    const wrong = v.locator('.part-grid [data-act=add]').filter({ hasNot: page.locator('.part-k', { hasText: new RegExp(`^(${target.parts.join('|')})`) }) });
    await wrong.first().click();
    await v.getByRole('button', { name: /Strike the anvil/ }).click();
    await expect(page.locator('.fx-nudge')).toHaveCount(1);
    for (const part of target.parts) {
      await v.locator('.part-grid [data-act=add]').filter({ has: page.locator('.part-k', { hasText: new RegExp(`^${part}`) }) }).first().click();
    }
    await v.getByRole('button', { name: /Strike the anvil/ }).click();
    await expect(page.locator('#fx .fx-burst.big')).toHaveCount(1);
    await expect(page.locator('#fx .fx-burst')).toHaveCount(0, { timeout: 2000 });   // cleans up after itself
  });

  test('reduced motion: no bursts or slides, the answer colours still show', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./#/play/duel');
    await view(page).locator('[data-act=choose]').first().click();
    await expect(view(page).locator('.duel-opt.correct')).toHaveCount(1);
    await expect(page.locator('#fx > *')).toHaveCount(0);
    await page.goto('./#/modes');
    await expect(view(page)).not.toHaveClass(/enter-/);
  });

  test('sound effects and vibration can be turned off, and stay off', async ({ page }) => {
    await page.goto('./#/settings');
    await view(page).getByRole('switch', { name: /Sound effects/ }).uncheck();
    await expect.poll(async () => (await saved(page)).settings.sfx).toBe(false);
    await page.reload();
    await expect(view(page).getByRole('switch', { name: /Sound effects/ })).not.toBeChecked();
  });

  test('finishing the whole day shows the reward once', async ({ page }) => {
    const state = await readerState(page, { settings: { length: 'short', hideIosHint: true } });
    await page.clock.setFixedTime(new Date('2026-10-07T10:00:00'));
    await seed(page, state);
    await page.goto('./');
    for (let i = 0; i < 2; i++) {
      await view(page).locator('.hero').getByRole('link', { name: /Start/ }).click();
      await page.locator('#banner').getByRole('button', { name: /Done/ }).click();
    }
    const dialog = page.getByRole('dialog', { name: /おつかれさま/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Back to Today' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(view(page).getByText("Today's done", { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('readability', () => {
  test('text size scales the whole app and is saved', async ({ page }) => {
    await page.goto('./#/settings');
    const base = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    await view(page).getByRole('radio', { name: 'Extra large' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-text', 'xl');
    const big = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(big / base).toBeCloseTo(1.25, 2);
    expect((await saved(page)).settings.textSize).toBe('xl');
    await page.goto('./#/play/story');
    await view(page).locator('[data-act=open]').first().click();
    await page.waitForTimeout(300);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
  });

  test('a long kana word with romaji over it wraps instead of overflowing a narrow screen', async ({ page }) => {
    await seed(page, { v: 2, items: {}, settings: { readingHelp: 'romaji' } });
    await page.goto('./#/modes');
    const r = await page.evaluate(async () => {
      const p = document.createElement('p');
      p.style.width = '150px';
      p.lang = 'ja';
      p.textContent = 'ありがとうございました';
      document.getElementById('view').prepend(p);
      await new Promise((res) => setTimeout(res, 100));   // reading help annotates on the next mutation pass
      const rts = [...p.querySelectorAll('rt')].map((x) => x.textContent);
      return { overflow: p.scrollWidth - p.clientWidth, rts };
    });
    expect(r.rts.join('')).toBe('arigatougozaimashita');
    expect(r.rts.length).toBeGreaterThan(1);
    expect(r.overflow).toBeLessThanOrEqual(0);
  });

  test('romaji is spaced and broken by word, never in the middle of one', async ({ page }) => {
    await seed(page, { v: 2, items: {}, settings: { readingHelp: 'romaji' } });
    await page.goto('./#/modes');
    const r = await page.evaluate(async () => {
      const out = {};
      for (const text of ['よろしくおねがいします', 'わたしはがくせいです', 'ありがとうございます', 'よろしくお願いします', 'レンです', 'がくせいですか']) {
        const p = document.createElement('p');
        p.style.width = '120px';
        p.lang = 'ja';
        p.textContent = text;
        document.getElementById('view').prepend(p);
        await new Promise((res) => setTimeout(res, 100));
        // A word is one ruby, or one .jw span of rubies (one per romaji piece, so no ruby text holds a space).
        const words = [...p.querySelectorAll(':scope > ruby, :scope > .jw')];
        out[text] = {
          rts: words.map((w) => [...w.querySelectorAll('rt')].map((x) => x.textContent).join(' ')),
          spaced: [...p.querySelectorAll('rt')].some((x) => x.textContent.includes(' ')),
          gaps: p.querySelectorAll('.wsp').length, plain: p.textContent,
        };
      }
      return out;
    });
    expect(r['よろしくおねがいします'].rts).toEqual(['yoroshiku', 'onegaishimasu']);
    expect(r['わたしはがくせいです'].rts).toEqual(['watashi wa', 'gakusei desu']);
    expect(r['ありがとうございます'].rts).toEqual(['arigatou', 'gozaimasu']);
    expect(r['よろしくお願いします'].rts).toEqual(['yoroshiku', 'onegaishimasu']);   // a する verb stays one word
    expect(r['レンです'].rts).toEqual(['ren desu']);   // です gets its own romaji word, with no gap in the Japanese
    expect(r['レンです'].gaps).toBe(0);
    expect(r['がくせいですか'].rts).toEqual(['gakusei desu ka']);
    for (const v of Object.values(r)) { expect(v.gaps).toBe(v.rts.length - 1); expect(v.spaced).toBe(false); }
    expect(r['よろしくおねがいします'].plain).toBe('よろしくyoroshikuおねがいしますonegaishimasu');   // the gap adds no text
  });

  for (const help of ['romaji', 'kana']) {
    test(`${help} reading help never overlaps other text`, async ({ page }) => {
      await seed(page, { v: 2, items: {}, settings: { readingHelp: help, textSize: 'l' } });
      for (const hash of ['#/', '#/play/story', '#/play/particle', '#/play/forge', '#/play/shop', '#/settings', '#/play/dojo']) {
        await page.goto('./' + hash);
        if (hash === '#/play/story') await view(page).locator('[data-act=open]').first().click();
        if (hash === '#/play/shop') await view(page).locator('[data-act=greet]').first().click();
        await page.waitForTimeout(250);
        const overlaps = await page.evaluate(() => {
          // Every reading (<rt>) box against every other line of text on screen.
          const rects = (node) => { const r = document.createRange(); r.selectNodeContents(node); return [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1); };
          // Text folded away in a closed <details> isn't on screen (Chromium still gives it boxes), so it's left out.
          const shown = (el) => el.offsetParent && !el.closest('details:not([open]) > :not(summary)');
          const rts = [...document.querySelectorAll('#view rt')].filter(shown);
          const texts = [];
          const walker = document.createTreeWalker(document.getElementById('view'), NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const n = walker.currentNode;
            if (!n.nodeValue.trim() || !shown(n.parentElement)) continue;
            texts.push({ n, rt: n.parentElement.closest('rt'), ruby: n.parentElement.closest('ruby'), boxes: rects(n) });
          }
          const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 2 && b.top < a.bottom - 2;
          const out = [];
          for (const rt of rts) {
            const ruby = rt.closest('ruby');
            for (const a of rects(rt)) {
              for (const t of texts) {
                if (t.ruby === ruby) continue;   // its own base text sits right under it
                for (const b of t.boxes) if (hit(a, b)) out.push(`${rt.textContent} × ${t.n.nodeValue.trim().slice(0, 20)}`);
              }
            }
          }
          return out;
        });
        expect(overlaps, `${hash}`).toEqual([]);
      }
    });
  }
});

test.describe('accessibility', () => {
  const SCREENS = ['#/', '#/modes', '#/garden', '#/progress', '#/settings', '#/check', '#/play/dojo', '#/play/story', '#/play/particle',
    '#/play/forge', '#/play/rhythm', '#/play/duel', '#/play/slice', '#/play/shop'];

  test('every control has a name a screen reader can say', async ({ page }) => {
    for (const hash of SCREENS) {
      await page.goto('./' + hash);
      await page.waitForTimeout(200);
      const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=radio], [role=switch]')]
        .filter((el) => el.offsetParent || el.getClientRects().length)
        .filter((el) => {
          const label = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title || el.placeholder
            || (el.labels && [...el.labels].map((l) => l.textContent).join('')) || el.textContent;
          return !label || !label.trim();
        })
        .map((el) => el.outerHTML.slice(0, 80)));
      expect(unnamed, hash).toEqual([]);
    }
  });

  test('keyboard focus is always visible', async ({ page }) => {
    for (const hash of ['#/', '#/settings', '#/play/dojo', '#/play/garden']) {
      await page.goto('./' + hash);
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const style = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          return { tag: el.tagName, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, visible: !!el.getClientRects().length };
        });
        if (!style || !style.visible) continue;
        expect(style.outline, `${hash}: ${style.tag} #${i}`).toBe(true);
      }
    }
  });

  test('the Today plan works from the keyboard alone', async ({ page }) => {
    await page.goto('./');
    await view(page).locator('.hero').getByRole('link', { name: /Start/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#title')).toHaveText('Reading Dojo');
    await expect(view(page)).toBeFocused();   // focus moved into the new screen
    await page.keyboard.press('Escape');
    await expect(page.locator('#today-h')).toBeVisible();
  });

  test('text and controls meet contrast targets in light and dark', async ({ page }) => {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('./');
      const res = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const v = (n) => cs.getPropertyValue('--' + n).trim();
        const lum = (hex) => {
          const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
          return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        const cr = (a, b) => { const [x, y] = [lum(v(a)), lum(v(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const pairs = [];
        for (const fg of ['ink', 'dim', 'accent', 'electric', 'trace', 'good', 'miss']) for (const bg of ['bg', 'surface', 'surface-2']) pairs.push([fg, bg, 4.5]);
        pairs.push(['accent-ink', 'accent', 4.5], ['border-strong', 'surface', 3], ['focus', 'bg', 3]);
        return pairs.map(([a, b, min]) => ({ pair: `${a} on ${b}`, ratio: +cr(a, b).toFixed(2), min })).filter((p) => p.ratio < p.min);
      });
      expect(res, scheme).toEqual([]);
    }
  });
});

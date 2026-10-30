// Today's words screen (#/words, #/words/3 opens at the third): flip through today's words (js/daily-words.js) one at
// a time, recall each meaning before showing it, and hear the word. The widget's tap opens this screen at its word.
// Below the card: how to put the words on the iPhone home screen with the free Scriptable app.
import { speaker } from './audio.js';
import { esc, delegate, toast } from './ui.js';
import { todaysWords } from './daily-words.js';
import * as sync from './sync.js';

const SCRIPT_URL = './widget/kotoba-widget.js';

/** The Scriptable script with this site's address and the learner's widget link filled in. */
export function widgetScript(template, feed, site = new URL('./', location.href).href) {
  return template.replace("const FEED = '';", `const FEED = ${JSON.stringify(feed || '')};`)
    .replace("const SITE = 'https://rykoha.github.io/kotoba-web/';", `const SITE = ${JSON.stringify(site)};`);
}

export function mount(el, start = 1) {
  const words = todaysWords();
  let i = Math.min(Math.max(0, (Number(start) || 1) - 1), Math.max(0, words.length - 1));
  let shown = false;
  let template = '';
  fetch(SCRIPT_URL).then((r) => (r.ok ? r.text() : '')).then((t) => { template = t; }).catch(() => { /* offline: copy waits */ });

  function card() {
    const w = words[i];
    if (!w) return '<p class="small">No words yet. Water the Garden once and today\'s words appear here.</p>';
    const kana = w.reading && w.reading !== w.jp ? `<p class="word-kana" lang="ja">${esc(w.reading)}</p>` : '';
    const ex = shown && w.ex ? `<p class="small" lang="ja">${esc(w.ex)}</p>${w.exEn ? `<p class="small dim">${esc(w.exEn)}</p>` : ''}` : '';
    return `<p class="small dim mono" id="word-count">Word ${i + 1} of ${words.length}</p>
      <p class="word-jp" lang="ja">${esc(w.jp)}</p>${kana}
      <div class="word-answer" aria-live="polite">${shown
        ? `<p class="lead strong" id="word-en">${esc(w.en)}</p>${ex}`
        : '<button class="btn" data-act="show">Show the meaning</button><p class="tiny dim">Think of it first, then check.</p>'}</div>
      <div class="row-between word-nav">
        <button class="btn" data-act="prev" aria-label="Previous word" ${i === 0 ? 'disabled' : ''}>‹ Back</button>
        <button class="btn ghost" data-act="hear">🔊 Hear it</button>
        <button class="btn primary" data-act="next" aria-label="Next word">${i === words.length - 1 ? 'From the top ↻' : 'Next ›'}</button>
      </div>`;
  }

  function setupHTML() {
    const st = sync.status();
    let feed;
    if (!st.connected) {
      feed = `<p class="small">To show <span class="strong">your</span> words (the ones you're growing in the Garden), turn on
        <a href="#/settings">Settings › Sync across devices</a> first. Without it, the widget shows 10 words a day from the N5 deck, in order.</p>`;
    } else {
      feed = `<label class="switch-row small"><span>Send today's words to the widget (through your sync gist)</span><input type="checkbox" role="switch" data-act="feed" ${st.widget ? 'checked' : ''}></label>
        ${st.widget && !st.widgetUrl ? `<p class="small dim" role="status">${st.busy ? 'Syncing…' : 'Your widget link appears after the next sync.'}</p>` : ''}
        ${st.note ? `<p class="small note-c">${esc(st.note)}</p>` : ''}`;
    }
    return `<h2 class="section-title" id="widget-h">📱 On your home screen</h2>
      <p class="small">An iPhone widget can show these words all day, a new one about every half hour. Recall the meaning, then tap the widget: a card opens in Scriptable with the meaning and an example sentence, and you can flip through the rest of today's words there.</p>
      ${feed}
      <ol class="small widget-steps">
        <li>Install <span class="strong">Scriptable</span> from the App Store (free).</li>
        <li>Tap <span class="strong">Copy widget script</span> below. In Scriptable, tap <span class="strong">+</span>, paste, and name it <span class="strong">Kotoba Words</span>.</li>
        <li>Touch and hold the home screen, tap <span class="strong">Edit › Add Widget</span>, pick <span class="strong">Scriptable</span> (small or medium) and add it.</li>
        <li>Touch and hold the new widget, tap <span class="strong">Edit Widget</span>, and choose <span class="strong">Kotoba Words</span> as the script. It works on the Lock Screen too.</li>
      </ol>
      <button class="btn" data-act="copyscript" ${st.connected && st.widget && !st.widgetUrl ? 'disabled' : ''}>📋 Copy widget script</button>
      <p class="tiny dim">iOS refreshes widgets on its own schedule (about every 15 to 60 minutes), so a word can stay a little longer. iPhone only lets real App Store apps change a widget in place, so the meaning opens in Scriptable's card instead. On the Lock Screen, pick the wide (rectangular) size. The script reads only your widget file${st.connected ? '' : ' (or this site\'s N5 deck)'}; your GitHub token never goes into it.</p>`;
  }

  function render() {
    el.innerHTML = `<div class="stack words-screen">
      <section class="panel stack-sm word-card" aria-label="Today's words">${card()}</section>
      ${words.length > 1 ? `<section class="panel stack-sm" aria-label="All of today's words"><div class="word-chips">${words.map((w, n) => `<button class="chip-toggle ${n === i ? 'on' : ''}" data-act="go" data-n="${n}" lang="ja" aria-current="${n === i}">${esc(w.jp)}</button>`).join('')}</div>
        <p class="tiny dim">A new set comes each day from your Garden: words that need help, today's new words, then the ones due soonest.</p></section>` : ''}
      <section class="panel stack-sm" id="widget-panel" aria-labelledby="widget-h">${setupHTML()}</section>
    </div>`;
  }

  function go(n) {
    if (!words.length) return;
    i = (n + words.length) % words.length;
    shown = false;
    speaker.stop();
    // Keep the address on this word without adding a step to the back stack.
    try { history.replaceState(history.state, '', '#/words/' + (i + 1)); } catch (e) { /* ignore */ }
    render();
  }

  async function copyScript() {
    if (!template) { toast('The script hasn\'t loaded yet. Try again in a moment (it needs the site once).'); return; }
    const st = sync.status();
    const text = widgetScript(template, st.connected && st.widget ? st.widgetUrl : '');
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* fall back to a box to copy from */ }
    if (!ok) {
      const box = document.createElement('textarea');
      box.className = 'text-input code-box';
      box.readOnly = true;
      box.value = text;
      box.setAttribute('aria-label', 'Widget script');
      el.querySelector('#widget-panel').append(box);
      box.focus();
      box.select();
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    }
    toast(ok ? 'Widget script copied. Paste it into Scriptable.' : 'Select the script in the box and copy it.');
  }

  const off = delegate(el, {
    show: () => { shown = true; render(); el.querySelector('#word-en')?.focus?.(); },
    next: () => go(i + 1),
    prev: () => go(i - 1),
    go: (b) => go(Number(b.dataset.n)),
    hear: () => { const w = words[i]; if (w) speaker.speak(w.say || w.reading || w.jp, { mps: 3.5 }); },
    copyscript: copyScript,
  });
  const onChange = (ev) => {
    if (ev.target.matches('[data-act=feed]')) sync.setWidget(ev.target.checked);
  };
  const onKey = (ev) => {
    if (ev.target.closest('input, textarea')) return;
    if (ev.key === 'ArrowRight') go(i + 1);
    else if (ev.key === 'ArrowLeft') go(i - 1);
  };
  // A sideways swipe on the card moves between words.
  let x0 = null;
  const onStart = (ev) => { x0 = ev.target.closest('.word-card') ? ev.touches[0].clientX : null; };
  const onEnd = (ev) => {
    if (x0 == null) return;
    const dx = ev.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
  };
  const offStatus = sync.onStatus(() => {
    const p = el.querySelector('#widget-panel');
    if (!p) return;
    const focused = document.activeElement && p.contains(document.activeElement) ? document.activeElement.dataset.act : '';
    p.innerHTML = setupHTML();
    if (focused) p.querySelector(`[data-act=${focused}]`)?.focus();
  });
  el.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchend', onEnd);
  render();
  return () => {
    off(); offStatus();
    el.removeEventListener('change', onChange);
    document.removeEventListener('keydown', onKey);
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchend', onEnd);
  };
}

/** Today's side card: the day's first word, and a way in. */
export function wordsCard() {
  const words = todaysWords();
  if (!words.length) return '';
  return `<a class="panel link-panel words-today" href="#/words">
    <span class="grow small">📝 <span class="strong">Today's words</span>: <span lang="ja" class="strong">${esc(words[0].jp)}</span> and ${words.length - 1} more to flip through. They can go on your phone's home screen too.</span>
    <span class="dim chev" aria-hidden="true">›</span></a>`;
}

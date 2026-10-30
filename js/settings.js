// Settings: quiet mode, session length, theme, voices, mic test, latency calibration, export/import.
import { store } from './store.js';
import { speaker, recognitionSupported, micSupported, PitchTracker, audioContext, click, micHelp, isIOS } from './audio.js';
import { esc, delegate, toast } from './ui.js';
import { CLIPS, LATER_CLIPS } from './clips.js';
import { median } from './modes/rhythm.js';
import * as fx from './fx.js';
import * as sync from './sync.js';
import * as ai from './ai-chat.js';
import { unlockedLevels, lockedLevels, lockLine } from './levels.js';

export function mount(el, ctx) {
  let calib = null;        // { beats: [perfMs], taps: [perfMs], timers, result }
  let pending = null;      // parsed import waiting for confirmation
  let importError = '';
  let code = '';
  let micTest = null;
  let micTimer = 0;
  let resetArmed = false;

  function render() {
    const st = store.settings;
    const voices = speaker.voices;
    el.innerHTML = `
      <div class="settings-grid">
        <section class="panel stack-sm">
          <h2 class="section-title">Study</h2>
          <label class="switch-row"><span><span class="strong">Quiet mode</span><br><span class="small dim">For trains and planes. Speaking modes switch to listen-and-choose, and the daily plan skips anything that needs the mic.</span></span>
            <input type="checkbox" role="switch" data-act="quiet" ${st.quiet ? 'checked' : ''}></label>
          <div><span class="strong">Daily session</span>
            <div class="seg" role="radiogroup">
              <button class="seg-btn ${st.length === 'standard' ? 'on' : ''}" data-act="len" data-v="standard" role="radio" aria-checked="${st.length === 'standard'}">Standard ~20 min</button>
              <button class="seg-btn ${st.length === 'short' ? 'on' : ''}" data-act="len" data-v="short" role="radio" aria-checked="${st.length === 'short'}">Short ~10 min</button>
            </div></div>
          <div><span class="strong" id="pace-label">New words per day</span>
            <div class="seg" role="radiogroup" aria-labelledby="pace-label">
              ${[['normal', 'Up to 5'], ['less', 'Up to 3']].map(([v, t]) => `<button class="seg-btn ${st.pace === v ? 'on' : ''}" data-act="pace" data-v="${v}" role="radio" aria-checked="${st.pace === v}">${t}</button>`).join('')}
            </div>
            <p class="small dim">The app also brings in fewer while your recent answers are below ~80%, so it stays near the 85% sweet spot.</p></div>
          <div><a class="btn wide" href="#/placement">Placement check</a><p class="small dim">Skips the Reading Dojo lessons you already know.</p></div>
          <div><span class="strong">Theme</span>
            <div class="seg" role="radiogroup">
              ${['auto', 'light', 'dark'].map((t) => `<button class="seg-btn ${st.theme === t ? 'on' : ''}" data-act="theme" data-v="${t}" role="radio" aria-checked="${st.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
            </div></div>
        </section>

        <section class="panel stack-sm">
          <h2 class="section-title">Comfort</h2>
          <div><span class="strong" id="ts-label">Text size</span>
            <div class="seg" role="radiogroup" aria-labelledby="ts-label">
              ${[['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']].map(([v, t]) => `<button class="seg-btn ${st.textSize === v ? 'on' : ''}" data-act="textsize" data-v="${v}" role="radio" aria-checked="${st.textSize === v}">${t}</button>`).join('')}
            </div></div>
          <p class="text-preview" lang="ja">今日 から 修行だ！</p>
          <label class="switch-row"><span><span class="strong">Sound effects</span><br><span class="small dim">A chime for right answers, a soft tone for misses.</span></span>
            <input type="checkbox" role="switch" data-act="sfx" ${st.sfx ? 'checked' : ''}></label>
          <label class="switch-row"><span><span class="strong">Vibration</span><br><span class="small dim">${'vibrate' in navigator ? 'A short buzz on answers (phones that support it).' : 'This device or browser can\'t vibrate (iPhone Safari doesn\'t allow it).'}</span></span>
            <input type="checkbox" role="switch" data-act="haptics" ${st.haptics ? 'checked' : ''} ${'vibrate' in navigator ? '' : 'disabled'}></label>
        </section>

        <section class="panel stack-sm">
          <h2 class="section-title">Reading help</h2>
          <p class="small dim">Shows how to read the Japanese in every game. The ふa button at the top switches it quickly.</p>
          <div class="seg seg-wrap" role="radiogroup">
            ${[['auto', 'Auto'], ['romaji', 'Romaji'], ['kana', 'Furigana'], ['off', 'Off']].map(([v, t]) => `<button class="seg-btn ${st.readingHelp === v ? 'on' : ''}" data-act="ruby" data-v="${v}" role="radio" aria-checked="${st.readingHelp === v}">${t}</button>`).join('')}
          </div>
          <p class="small">${{
            auto: 'Auto: romaji over everything until you finish hiragana in the Reading Dojo, then romaji over katakana only, then just kana over kanji.',
            romaji: 'Romaji over all Japanese text.',
            kana: 'Kana (furigana) over kanji only.',
            off: 'No help: read it yourself.',
          }[st.readingHelp]}</p>
          <p class="small dim">Example: <span lang="ja">明日から 修行だ！</span></p>
        </section>

        <section class="panel stack-sm">
          <h2 class="section-title">Voice</h2>
          <div class="seg seg-wrap" role="radiogroup">
            ${[['auto', 'Best available'], ['clips', 'Built-in'], ['device', 'All device voices']].map(([v, t]) => `<button class="seg-btn ${st.voiceSrc === v ? 'on' : ''}" data-act="voice" data-v="${v}" role="radio" aria-checked="${st.voiceSrc === v}">${t}</button>`).join('')}
          </div>
          <p class="small">${{
            auto: 'The built-in VOICEVOX voices, one per character.' + (speaker.natural.length ? ` Anything without a clip uses ${esc(speaker.natural[0].name)}.` : ''),
            clips: 'The built-in VOICEVOX voices, one per character: works offline and on any device.',
            device: 'Rotates through every Japanese voice on this device, for variety.',
          }[st.voiceSrc]}</p>
          <div><span class="strong">Speed</span>
            <div class="seg" role="radiogroup">
              ${[['normal', 'Normal'], ['slow', '🐢 Slow']].map(([v, t]) => `<button class="seg-btn ${st.speed === v ? 'on' : ''}" data-act="speed" data-v="${v}" role="radio" aria-checked="${st.speed === v}">${t}</button>`).join('')}
            </div>
            <p class="small dim">Or tap 🐢 at the top of any screen.</p></div>
          <div class="row2"><button class="btn" data-act="testvoice" data-v="clips">🔊 Built-in</button><button class="btn" data-act="testvoice" data-v="device">🔊 Device</button></div>
          ${!speaker.supported ? '<p class="small miss-c">This browser has no device voices.</p>'
            : voices.length ? `<p class="small">${voices.length} Japanese device voice${voices.length === 1 ? '' : 's'}: <span class="dim">${voices.map((v) => esc(v.name) + (v.localService ? '' : ' (online)')).join(' · ')}</span></p>`
            : '<p class="small miss-c">No Japanese device voice found. The built-in voice still works.</p>'}
          <details><summary class="small strong">How to add Japanese device voices</summary>
            <ul class="small dim">
              <li>iPhone: Settings › Accessibility › Spoken Content › Voices › Japanese (download the Enhanced ones).</li>
              <li>Mac: System Settings › Accessibility › Spoken Content › System voice › Manage Voices › Japanese.</li>
              <li>Windows: Settings › Time &amp; language › Speech › Add voices › Japanese. Chrome and Edge also have online voices.</li>
            </ul></details>
          <a class="btn wide" href="#/check">🔧 Sound &amp; mic check</a>
        </section>

        <section class="panel stack-sm">
          <h2 class="section-title">JLPT levels</h2>
          <p class="small">Open now: ${unlockedLevels().join(', ')}. ${lockedLevels().length ? esc(lockLine(lockedLevels()[0])) : 'Every level is open.'}</p>
          <label class="switch-row"><span><span class="strong">Show every level</span><br><span class="small dim">Opens every level's content in every mode now, to look ahead (or to test). Turning it off again takes nothing away: what you've already started keeps coming back for review.</span></span>
            <input type="checkbox" role="switch" data-act="alllevels" ${st.showAllLevels ? 'checked' : ''}></label>
        </section>
        <section class="panel stack-sm">
          <h2 class="section-title">Microphone</h2>
          <p class="small">Speech recognition: <span class="${recognitionSupported ? 'good-c' : 'miss-c'}">${recognitionSupported ? 'available (Japanese, needs internet in Chrome)' : 'not available here: speaking modes use self-grading'}</span></p>
          <p class="small">Pitch tracking (Rhythm): <span class="${micSupported ? 'good-c' : 'miss-c'}">${micSupported ? 'available' : 'not available'}</span></p>
          <label class="switch-row"><span><span class="strong">Pronunciation check</span><br><span class="small dim">A 🎤 button next to new words and phrases. It compares how you say one with the model: its sounds, pitch and length, all on this device. Always optional${st.quiet ? '; hidden in Quiet mode' : ''}.</span></span>
            <input type="checkbox" role="switch" data-act="pron" ${st.pronCheck !== false ? 'checked' : ''}></label>
          <label class="switch-row"><span><span class="strong">Start the mic on its own</span><br><span class="small dim">Say it cards and Sentence Builder listen as soon as it's your turn, so you don't tap 🎤 first. The mic turns off again after each answer.${isIOS ? ' Safari may still ask for permission once per visit.' : ''}</span></span>
            <input type="checkbox" role="switch" data-act="automic" ${st.autoMic ? 'checked' : ''}></label>
          <button class="btn" data-act="mictest">${micTest ? '■ Stop mic test' : '🎤 Test mic + pitch'}</button>
          ${micTest ? `<p class="mono" id="mic-out">${esc(micTest.msg || 'Listening…')}</p>` : ''}
        </section>

        <section class="panel stack-sm">
          <h2 class="section-title">Audio latency</h2>
          <p class="small dim">Tap along with the clicks so Rhythm can line your voice up with the beat. Current offset: <span class="strong mono" id="lat-val">${st.latencyMs} ms</span></p>
          ${calibHTML()}
          <label class="small">Fine-tune <input type="range" min="-100" max="400" step="10" value="${st.latencyMs}" data-act="latrange" aria-label="Latency offset in milliseconds"></label>
        </section>

        <section class="panel stack-sm">
          <h2 class="section-title">Keep progress safe</h2>
          <p class="small">On iPhone: Share › Add to Home Screen keeps your progress safe. Safari can clear website data after about 7 days without a visit, but not for Home Screen apps. Export now and then as a backup.</p>
          <p class="small" id="offline-status">${offlineText}</p>
          <p class="small dim" id="app-version">${esc(versionText)}</p>
          ${store.saveOk ? '' : '<p class="miss-c small">Saving is blocked in this browser (private mode?). Progress will not persist.</p>'}
        </section>

        <section class="panel stack-sm full" id="sync-panel" aria-labelledby="sync-h">${syncHTML()}</section>

        <section class="panel stack-sm full" id="ai-panel" aria-labelledby="ai-h">${aiHTML()}</section>

        <section class="panel stack-sm full">
          <h2 class="section-title">Move progress between devices</h2>
          <p class="small dim">Export here, then import on your PC or phone. Importing replaces the progress on that device.</p>
          <div class="row2"><button class="btn" data-act="copycode">📋 Copy code</button><button class="btn" data-act="download">⬇ Download .json</button></div>
          ${code ? `<textarea class="code" readonly rows="3" aria-label="Progress code">${esc(code)}</textarea>` : ''}
          <textarea id="import-text" rows="3" placeholder="Paste a progress code or .json here" aria-label="Paste progress to import"></textarea>
          <div class="row2"><button class="btn" data-act="importtext">Import pasted</button>
            <label class="btn filebtn">📁 Pick file<input type="file" accept=".json,application/json,text/plain" data-act-change="file" hidden></label></div>
          ${importError ? `<p class="miss-c small">${esc(importError)}</p>` : ''}
          ${pending ? `<div class="panel note stack-sm"><p>Replace this device's progress with the import? It has ${Object.keys(pending.items).length} plants, ${pending.chapters.length} chapters cleared and ${pending.forged.length} kanji forged.</p>
            <div class="row2"><button class="btn primary" data-act="confirmimport">Replace</button><button class="btn" data-act="cancelimport">Cancel</button></div></div>` : ''}
        </section>

        <section class="panel stack-sm full danger-zone" aria-labelledby="reset-h">
          <h2 class="section-title" id="reset-h">Start over</h2>
          <p class="small dim">Erases this device's progress. Your settings stay. It asks once more before erasing.</p>
          ${sync.status().connected ? '<p class="small dim">Sync is on: a reset only erases this device, and the next sync brings your progress back from GitHub. Disconnect sync first to start over everywhere.</p>' : ''}
          <button class="btn danger-outline ${resetArmed ? 'danger' : ''}" data-act="reset">${resetArmed ? 'Tap again to erase all progress' : 'Reset all progress'}</button>
        </section>
        <div class="full stack-sm">
          <p class="tiny dim center-text">Kotoba Beat web · works offline once loaded</p>
          <p class="tiny dim center-text" lang="ja" data-noruby>Voices: VOICEVOX:四国めたん · VOICEVOX:白上虎太郎 · VOICEVOX:青山龍星 · VOICEVOX:玄野武宏 · VOICEVOX:東北イタコ · VOICEVOX:ずんだもん · VOICEVOX:春日部つむぎ · VOICEVOX:東北ずん子 · VOICEVOX:剣崎雌雄</p>
          <p class="tiny dim center-text">Deck readings checked against JMdict, and word lookup meanings beyond the decks and the Manga Reader dictionary from JMdict, © EDRDG, CC BY-SA 4.0.</p>
          <p class="tiny dim center-text">Manga Reader text reading by Tesseract (tesseract.js), Apache License 2.0.</p>
          <p class="tiny dim center-text">Kana Brush strokes from KanjiVG (kanjivg.tagaini.net), © Ulrich Apel and contributors, CC BY-SA 3.0.</p>
          <p class="tiny dim center-text">Furigana and romaji made with Open JTalk.</p>
        </div>
      </div>`;
    checkOffline();
  }

  function syncHTML() {
    const st = sync.status();
    const head = '<h2 class="section-title" id="sync-h">Sync across devices</h2>';
    if (!st.connected) {
      return `${head}
        <p class="small">Optional. Keeps your progress the same on your PC and iPhone (Safari and the Home Screen app) through one private GitHub gist. Studying on two devices between syncs is fine: both are kept.</p>
        <label class="stack-sm"><span class="strong">GitHub token</span>
          <input type="password" id="sync-token" class="text-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…" aria-describedby="sync-help"></label>
        ${syncMsg ? `<p class="small note-c" role="status">${esc(syncMsg)}</p>` : ''}
        <button class="btn primary" data-act="syncconnect">Connect</button>
        <p class="small dim" id="sync-help">Make a fine-grained token on github.com with only the Gists permission (read and write). It stays on this device only: it is never in an export code and is only ever sent to api.github.com.</p>`;
    }
    const when = st.lastSync ? new Date(st.lastSync).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
    return `${head}
      <p class="small"><span class="good-c strong">Connected.</span> Syncs when the app opens, after each session or Today block, and when you switch away.</p>
      <p class="small" id="sync-last" role="status">${st.busy ? 'Syncing…' : when ? `Last synced: ${esc(when)}` : 'Not synced yet.'}</p>
      ${st.note ? `<p class="small note-c" id="sync-note">${esc(st.note)}</p>` : ''}
      <div class="row2"><button class="btn primary" data-act="syncnow" ${st.busy ? 'disabled' : ''}>⟳ Sync now</button><button class="btn" data-act="syncoff">Disconnect</button></div>
      <p class="small dim">Settings like theme, voice and text size stay separate on each device. Disconnect forgets the token and gist on this device; the gist stays in your GitHub account. Export / Import below still works as a manual backup.</p>`;
  }
  let syncMsg = '';

  // Free chat in Messages (js/ai-chat.js): optional, off until a Claude API key is pasted here.
  let aiMsg = '';
  function aiHTML() {
    const st = ai.status();
    const head = '<h2 class="section-title" id="ai-h">AI chat partner</h2>';
    const models = `<div class="stack-sm" role="group" aria-label="Model">${Object.entries(ai.MODELS).map(([id, m]) => `
        <button class="btn left ai-model" data-act="aimodel" data-model="${id}" aria-pressed="${st.model === id}"><span class="strong">${esc(m.name)}${id === ai.DEFAULT_MODEL ? ' (default)' : ''}</span><span class="small dim">${esc(m.note)}</span></button>`).join('')}</div>`;
    if (!st.on) {
      return `${head}
        <p class="small">Optional. Adds Free chat to Messages: type your own Japanese to Ren and friends, and an AI playing them writes back at your level, with a more natural way to say what you wrote.</p>
        <p class="small dim">It needs your own Claude API key from console.anthropic.com, with credit on it. That is paid separately from a Claude subscription.</p>
        <label class="stack-sm"><span class="strong">Claude API key</span>
          <input type="password" id="ai-key" class="text-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" aria-describedby="ai-help"></label>
        ${models}
        ${aiMsg ? `<p class="small note-c" role="status">${esc(aiMsg)}</p>` : ''}
        <button class="btn primary" data-act="aiconnect">Turn on</button>
        <p class="small dim" id="ai-help">The key stays on this device only: it is never in an export code or synced, and is only ever sent to api.anthropic.com. What you type in Free chat is sent there to get a reply.</p>`;
    }
    return `${head}
      <p class="small"><span class="good-c strong">On.</span> Open Messages, pick someone, then Free chat.</p>
      ${models}
      <button class="btn" data-act="aioff">Turn off</button>
      <p class="small dim">Turning off forgets the key on this device. You can set a monthly spend limit for the key at console.anthropic.com.</p>`;
  }
  function drawAi() {
    const p = el.querySelector('#ai-panel');
    if (!p) return;
    const typed = p.querySelector('#ai-key')?.value || '';
    p.innerHTML = aiHTML();
    const input = p.querySelector('#ai-key');
    if (input) input.value = typed;
  }

  function drawSync() {
    const p = el.querySelector('#sync-panel');
    if (!p) return;
    const typed = p.querySelector('#sync-token')?.value || '';
    const focused = p.contains(document.activeElement) ? document.activeElement.dataset.act || document.activeElement.id : '';
    p.innerHTML = syncHTML();
    const input = p.querySelector('#sync-token');
    if (input) input.value = typed;
    if (focused) (p.querySelector(`[data-act="${focused}"]`) || p.querySelector('#' + focused) || p.querySelector('button'))?.focus();
  }

  // How many voice clips the service worker has saved, so it's clear when the app is ready to use offline.
  let offlineText = 'Checking the offline download…';
  let versionText = '';
  async function checkOffline() {
    let text;
    try {
      if (!('caches' in window) || !navigator.serviceWorker?.controller) {
        text = 'Offline: not set up yet. Open the site once while online, then reload.';
      } else {
        // The clips this device should have: all but those of levels still locked (cached once they open).
        const waiting = new Set(lockedLevels().flatMap((lv) => LATER_CLIPS[lv] || []));
        const files = new Set(Object.values(CLIPS).filter((f) => !waiting.has(f)));
        const saved = new Set();
        for (const key of await caches.keys()) {
          if (!key.startsWith('kotoba-beat-')) continue;
          for (const req of await (await caches.open(key)).keys()) {
            const name = new URL(req.url).pathname.split('/').pop();
            if (files.has(name)) saved.add(name);
          }
        }
        text = saved.size >= files.size
          ? `Offline: ready. All ${files.size} voice clips are saved on this device.`
          : `Offline: ${saved.size} of ${files.size} voice clips saved so far. Keep the app open on Wi-Fi to finish; missing lines use the device voice.`;
      }
    } catch (e) { text = 'Offline: could not check this browser\'s storage.'; }
    try {
      const v = (await caches.keys()).filter((k) => k.startsWith('kotoba-beat-v')).map((k) => +k.slice(13)).sort((a, b) => b - a)[0];
      if (v) {
        versionText = `Version ${v}. Updates install on their own and show up the next time the app starts.`;
        const vp = el.querySelector('#app-version');
        if (vp) vp.textContent = versionText;
      }
    } catch (e) { /* no cache storage here */ }
    if (text === offlineText) return;
    offlineText = text;
    const p = el.querySelector('#offline-status');
    if (p) p.textContent = text;
  }

  function calibHTML() {
    if (!calib) return '<button class="btn primary wide" data-act="calib">Start tap-along (10 clicks)</button>';
    if (calib.result == null) {
      return `<div class="calib"><div class="calib-dot" id="calib-dot"></div>
        <button class="btn primary wide tapbtn" data-act="tap">TAP on each click (or press Space)</button>
        <p class="small dim center-text">${calib.taps.length} taps</p></div>`;
    }
    return `<div class="stack-sm"><p>Measured offset: <span class="strong mono">${calib.result} ms</span> (${calib.used} taps)</p>
      <div class="row2"><button class="btn primary" data-act="savecalib">Use it</button><button class="btn" data-act="calib">Try again</button></div></div>`;
  }

  function startCalib() {
    const ac = audioContext();
    if (!ac) { toast('No Web Audio in this browser.'); return; }
    stopCalib();
    const interval = 0.6;
    const first = ac.currentTime + 0.8;
    const perfNow = performance.now();
    const beats = [];
    calib = { beats, taps: [], timers: [], result: null };
    for (let i = 0; i < 10; i++) {
      const t = first + i * interval;
      click(ac, t, i < 2 ? 1500 : 1000);
      const perf = perfNow + (t - ac.currentTime) * 1000;
      beats.push(perf);
      calib.timers.push(setTimeout(() => {
        const d = el.querySelector('#calib-dot');
        if (d) { d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 120); }
      }, perf - performance.now()));
    }
    calib.timers.push(setTimeout(finishCalib, beats[beats.length - 1] - performance.now() + 700));
    render();
  }

  function tap(ts) {
    if (!calib || calib.result != null) return;
    calib.taps.push(ts);
    const p = el.querySelector('.calib .small');
    if (p) p.textContent = `${calib.taps.length} taps`;
  }

  function finishCalib() {
    if (!calib) return;
    // Ignore the two warm-up clicks; match each tap to its nearest beat.
    const offs = [];
    for (const t of calib.taps) {
      let best = null;
      calib.beats.forEach((b, i) => { if (i >= 2 && (best === null || Math.abs(t - b) < Math.abs(best))) best = t - b; });
      if (best !== null && Math.abs(best) < 300) offs.push(best);
    }
    calib.used = offs.length;
    calib.result = offs.length >= 3 ? Math.round(median(offs) / 10) * 10 : null;
    if (calib.result == null) { toast('Not enough taps on the beat. Try again.'); calib = null; }
    render();
  }

  function stopCalib() {
    if (calib) calib.timers.forEach(clearTimeout);
  }

  function setLatency(v) {
    store.setSetting('latencyMs', Math.max(-100, Math.min(400, Math.round(v))));
  }

  async function toggleMic() {
    if (micTest) { micTest.tracker.stop(); clearInterval(micTimer); micTest = null; render(); return; }
    const tracker = new PitchTracker();
    micTest = { tracker, msg: 'Starting…' };
    render();
    try {
      await tracker.start();
      micTimer = setInterval(() => {
        const out = el.querySelector('#mic-out');
        const msg = `level ${tracker.liveLevel.toFixed(3)} · ${tracker.liveHz ? Math.round(tracker.liveHz) + ' Hz' : 'no pitch'}`;
        if (micTest) micTest.msg = msg;
        if (out) out.textContent = msg;
      }, 150);
    } catch (e) {
      micTest.msg = e && e.name === 'NotAllowedError' ? micHelp() : `Mic error: ${(e && e.message) || e}`;
      tracker.stop();
      render();
    }
  }

  function tryImport(text) {
    importError = '';
    pending = null;
    try {
      pending = store.parseImport(text);
    } catch (e) {
      importError = e && e.message && !/JSON|token|atob|decode/i.test(e.message) ? e.message : 'That code could not be read. Copy the whole code, including KOTOBA1:';
    }
    render();
  }

  async function copyCode() {
    code = store.exportCode();
    let ok = false;
    try { await navigator.clipboard.writeText(code); ok = true; } catch (e) { /* fall back to manual copy */ }
    render();
    const ta = el.querySelector('textarea.code');
    if (!ok && ta) { ta.focus(); ta.select(); try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ } }
    toast(ok ? 'Progress code copied.' : 'Select the code and copy it.');
  }

  function download() {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kotoba-beat-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Progress file downloaded.');
  }

  const off = delegate(el, {
    len: (b) => { store.setSetting('length', b.dataset.v); render(); },
    pace: (b) => { store.setSetting('pace', b.dataset.v); render(); },
    textsize: (b) => { store.setSetting('textSize', b.dataset.v); ctx.applyTheme(); render(); el.querySelector(`[data-act=textsize][data-v="${b.dataset.v}"]`)?.focus(); },
    theme: (b) => { store.setSetting('theme', b.dataset.v); ctx.applyTheme(); render(); },
    testvoice: (b) => {
      if (b.dataset.v === 'device') speaker.speakDevice('こんにちは', { mps: 4 });
      else { const prev = speaker.source; speaker.source = 'clips'; speaker.speak('こんにちは', { mps: 4 }); speaker.source = prev; }
    },
    ruby: (b) => { store.setSetting('readingHelp', b.dataset.v); ctx.refreshChrome(); ctx.rerender(); },
    voice: (b) => { store.setSetting('voiceSrc', b.dataset.v); ctx.refreshChrome(); render(); },
    speed: (b) => { store.setSetting('speed', b.dataset.v); ctx.refreshChrome(); render(); },
    mictest: toggleMic,
    calib: startCalib,
    savecalib: () => { setLatency(calib.result); calib = null; toast('Latency saved.'); render(); },
    copycode: copyCode,
    download,
    importtext: () => tryImport(el.querySelector('#import-text').value),
    // The import can change quiet mode, speed, theme and how much reading help is shown, so redraw everything.
    confirmimport: () => { store.applyImport(pending); pending = null; ctx.applyTheme(); ctx.refreshChrome(); ctx.rerender(); toast('Progress imported.'); },
    cancelimport: () => { pending = null; render(); },
    syncconnect: async () => {
      const input = el.querySelector('#sync-token');
      const token = (input?.value || '').trim();
      if (!sync.looksLikeToken(token)) {
        syncMsg = token ? 'That doesn\'t look like a GitHub token. It should start with github_pat_. Copy the whole token and try again.' : 'Paste your GitHub token first.';
        drawSync();
        return;
      }
      syncMsg = '';
      if (input) input.value = '';
      const ok = await sync.connect(token);
      if (ok) toast('Sync is on.');
    },
    aiconnect: () => {
      const input = el.querySelector('#ai-key');
      const key = (input?.value || '').trim();
      if (!ai.looksLikeKey(key)) {
        aiMsg = key ? 'That doesn\'t look like a Claude API key. It should start with sk-ant-. Copy the whole key and try again.' : 'Paste your Claude API key first.';
        drawAi();
        return;
      }
      aiMsg = '';
      if (input) input.value = '';
      ai.connect(key);
      drawAi();
      toast('Free chat is on.');
    },
    aimodel: (b) => {
      const typed = el.querySelector('#ai-key')?.value || '';
      ai.setModel(b.dataset.model);
      drawAi();
      const input = el.querySelector('#ai-key');
      if (input) input.value = typed;
      el.querySelector(`[data-act=aimodel][data-model="${b.dataset.model}"]`)?.focus();
    },
    aioff: () => { ai.disconnect(); aiMsg = ''; drawAi(); toast('Free chat is off on this device.'); },
    syncnow: async () => { if (await sync.sync({ force: true })) toast('Synced.'); },
    syncoff: () => { sync.disconnect(); syncMsg = ''; toast('Sync is off on this device.'); render(); },
    reset: () => {
      if (!resetArmed) { resetArmed = true; render(); return; }
      // Erasing Dojo lessons turns romaji back on (Auto reading help), so redraw everything.
      store.resetAll(); resetArmed = false; ctx.refreshChrome(); ctx.rerender(); toast('Progress erased.');
    },
  });

  const onChange = (ev) => {
    const t = ev.target;
    if (t.matches('[data-act=quiet]')) { store.setSetting('quiet', t.checked); ctx.refreshChrome(); }
    if (t.matches('[data-act=sfx]')) { store.setSetting('sfx', t.checked); if (t.checked) fx.sound('hit'); }
    if (t.matches('[data-act=pron]')) store.setSetting('pronCheck', t.checked);
    if (t.matches('[data-act=automic]')) store.setSetting('autoMic', t.checked);
    if (t.matches('[data-act=alllevels]')) { store.setSetting('showAllLevels', t.checked); render(); }
    if (t.matches('[data-act=haptics]')) { store.setSetting('haptics', t.checked); if (t.checked) fx.buzz(20); }
    if (t.matches('[data-act=latrange]')) { setLatency(+t.value); }
    if (t.matches('[data-act-change=file]') && t.files && t.files[0]) {
      const r = new FileReader();
      r.onload = () => tryImport(String(r.result));
      r.readAsText(t.files[0]);
    }
  };
  const onInput = (ev) => {
    if (ev.target.matches('[data-act=latrange]')) {
      const v = el.querySelector('#lat-val');
      if (v) v.textContent = ev.target.value + ' ms';
    }
  };
  const onKey = (ev) => {
    if (calib && calib.result == null && ev.code === 'Space') { ev.preventDefault(); tap(ev.timeStamp || performance.now()); }
  };
  // Pointerdown gives tighter timing than click for tap-along.
  const onPointer = (ev) => {
    if (ev.target.closest('[data-act=tap]')) { ev.preventDefault(); tap(ev.timeStamp || performance.now()); }
  };
  el.addEventListener('change', onChange);
  el.addEventListener('input', onInput);
  el.addEventListener('pointerdown', onPointer);
  window.addEventListener('keydown', onKey);
  const offVoices = speaker.onVoices(render);
  const offSync = sync.onStatus(drawSync);
  render();

  return () => {
    off(); offVoices(); offSync(); stopCalib();
    el.removeEventListener('change', onChange);
    el.removeEventListener('input', onInput);
    el.removeEventListener('pointerdown', onPointer);
    window.removeEventListener('keydown', onKey);
    if (micTest) micTest.tracker.stop();
    clearInterval(micTimer);
  };
}

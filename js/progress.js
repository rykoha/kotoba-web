// Progress screen: words known, kana and kanji progress, accuracy by skill over the last 4 weeks, days studied this
// month (a calendar, never a streak) and the road to the next JLPT level (js/readiness.js) with mock results. Charts are plain SVG, coloured with the
// design tokens (so they follow light and dark), each with a text alternative.
import { store, dateKey, SKILLS } from './store.js';
import { CHAPTERS, KANJI, N5_WORDS, N4_WORDS } from './data.js';
import { APP_LEVELS, isUnlocked, lockLine } from './levels.js';
import { mountSkillChart } from './skill-chart.js';
import { ALL_LESSONS, LESSONS, KANJI_LESSONS, TRACKS } from './dojo-data.js';
import { SKILL_LABELS } from './skills.js';
import { knobs } from './tuning.js';
import { accuracyNote } from './today.js';
import { esc, delegate } from './ui.js';
import { readiness, mockLine, N5_TARGETS, N4_TARGETS, N3_TARGETS, READY_AVERAGE, READY_FLOOR } from './readiness.js';
import { SCORING, scoreSections } from './exam-data.js';
import { N3_WORDS } from './data.js';
import { READERS } from './library-data.js';
import { wordsRead } from './modes/library.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
/** Commonly cited size of JLPT N5 kanji (there's no official list). */
export const N5_KANJI_ESTIMATE = 100;
const W = 340;   // chart width in viewBox units; the SVG scales to the panel

const pct = (x) => `${Math.round(x * 100)}%`;
const daysLine = (n) => `${n} ${n === 1 ? 'day' : 'days'} studied this month.`;

/**
 * Horizontal bar rows: [{ label, value (0..1 or null), text, title }]. An optional dashed reference line (ref).
 * One series, so no legend: the section title names it, and each row is direct-labelled.
 */
export function barChart(rows, { label, ref = null, labelW = 128 } = {}) {
  const rowH = 28;
  const top = ref != null ? 18 : 4;
  const x0 = labelW + 4;
  const x1 = W - 76;
  const h = top + rows.length * rowH;
  const span = x1 - x0;
  const parts = rows.map((r, i) => {
    const y = top + i * rowH;
    const cy = y + rowH / 2;
    const v = r.value == null ? null : Math.max(0, Math.min(1, r.value));
    const bw = v == null ? 0 : Math.max(v > 0 ? 4 : 0, v * span);
    return `<g class="ch-row"><title>${esc(r.title || `${r.label}: ${r.text}`)}</title>
      <text class="ch-label" x="0" y="${cy}" dominant-baseline="middle">${esc(r.label)}</text>
      <rect class="ch-track" x="${x0}" y="${cy - 6}" width="${span}" height="12" rx="4"/>
      ${bw ? `<rect class="ch-bar" x="${x0}" y="${cy - 6}" width="${bw.toFixed(1)}" height="12" rx="4"/>` : ''}
      <text class="ch-val" x="${W - 2}" y="${cy}" text-anchor="end" dominant-baseline="middle">${esc(r.text)}</text></g>`;
  }).join('');
  const refLine = ref != null
    ? `<line class="ch-ref" x1="${x0 + ref * span}" x2="${x0 + ref * span}" y1="12" y2="${h}"/>
       <text class="ch-note" x="${x0 + ref * span}" y="9" text-anchor="middle">${pct(ref)}</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${refLine}${parts}</svg>`;
}

/** Vertical columns, one per period: [{ label, value (0..1 or null), text, title }], with a reference line. */
export function columnChart(cols, { label, ref = null } = {}) {
  const h = 150, top = 22, bottom = 30;
  const plotH = h - top - bottom;
  const left = 28;
  const slot = (W - left) / cols.length;
  const bw = Math.min(44, slot * 0.5);
  const y = (v) => top + plotH * (1 - v);
  const grid = [0, 0.5, 1].map((g) => `<line class="ch-grid" x1="${left}" x2="${W}" y1="${y(g)}" y2="${y(g)}"/>
    <text class="ch-note" x="${left - 4}" y="${y(g)}" text-anchor="end" dominant-baseline="middle">${pct(g)}</text>`).join('');
  const refLine = ref != null ? `<line class="ch-ref" x1="${left}" x2="${W}" y1="${y(ref)}" y2="${y(ref)}"/>` : '';
  const bars = cols.map((c, i) => {
    const cx = left + slot * (i + 0.5);
    const v = c.value == null ? null : Math.max(0, Math.min(1, c.value));
    return `<g class="ch-row"><title>${esc(c.title || `${c.label}: ${c.text}`)}</title>
      ${v == null ? '' : `<rect class="ch-bar" x="${cx - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(2, plotH * v)}" rx="4"/>`}
      ${v != null && v >= 0.15
        ? `<text class="ch-inval" x="${cx}" y="${y(v) + 15}" text-anchor="middle">${esc(c.text)}</text>`
        : `<text class="ch-val" x="${cx}" y="${v == null ? y(0) - 6 : y(v) - 6}" text-anchor="middle">${esc(c.text)}</text>`}
      <text class="ch-label" x="${cx}" y="${h - 10}" text-anchor="middle">${esc(c.label)}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${grid}${refLine}${bars}</svg>`;
}

/** Everything the screen shows, computed from the store (exported for tests). */
export function progressData(now = new Date()) {
  const items = store.s.items;
  const planted = store.planted();
  const wordsKnown = planted.filter((p) => p.prog.level >= 2);
  const knownJp = new Set(wordsKnown.map((p) => p.item.jp));
  const n5Known = N5_WORDS.filter((w) => knownJp.has(w.jp)).length;
  const n4Known = N4_WORDS.filter((w) => knownJp.has(w.jp)).length;

  const kanaIn = (track) => LESSONS.filter((l) => l.track === track).flatMap((l) => l.chars.map((c) => c.k));
  const learned = (id) => items[id] && items[id].level >= 1;
  const hira = kanaIn('hiragana'), kata = kanaIn('katakana');
  const starter = KANJI_LESSONS.flatMap((l) => l.kanji.map((j) => j.k));
  const kanjiKnown = new Set([...starter.filter((k) => learned('kj:' + k)), ...store.forgedKanji]);

  // Four rolling weeks ending today.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  const weeks = [3, 2, 1, 0].map((w) => {
    const from = at(w * 7 + 6), to = at(w * 7);
    const per = store.skillDays(dateKey(from), dateKey(to));
    const ok = SKILLS.reduce((a, s) => a + per[s].ok, 0), tot = SKILLS.reduce((a, s) => a + per[s].tot, 0);
    return { from, to, ok, tot, rate: tot ? ok / tot : null };
  });
  const bySkill = store.skillDays(dateKey(at(27)), dateKey(today));

  return {
    planted: planted.length, wordsKnown: wordsKnown.length, n5Known, n5Total: N5_WORDS.length, n4Known, n4Total: N4_WORDS.length,
    hira: { n: hira.filter((k) => learned('kana:' + k)).length, of: hira.length },
    kata: { n: kata.filter((k) => learned('kana:' + k)).length, of: kata.length },
    starter: { n: starter.filter((k) => learned('kj:' + k)).length, of: starter.length },
    forged: { n: store.forgedKanji.size, of: KANJI.length },
    kanjiKnown: kanjiKnown.size, bySkill, weeks,
  };
}

export function render(view) {
  const d = progressData();
  const now = new Date();
  const acc = store.weekAccuracy();
  const cleared = store.clearedLessons;
  const stages = ['Seed', 'Sprout', 'Seedling', 'Young plant', 'Bush', 'Tree', 'Blossom'];
  const words = store.planted();
  const byLevel = stages.map((_, lv) => words.filter((w) => w.prog.level === lv).length);
  const maxLv = Math.max(1, ...byLevel);
  const k = knobs(store.engine, store.settings);

  const skillRows = SKILLS.map((s) => {
    const t = d.bySkill[s];
    return { label: SKILL_LABELS[s], value: t.rate, text: t.tot ? `${pct(t.rate)} (${t.tot})` : '–',
      title: t.tot ? `${SKILL_LABELS[s]}: ${pct(t.rate)} right on the first try, ${t.tot} answers` : `${SKILL_LABELS[s]}: no answers yet` };
  });
  const answered = SKILLS.some((s) => d.bySkill[s].tot);
  const weekCols = d.weeks.map((w, i) => ({
    label: i === 3 ? 'This week' : `${MON[w.from.getMonth()]} ${w.from.getDate()}`,
    value: w.rate, text: w.tot ? pct(w.rate) : '–',
    title: `${MON[w.from.getMonth()]} ${w.from.getDate()} to ${MON[w.to.getMonth()]} ${w.to.getDate()}: ${w.tot ? `${pct(w.rate)} of ${w.tot} first tries` : 'no answers'}`,
  }));
  const readRows = [
    { label: 'Hiragana', value: d.hira.n / d.hira.of, text: `${d.hira.n}/${d.hira.of}` },
    { label: 'Katakana', value: d.kata.n / d.kata.of, text: `${d.kata.n}/${d.kata.of}` },
    { label: 'Starter kanji', value: d.starter.n / d.starter.of, text: `${d.starter.n}/${d.starter.of}` },
    { label: 'Kanji Forge', value: d.forged.n / d.forged.of, text: `${d.forged.n}/${d.forged.of}` },
  ];
  const road = readiness(now);

  // This month's calendar: a mark for every day you studied. Gaps are fine.
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;   // weeks start on Monday
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cal-d empty" aria-hidden="true"></span>');
  for (let day = 1; day <= daysIn; day++) {
    const key = dateKey(new Date(now.getFullYear(), now.getMonth(), day));
    const on = store.s.days[key]?.studied;
    cells.push(`<span class="cal-d ${on ? 'on' : ''} ${day === now.getDate() ? 'today' : ''}" ${on ? `aria-label="Studied on the ${day}"` : 'aria-hidden="true"'}>${day}</span>`);
  }
  const lessonsDone = (t) => ALL_LESSONS.filter((l) => l.track === t && cleared.has(l.id)).length;

  view.innerHTML = `<div class="stack progress-screen">
    <div id="skill-chart"></div>
    <section class="stat-grid" aria-label="Totals">
      <div class="panel stat"><span class="stat-v mono">${d.wordsKnown}<span class="stat-of"> / ${d.planted}</span></span><span class="small dim">words known (of those in your garden)</span></div>
      <div class="panel stat"><span class="stat-v mono">${d.hira.n + d.kata.n}</span><span class="small dim">kana learned</span></div>
      <div class="panel stat"><span class="stat-v mono">${d.kanjiKnown}</span><span class="small dim">kanji known</span></div>
      <div class="panel stat"><span class="stat-v mono">${store.daysStudiedThisMonth()}</span><span class="small dim">${store.daysStudiedThisMonth() === 1 ? 'day' : 'days'} studied this month</span></div>
    </section>

    <section class="panel stack-sm" aria-labelledby="skill-h">
      <h2 class="section-title" id="skill-h">Accuracy</h2>
      ${answered ? `<p><span class="stat-v mono">${acc.rate == null ? '–' : pct(acc.rate)}</span> <span class="small dim">right this week, from ${acc.tot} answer${acc.tot === 1 ? '' : 's'}</span></p>
      <p class="small">${esc(accuracyNote(acc.rate, store.settings.length === 'short'))}</p>
      <h3 class="section-label">BY SKILL · LAST 4 WEEKS</h3>
      ${barChart(skillRows, { label: `First-try accuracy by skill over the last 4 weeks. ${skillRows.map((r) => `${r.label} ${r.text}`).join(', ')}.`, ref: 0.85 })}
      ${columnChart(weekCols, { label: `First-try accuracy per week: ${weekCols.map((c) => `${c.label} ${c.text}`).join(', ')}.`, ref: 0.85 })}
      <p class="small dim">First tries only, with the number of answers in brackets. The dashed line is the ~85% sweet spot.</p>`
        : '<p class="small dim">Play any mode and your accuracy shows up here. About 85% right is the sweet spot.</p>'}
      <p class="small dim">Adjusting for you: up to ${k.newPerDay} new word${k.newPerDay === 1 ? '' : 's'} a day${k.rhythmSpeed !== 1 ? `, Rhythm at ${pct(k.rhythmSpeed)} speed` : ''}${k.forgeHint || k.storyHint ? ', hints shown earlier' : ''}.</p>
    </section>

    <section class="panel stack-sm" aria-labelledby="read-h">
      <h2 class="section-title" id="read-h">Kana and kanji</h2>
      ${barChart(readRows, { label: `Characters learned: ${readRows.map((r) => `${r.label} ${r.text}`).join(', ')}.` })}
      <p class="small dim">Reading Dojo lessons: ${TRACKS.map((t) => `${esc(t.title)} ${lessonsDone(t.id)}/${ALL_LESSONS.filter((l) => l.track === t.id).length}`).join(' · ')}. Story chapters: ${store.clearedChapters.size}/${CHAPTERS.length}. Library: ${READERS.filter((r) => store.readerResult(r.id)).length}/${READERS.length} readers, ${wordsRead().toLocaleString()} words read.</p>
    </section>

    ${roadSection(road, d)}

    <div class="progress-pair">
    <section class="panel stack-sm" aria-labelledby="garden-h">
      <h2 class="section-title" id="garden-h">Garden</h2>
      <div class="hbars">${stages.map((s, lv) => `<div class="hbar"><span class="small">${s}</span>
        <span class="bar" role="img" aria-label="${byLevel[lv]} ${s.toLowerCase()}"><span style="width:${(byLevel[lv] / maxLv) * 100}%"></span></span>
        <span class="small mono right">${byLevel[lv]}</span></div>`).join('')}</div>
      <p class="small dim">Plants grow as you remember them, and come back just before you'd forget. Nothing wilts while you're away.</p>
    </section>

    <section class="panel stack-sm" aria-labelledby="cal-h">
      <h2 class="section-title" id="cal-h">${MONTHS[now.getMonth()]}</h2>
      <div class="cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span class="cal-h" aria-hidden="true">${x}</span>`).join('')}${cells.join('')}</div>
      <p class="small dim">${daysLine(store.daysStudiedThisMonth())} No streaks: come back whenever.</p>
    </section>
    </div>
    <a class="btn wide" href="#/settings">Move progress to another device (Settings)</a>
  </div>`;
  // The skill chart at the top (js/skill-chart.js), with its own clicks.
  if (offChart) offChart();
  offChart = mountSkillChart(view.querySelector('#skill-chart'));
  if (offRoad) offRoad();
  offRoad = delegate(view, {
    'real-ask': (b) => { const box = view.querySelector('.real-pass'); if (box) box.innerHTML = realConfirm(b.dataset.level); box?.querySelector('button')?.focus(); },
    'real-yes': (b) => { store.markRealPass(b.dataset.level, true); render(view); },
    'real-no': () => render(view),
    'real-undo': (b) => { store.markRealPass(b.dataset.level, false); render(view); },
  });
  return () => { if (offRoad) offRoad(); offRoad = null; if (offChart) offChart(); offChart = null; };
}
let offRoad = null;
let offChart = null;

const realConfirm = (lv) => `<p class="small">Mark ${lv} as passed? Its meter makes way for the next level. You can undo this here.</p>
  <div class="row2"><button class="btn primary" data-act="real-yes" data-level="${lv}">Yes, I passed it</button><button class="btn ghost" data-act="real-no">Cancel</button></div>`;

/** Which levels' content is open in the games, and how a locked one opens. */
const levelsLine = () => `<p class="small dim levels-line">Levels in the games: ${APP_LEVELS.map((lv) => (isUnlocked(lv) ? `${lv} open` : `🔒 ${lv} (${esc(lockLine(lv))})`)).join(' · ')}${store.settings.showAllLevels ? ' · every level shown (Settings)' : ''}</p>`;

/** The road to the next JLPT level: readiness by area, mock results, and levels already done. */
function roadSection(road, d) {
  const hist = store.exam.history;
  const doneList = store.examDone();
  const doneLines = [...doneList].map((lv) => {
    const real = store.exam.real[lv];
    const mock = hist.filter((h) => h.level === lv && h.format === 'full' && h.pass).pop();
    return `<li>${lv} done${mock ? ` (${esc(mockLine(mock))})` : ''}${real && real.on ? ` · marked as passed for real <button class="linkbtn inline" data-act="real-undo" data-level="${lv}">Undo</button>` : ''}</li>`;
  }).join('');
  const recent = hist.slice(-5).reverse();
  if (!road) {
    return `<section class="panel stack-sm" aria-labelledby="road-h"><h2 class="section-title" id="road-h">JLPT</h2>
      <ul class="small">${doneLines}</ul>${levelsLine()}</section>`;
  }
  const rows = road.areas.map((a) => ({ label: a.label, value: a.value, text: a.text, title: a.title }));
  const sc = SCORING[road.level];
  return `<section class="panel stack-sm road" aria-labelledby="road-h">
      <h2 class="section-title" id="road-h">Road to JLPT ${road.level}</h2>
      <p><span class="stat-v mono">${pct(road.overall)}</span> <span class="small dim">of the way to ${road.mock ? `a mock ${road.level}` : road.level}</span></p>
      ${barChart(rows, { label: `Readiness for ${road.level}: ${rows.map((r) => `${r.label} ${r.text}`).join(', ')}.` })}
      ${road.mock ? `<p class="small">${road.ready ? `<span class="strong good-c">Ready for a mock ${road.level}.</span> ` : ''}Each bar fills toward a target, and "ready" comes when they average ${pct(READY_AVERAGE)} with none under ${pct(READY_FLOOR)}.</p>
      ${road.level === 'N3' ? `<p class="small dim">Targets: ${pct(N3_TARGETS.vocab)} of the ${N3_WORDS.length}-word N3 deck known (Seedling or later); ${pct(N3_TARGETS.kanji)} of the N3 kanji the app teaches; ${pct(N3_TARGETS.grammar)} of the N3 grammar points remembered for a week; ${pct(N3_TARGETS.listening)} right in listening over ${N3_TARGETS.listeningAnswers}+ answers; the ${N3_TARGETS.chapters} chapters of the N3 Story arc (with their reading passages) and the N3 kanji lessons.</p>`
      : road.level === 'N4' ? `<p class="small dim">Targets: ${pct(N4_TARGETS.vocab)} of the ${d.n4Total}-word N4 deck known (Seedling or later); ${pct(N4_TARGETS.kanji)} of the N4 kanji the app teaches; ${pct(N4_TARGETS.grammar)} of the N4 grammar points remembered for a week; ${pct(N4_TARGETS.listening)} right in listening over ${N4_TARGETS.listeningAnswers}+ answers; the ${N4_TARGETS.chapters} chapters of the N4 Story arc and the N4 kanji lessons.</p>` : `<p class="small dim">Targets: ${pct(N5_TARGETS.vocab)} of the ${d.n5Total}-word N5 deck known (Seedling or later); ${pct(N5_TARGETS.kanji)} of the kanji the app teaches; ${pct(N5_TARGETS.grammar)} of the N5 grammar points remembered for a week; ${pct(N5_TARGETS.listening)} right in listening over ${N5_TARGETS.listeningAnswers}+ answers; the kana and ${N5_TARGETS.chapters} Story chapters. The real ${road.level} also uses about ${N5_KANJI_ESTIMATE} kanji, more than the app teaches yet, so its kanji questions come from words you know.</p>`}`
        : `<p class="small dim">${road.level} lessons and a mock ${road.level} are still to come. Until then this shows the ground they build on.</p>`}
      ${road.mock ? `<div class="row2"><a class="btn ${road.ready ? 'primary' : ''}" href="#/exam">Mock ${road.level}</a>
        <span class="real-pass"><button class="btn ghost wide" data-act="real-ask" data-level="${road.level}">I passed the real ${road.level}</button></span></div>` : ''}
      ${sc && recent.length ? `<h3 class="small strong">Mock results</h3><ul class="small mock-list">${recent.map((h) => `<li>${esc(mockLine(h))}</li>`).join('')}</ul>
        <p class="tiny dim">The pass line for ${road.level} is ${sc.pass}/${sc.total}, with at least ${scoreSections(road.level).map((x) => `${x.min} in ${x.short}`).join(', ')}. Only a full mock counts toward finishing a level.</p>` : ''}
      ${doneLines ? `<ul class="small">${doneLines}</ul>` : ''}
      <a class="linkbtn" href="#/plan">${store.goal ? `Your ${store.goal.level} test plan ›` : 'Plan for a real test date ›'}</a>
      ${levelsLine()}
    </section>`;
}


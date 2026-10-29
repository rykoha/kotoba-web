// Test date planner: pick a JLPT level and a test day, and the app works out how much study it takes to get there and
// sets a weekly plan. Shown at #/plan, as a card on Today, and linked from Progress.
//
// What's left is counted with the readiness meter's own targets (js/readiness.js): the deck words, the Dojo lessons
// (kana and kanji), the course units and the Story chapters, for every level from the next one not done up to the
// goal. The daily plan moves each of these at a known pace (the Garden adds up to 5 new words a study day, 3 on Short
// days; a Dojo lesson takes about 2 days, a course unit about 3, a Story chapter about 2), so the planner picks the
// lightest session length that gets through it in the study days before the test.
//
// Learning-first rules:
// - New material ends before the test: the last stretch (about 15% of the time, 1-3 weeks) is review and full mocks.
// - The Garden's 5-a-day cap stays, to keep accuracy near 85%. A date that needs more is called a stretch, and the
//   planner offers the next real sitting that fits instead of overloading.
// - Weekly targets are what's left divided by the weeks left, worked out fresh each day, so missed days quietly
//   spread out and nothing is ever "behind". No streaks.
import { store, dateKey } from './store.js';
import { N5_WORDS, N4_WORDS, N3_WORDS, CHAPTERS } from './data.js';
import { LESSONS, KANJI_LESSONS, N4_KANJI_LESSONS, N3_KANJI_LESSONS } from './dojo-data.js';
import { UNITS } from './course-data.js';
import { MOCK_LEVELS } from './exam-data.js';
import { APP_LEVELS, isUnlocked } from './levels.js';
import { n5Areas, n4Areas, n3Areas, readiness, N5_TARGETS, N4_TARGETS, N3_TARGETS } from './readiness.js';
import { icon } from './icons.js';
import { esc, delegate } from './ui.js';

const AREAS = { N5: n5Areas, N4: n4Areas, N3: n3Areas };
const TARGETS = { N5: N5_TARGETS, N4: N4_TARGETS, N3: N3_TARGETS };
const DECKS = { N5: N5_WORDS, N4: N4_WORDS, N3: N3_WORDS };
const DOJO = { N5: [...LESSONS, ...KANJI_LESSONS], N4: N4_KANJI_LESSONS, N3: N3_KANJI_LESSONS };

/** New Garden words a study day: Standard days, Short days (half the review room), and on the "Up to 3" pace. */
export const WORDS_PER_DAY = { standard: 5, short: 3, less: 3, lessShort: 2 };
/** Study days each piece takes in the daily plan (the Dojo block and the Input block run side by side). */
export const DAYS_PER = { lesson: 2, unit: 3, chapter: 2 };
/** Minutes a session: the daily plan's Standard and Short lengths. */
export const SESSION_MIN = { standard: 20, short: 10 };
/** Share of the time kept for review and mocks at the end, and its bounds in days. */
export const REVIEW_SHARE = 0.15;
export const REVIEW_MIN = 7;
export const REVIEW_MAX = 21;
/** Closer than this, there's no time for new material to settle: the plan is review and one full mock. */
export const FINAL_DAYS = 28;

const DAY = 86_400_000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** A 'YYYY-MM-DD' key as a local date. */
export const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
/** Whole calendar days from a to b (local dates, so daylight saving never shifts it). */
export const daysBetween = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** "Sun 4 Jul 2027" */
export const longDate = (d) => `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
const shortDate = (d) => `${d.getDate()} ${MON[d.getMonth()]}`;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** The JLPT is held on the first Sunday of July and of December. */
export function firstSunday(year, month) {
  const d = new Date(year, month, 1);
  d.setDate(1 + ((7 - d.getDay()) % 7));
  return d;
}

/** The next `n` JLPT sittings after today. */
export function nextSittings(now = new Date(), n = 3) {
  const today = startOf(now);
  const out = [];
  for (let y = today.getFullYear(); out.length < n; y++) {
    for (const m of [6, 11]) {
      const d = firstSunday(y, m);
      if (d > today && out.length < n) out.push(d);
    }
  }
  return out;
}

/** True when the date is a JLPT sitting (first Sunday of July or December). */
export const isSitting = (d) => (d.getMonth() === 6 || d.getMonth() === 11) && d.getDay() === 0 && d.getDate() <= 7;

/** Levels from the next one not done up to `goal` (a goal for N4 still counts what's left of N5). */
export function levelsTo(goal) {
  const done = store.examDone();
  const upTo = APP_LEVELS.indexOf(goal);
  if (upTo < 0) return [];
  return APP_LEVELS.slice(0, upTo + 1).filter((lv) => !done.has(lv));
}

/**
 * What's left to reach a level's readiness targets: { words, lessons, units, chapters }, plus the same per level.
 * Counts use the readiness meter's targets, so the plan and the meter always agree.
 */
export function remainingWork(goal, now = new Date()) {
  const per = levelsTo(goal).map((lv) => {
    const areas = AREAS[lv](now);
    const vocab = areas.find((a) => a.id === 'vocab');
    const T = TARGETS[lv];
    const lessons = DOJO[lv].filter((l) => !store.clearedLessons.has(l.id)).length;
    const units = UNITS.filter((u) => u.level === lv && !u.outline);
    const unitsLeft = Math.max(0, Math.ceil(units.length * T.grammar) - units.filter((u) => store.s.course.done.includes(u.id)).length);
    const chapters = CHAPTERS.filter((c) => (c.level || 'N5') === lv);
    const chaptersLeft = Math.max(0, T.chapters - chapters.filter((c) => store.clearedChapters.has(c.id)).length);
    return { level: lv, words: Math.max(0, vocab.t - vocab.n), lessons, units: unitsLeft, chapters: chaptersLeft, deck: DECKS[lv].length };
  });
  const sum = (k) => per.reduce((a, x) => a + x[k], 0);
  return { per, words: sum('words'), lessons: sum('lessons'), units: sum('units'), chapters: sum('chapters') };
}

/** Study days the remaining work takes at a session length: the slowest of the Garden, the Dojo and the Input block. */
export function studyDaysNeeded(work, length, pace = store.settings.pace) {
  const wpd = pace === 'less' ? (length === 'short' ? WORDS_PER_DAY.lessShort : WORDS_PER_DAY.less) : WORDS_PER_DAY[length];
  return Math.ceil(Math.max(work.words / wpd, work.lessons * DAYS_PER.lesson, work.units * DAYS_PER.unit + work.chapters * DAYS_PER.chapter));
}

/** Days kept for review and mocks at the end of a plan that runs `total` days. */
export function reviewDays(total) {
  if (total < FINAL_DAYS) return 0;
  return Math.max(REVIEW_MIN, Math.min(REVIEW_MAX, Math.round(total * REVIEW_SHARE)));
}

/** New words added on each of the last 28 days' study days: { words, days }. */
export function recentPace(now = new Date()) {
  let words = 0, days = 0;
  for (let i = 0; i < 28; i++) {
    const d = store.s.days[dateKey(addDays(startOf(now), -i))];
    if (!d || !d.studied) continue;
    days++;
    words += d.newc || 0;
  }
  return { words, days };
}

/** New words added since Monday. */
function wordsThisWeek(now) {
  const today = startOf(now);
  let n = 0;
  for (let i = 0; i <= (today.getDay() + 6) % 7; i++) {
    const d = store.s.days[dateKey(addDays(today, -i))];
    if (d) n += d.newc || 0;
  }
  return n;
}

/**
 * The plan for a goal { level, date, days, from }:
 *   phase      'learn' | 'review' (the end stretch) | 'final' (too close for new material) | 'today' | 'past'
 *   daysLeft, test (Date), reviewStart (Date), work (remainingWork), length ('short'|'standard'|null when nothing
 *   fits), need (study days at that length), avail (study days before the review stretch), stretch (no length fits),
 *   moreDays (study days a week that would fit at Standard, when that's 7 or fewer), better (a later sitting that fits),
 *   weekly ({ words, lessons, units, chapters } targets this week), checkpoints ([{ format, date, done }])
 */
export function makePlan(goal, now = new Date()) {
  const today = startOf(now);
  const test = fromKey(goal.date);
  const daysLeft = daysBetween(today, test);
  const base = { goal, test, daysLeft };
  if (daysLeft < 0) return { ...base, phase: 'past' };
  if (daysLeft === 0) return { ...base, phase: 'today' };

  const from = goal.from ? fromKey(goal.from) : today;
  const buffer = reviewDays(daysBetween(from, test));
  const reviewStart = addDays(test, -buffer);
  const learnLeft = Math.max(0, daysBetween(today, reviewStart));
  const phase = daysLeft < FINAL_DAYS && buffer === 0 ? 'final' : learnLeft === 0 ? 'review' : 'learn';
  const work = remainingWork(goal.level, now);
  const avail = Math.floor((learnLeft * goal.days) / 7);
  const empty = !work.words && !work.lessons && !work.units && !work.chapters;

  const needShort = studyDaysNeeded(work, 'short');
  const needStd = studyDaysNeeded(work, 'standard');
  const length = empty || needShort <= avail ? 'short' : needStd <= avail ? 'standard' : null;
  const need = length === 'short' ? needShort : needStd;
  const stretch = phase === 'learn' && !empty && !length;

  let moreDays = null, better = null;
  if (stretch) {
    const days = learnLeft ? Math.ceil((needStd * 7) / learnLeft) : 8;
    if (days <= 7) moreDays = days;
    // The first sitting with room for the work at this many days a week, plus its review stretch.
    better = nextSittings(now, 8).find((d) => {
      const total = daysBetween(today, d);
      return Math.floor(((total - reviewDays(total)) * goal.days) / 7) >= needStd;
    }) || null;
  }

  const weeksLeft = Math.max(1, learnLeft / 7);
  const per = (x) => (phase === 'learn' ? Math.ceil(x / weeksLeft) : 0);
  const weekly = { words: per(work.words), lessons: per(work.lessons), units: per(work.units), chapters: per(work.chapters), wordsDone: wordsThisWeek(now) };

  const checkpoints = [];
  if (MOCK_LEVELS.includes(goal.level)) {
    const total = daysBetween(from, test);
    const learn = total - buffer;
    if (learn >= 42) checkpoints.push({ format: 'mini', date: addDays(from, Math.round(learn / 2)) });
    if (buffer) checkpoints.push({ format: 'full', date: reviewStart });
    if (buffer >= 14) checkpoints.push({ format: 'full', date: addDays(test, -7) });
    if (!buffer) checkpoints.push({ format: 'full', date: addDays(today, Math.min(7, Math.max(0, daysLeft - 3))) });
    const hist = store.exam.history.filter((h) => h.level === goal.level);
    for (const c of checkpoints) {
      // Any mock of that format from a few days before the checkpoint counts (taking it early is fine).
      c.done = hist.some((h) => (h.format === c.format || h.format === 'full') && h.at >= addDays(c.date, -5).getTime());
    }
  }

  return { ...base, phase, reviewStart, buffer, learnLeft, work, empty, avail, length, need, stretch, moreDays, better, weekly, checkpoints };
}

/** The current goal's plan, or null. */
export function currentPlan(now = new Date()) {
  const g = store.goal;
  return g ? makePlan(g, now) : null;
}

/** "Standard days (about 20 minutes), 5 days a week: about 1 hr 40 min a week." */
export function regimenLine(plan) {
  const len = plan.length || 'standard';
  const mins = SESSION_MIN[len] * plan.goal.days;
  const h = Math.floor(mins / 60), m = mins % 60;
  const time = [h && `${h} hr`, m && `${m} min`].filter(Boolean).join(' ');
  return `${len === 'short' ? 'Short' : 'Standard'} days (about ${SESSION_MIN[len]} minutes), ${plan.goal.days} days a week: about ${time} a week.`;
}

function workLine(w) {
  const parts = [];
  if (w.words) parts.push(plural(w.words, 'new word'));
  if (w.lessons) parts.push(plural(w.lessons, 'Reading Dojo lesson'));
  if (w.units) parts.push(plural(w.units, 'course unit'));
  if (w.chapters) parts.push(plural(w.chapters, 'Story chapter'));
  return parts.join(', ');
}

/** The next checkpoint not done, or null. */
const nextCheckpoint = (plan) => (plan.checkpoints || []).find((c) => !c.done) || null;

function checkpointLine(c, today) {
  const days = daysBetween(today, c.date);
  const when = days <= 0 ? 'now' : days <= 7 ? 'this week' : `on ${shortDate(c.date)}`;
  return `${c.format === 'full' ? 'Full' : 'Mini'} mock ${when}`;
}

/** The weakest readiness area for the goal's next level (for the Saturday tip), or null. */
export function planFocus(now = new Date()) {
  const plan = currentPlan(now);
  if (!plan || plan.phase === 'past') return null;
  const r = readiness(now);
  return r && r.weakest && r.weakest.value < 1 ? { level: plan.goal.level, area: r.weakest } : null;
}

// ---------- Today card ----------

/** The Today card for the goal, or a one-line invitation inside the readiness card when no goal is set. */
export function planCard(now = new Date()) {
  const plan = currentPlan(now);
  if (!plan) return '';
  const lv = plan.goal.level;
  const today = startOf(now);
  let body;
  if (plan.phase === 'past') {
    body = `<p class="small">Your ${lv} test day has passed. How did it go? Mark a pass, or plan for the next sitting.</p>`;
  } else if (plan.phase === 'today') {
    body = `<p class="strong">Test day. がんばって! (You've got this.)</p><p class="small">Rest your eyes, eat well, and trust your reviews.</p>`;
  } else if (plan.phase === 'final' || plan.phase === 'review') {
    const c = nextCheckpoint(plan);
    body = `<p class="small">${plan.phase === 'final' ? 'Close to the test: keep to review now, since new material needs time to settle.' : 'Review stretch: no new material needed. Water the Garden and take full mocks.'}</p>
      ${c ? `<a class="btn wide" href="#/exam">${esc(checkpointLine(c, today))}</a>` : ''}`;
  } else {
    const w = plan.weekly;
    const pctW = w.words ? Math.min(100, Math.round((w.wordsDone / w.words) * 100)) : 100;
    const c = nextCheckpoint(plan);
    const soon = c && daysBetween(today, c.date) <= 7;
    body = `${w.words ? `<p class="small">This week: <span class="strong mono">${Math.min(w.wordsDone, w.words)}/${w.words}</span> new words</p>
      <div class="bar" role="img" aria-label="${Math.min(w.wordsDone, w.words)} of ${w.words} new words this week"><span style="width:${pctW}%"></span></div>` : ''}
      <p class="small">${plan.stretch ? 'This date is a stretch at the Garden\'s pace. See the plan for options.' : esc(regimenLine(plan))}</p>
      ${soon ? `<a class="btn wide" href="#/exam">${esc(checkpointLine(c, today))}</a>` : ''}`;
  }
  const left = plan.daysLeft > 0 ? `${plural(plan.daysLeft, 'day')} to go` : '';
  return `<section class="panel stack-sm plan-card" aria-labelledby="plan-h">
    <div class="row-between"><h2 class="section-title" id="plan-h">${icon('calendar')} ${lv} test plan</h2><span class="small dim">${left}</span></div>
    <p class="tiny dim">${esc(longDate(plan.test))}</p>
    ${body}
    <a class="linkbtn" href="#/plan">See the plan ›</a>
  </section>`;
}

// ---------- the planner screen (#/plan) ----------

/** Levels a goal can be set for: the ones the app offers that aren't done. */
const goalLevels = () => { const done = store.examDone(); return APP_LEVELS.filter((lv) => AREAS[lv] && !done.has(lv)); };

export function mount(el) {
  const g = store.goal;
  const sittings = nextSittings(new Date(), 3);
  const levels = goalLevels();
  let editing = !g;
  let draft = g ? { level: g.level, date: g.date, days: g.days }
    : { level: levels[0] || 'N5', date: dateKey(sittings[1] || sittings[0]), days: 5 };

  function preview(plan) {
    const today = startOf(new Date());
    if (plan.phase === 'past') {
      return `<p>The test day (${esc(longDate(plan.test))}) has passed.</p>
        <div class="row2"><button class="btn primary" data-act="passed">I passed the ${plan.goal.level}</button><button class="btn" data-act="edit">Plan the next sitting</button></div>`;
    }
    if (plan.phase === 'today') return `<p class="strong">Test day. がんばって!</p>`;
    const w = plan.work;
    const rows = [];
    rows.push(`<p><span class="stat-v mono">${plan.daysLeft}</span> <span class="small dim">days until ${esc(longDate(plan.test))}${isSitting(plan.test) ? ' (a JLPT sitting)' : ''}</span></p>`);
    if (plan.phase === 'final') {
      rows.push(`<p class="small">That's under ${FINAL_DAYS / 7} weeks away, too close for new material to settle. The best use of the time is review and a full mock, so that's the plan.</p>`);
    } else if (plan.empty) {
      rows.push(`<p class="small strong good-c">Everything for ${plan.goal.level} is covered.</p><p class="small">Keep reviewing on Short days and take the mocks below.</p>`);
    } else {
      rows.push(`<h3 class="small strong">Still to learn</h3><p class="small">${esc(workLine(w))}${plan.work.per.length > 1 ? ` (across ${plan.work.per.map((x) => x.level).join(' and ')})` : ''}.</p>`);
      if (plan.phase === 'learn' && plan.length) {
        rows.push(`<h3 class="small strong">Time to invest</h3><p class="small">${esc(regimenLine(plan))} That covers it in about ${plural(plan.need, 'study day')}, with ${plural(plan.avail, 'study day')} available.</p>`);
        if (plan.length === 'short') rows.push(`<p class="tiny dim">Standard days still help: they add speaking and skill practice, and get you there sooner.</p>`);
        if (store.settings.length !== plan.length && plan.length === 'standard') {
          rows.push(`<button class="btn" data-act="use-std">Switch to Standard days</button>`);
        }
      }
      if (plan.stretch) {
        rows.push(`<div class="panel hint stack-sm"><p class="small strong">This date is a stretch.</p>
          <p class="small">At ${plan.goal.days} days a week on Standard days it takes about ${plural(plan.need, 'study day')}, and there are ${plural(plan.avail, 'study day')} before the review stretch. The Garden adds at most ${WORDS_PER_DAY.standard} new words a day, because more than that pushes accuracy below the ~85% where words stick.</p>
          ${plan.moreDays && plan.moreDays > plan.goal.days ? `<p class="small">Studying ${plan.moreDays} days a week would fit.</p>` : ''}
          ${plan.better ? `<button class="btn" data-act="move" data-date="${dateKey(plan.better)}">Aim for ${esc(longDate(plan.better))} instead</button>` : ''}
          <p class="tiny dim">Or keep this date: everything you learn still counts, and the test is good practice either way.</p></div>`);
      }
      if (plan.phase === 'learn') {
        const wk = plan.weekly;
        const items = [
          wk.words && `${wk.words} new words (${Math.min(wk.wordsDone, wk.words)} so far)`,
          wk.lessons && plural(wk.lessons, 'Reading Dojo lesson'),
          wk.units && plural(wk.units, 'course unit'),
          wk.chapters && plural(wk.chapters, 'Story chapter'),
        ].filter(Boolean);
        rows.push(`<h3 class="small strong">This week</h3><ul class="small">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="tiny dim">Worked out fresh each day from what's left, so a missed day just spreads out over the weeks ahead.</p>`);
        rows.push(`<p class="small">New material ends ${esc(longDate(plan.reviewStart))}. After that, ${plural(plan.buffer, 'day')} of review and full mocks.</p>`);
      } else if (plan.phase === 'review') {
        rows.push(`<p class="small">You're in the review stretch: water the Garden, reread Story chapters, and take full mocks. New material is optional now.</p>`);
      }
    }
    const pace = recentPace();
    if (pace.days >= 5) rows.push(`<p class="tiny dim">Your recent pace: ${pace.words} new words over ${plural(pace.days, 'study day')} in the last 4 weeks.</p>`);
    if (plan.checkpoints && plan.checkpoints.length) {
      rows.push(`<h3 class="small strong">Checkpoints</h3><ul class="small plan-checks">${plan.checkpoints.map((c) => `<li>${c.done ? icon('check') + ' ' : ''}${c.format === 'full' ? 'Full' : 'Mini'} mock ${plan.goal.level}, around ${esc(shortDate(c.date))}${c.done ? ' (done)' : ''}</li>`).join('')}</ul>
        <p class="tiny dim">A mock result shows which area to work on next. Misses go into your Garden.</p>`);
    }
    if (isSitting(plan.test) && plan.daysLeft < 110) rows.push(`<p class="tiny dim">Registration for the real test usually closes 3 to 4 months before it, so check your local test site.</p>`);
    return rows.join('');
  }

  function form() {
    const custom = !sittings.some((d) => dateKey(d) === draft.date);
    return `<section class="panel stack-sm" aria-labelledby="goal-h">
      <h2 class="section-title" id="goal-h">${icon('flag')} Set a test goal</h2>
      <p class="small dim">Pick a level and a date, and the plan shows how much time it takes. Nothing changes until you save.</p>
      <h3 class="small strong" id="lv-label">Level</h3>
      <div class="seg" role="radiogroup" aria-labelledby="lv-label">${levels.map((lv) => `<button class="seg-btn ${draft.level === lv ? 'on' : ''}" data-act="lv" data-v="${lv}" role="radio" aria-checked="${draft.level === lv}">${lv}${isUnlocked(lv) ? '' : ' (later)'}</button>`).join('')}</div>
      <h3 class="small strong" id="date-label">Test date</h3>
      <div class="chips" role="radiogroup" aria-labelledby="date-label">${sittings.map((d) => `<button class="chip-toggle ${draft.date === dateKey(d) ? 'on' : ''}" data-act="date" data-v="${dateKey(d)}" role="radio" aria-checked="${draft.date === dateKey(d)}">${esc(longDate(d))}</button>`).join('')}</div>
      <label class="small">Or another date <input type="date" class="plan-date" data-field="date" min="${dateKey(new Date(Date.now() + DAY))}" value="${custom ? draft.date : ''}"></label>
      <p class="tiny dim">The JLPT is held twice a year, on the first Sunday of July and of December.</p>
      <h3 class="small strong" id="days-label">Study days a week</h3>
      <div class="seg" role="radiogroup" aria-labelledby="days-label">${[3, 4, 5, 6, 7].map((n) => `<button class="seg-btn ${draft.days === n ? 'on' : ''}" data-act="days" data-v="${n}" role="radio" aria-checked="${draft.days === n}">${n}</button>`).join('')}</div>
    </section>`;
  }

  function render() {
    const goal = editing ? { ...draft, from: dateKey(new Date()) } : store.goal;
    const plan = goal && goal.level ? makePlan(goal) : null;
    el.innerHTML = `<div class="stack plan-screen">
      ${editing ? form() : ''}
      ${plan ? `<section class="panel stack-sm" aria-labelledby="plan-h2" aria-live="polite">
        <h2 class="section-title" id="plan-h2">${editing ? 'Your plan would be' : `${plan.goal.level} test plan`}</h2>
        ${preview(plan)}
      </section>` : ''}
      ${editing
        ? `<div class="row2"><button class="btn primary" data-act="save">Save this plan</button>${store.goal ? '<button class="btn ghost" data-act="cancel">Cancel</button>' : '<a class="btn ghost" href="#/progress">Not now</a>'}</div>`
        : `<div class="row2"><button class="btn" data-act="edit">Change the goal</button><button class="btn ghost" data-act="clear">Remove the goal</button></div>`}
      <p class="tiny dim">Estimates: the Garden adds up to ${WORDS_PER_DAY.standard} new words a study day (${WORDS_PER_DAY.short} on Short days), a Dojo lesson takes about ${DAYS_PER.lesson} days, a course unit ${DAYS_PER.unit} and a Story chapter ${DAYS_PER.chapter}. Targets match the Road to JLPT meter on Progress.</p>
    </div>`;
  }

  const off = delegate(el, {
    lv: (b) => { draft.level = b.dataset.v; render(); },
    date: (b) => { draft.date = b.dataset.v; render(); },
    days: (b) => { draft.days = Number(b.dataset.v); render(); },
    save: () => { store.setGoal(draft); editing = false; render(); },
    cancel: () => { editing = false; render(); },
    edit: () => {
      const cur = store.goal;
      if (cur && fromKey(cur.date) < startOf(new Date())) draft = { ...draft, level: cur.level, date: dateKey(nextSittings(new Date(), 1)[0]) };
      editing = true; render();
    },
    clear: () => { store.clearGoal(); editing = true; draft = { level: levels[0] || 'N5', date: dateKey(sittings[1] || sittings[0]), days: 5 }; render(); },
    move: (b) => { draft = { ...(editing ? draft : store.goal), date: b.dataset.date }; if (!editing) store.setGoal(draft); render(); },
    'use-std': () => { store.setSetting('length', 'standard'); render(); },
    passed: () => { const cur = store.goal; if (cur) store.markRealPass(cur.level, true); store.clearGoal(); location.hash = '#/progress'; },
  });
  const onChange = (ev) => {
    if (ev.target.matches('[data-field=date]') && /^\d{4}-\d{2}-\d{2}$/.test(ev.target.value)) { draft.date = ev.target.value; render(); el.querySelector('[data-field=date]')?.focus(); }
  };
  el.addEventListener('change', onChange);
  render();
  return () => { off(); el.removeEventListener('change', onChange); };
}

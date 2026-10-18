// "Today": a guided daily plan. Nothing is lost by skipping blocks or days, and there are no streaks.
import { store, DAILY_REVIEW_CAP, DAILY_REVIEW_CAP_SHORT } from './store.js';
import { MODE_BY_ID } from './data.js';
import { TRACKS } from './dojo-data.js';
import { BRUSH_KANA } from './brush-data.js';
import { coursePlan, storyBlock } from './course.js';
import { attackPool, unlockedRivals, MIN_ITEMS } from './rival-items.js';

/**
 * Skill block by weekday, in two alternating weeks (A, B) so every mode gets regular time and no skill area starves:
 * grammar every Monday, pitch and listening every week (Tue/Fri swap), kanji or kana every Wednesday, counters every
 * Thursday. Speaking rotates Rhythm, Speak Slice and Sentence Builder day by day.
 */
const SKILL_BY_WEEKDAY = {
  1: ['particle', 'conj'],   // Mon: grammar
  2: ['duel', 'listen'],     // Tue: pitch | listening
  3: ['forge', 'kata'],      // Wed: kanji | kana
  4: ['shop', 'numbers'],    // Thu: counters
  5: ['listen', 'duel'],     // Fri: listening | pitch
  6: 'free',                 // Sat
  0: null,                   // Sun: review only
};
const SPEAK_ROTATION = ['rhythm', 'slice', 'build'];
const SPEAK_DESC = {
  rhythm: 'Shadow 3 phrases with the sweeping line.',
  slice: 'One 60-second round: say the words out loud.',
  build: 'Build 5 sentences from English, then say each one.',
};
/** In Quiet mode the speaking block becomes a listening one. */
const QUIET_ROTATION = ['duel', 'listen', 'numbers'];
const QUIET_DESC = {
  duel: 'Quiet mode: listening instead of speaking. 10 pitch questions.',
  listen: 'Quiet mode: listening instead of speaking. 2 short scenes.',
  numbers: 'Quiet mode: listening instead of speaking. 8 numbers by ear.',
};
const GOALS = {
  particle: '6 trains.', duel: '10 pitch questions.', forge: '3 kanji.', shop: '3 customers.',
  listen: '2 listening scenes.', conj: '12 quick forms.', kata: 'One round of 12 loanwords.', numbers: '8 numbers by ear.',
};

/** Days since 1 Jan 1970 for the local calendar date (so it never shifts with time zones or daylight saving). */
export function dayNumber(date) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}
/** 0 for an A week, 1 for a B week. Weeks start on Monday. */
export function weekParity(date) {
  return Math.floor((dayNumber(date) + 3) / 7) % 2;
}
/** Kana per Kana Brush round when it is the day's reading block. */
const BRUSH_TODAY = 6;
/**
 * While the kana are still being learned, every third day the reading block is Kana Brush (draw kana met in the Dojo
 * from memory) instead of the next Dojo lesson, once at least 5 kana have been met. Not when lots of reading reviews
 * are waiting: those come first.
 */
export function brushDay(date, { beginner, dojoDue }) {
  if (!beginner || dojoDue >= 15 || dayNumber(date) % 3 !== 0) return false;
  return BRUSH_KANA.filter((x) => store.item('kana:' + x.k)).length >= 5;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Builds today's blocks from the date and settings. Statuses come from the store. */
export function todayPlan(date = new Date()) {
  const short = store.settings.length === 'short';
  const quiet = store.settings.quiet;
  const cap = short ? DAILY_REVIEW_CAP_SHORT : DAILY_REVIEW_CAP;
  const blocks = [];
  const day = store.day();
  const status = (id) => day.blocks[id] || null;

  // Reading first while the kana and starter kanji are still being learned.
  const nextLesson = store.nextLesson();
  const dojoDue = store.dojoDue().length;
  const beginner = !store.trackDone('hiragana') || !store.trackDone('katakana');
  if (brushDay(date, { beginner, dojoDue })) {
    const due = store.brushDue().length;
    blocks.push({
      id: 'dojo', mode: 'brush', mins: 5, title: 'Reading · Kana Brush',
      desc: `Hear ${BRUSH_TODAY} kana and draw them from memory${due ? ` (${Math.min(due, BRUSH_TODAY)} due)` : ''}. The next Dojo lesson waits a day.`,
      ctx: { n: BRUSH_TODAY },
    });
  } else if (nextLesson || dojoDue >= 5) {
    const review = !nextLesson || dojoDue >= 8;
    const track = nextLesson && TRACKS.find((t) => t.id === nextLesson.track);
    blocks.push({
      id: 'dojo', mode: 'dojo', mins: 5, title: review ? 'Reading review' : 'Reading Dojo',
      desc: review ? `${Math.min(dojoDue, 15)} learned characters come back for review.` : `Next lesson: ${track.title} · ${nextLesson.title}.`,
      ctx: { review },
    });
  }

  const garden = store.dailyGardenQueue(cap);
  blocks.push({
    id: 'garden', mode: 'garden', mins: 5, title: 'Garden review',
    desc: garden.queue.length
      ? `${garden.queue.length} to water today (max ${cap}, up to ${store.newCap()} new).${garden.waiting ? ` ${garden.waiting} more wait; no rush.` : ''}`
      : store.thirsty().length
        ? `Today's share is done. ${store.thirsty().length} more wait for later days (new words arrive ${store.newCap()} a day); nothing wilts.`
        : 'Nothing due right now. Your garden is fine.',
    ctx: { cap },
  });

  // With the course on, Input is the current unit's lesson until it is read, then the next story chapter, and
  // grammar/counter skill days practise the unit (see coursePlan in course.js). Otherwise the next story chapter.
  const course = coursePlan();
  if (!(short && beginner)) blocks.push(course ? course.input : storyBlock());

  if (!short) {
    const weekday = date.getDay();
    const slot = SKILL_BY_WEEKDAY[weekday];
    const skill = Array.isArray(slot) ? slot[weekParity(date)] : slot;
    const n = dayNumber(date);
    let speak = SPEAK_ROTATION[n % SPEAK_ROTATION.length];
    let speakDesc = SPEAK_DESC[speak];
    if (quiet) {
      // A listening mode, never the same one as today's skill block.
      speak = QUIET_ROTATION[n % QUIET_ROTATION.length];
      if (speak === skill) speak = QUIET_ROTATION[(n + 1) % QUIET_ROTATION.length];
      speakDesc = QUIET_DESC[speak];
    }
    blocks.push({ id: 'speak', mode: speak, mins: 5, title: `Speaking · ${MODE_BY_ID[speak].title}`, desc: speakDesc, ctx: {} });

    // While learning to read, the Dojo takes the skill-focus slot so the day stays about 20 minutes.
    if (beginner) {
      // no skill block
    } else if (skill === 'free') {
      blocks.push({ id: 'skill', mode: null, mins: 5, title: 'Skill focus · Free choice', desc: 'Saturday: play any mode you like.', ctx: {} });
    } else if (skill && course && course.skill(skill)) {
      const cs = course.skill(skill);
      blocks.push({ id: 'skill', mode: cs.mode, mins: 5, title: `Skill focus · ${MODE_BY_ID[cs.mode].title}`, desc: `${WEEKDAY[weekday]}: ${cs.desc}`, ctx: cs.ctx, unit: cs.unit });
    } else if (skill) {
      blocks.push({ id: 'skill', mode: skill, mins: 5, title: `Skill focus · ${MODE_BY_ID[skill].title}`, desc: `${WEEKDAY[weekday]}: ${GOALS[skill]}`, ctx: {} });
    }
  }

  // Weekends: an optional Rival Battle (pure review), once enough has been learned to fight with. It never counts
  // toward finishing the day.
  const weekday = date.getDay();
  if ((weekday === 6 || weekday === 0) && attackPool().length >= MIN_ITEMS) {
    const rival = unlockedRivals().slice(-1)[0];
    blocks.push({ id: 'rival', mode: 'rival', mins: 5, optional: true, title: 'Optional · Rival Battle',
      desc: `${rival.name} challenges you with things you already know. Skip it freely.`, ctx: {} });
  }

  blocks.forEach((b, i) => { b.n = i + 1; b.status = status(b.id); });
  const sunday = !short && date.getDay() === 0;
  const finished = blocks.every((b) => b.status || b.optional);
  return { blocks, short, quiet, sunday, finished, minutes: blocks.reduce((a, b) => a + (b.optional ? 0 : b.mins), 0) };
}

export function accuracyNote(rate, short) {
  if (rate == null) return 'Answer a few questions and your accuracy shows up here. About 85% is the sweet spot.';
  const pct = Math.round(rate * 100);
  if (rate > 0.95) {
    return `${pct}% is above the ~85% sweet spot, so it may be too easy. ${short ? 'Try the Standard length,' : 'Try'} new content: the next story chapter or more Kanji Forge.`;
  }
  if (rate < 0.7) return `${pct}% is below the ~85% sweet spot. Lean on review for a few days (Short sessions are perfect) and skip new content.`;
  return `${pct}%: right around the ~85% sweet spot, where learning sticks best.`;
}

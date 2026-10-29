// The app's own clip of a word, decoded and analysed once: loudness and pitch every 30 ms, where each beat (mora)
// falls in time, and the audio itself, so the Pitch Coach can play just two beats of it. Used by the
// pronunciation check (pron.js) and the Pitch Coach (pitch-coach.js). Everything stays on the device.
import { speaker, audioContext, detectPitch } from './audio.js';

const cache = new Map();

/** The clip file for a target, or null when the app has none. `voice` overrides the target's voice. */
export function clipFile(target, voice = null) {
  return speaker.clipFor(target.say || target.jp, voice ?? (target.voice || 0), 'normal');
}

/**
 * { buffer, frames, span: { from, to } (seconds of speech in the clip) } for a target's clip, or null.
 * Cached per file, so the second look is instant.
 */
export function modelClip(target, voice = null) {
  const file = clipFile(target, voice);
  if (!file) return Promise.resolve(null);
  if (cache.has(file)) return cache.get(file);
  const job = (async () => {
    const ctx = audioContext();
    if (!ctx) return null;
    const res = await fetch('audio/' + file);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    return { file, buffer, ...analyseBuffer(buffer) };
  })().catch(() => null);
  cache.set(file, job);
  return job;
}

/**
 * Loudness and pitch every 30 ms of decoded audio, and where the speech is: { frames, span }. Also used for the
 * learner's own recordings (js/capsule.js).
 */
export function analyseBuffer(buffer) {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const hop = Math.round(sr * 0.03);
  const win = 2048;
  const frames = [];
  for (let i = 0; i + win <= data.length; i += hop) {
    const w = data.subarray(i, i + win);
    let sum = 0;
    for (let k = 0; k < w.length; k++) sum += w[k] * w[k];
    const level = Math.sqrt(sum / w.length);
    frames.push({ time: i / sr, level, hz: level > 0.01 ? detectPitch(w, sr) : null });
  }
  const peak = Math.max(0, ...frames.map((f) => f.level));
  const loud = frames.filter((f) => f.level >= peak * 0.12);
  const span = loud.length ? { from: loud[0].time, to: loud[loud.length - 1].time + win / sr } : { from: 0, to: buffer.duration };
  return { frames, span };
}

/** Back-compat for the pronunciation check: just the frames. */
export async function modelFrames(target) {
  const m = await modelClip(target);
  return m ? { frames: m.frames } : null;
}

/**
 * When each of `n` beats starts and ends in the clip (seconds from the start of speech). VOICEVOX speaks its beats
 * close to evenly, so the speech is split evenly; without a clip, a steady practice pace is assumed.
 */
export function beatTimes(clip, n, perBeat = 0.22) {
  const total = clip ? Math.max(0.2, clip.span.to - clip.span.from) : n * perBeat;
  return Array.from({ length: n }, (_, i) => ({ from: (i * total) / n, to: ((i + 1) * total) / n }));
}

/**
 * Plays part of the clip (beats a..b, inclusive) with a little room either side. Returns a stop function. `rate`
 * plays it higher or lower (and a little faster or slower), for hearing the same melody in another voice range.
 */
export function playClipPart(clip, n, a = 0, b = n - 1, { rate = 1, onend = null, pad = 0.05 } = {}) {
  const ctx = audioContext();
  if (!ctx || !clip) { if (onend) setTimeout(onend, 0); return () => {}; }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const times = beatTimes(clip, n);
  const from = Math.max(0, clip.span.from + times[a].from - pad);
  const to = Math.min(clip.buffer.duration, clip.span.from + times[b].to + pad);
  const src = ctx.createBufferSource();
  src.buffer = clip.buffer;
  src.playbackRate.value = rate;
  src.connect(ctx.destination);
  let done = false;
  src.onended = () => { if (!done) { done = true; if (onend) onend(); } };
  src.start(0, from, to - from);
  return () => { if (!done) { done = true; try { src.stop(); } catch (e) { /* ignore */ } } };
}

#!/usr/bin/env python3
"""Builds the generated assets: voice clips (audio/*.mp3 + js/clips.js), readings for romaji/furigana
(js/readings.js) and the service worker's precache list (sw.js).

Needs: node, ffmpeg, numpy, pyopenjtalk-plus (for readings) and VOICEVOX CORE 0.16 (for the voices):
  - the Python wheel voicevox_core-0.16.x-cp310-abi3-<platform>.whl from github.com/VOICEVOX/voicevox_core/releases
  - libvoicevox_onnxruntime from github.com/VOICEVOX/onnxruntime-builder/releases
  - open_jtalk_dic_utf_8-1.11 from github.com/r9y9/open_jtalk/releases
  - the .vvm voice models listed in VOICES, from github.com/VOICEVOX/voicevox_vvm/releases
  (or let VOICEVOX's `download` tool fetch them all). Point VOICEVOX_DIR at a folder holding
  onnxruntime/lib/, dict/open_jtalk_dic_utf_8-1.11/ and vvms/.
Run from the repo root after changing any Japanese text:  VOICEVOX_DIR=... python3 tools/build_assets.py
Existing clips are reused, so reruns only synthesize new lines. Without pyopenjtalk, js/readings.js keeps what it has and only gains the readings written in the data.
"""
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import wave
from collections import Counter, defaultdict

import numpy as np

try:
    import pyopenjtalk
except ImportError:
    pyopenjtalk = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, 'audio')

# Per-character VOICEVOX voices. Index = `voice` in speaker.speak(); (vvm file, style id, credit name).
# Only voices whose terms allow free use with a "VOICEVOX:name" credit (shown in Settings, js/settings.js).
VOICES = [
    ('0.vvm', 2, '四国めたん'),     # 0 narrator, vocabulary, kana: clear standard voice
    ('9.vvm', 12, '白上虎太郎'),    # 1 Ren, shopkeeper: young, energetic
    ('15.vvm', 13, '青山龍星'),     # 2 the Master: deep, calm (personal use; companies must ask first)
    ('4.vvm', 11, '玄野武宏'),      # 3 Kaito, office worker
    ('21.vvm', 109, '東北イタコ'),  # 4 older customer
    ('0.vvm', 3, 'ずんだもん'),     # 5 kid
    ('0.vvm', 8, '春日部つむぎ'),   # 6 Mika, the konbini clerk (Encounters)
    ('21.vvm', 107, '東北ずん子'),  # 7 Chef Hana (Encounters)
    ('4.vvm', 21, '剣崎雌雄'),      # 8 Kenta, the classmate (Encounters)
]
# Two recordings of every line: natural speed, and a slow one for the 🐢 setting (slowing at synthesis
# sounds far cleaner than stretching in the browser).
SPEEDS = {'': 1.0, 'slow': 0.6}
# Readings to use when a kanji run appears on its own or in text the build hasn't seen (Open JTalk's pick is off).
# A kanji alone takes its most common reading on its own; sentences that read it differently (土よう日, 3時, 来ます)
# get their own exception in SEGMENTS.
RUN_OVERRIDE = {'十時': 'じゅうじ', '働': 'どう', '出発進行': 'しゅっぱつしんこう', '進行': 'しんこう', '学': 'がく', '間': 'あいだ', '一': 'いち', '二': 'に', '三': 'さん', '四': 'よん', '五': 'ご', '明': 'めい', '鍛冶': 'かじ', '生': 'せい',
                '土': 'つち', '日': 'ひ', '時': 'とき', '組': 'くみ', '六': 'ろく',
                # N3 kanji shown alone: the on reading, not an old or long kun reading (造 is not みやつこ).
                '足': 'あし', '器': 'うつわ', '戦': 'せん', '古': 'こ', '必': 'ひつ', '改': 'かい', '最': 'さい', '訪': 'ほう', '造': 'ぞう'}
# Sentences whose automatic split goes wrong, fixed by hand (a rebuild keeps them).
SEGMENT_OVERRIDE = {
    '入れます': [['入', 'い'], ['れます', None]],
    '毎日六時に帰ります': [['毎日', 'まいにち'], ['六時', 'ろくじ'], ['に', None], ['帰', 'かえ'], ['ります', None]],
    '十二月に入り': [['十二月', 'じゅうにがつ'], ['に', None], ['入', 'はい'], ['り', None]],
    '姉は国際電話で友だちと話している': [['姉', 'あね'], ['は', None], ['国際電話', 'こくさいでんわ'], ['で', None], ['友', 'とも'], ['だちと', None], ['話', 'はな'], ['している', None]],
}
WRONG = {'鍛冶', '十時'}   # misread everywhere, not just alone
# Single kana whose reading differs when said alone (は alone is read as the particle "wa").
SAY_AS = {'は': 'ハ', 'へ': 'ヘ'}

KANJI = r'一-鿿々'
SEG_RE = re.compile(r'[ぁ-ゖァ-ヺー' + KANJI + r']+')
RUN_RE = re.compile(r'[' + KANJI + r']+|[^' + KANJI + r']+')
IS_KANJI = re.compile(r'[' + KANJI + r']')


def hira(s):
    return ''.join(chr(ord(c) - 0x60) if 0x30a1 <= ord(c) <= 0x30f6 else c for c in s)


def clip_key(text, voice, speed=''):
    return f'{text}#{voice}' + (f'#{speed}' if speed else '')


def clip_name(text, voice, speed='', opts=None):
    tag = 'vv1|' + (f'{SPEEDS[speed]}|' if speed else '')
    # Clips with a set pitch accent or a different text to read get their own file (old clips keep their names).
    if opts:
        tag += json.dumps(opts, ensure_ascii=False, sort_keys=True) + '|'
    return hashlib.sha1((tag + clip_key(text, voice, speed)).encode()).hexdigest()[:12] + '.mp3'


_synth = None


def synthesizer():
    global _synth
    if _synth is None:
        from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile
        base = os.environ.get('VOICEVOX_DIR', os.path.join(ROOT, 'voicevox_core'))
        ort = Onnxruntime.load_once(filename=os.path.join(base, 'onnxruntime', 'lib', Onnxruntime.LIB_VERSIONED_FILENAME))
        _synth = Synthesizer(ort, OpenJtalk(os.path.join(base, 'dict', 'open_jtalk_dic_utf_8-1.11')))
        for vvm in sorted({v[0] for v in VOICES}):
            with VoiceModelFile.open(os.path.join(base, 'vvms', vvm)) as m:
                _synth.load_voice_model(m)
    return _synth


def mora_count(kana):
    return len(re.sub(r'[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]', '', kana))


def shape_pitch(moras, accent):
    """Set each mora's pitch from the accent (high/low as js/pron-analysis.js targetPitch draws it), so the drop is
    always where the app says. VOICEVOX's own prediction is often flat or drops elsewhere on a word said alone."""
    voiced = [m.pitch for m in moras if m.pitch > 0]
    if not voiced:
        return
    base = sum(voiced) / len(voiced)
    for i, m in enumerate(moras):
        if m.pitch <= 0:
            continue   # whispered: stays unvoiced
        high = i == 0 if accent == 1 else (i > 0 and (accent == 0 or i < accent))
        m.pitch = base + (0.09 if high else -0.09) - 0.012 * i   # ~3 semitones apart, with a gentle fall


def accent_phrase(text, voice, opts):
    """The single accent phrase VOICEVOX makes for a word with its accent set (None when it reads as more than one)."""
    s = synthesizer()
    style = VOICES[voice][1]
    say = opts.get('say') or SAY_AS.get(text, text)
    phrases = s.create_accent_phrases(say, style)
    if len(phrases) != 1:
        return None
    ph = phrases[0]
    n = len(ph.moras)
    want = opts['accent'] or n
    if 1 <= want <= n and want != ph.accent:
        ph.accent = want
        phrases = s.replace_mora_pitch(phrases, style)
    return phrases[0]


def melody_fits(moras, accent):
    """Whether VOICEVOX's own pitch already says the accent the way the pronunciation check scores it
    (js/pitch-score.js scorePitch): each step between beats goes the right way, high beats stay about level, and the
    first clear fall is the drop. Whispered beats are left out. Pitch is log Hz, so 12 / ln 2 turns it into semitones."""
    st = 12 / math.log(2)
    p = [(i, m.pitch * st) for i, m in enumerate(moras) if m.pitch > 0]
    n = len(moras)
    highs = [(i == 0) if accent == 1 else (i > 0 and (accent == 0 or i < accent)) for i in range(n)]
    drop = next((i for i in range(n - 1) if highs[i] and not highs[i + 1]), -1)
    first_fall = None
    for (a, pa), (b, pb) in zip(p, p[1:]):
        d = pb - pa
        want = 'level' if highs[a] == highs[b] else 'up' if highs[b] else 'down'
        if want == 'level' and abs(d) >= 2.0:
            return False
        if want == 'up' and d <= 0.7 or want == 'down' and d >= -0.7:
            return False
        if d < -0.7 and first_fall is None:
            first_fall = a
    if drop >= 0 and not any(a <= drop < b for (a, _), (b, _) in zip(p, p[1:])):
        return True   # the drop falls on whispered beats: nothing to hear or score there
    return first_fall == drop if drop >= 0 else True


def with_shape(text, voice, opts):
    """A word clip with a set accent gets its pitch drawn beat by beat (shape) when VOICEVOX's own melody doesn't say
    that accent, so what the learner hears is what the pronunciation check and the Pitch Coach score."""
    if not opts or 'accent' not in opts or opts.get('shape'):
        return opts
    ph = accent_phrase(text, voice, opts)
    if ph is None or len(ph.moras) < 2 or melody_fits(ph.moras, opts['accent']):
        return opts
    return {**opts, 'shape': 1}


def synth(text, voice, speed, out, opts=None):
    """opts: 'say' = text to read instead (when Open JTalk misreads the written form), 'accent' = downstep
    (0 = flat) to force on a single word, so the clip matches the pitch the app shows, 'shape' = also set every
    mora's pitch from that accent (shape_pitch) so the drop is clear."""
    from voicevox_core import AudioQuery
    s = synthesizer()
    style = VOICES[voice][1]
    opts = opts or {}
    say = opts.get('say') or SAY_AS.get(text, text)
    if 'accent' in opts:
        phrases = s.create_accent_phrases(say, style)
        if len(phrases) == 1:
            ph = phrases[0]
            n = len(ph.moras)
            want = opts['accent'] or n   # VOICEVOX writes flat as "accent on the last mora"
            if 1 <= want <= n and want != ph.accent:
                ph.accent = want
                phrases = s.replace_mora_pitch(phrases, style)
            if opts.get('shape') and n >= 2:
                shape_pitch(phrases[0].moras, opts['accent'])
        q = AudioQuery.from_accent_phrases(phrases)
    else:
        q = s.create_audio_query(say, style)
    q.speed_scale = SPEEDS[speed]
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = f.name
        f.write(s.synthesis(q, style))
    # Keep headroom: scale every clip to the same peak (0.9) so none clip and voices sound equally loud.
    with wave.open(tmp, 'rb') as w:
        sr, x = w.getframerate(), np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)
    peak = float(np.max(np.abs(x))) or 1.0
    x = (x * (0.9 * 32767 / peak)).astype(np.int16)
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(x.tobytes())
    # Trim silence, then add a short lead-in and tail so phones never swallow the first or last sound.
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-af',
                    'silenceremove=start_periods=1:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse,'
                    'afade=t=in:d=0.01,adelay=120,apad=pad_dur=0.25,aresample=24000',
                    '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', out], check=True)
    os.remove(tmp)


def build_clips(clips):
    os.makedirs(AUDIO, exist_ok=True)
    silence = os.path.join(AUDIO, 'silence.mp3')
    if not os.path.exists(silence):
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.15',
                        '-c:a', 'libmp3lame', '-b:a', '32k', silence], check=True)
    table = {}
    keep = {'silence.mp3'}
    made = 0
    level_of = {}   # file name -> the easiest level that uses it (N5 files are precached; the rest after unlock)
    order = ['N5', 'N4', 'N3', 'N2', 'N1']
    for text, voice, opts, speeds, level in clips:
        opts = with_shape(text, voice, opts)
        for speed in speeds or SPEEDS:
            name = clip_name(text, voice, speed, opts)
            keep.add(name)
            if name not in level_of or order.index(level) < order.index(level_of[name]):
                level_of[name] = level
            path = os.path.join(AUDIO, name)
            if not os.path.exists(path):
                try:
                    synth(text, voice, speed, path, opts)
                except Exception:
                    print(f'  could not voice {text!r} ({voice}, {speed})', flush=True)
                    raise
                made += 1
                if made % 100 == 0:
                    print(f'  {made} clips made...', flush=True)
            table[clip_key(text, voice, speed)] = name
    for f in os.listdir(AUDIO):
        if f not in keep:
            os.remove(os.path.join(AUDIO, f))
    with open(os.path.join(ROOT, 'js', 'clips.js'), 'w') as f:
        f.write('// Generated by tools/build_assets.py. Built-in voice clips: "text#voice" -> file in audio/.\n')
        f.write('export const CLIPS = ' + json.dumps(table, ensure_ascii=False, indent=0, sort_keys=True) + ';\n')
        later = {}
        for name, lv in sorted(level_of.items()):
            if lv != 'N5':
                later.setdefault(lv, []).append(name)
        f.write('// Clip files only a later JLPT level uses (cached once it is unlocked; see sw.js LATER).\n')
        f.write('export const LATER_CLIPS = ' + json.dumps(later, ensure_ascii=False) + ';\n')
    print(f'clips: {len(table)} ({made} new)')
    return level_of


# ---------------- readings ----------------

def align(surface, reading):
    """Split surface into [text, reading-or-None] runs, given its full hiragana reading. None if it doesn't fit."""
    runs = RUN_RE.findall(surface)
    # A kanji run reads at least one kana per kanji (毎日六時 is never just まい when the next kana is a に).
    pattern = ''.join('(.{%d,}?)' % len(r) if IS_KANJI.search(r) else '(' + re.escape(hira(r)) + ')' for r in runs)
    m = re.fullmatch(pattern, hira(reading))
    if not m:
        return None
    return [[r, m.group(i + 1) if IS_KANJI.search(r) else None] for i, r in enumerate(runs)]


def strip_marks(s):
    return re.sub(r'[\s、。！？!?…「」『』（）()・〜~,.]', '', s)


def char_readings_from_pair(jp, reading):
    """Per-run readings for a jp text with a known (spaced) reading, e.g. story lines."""
    # Punctuation splits kanji runs (夜、母に… is 夜 + 母, not one run 夜母): align piece by piece when the
    # reading has the same punctuation, so neighbouring kanji runs can't swallow each other's readings. Spaces count
    # too when both sides are spaced the same way (何 食べた is 何 + 食, not one run 何食).
    marks = r'[\s、。！？!?…「」『』（）()・〜~,.]+'
    jp_pieces = [x for x in re.split(marks, jp) if strip_marks(x)]
    rd_pieces = [x for x in re.split(marks, reading) if strip_marks(x)]
    if len(jp_pieces) > 1 and len(jp_pieces) == len(rd_pieces):
        out = []
        for a, b in zip(jp_pieces, rd_pieces):
            parts = align(strip_marks(a), strip_marks(b))
            if parts is None:
                break
            out.extend(parts)
        else:
            return out
    return align(strip_marks(jp), strip_marks(reading))


def char_readings_openjtalk(text):
    """[[surface, reading|None], ...] covering the Japanese in text, from Open JTalk's analysis."""
    out = []
    for n in pyopenjtalk.run_frontend(text):
        s, r = n['string'], n['read']
        if not IS_KANJI.search(s):
            out.append([s, None])
            continue
        parts = align(s, r)
        if parts is None:
            out.append([s, hira(r)])
        else:
            out.extend(parts)
    return out


def segments_with_parts(text, runs):
    """Map each Japanese segment of text to its parts, using a run list that covers text's Japanese characters."""
    # Expand runs into per-character labels: (char, run-id, reading)
    labels = []
    for i, (s, r) in enumerate(runs):
        for ch in s:
            labels.append((ch, i, r))
    result = {}
    pos = 0
    for m in SEG_RE.finditer(text):
        seg = m.group(0)
        # Walk labels to find this segment's characters in order.
        chars = []
        while pos < len(labels) and len(chars) < len(seg):
            ch, i, r = labels[pos]
            pos += 1
            if ch == seg[len(chars)]:
                chars.append((ch, i, r))
            elif chars:
                chars = []
        if len(chars) != len(seg) or not IS_KANJI.search(seg):
            continue
        parts = []
        for ch, i, r in chars:
            kan = bool(IS_KANJI.search(ch))
            if parts and parts[-1][2] == i and parts[-1][3] == kan:
                parts[-1][0] += ch
            else:
                parts.append([ch, r if kan else None, i, kan])
        # A kanji run cut by a segment edge would carry the full reading: drop those so the run table is used.
        fixed = []
        for t, r, i, kan in parts:
            full = ''.join(s for s, _ in [runs[i]])
            fixed.append([t, r if (not kan or t == full) else None])
        merged = []
        for t, r in fixed:
            if merged and r is None and merged[-1][1] is None and not IS_KANJI.search(t) and not IS_KANJI.search(merged[-1][0]):
                merged[-1][0] += t
            else:
                merged.append([t, r])
        result[seg] = merged
    return result


JS_STR = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`")


def source_texts():
    texts = set()
    for dirpath, _, files in os.walk(os.path.join(ROOT, 'js')):
        for f in files:
            # The Manga Reader's conjugation rules and practice bubbles aren't read through readings.js (the reader
            # gives its own readings), so they're left out.
            if not f.endswith('.js') or f in ('readings.js', 'clips.js', 'n5.js', 'n4.js', 'n3.js', 'words.js', 'lookup-data.js', 'manga-dict.js', 'manga-samples.js'):
                continue
            src = open(os.path.join(dirpath, f), encoding='utf-8').read()
            # Lists of look-alike characters (js/word-help.js) are not text: reading 右石 as a word would give 石 the
            # reading せき everywhere.
            src = re.sub(r'const LOOK_ALIKE = \[.*?\];', '', src, flags=re.S)
            # Comments aren't text the app shows.
            src = '\n'.join(l for l in src.split('\n') if not l.lstrip().startswith(('//', '*', '/*')))
            for m in JS_STR.finditer(src):
                s = m.group(0)[1:-1]
                s = re.sub(r'\$\{[^}]*\}', ' ', s)
                # A long run of kanji alone is a set of characters (N5_KANJI, N4_KANJI), not text to read.
                if re.fullmatch(r'[一-鿿々]{20,}', s):
                    continue
                if IS_KANJI.search(s):
                    texts.add(s)
    return texts


def existing_readings():
    src = open(os.path.join(ROOT, 'js', 'readings.js'), encoding='utf-8').read()
    get = lambda name: json.loads(re.search(r'export const ' + name + r' = (\{.*?\});\n', src, re.S).group(1))
    return get('RUNS'), get('SEGMENTS')


def build_readings(pairs, merge=False):
    """merge=True (no pyopenjtalk): add the readings written in the data to the current js/readings.js, keeping
    everything already there, instead of rebuilding it from scratch."""
    segments = {}
    conflicts = []
    run_votes = defaultdict(Counter)

    def take(seg_map, source):
        for seg, parts in seg_map.items():
            if any(IS_KANJI.search(t) and not r for t, r in parts):
                continue   # a kanji without a reading here: leave the segment to Open JTalk or the run table
            for t, r in parts:
                if r and IS_KANJI.search(t):
                    run_votes[t][r] += 3 if source == 'data' else 1
            if seg in segments:
                if segments[seg] != parts and source == 'ojt':
                    conflicts.append((seg, segments[seg], parts))
                continue
            segments[seg] = parts

    # 1. Texts with readings written in the data win.
    for jp, reading in pairs:
        if not IS_KANJI.search(jp):
            continue
        parts = char_readings_from_pair(jp, reading)
        if parts is None:
            print('  could not align data reading:', jp, reading, file=sys.stderr)
            continue
        take(segments_with_parts(jp, parts), 'data')
    # 2. Everything else in the source, via Open JTalk.
    if not merge:
        for text in sorted(source_texts()):
            take(segments_with_parts(text, char_readings_openjtalk(text)), 'ojt')

    runs = {t: c.most_common(1)[0][0] for t, c in run_votes.items()}
    old_segments = {}
    if merge:
        old_runs, old_segments = existing_readings()
        runs.update(old_runs)
    runs.update(RUN_OVERRIDE)
    for seg in list(segments):
        segments[seg] = [[t, RUN_OVERRIDE.get(t, r) if seg == t or t in WRONG else r] for t, r in segments[seg]]
    # Only keep segments whose parts differ from what the run table would produce.
    def from_runs(seg):
        return [[t, runs.get(t) if IS_KANJI.search(t) else None] for t in RUN_RE.findall(seg)]
    segments.update(SEGMENT_OVERRIDE)
    seg_out = {s: p for s, p in segments.items() if p != from_runs(s) and s not in old_segments}
    seg_out.update(old_segments)
    with open(os.path.join(ROOT, 'js', 'readings.js'), 'w') as f:
        f.write('// Generated by tools/build_assets.py. Readings for furigana/romaji: story and word readings from data.js,\n')
        f.write('// everything else from Open JTalk. RUNS: kanji run -> hiragana. SEGMENTS: exceptions, segment -> [text, reading].\n')
        f.write('export const RUNS = ' + json.dumps(runs, ensure_ascii=False, sort_keys=True, indent=0) + ';\n')
        f.write('export const SEGMENTS = ' + json.dumps(seg_out, ensure_ascii=False, sort_keys=True) + ';\n')
    print(f'readings: {len(runs)} kanji runs, {len(seg_out)} segment exceptions, {len(conflicts)} conflicts')
    for c in conflicts:
        print('  conflict (data kept):', c, file=sys.stderr)
    with open(os.path.join(tempfile.gettempdir(), 'kotoba-readings-review.txt'), 'w') as f:
        for t, r in sorted(runs.items()):
            f.write(f'{t}\t{r}\t{dict(run_votes[t])}\n')


# ---------------- word breaks ----------------

# Set phrases Open JTalk reads as one word, with where a learner's book puts the space.
PHRASE_SPLITS = {
    'よろしくおねがいします': [4], 'よろしくお願いします': [4], 'どうぞよろしく': [3],
    'よろしくおねがいしまーす': [4], 'おねがいします': [], 'いただきます': [], 'ごちそうさまでした': [6],
}


def word_cuts(seg):
    """Cut positions between words in a Japanese segment, grouped the way the app spaces its own Japanese (particles
    and endings stay on their word: わたしは がくせいです, たべて ください, わかりました).
    A negative number is a soft cut: no gap in the Japanese, but a space in the romaji (れんです → "ren desu")."""
    if seg in PHRASE_SPLITS:
        return PHRASE_SPLITS[seg]
    nodes = pyopenjtalk.run_frontend(seg)
    if ''.join(n['string'] for n in nodes) != seg:
        return []
    words = []
    soft = []
    at = 0
    prefix = False
    prev_g1 = None
    for n in nodes:
        t, pos, g1 = n['string'], n['pos'], n['pos_group1']
        sub = PHRASE_SPLITS.get(t)
        attach = bool(words) and (
            prefix
            or pos in ('助動詞', '助詞')
            or g1 == '接尾'
            or (pos == '動詞' and g1 == '接尾')
            or t in ('ー', 'っ')
            # する verbs stay one word: お願い|します → お願いします, 勉強|しました → 勉強しました
            or (prev_g1 == 'サ変接続' and (n['orig'] == 'する' or t in ('しない', 'しなかった'))))
        if sub:
            pieces, last = [], 0
            for c in sub + [len(t)]:
                pieces.append(t[last:c]); last = c
        else:
            pieces = [t]
        # Particles and です read as their own romaji word: "ren ga", "ren desu", "tabemasu ka".
        if attach and ((pos == '助詞' and not (g1 == '接続助詞' and t in ('て', 'で'))) or (pos == '助動詞' and n['orig'] in ('です', 'だ'))):
            soft.append(at)
        for k, piece in enumerate(pieces):
            if attach and k == 0:
                words[-1] += piece
            else:
                words.append(piece)
            at += len(piece)
        prefix = pos == '接頭詞'
        prev_g1 = g1
    # A lone kana is usually Open JTalk misreading kana-only text (あ|には for あには): keep it with the next word.
    merged = []
    for w in words:
        if merged and len(merged[-1]) == 1:
            merged[-1] += w
        else:
            merged.append(w)
    words = merged
    cuts, at = [], 0
    for w in words[:-1]:
        at += len(w)
        cuts.append(at)
    hard = set(cuts)
    return sorted(cuts + [-c for c in soft if c not in hard and 0 < c < len(seg)], key=abs)


def build_words():
    """js/words.js: where the spaces go when Japanese text is shown in romaji, for every Japanese run in the code."""
    segs = set()
    for dirpath, _, files in os.walk(os.path.join(ROOT, 'js')):
        for f in files:
            if not f.endswith('.js') or f in ('readings.js', 'words.js', 'lookup-data.js', 'clips.js'):
                continue
            src = open(os.path.join(dirpath, f), encoding='utf-8').read()
            segs.update(SEG_RE.findall(src))
    out = {}
    for seg in sorted(segs):
        if len(seg) < 3:
            continue
        cuts = word_cuts(seg)
        if cuts:
            out[seg] = cuts
    with open(os.path.join(ROOT, 'js', 'words.js'), 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build_assets.py (Open JTalk). Where romaji puts spaces: segment -> cut positions,\n')
        f.write('// so よろしくおねがいします reads "yoroshiku onegaishimasu" and long lines wrap between words.\n')
        f.write('export const WORD_BREAKS = ' + json.dumps(out, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + ';\n')
    print(f'words: {len(out)} segments with word breaks')


# ---------------- service worker ----------------

def build_sw(level_of=None):
    """sw.js's lists: FILES, precached on install (the app and every clip N5 content uses), and LATER, by level: clips
    only a later level uses, cached once that level is unlocked (the app asks, js/levels.js). level_of: clip file ->
    level, from build_clips; without it the levels already in sw.js are kept."""
    path = os.path.join(ROOT, 'sw.js')
    src = open(path, encoding='utf-8').read()
    if level_of is None:
        level_of = {}
        m = re.search(r'const LATER = (\{.*?\});', src, flags=re.S)
        if m:
            body = re.sub(r'^\s*(\w+):', r'"\1":', m.group(1).replace("'", '"'), flags=re.M)
            for lv, names in json.loads(re.sub(r',\s*([\]}])', r'\1', body)).items():
                for n in names:
                    level_of[n.split('/')[-1]] = lv
    files = ['./', './index.html', './styles.css', './manifest.webmanifest']
    later = {}
    for sub in ('js', 'icons', 'img', 'audio'):
        for dirpath, _, names in os.walk(os.path.join(ROOT, sub)):
            for n in sorted(names):
                f = './' + os.path.relpath(os.path.join(dirpath, n), ROOT).replace(os.sep, '/')
                lv = level_of.get(n, 'N5') if sub == 'audio' else 'N5'
                if lv == 'N5':
                    files.append(f)
                else:
                    later.setdefault(lv, []).append(f)
    listing = 'const FILES = [\n' + ''.join(f"  '{f}',\n" for f in files) + '];'
    src = re.sub(r'const FILES = \[.*?\];', lambda _: listing, src, flags=re.S)
    later_src = 'const LATER = {\n' + ''.join(f"  {lv}: [\n" + ''.join(f"    '{f}',\n" for f in fs) + '  ],\n' for lv, fs in sorted(later.items())) + '};'
    if 'const LATER = {' in src:
        src = re.sub(r'const LATER = \{.*?\n\};', lambda _: later_src, src, flags=re.S)
    else:
        src = src.replace('\nself.addEventListener(\'install\'', '\n' + later_src + '\n\nself.addEventListener(\'install\'', 1)
    open(path, 'w', encoding='utf-8').write(src)
    print(f'sw.js: {len(files)} files to precache, ' + ', '.join(f'{len(v)} {k} clips after unlock' for k, v in sorted(later.items())))


# ---------------- N5 deck ----------------

def build_deck(level):
    """tools/<level>.tsv -> js/<level>.js. Columns: jp, kana, English, pitch accent (downstep, 0 = flat), example, its
    reading, its English, then optional texts for the voice to read instead of the word / the example when Open JTalk
    misreads."""
    name = level.lower()
    rows = []
    for line in open(os.path.join(ROOT, 'tools', name + '.tsv'), encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#'):
            continue
        f = line.split('\t')
        row = f[:3] + [int(f[3])] + f[4:7]
        extra = (f[7:9] + ['', ''])[:2]
        if any(extra):
            row += [extra[0] or 0, extra[1] or 0]
        rows.append(row)
    with open(os.path.join(ROOT, 'js', name + '.js'), 'w', encoding='utf-8') as f:
        f.write(f'// Generated by tools/build_assets.py from tools/{name}.tsv. JLPT {level} deck, in teaching order:\n')
        f.write('// [jp, kana, English, pitch accent (0 = flat), example, example reading, example English, voice says?, example voice says?]\n')
        f.write(f'export const {level} = [\n' + ''.join(json.dumps(r, ensure_ascii=False) + ',\n' for r in rows) + '];\n')
    print(f'{name}: {len(rows)} words')


def build_n5():
    build_deck('N5')
    build_deck('N4')
    build_deck('N3')


def main():
    build_n5()
    data = json.loads(subprocess.run(['node', os.path.join(ROOT, 'tools', 'collect.mjs')], capture_output=True, check=True, text=True).stdout)
    extra = []
    if pyopenjtalk:
        # Tap a word to look it up (js/lookup-data.js), and a clip for each looked-up word that has no Garden card.
        import build_lookup
        tokens, entries, unknown = build_lookup.build(data['lookup'])
        build_lookup.write(tokens, entries)
        have = {(c[0], c[1]) for c in data['clips']}
        extra = [c for c in build_lookup.extra_clips(entries, build_lookup.build.level_of) if (c[0], c[1]) not in have]
    level_of = build_clips([(c[0], c[1], c[2] if len(c) > 2 else None, c[3] if len(c) > 3 else None, c[4] if len(c) > 4 else 'N5') for c in data['clips'] + extra])
    if pyopenjtalk:
        build_readings(data['pairs'])
        build_words()
    else:
        print('readings: pyopenjtalk not installed, so only adding readings written in the data to js/readings.js')
        build_readings(data['pairs'], merge=True)
    build_sw(level_of)


if __name__ == '__main__':
    main()

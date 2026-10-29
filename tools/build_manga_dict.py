#!/usr/bin/env python3
"""Manga Reader dictionary: turns JMdict (EDRDG, CC BY-SA 4.0) into manga/dict.txt, a compact word list the reader
loads the first time it opens. The reader finds the longest dictionary word at each point of a speech bubble's text,
undoing conjugations first (js/manga-dict.js), so it needs every written form, every reading, the verb or adjective
class and a short meaning.

Point JMDICT_DB at a jamdict SQLite file (the jamdict-data package on PyPI ships one as jamdict.db.xz):
  JMDICT_DB=/path/to/jamdict.db python3 tools/build_manga_dict.py

Each line of manga/dict.txt is one entry, tab-separated:
  written forms (;), readings (;), word classes (,), common (1 or empty), meanings (senses split by |, glosses by ;)
A form or reading the entry marks as rare or wrong is left out.
"""
import os
import sqlite3
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'manga', 'dict.txt')

# JMdict part-of-speech text -> the short class js/manga-dict.js deinflects with. Anything else is left out.
POS = {
    'Ichidan verb': 'v1', 'Ichidan verb - kureru special class': 'v1',
    "Godan verb with 'u' ending": 'v5u', "Godan verb with 'u' ending (special class)": 'v5u',
    "Godan verb with 'ku' ending": 'v5k', 'Godan verb - Iku/Yuku special class': 'v5k-s',
    "Godan verb with 'gu' ending": 'v5g', "Godan verb with 'su' ending": 'v5s',
    "Godan verb with 'tsu' ending": 'v5t', "Godan verb with 'nu' ending": 'v5n',
    "Godan verb with 'bu' ending": 'v5b', "Godan verb with 'mu' ending": 'v5m',
    "Godan verb with 'ru' ending": 'v5r', "Godan verb with 'ru' ending (irregular verb)": 'v5r-i',
    'Godan verb - -aru special class': 'v5aru',
    'Kuru verb - special class': 'vk', 'suru verb - included': 'vs-i', 'suru verb - special class': 'vs-s',
    'noun or participle which takes the aux. verb suru': 'vs',
    'Ichidan verb - zuru verb (alternative form of -jiru verbs)': 'vz',
    'adjective (keiyoushi)': 'adj-i', 'adjective (keiyoushi) - yoi/ii class': 'adj-ix',
    'adjectival nouns or quasi-adjectives (keiyodoshi)': 'adj-na',
    'particle': 'prt', 'expressions (phrases, clauses, etc.)': 'exp', 'auxiliary verb': 'aux-v',
}
RARE = {'rarely-used kanji form', 'rarely used kanji form', 'search-only kanji form', 'irregular kanji usage',
        'out-dated kanji', 'out-dated or obsolete kana usage', 'search-only kana form', 'irregular kana usage',
        'old or irregular kana form', 'word containing irregular kana usage', 'word containing out-dated kanji or kanji usage',
        'word containing irregular kanji usage', 'rarely used kana form'}
# Meanings kept: common words get more of them than rare ones, to keep the download small.
LIMITS = {True: (3, 3, 110), False: (2, 2, 60)}   # common?: (senses, glosses per sense, characters)


def main():
    db = os.environ.get('JMDICT_DB')
    if not db or not os.path.exists(db):
        sys.exit('Set JMDICT_DB to a jamdict SQLite file (see the docstring).')
    c = sqlite3.connect(db)
    kanji, kana = defaultdict(list), defaultdict(list)
    prio = set()
    kji = {kid for kid, t in c.execute('select kid, text from KJI') if t in RARE}
    kni = {kid for kid, t in c.execute('select kid, text from KNI') if t in RARE}
    for kid, idseq, text in c.execute('select ID, idseq, text from Kanji order by ID'):
        if kid not in kji: kanji[idseq].append(text)
    for kid, idseq, text in c.execute('select ID, idseq, text from Kana order by ID'):
        if kid not in kni: kana[idseq].append(text)
    for (idseq,) in c.execute('select distinct k.idseq from KJP p join Kanji k on k.ID = p.kid where p.text in ("news1","ichi1","spec1","spec2","gai1")'):
        prio.add(idseq)
    for (idseq,) in c.execute('select distinct k.idseq from KNP p join Kana k on k.ID = p.kid where p.text in ("news1","ichi1","spec1","spec2","gai1")'):
        prio.add(idseq)
    senses = defaultdict(list)
    for sid, idseq in c.execute('select ID, idseq from Sense order by ID'):
        senses[idseq].append(sid)
    gloss = defaultdict(list)
    for sid, text in c.execute("select sid, text from SenseGloss where lang = 'eng' or lang is null order by rowid"):
        gloss[sid].append(text.replace('\t', ' ').replace('|', '/').replace(';', ','))
    pos = defaultdict(list)
    for sid, text in c.execute('select sid, text from pos'):
        if text in POS: pos[sid].append(POS[text])
    lines = []
    for (idseq,) in c.execute('select idseq from Entry order by idseq'):
        rs = kana.get(idseq)
        sids = [s for s in senses.get(idseq, []) if gloss.get(s)]
        if not rs or not sids:
            continue
        classes = []
        for s in sids:
            for p in pos.get(s, []):
                if p not in classes: classes.append(p)
        senses_max, glosses_max, max_len = LIMITS[idseq in prio]
        parts, n = [], 0
        for s in sids[:senses_max]:
            g = '; '.join(gloss[s][:glosses_max])
            if parts and n + len(g) > max_len: break
            parts.append(g)
            n += len(g)
        lines.append('\t'.join([';'.join(kanji.get(idseq, [])), ';'.join(rs), ','.join(classes), '1' if idseq in prio else '', '|'.join(parts)]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('# Manga Reader dictionary from JMdict (EDRDG, CC BY-SA 4.0). Written by tools/build_manga_dict.py.\n')
        f.write('\n'.join(lines) + '\n')
    print(f'{len(lines)} entries, {sum(1 for l in lines if l.split(chr(9))[3])} common -> {OUT}')


if __name__ == '__main__':
    main()

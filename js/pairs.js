// Word partners for the Garden: opposites and matched sets (男/女, 大きい/小さい, 行く/来る). When the Garden brings in
// one of them as a new word, its partner comes in the same day, and each new card shows "Goes with". They are still
// reviewed as separate cards afterwards, so the two don't blur together. Written forms; pairs whose words aren't in a
// deck are skipped. tests/garden-pairs.spec.js checks every pair is found.
import { N5_WORDS, N4_WORDS, N3_WORDS } from './data.js';

export const PAIRS = [
  // people
  ['男', '女'], ['男の子', '女の子'], ['父', '母'], ['お父さん', 'お母さん'], ['兄', '姉'], ['弟', '妹'],
  ['お兄さん', 'お姉さん'], ['おじいさん', 'おばあさん'], ['おじさん', 'おばさん'], ['彼', '彼女'], ['大人', '子供'],
  ['先生', '学生'], ['はい', 'いいえ'],
  // time
  ['昨日', '明日'], ['一昨日', '明後日'], ['朝', '夜'], ['午前', '午後'], ['今朝', '今晩'], ['毎朝', '毎晩'],
  ['先週', '来週'], ['先月', '来月'], ['去年', '来年'], ['春', '秋'], ['夏', '冬'], ['前', '後'], ['最初', '最後'],
  // places and directions
  ['上', '下'], ['中', '外'], ['右', '左'], ['東', '西'], ['南', '北'], ['入口', '出口'], ['海', '山'],
  // verbs
  ['行く', '来る'], ['買う', '売る'], ['起きる', '寝る'], ['出る', '入る'], ['教える', '習う'], ['覚える', '忘れる'],
  ['始まる', '終わる'], ['開ける', '閉める'], ['開く', '閉まる'], ['立つ', '座る'], ['乗る', '降りる'],
  ['貸す', '借りる'], ['あげる', 'もらう'], ['押す', '引く'], ['付ける', '消す'], ['点く', '消える'],
  ['出す', '入れる'], ['着る', '脱ぐ'], ['上がる', '下がる'],
  // describing words
  ['大きい', '小さい'], ['新しい', '古い'], ['いい', '悪い'], ['高い', '安い'], ['長い', '短い'], ['多い', '少ない'],
  ['早い', '遅い'], ['近い', '遠い'], ['暑い', '寒い'], ['熱い', '冷たい'], ['暖かい', '涼しい'], ['難しい', '易しい'],
  ['面白い', 'つまらない'], ['嬉しい', '悲しい'], ['強い', '弱い'], ['重い', '軽い'], ['広い', '狭い'],
  ['明るい', '暗い'], ['白い', '黒い'], ['太い', '細い'], ['厚い', '薄い'], ['綺麗', '汚い'], ['静か', '賑やか'],
  ['好き', '嫌い'], ['大好き', '大嫌い'], ['上手', '下手'], ['晴れ', '曇り'],
  // N4 and N3
  ['勝ち', '負け'], ['味方', '敵'], ['過去', '未来'], ['得る', '失う'], ['最高', '最低'], ['以上', '以下'],
  ['生きる', '死ぬ'], ['濃い', '薄い'],
];

const DECK_BY_JP = new Map();
for (const w of [...N5_WORDS, ...N4_WORDS, ...N3_WORDS]) if (!DECK_BY_JP.has(w.jp)) DECK_BY_JP.set(w.jp, w);

const PARTNER = new Map();
for (const [a, b] of PAIRS) {
  if (!DECK_BY_JP.has(a) || !DECK_BY_JP.has(b)) continue;
  if (!PARTNER.has(a)) PARTNER.set(a, b);
  if (!PARTNER.has(b)) PARTNER.set(b, a);
}

/** The deck word that pairs with this written form (男 → the deck's 女), or null. */
export function partnerOf(jp) {
  const p = PARTNER.get(jp);
  return p ? DECK_BY_JP.get(p) : null;
}

/** Pairs where a word isn't in any deck (for the test). */
export const missingPairs = () => PAIRS.filter(([a, b]) => !DECK_BY_JP.has(a) || !DECK_BY_JP.has(b));

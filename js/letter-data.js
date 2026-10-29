// Ren's monthly letter (js/letters.js): the lines a letter is built from. Each slot has a polite version (while Ren and
// the learner are still getting to know each other, tier 1 in js/messages.js) and a casual one. `jp` is spoken (its
// VOICEVOX clip is in Ren's voice, tools/collect.mjs) and shown once every kanji in it is known; `kana` otherwise.
// The letter only ever says what went well. It never counts or mentions days missed.
const L = (id, jp, kana, en) => ({ id, jp, kana, en });

export const LETTER_LINES = {
  open: {
    polite: L('open', 'こんにちは！ レンです。先月も お疲れさまでした！', 'こんにちは！ レンです。せんげつも おつかれさまでした！', "Hi! It's Ren. Great work last month too!"),
    casual: L('open', 'やあ、レンだよ！ 先月も お疲れ！', 'やあ、レンだよ！ せんげつも おつかれ！', "Hey, it's Ren! Nice work last month!"),
  },
  wordsMany: {
    polite: L('wordsMany', '言葉を たくさん 覚えましたね。すごいです！', 'ことばを たくさん おぼえましたね。すごいです！', 'You learned lots of words. Amazing!'),
    casual: L('wordsMany', '言葉、すごく 増えたね！ すごい！', 'ことば、すごく ふえたね！ すごい！', 'Your words really grew! Amazing!'),
  },
  wordsSome: {
    polite: L('wordsSome', '新しい 言葉を 覚えましたね。', 'あたらしい ことばを おぼえましたね。', 'You learned new words.'),
    casual: L('wordsSome', '新しい 言葉、覚えたね。', 'あたらしい ことば、おぼえたね。', 'You learned new words.'),
  },
  wordsFew: {
    polite: L('wordsFew', '少しずつ、いいですね。', 'すこしずつ、いいですね。', 'Little by little. Nice.'),
    casual: L('wordsFew', '少しずつで いいんだよ。', 'すこしずつで いいんだよ。', "Little by little is fine, you know."),
  },
  review: {
    polite: L('review', '復習、がんばりましたね。', 'ふくしゅう、がんばりましたね。', 'You worked hard on your reviews.'),
    casual: L('review', '復習、がんばったね。', 'ふくしゅう、がんばったね。', 'You worked hard on your reviews.'),
  },
  busy: {
    polite: L('busy', '忙しかったですか。無理しないで くださいね。', 'いそがしかったですか。むりしないで くださいね。', "Were you busy? Don't push yourself too hard."),
    casual: L('busy', '忙しかった？ 無理しないでね。', 'いそがしかった？ むりしないでね。', "Busy? Don't overdo it."),
  },
  hiragana: {
    polite: L('hiragana', 'ひらがなが 全部 読めるように なりましたね！', 'ひらがなが ぜんぶ よめるように なりましたね！', 'You can read all the hiragana now!'),
    casual: L('hiragana', 'ひらがな、全部 読めるように なったね！', 'ひらがな、ぜんぶ よめるように なったね！', 'You can read all the hiragana now!'),
  },
  katakana: {
    polite: L('katakana', 'カタカナも 読めるように なりましたね！', 'カタカナも よめるように なりましたね！', 'You can read katakana too now!'),
    casual: L('katakana', 'カタカナも 読めるように なったね！', 'カタカナも よめるように なったね！', 'You can read katakana too now!'),
  },
  story: {
    polite: L('story', '物語も 進みましたね。続きが 楽しみです。', 'ものがたりも すすみましたね。つづきが たのしみです。', "The story moved on too. I can't wait for what's next."),
    casual: L('story', '物語も 進んだね。続き、楽しみ！', 'ものがたりも すすんだね。つづき、たのしみ！', "The story moved on too. Can't wait for what's next!"),
  },
  course: {
    polite: L('course', 'コースも 進みましたね。', 'コースも すすみましたね。', 'You moved ahead in the course too.'),
    casual: L('course', 'コースも 進んだね。', 'コースも すすんだね。', 'You moved ahead in the course too.'),
  },
  mock: {
    polite: L('mock', '模擬試験も 受けましたね。えらいです！', 'もぎしけんも うけましたね。えらいです！', 'You took a mock test too. Well done!'),
    casual: L('mock', '模擬試験も 受けたんだ！ えらい！', 'もぎしけんも うけたんだ！ えらい！', 'You took a mock test too! Well done!'),
  },
  plan: {
    polite: L('plan', '試験まで いっしょに がんばりましょう！', 'しけんまで いっしょに がんばりましょう！', "Let's keep at it together until the test!"),
    casual: L('plan', '試験まで いっしょに がんばろう！', 'しけんまで いっしょに がんばろう！', "Let's keep at it together until the test!"),
  },
  quiz: {
    polite: L('quiz', 'この 言葉、覚えていますか。', 'この ことば、おぼえていますか。', 'Do you remember these words?'),
    casual: L('quiz', 'この 言葉、覚えてる？', 'この ことば、おぼえてる？', 'Remember these words?'),
  },
  close: {
    polite: L('close', '今月も よろしく お願いします！', 'こんげつも よろしく おねがいします！', 'Looking forward to this month too!'),
    casual: L('close', '今月も よろしく！', 'こんげつも よろしく！', 'Here’s to this month too!'),
  },
  sign: {
    polite: L('sign', 'レンより', 'レンより', 'From Ren'),
    casual: L('sign', 'レンより', 'レンより', 'From Ren'),
  },
};

/** Every line, for the voice clips and readings (tools/collect.mjs). */
export const ALL_LETTER_LINES = Object.values(LETTER_LINES).flatMap((s) => [s.polite, s.casual]);

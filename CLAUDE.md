# Kotoba Beat (web): notes for Claude

The README covers how the app is built and how the voice clips are generated. Read it first. This file adds the context about the owner that a fresh session wouldn't have.

## Who it's for
- It's Hyreign's personal Japanese study app, not a commercial product. Choose the option that helps them learn the most, and favor free tools.
- Hyreign is a returning beginner. They're relearning kana now and know no kanji or katakana yet.
- Hyreign likes shōnen and action anime. Story content is original writing in that style, never copied scripts.
- They use Chrome or Edge on a PC and Safari on an iPhone.
- Design rules from the research:
  - Make the learner recall answers, and space out reviews.
  - Keep accuracy around 85%.
  - Score generously, and when the learner misses, reveal the answer instead of taking a life.
  - No streaks. Nothing should punish time away.
- The daily routine follows the study program: https://claude.ai/code/artifact/2759bb0c-28d8-4d14-abe3-647d8980acea . Blocks are review, story input, speaking, and a skill that rotates by weekday. There's also a 10-minute short day and a quiet mode.

## Conventions
- Plain JavaScript with no build step and no external network calls. Every path is relative, because the site is served from `/kotoba-web/` on GitHub Pages and the main branch deploys automatically.
  - The one allowed exception is the optional sync across devices (`js/sync.js`). It's opt-in and does nothing until Hyreign pastes a GitHub token in Settings. After that it talks only to `api.github.com`, using one private gist. The token lives only in this device's storage (`kotobaBeat.sync`), never in progress or an export code, and is never logged.
  - The second allowed exception is the optional AI chat partner (Free chat in Messages, `js/ai-chat.js`). It's opt-in and does nothing until Hyreign pastes a Claude API key in Settings. After that it talks only to `api.anthropic.com`. The key lives only in this device's storage (`kotobaBeat.ai`), never in progress, sync or an export code, and is never logged. Free chats are kept on the device only (`kotobaBeat.aiChats`), not in progress.
  - The sync gist can also hold `kotoba-beat-widget.json` (today's words for the Scriptable home screen widget, `widget/kotoba-widget.js`). It's written only after Hyreign turns it on in Today's words, and it never holds the token.
  - Sync merges and never overwrites. The merge is `mergeProgress` in `store.js`. If the saved progress shape changes, update `mergeProgress` and `tests/sync.spec.js` along with the migration.
- Every piece of content has a JLPT level, every mode draws through js/levels.js, and tests/levels.spec.js must pass. A new mode must cover every level the app offers.
- Bump `CACHE_VERSION` in `sw.js` on every change, or installed phones keep showing the old version.
- After changing any Japanese text, regenerate the clips and readings with `tools/build_assets.py`. The README has the steps.
- Keep the VOICEVOX credits in Settings, because the voice terms require them.
- `#/check` is the sound and mic check screen. Ask Hyreign to run it whenever they report an audio or mic problem.
- Test in headless Chromium at 390x844 and 1280x800 before pushing. Check for zero console errors and no horizontal scroll.
- Make changes through a branch and a pull request into `main`.

## Where else things live
The planning happens in a Claude Project called "Language Learning Game". It holds the research report, the game ideas list and the shared notes. A standalone cloud session can't see any of that, so ask Hyreign if you need it.

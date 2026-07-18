# 03 — Additional practice modes

## Context

Hyperlearning (repo `/Users/milindc/gitrepos/Kaizen`; see `handoff.md`). The
review session (`src/app/review/session.tsx`) currently supports two shapes:
flashcard (front → reveal back) and practice item (prompt → reveal answer),
both rated Again/Hard/Good/Easy through `rateFlashcard` in
`src/lib/actions.ts` → SM-2 in `src/lib/srs.ts`. The spec calls for richer
modes: cloze, multiple choice, matching, typing drill, free recall, ordering,
fill-in-the-blank. `PracticeType` enum in `prisma/schema.prisma` already has
all of these values.

## Current state

- `PracticeItem` has `type`, `prompt`, `answer`, `metadata Json` — metadata
  is free for mode-specific payloads (choices, blanks, pairs)
- Generation: `src/lib/flashcard-gen.ts` `generatePractice()` currently only
  emits prompt/answer pairs from `practiceRules` (`{type, promptField,
  answerField}`); schemas' seed rules live in `prisma/seed-data/schemas.ts`
- Session cards carry `kind: 'flashcard' | 'practice'` and `practiceType`
  (`src/app/review/page.tsx` builds `SessionCard`)
- The user prefers keyboard-first interaction (Space reveal, 1–4 rate)

## Task

1. **Mode renderers** inside the review session, switched on `practiceType`:
   - `CLOZE` / `FILL_BLANK`: prompt shows text with `{{c:…}}` spans hidden;
     typed answer or reveal; grade self-rated as today
   - `MULTIPLE_CHOICE`: metadata `{ choices: string[] }` — render 4 pill
     buttons (1–4 keys select), auto-rate GOOD on correct / AGAIN on wrong,
     then show the rating bar for override
   - `MATCHING`: metadata `{ pairs: [left, right][] }` — tap-to-pair grid,
     auto-grade when all matched
   - `TYPING_DRILL`: show target text, capture typed input, live WPM +
     accuracy, store `{wpm, accuracy}` in the `Attempt` (extend `Attempt`
     metadata via `answerGiven`/`timeMs` — already exist)
2. **Generation upgrades** in `generatePractice`: cloze auto-built from a
   sentence field + term field (wrap the term in the sentence); multiple
   choice distractors sampled from sibling items' answers (needs item pool —
   pass all items in); matching built per-batch of 4 items. Keep pure +
   unit-tested.
3. **Distractor quality**: same schema, different item, exclude identical
   answers.
4. NATO alphabet + GeoGuessr schemas should get `practiceRules` additions in
   `prisma/seed-data/schemas.ts` (e.g. NATO multiple choice, GeoGuessr
   clue→country multiple choice) — remember seeds only apply on `db:seed`;
   also add a small backfill path or regenerate via the Generate button.

## Verification / definition of done

- Vitest: cloze construction, distractor sampling (no dupes, no self),
  matching batch shapes
- Live: generate NATO multiple-choice items, run a session — arrow through
  choices with keys, wrong answer auto-rates AGAIN and re-queues; typing
  drill records WPM in Attempt rows (check via psql)
- `npm test` + `npm run build` clean

# Hyperlearning — handoff

This folder is the map of everything **not yet built**. Each numbered file is
a self-contained brief a fresh agent can execute without this conversation:
context, current state with file pointers, the task, implementation guidance,
and a verification checklist.

## Project snapshot (as of 2026-07-16)

Built and working (Phases 1–2 + Anki pivot + known words):

- Schema-driven content core: `ContentSchema/Version/Field` → Zod validation
  at import (`src/lib/schema-zod.ts`), LLM generation prompts per schema
  (`src/lib/llm-prompt.ts`, route `src/app/schemas/[slug]/prompt`)
- Anki integration: AnkiConnect client (`src/lib/anki-connect.ts`), snapshot
  sync (`src/lib/anki-sync.ts`), analytics engine (`src/lib/anki-analytics.ts`),
  Anki tab (`src/app/anki/`), Analytics page with charts
  (`src/components/anki-charts.tsx`), leech lesson-plan prompts
  (`src/lib/leech-prompt.ts`)
- In-app SM-2 review (`src/lib/srs.ts`, `src/app/review/`), card/practice
  generation from schema rules (`src/lib/flashcard-gen.ts`)
- Daily study queue with 10 modes (`src/lib/daily.ts`, `src/app/daily/`)
- Mistake log (`src/app/mistakes/`)
- Known words: kuromoji/OpenCC normalization (`src/lib/lemmatize.ts`), union
  bounds (`src/lib/known-words.ts`), Migaku import + Anki extraction
  (`src/lib/known-words-sync.ts`), Words page (`src/app/words/`)
- Math roadmap tree with hover tracing + ready-glow (`src/app/math/roadmap-view.tsx`)
- Books tracker with notes + page counts (`src/app/books/`)

## Environment

- Repo: `/Users/milindc/gitrepos/Kaizen`, branch flow: `main` ← PR #1
  (`hyperlearning-phase1`) ← PR #2 (`hyperlearning-phase2`)
- Postgres db `hyperlearning` (local, `.env` has `DATABASE_URL`); Prisma 7
  with driver adapters — after schema changes run `npx prisma migrate dev`
  AND `npx prisma generate` (the client has gone stale twice; regenerate if
  types look wrong)
- Anki desktop + AnkiConnect (add-on 2055492159) must be running for live
  sync; every Anki feature must degrade gracefully when it isn't
- Dev server: `npm run dev` (Turbopack). If it reports "module not found"
  for a file that exists, delete `.next` and restart — stale cache bug hit
  twice
- Tests: `npm test` (70 passing). Build: `npm run build` must stay clean

## Conventions (read before coding)

- Dark, information-dense UI; shared primitives in `src/components/ui.tsx`
  (Card, Section, StatCard, Badge, pill button classes)
- **User preference: pill-button rows over dropdowns** for small option sets
- **User preference: the math roadmap must stay a tree diagram** (layered DAG
  with drawn edges), never a flat list
- Domain logic goes in `src/lib/` as pure functions with vitest coverage;
  DB-facing modules are suffixed `-sync`; all mutations are server actions in
  `src/lib/actions.ts` with `revalidatePath`
- Downloadable LLM prompts follow the pattern in
  `src/app/schemas/[slug]/prompt/route.ts` (markdown, Content-Disposition
  attachment) + `src/components/copy-button.tsx`
- Verify in the browser before calling anything done (dev server via the
  Browser pane / launch.json name `hyperlearning`)

## Subtask briefs (independent; suggested order)

| # | File | Summary |
|---|---|---|
| 1 | [01-training-plan-generators.md](01-training-plan-generators.md) | Generate concrete study plans from exam targets + known-word counts (JA/ZH), and from math target paths |
| 2 | [02-book-flashcard-flow.md](02-book-flashcard-flow.md) | "Remember this" book notes → flashcards in the review queue; reading progress via page counts |
| 3 | [03-practice-modes.md](03-practice-modes.md) | Cloze, multiple choice, matching, typing-drill runner — beyond the current reveal/rate card |
| 4 | [04-csv-import-export.md](04-csv-import-export.md) | CSV import with column mapping; schema/course/full-data export |
| 5 | [05-course-addition-contract.md](05-course-addition-contract.md) | One-click "Course Addition Contract" bundling a whole course's schemas for an external LLM |
| 6 | [06-analytics-extensions.md](06-analytics-extensions.md) | In-app (non-Anki) review analytics, weak-area detection, study-time tracking |
| 7 | [07-japanese-content-pipeline.md](07-japanese-content-pipeline.md) | Populate Japanese: JLPT vocab/grammar/kanji content, map Japanese Anki decks, pitch accent |
| 8 | [08-settings-and-polish.md](08-settings-and-polish.md) | Editable settings, milestone/objective completion UI, small UX debts |

Each brief ends with a **Definition of done**. Run `npm test` + `npm run build`
+ a live browser pass before finishing any of them.

# Hyperlearning

A personal, single-user, local-first learning system: long-term training plans,
schema-driven content, Anki-powered review analytics, known-word tracking with
linguistic dedup, and progress tracking for Japanese, Chinese, math, random
skills, and books — extensible to any future course through a schema designer.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- PostgreSQL + Prisma 7 (driver adapters, `@prisma/adapter-pg`)
- Zod for schema-driven import validation
- AnkiConnect (local HTTP API) for the Anki integration
- kuromoji (Japanese lemmatization) + opencc-js (trad→simp Chinese)
- Vitest (70 tests)

## Running locally

Requires Node 20+, local PostgreSQL, and (for the Anki features) Anki desktop
with the AnkiConnect add-on (code `2055492159`).

```bash
# 1. PostgreSQL (once)
brew services start postgresql@17
createdb hyperlearning

# 2. Configure
#    .env → DATABASE_URL="postgresql://<you>@localhost:5432/hyperlearning"

# 3. Install, migrate, seed
npm install
npx prisma migrate dev
npm run db:seed

# 4. Run
npm run dev                     # http://localhost:3000
npm test                        # vitest suite
```

Useful scripts: `db:migrate`, `db:seed`, `db:studio`, `test`.
One-off utilities live in `scripts/` (Anki .apkg import, cleanup).

## What it does

- **Anki is the review engine** for deck-based study. The **Anki tab** maps
  your decks to courses/subsections and snapshots cards + full review history
  into Postgres via AnkiConnect. **Analytics** renders activity heatmaps,
  reviews/day, workload forecasts, retention, collection health, goal
  projections, and a per-deck leech panel that generates LLM lesson-plan
  prompts (.md) from your worst cards.
- **Known words** (Words tab): union of Migaku exports, mature Anki cards, and
  manual adds. Japanese conjugations are lemmatized with kuromoji so 食べた and
  食べる count once; ambiguous kana/kanji merges are reported as lower/upper
  bounds. Chinese is normalized traditional→simplified. Vocab goals ("Reach
  500 words") track the lower bound automatically.
- **In-app SM-2 review** for non-Anki content: flashcards and practice items
  generated from schema rules ({{field}} templates), reviewed with
  Again/Hard/Good/Easy and keyboard shortcuts.
- **Daily Study** builds a queue across Anki due counts, in-app reviews, new
  cards, open mistakes, and book notes, weighted by 10 study modes.
- **Math roadmap**: a 55-node layered prerequisite tree with hover-tracing of
  prerequisite closures, cyan "ready to start" glow when everything above a
  node is complete, and per-target filtered views (Iwasawa Theory, QFT,
  Physics Phenomenology, Quantitative Finance, Analytic Number Theory).
- **Schema designer + import**: every content type is a versioned schema;
  imports are validated by Zod validators built from the schema at runtime.
  Each schema generates a downloadable .md prompt so any LLM can produce
  conforming JSON.
- **Books** (reading tracker + "remember this" notes), **Mistakes** log, and a
  dashboard tying it together (unified streak across Anki + in-app study).

## Architecture in one paragraph

Everything importable is a **ContentSchema** (versioned, typed fields);
content lives in **LearningItem.data** JSON validated by Zod validators built
from those fields (`src/lib/schema-zod.ts`). **Flashcard/PracticeItem** are
generated from schema rules (`src/lib/flashcard-gen.ts`) and reviewed via
**ReviewRecord** + the SM-2 engine (`src/lib/srs.ts`). The Anki side mirrors
decks into **AnkiDeckMapping / AnkiCardSnapshot / AnkiReviewLog** and runs
pure-function analytics (`src/lib/anki-analytics.ts`). Known words live in
**KnownWord** with dual canonical keys (strict/loose) so
`src/lib/known-words.ts` can compute union-cardinality bounds; normalization
is in `src/lib/lemmatize.ts`. The math curriculum is **Roadmap/RoadmapNode/
RoadmapEdge** with graph utilities in `src/lib/roadmap.ts`.

## Key directories

- `prisma/schema.prisma` — the full data model; `prisma/seed-data/` — courses,
  exams (JLPT/BJT/Kanji Kentei/HSK), 21 content schemas, math roadmap
- `src/lib/` — all domain logic (pure functions preferred; DB-facing modules
  suffixed `-sync`); `src/lib/actions.ts` — every server action
- `src/app/` — one route per tab
- `tests/` — 70 vitest tests over the pure modules
- `handoff/` — self-contained briefs for the remaining roadmap (see below)

## Status & roadmap

Phases 1–2 are complete (schema system, all tabs, Anki integration, review,
daily queue, mistakes, known words). The remaining work — training-plan
generators, book→flashcard flow, more practice modes, CSV import/export, the
course-addition contract, deeper analytics, Japanese content pipeline, and
settings — is specced as independent, agent-runnable briefs in
[`handoff/handoff.md`](handoff/handoff.md).

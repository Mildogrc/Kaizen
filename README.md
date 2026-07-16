# Hyperlearning

A personal, single-user, local-first learning system: long-term training plans,
schema-driven content, flashcards, spaced repetition, and progress tracking for
Japanese, Chinese, Math, random skills, books — and any future course you
define through the Schema Designer.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- PostgreSQL + Prisma 7 (driver-adapter architecture, `@prisma/adapter-pg`)
- Zod for schema-driven import validation
- Vitest for tests

## Running locally

Requires Node 20+ and a local PostgreSQL (installed via Homebrew here).

```bash
# 1. Start PostgreSQL (once)
brew services start postgresql@17
createdb hyperlearning          # if it doesn't exist yet

# 2. Configure
#    .env contains DATABASE_URL=postgresql://<you>@localhost:5432/hyperlearning

# 3. Install, migrate, seed
npm install
npx prisma migrate dev
npm run db:seed

# 4. Run
npm run dev                     # http://localhost:3000
npm test                        # vitest suite
```

Useful scripts: `db:migrate`, `db:seed`, `db:studio` (Prisma Studio), `test`.

## Architecture in one paragraph

Everything importable is a **ContentSchema** (versioned, with typed
**ContentSchemaField**s). Content lives in **LearningItem.data** as JSON
validated against the schema's fields by a Zod validator built at runtime
(`src/lib/schema-zod.ts`). Items belong to a **Course** (Japanese, Chinese,
Math, Typing, …) and can later generate **Flashcard**s / **PracticeItem**s,
each with a **ReviewRecord** carrying SM-2 state. **Roadmap / RoadmapNode /
RoadmapEdge** model the math curriculum graph (solid prerequisite edges,
dotted application edges) with target-path computation in
`src/lib/roadmap.ts`. **Exam / ExamLevel / ExamObjective** hold JLPT, BJT,
Kanji Kentei, and HSK tracks. Books use **Book / BookNote** with a
"remember this" flag feeding future flashcard generation.

## Key directories

- `prisma/schema.prisma` — the full data model
- `prisma/seed.ts`, `prisma/seed-data/` — courses, exams, 21 content schemas, math roadmap
- `src/lib/` — db client, Zod builder, roadmap graph utils, server actions
- `src/app/` — one route per tab
- `tests/` — schema validation, import validation, roadmap path tests

## Phase status

Phase 1 (this codebase): schema system, seed data, all tabs, math roadmap MVP,
books MVP, JSON import with validation, schema export.
Phase 2 (next): flashcard generation, SM-2 scheduler, review session UI,
daily study queue, mistake log.

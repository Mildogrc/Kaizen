# 01 — Training plan generators (Japanese / Chinese / Math)

## Context

Hyperlearning (repo `/Users/milindc/gitrepos/Kaizen`, Next.js + Prisma 7 +
Postgres, see `handoff.md` for conventions) tracks exam tracks (JLPT N5–N1,
BJT, Kanji Kentei, HSK 1–9 in `Exam/ExamLevel/ExamObjective`), course goals
(`CourseGoal`), plans (`CoursePlan` + `CourseMilestone` — models exist,
plans are unused so far), a live known-word count per language
(`KnownWordStat.lower/upper`, updated automatically), and Anki review pace
(`AnkiReviewLog`). The original spec: picking a target like "Prepare for JLPT
N3" or "Reach 1,500 words" should produce a concrete training plan.

## Current state

- `CourseGoal` rows exist and vocab goals auto-track known words
  (`src/lib/known-words-sync.ts` → `recomputeKnownWordStats`)
- `CoursePlan.plan` is a JSON blob, never written; `CourseMilestone` only has
  seeded placeholder rows (`prisma/seed.ts`)
- Exam levels carry editable targets JSON: `{ targetVocab, targetKanji,
  targetGrammar, targetChars, targetScore }`
- Projections math (pace → date) already exists in
  `src/lib/anki-analytics.ts` (`projections()`) — reuse its style
- Course pages: `src/components/language-course.tsx`, `src/app/math/page.tsx`

## Task

1. **Plan generator (pure)** `src/lib/plan-gen.ts`: given a goal (exam level
   or vocab count), the current known-word bounds, exam-level targets, and
   recent pace (new cards introduced/day + maturation/day from
   `AnkiReviewLog`/`Attempt`), produce a `GeneratedPlan`:
   - phases (e.g. "close vocab gap: 1,240 words", "grammar coverage: 160
     points", "reading/listening blocks", "mock exam window")
   - weekly load suggestion (new words/day, review budget/day) and a
     projected completion date with a low-data confidence flag
   - milestones (ordered, with metric + targetValue) replacing the seeded
     placeholders when a plan is generated
2. **Goal → plan UI**: on Japanese/Chinese pages, a "Build training plan"
   action next to the exam tracks — pick an exam level (pill buttons) or a
   word target, preview the generated plan, save it (writes `CoursePlan` +
   milestones + activates the `CourseGoal` linked via `examLevelId`).
3. **Math target plan**: same idea from a roadmap target — reuse
   `pathToTarget` (`src/lib/roadmap.ts`) to produce an ordered node plan with
   a suggested nodes/month pace; save as `CoursePlan` for the math course.
4. Show the active plan on the course page (phase list, current milestone,
   projected date) — dense, read-only card.

## Verification / definition of done

- Vitest for `plan-gen.ts`: gap math from known-word bounds, pace fallbacks
  when no history (confidence 'low'), milestone ordering, exam-target
  extraction per level
- Live: generate an HSK 4 plan (current zh known words ≈134 → gap ≈3,111),
  confirm plan + milestones persist and render on the Chinese page; generate
  a math plan for Iwasawa Theory (uses completed-node state)
- `npm test` and `npm run build` clean

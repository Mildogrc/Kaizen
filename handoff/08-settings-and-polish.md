# 08 — Settings, completion tracking, and UX debts

## Context

Hyperlearning (repo `/Users/milindc/gitrepos/Kaizen`; see `handoff.md`).
A collection of smaller finishing tasks — each independent, all low-risk.

## Current state / tasks

1. **Editable settings** (`src/app/settings/page.tsx` is read-only): make
   `User.settings` JSON editable — daily new-card cap (used in
   `src/app/review/page.tsx` as `NEW_PER_SESSION` and `newCardCap` in
   `src/lib/daily.ts` — wire both to the setting instead of constants),
   review cap, default study mode (Daily Study should default to it instead
   of 'balanced'). Server action + form, no client state needed.
2. **Milestone completion**: `CourseMilestone.completedAt` exists but nothing
   sets it — add a toggle on the milestone list (language-course.tsx) and
   auto-complete vocab milestones when the known-word lower bound crosses
   `targetValue` (hook in `recomputeKnownWordStats`,
   `src/lib/known-words-sync.ts`).
3. **Exam objective tracking**: `ExamObjective.completed` exists, no UI —
   expandable exam-level rows on course pages listing objectives with
   checkboxes.
4. **Review page course filter**: pill-button row to scope a session to one
   course (`/review?course=math`) — filter both queries in
   `src/app/review/page.tsx`.
5. **Leech → mistake bridge**: "log as mistake" button on Analytics leech
   rows (creates a `Mistake` with category 'leech', courseId from mapping).
6. **Empty-state consistency pass**: Japanese/Chinese pages with zero content
   should point at the import flow + LLM prompts (some do, verify all tabs).
7. **Nav ordering sanity**: 14 items now — group visually with two hairline
   separators (study: Daily/Review/Mistakes; data: Import/Anki/Words;
   meta: Analytics/Settings). Pure CSS in `src/components/nav.tsx`.
8. **Preview stability note**: Turbopack has twice needed `.next` deleted
   after adding new files; if it recurs, pin or add a `predev` clean script.

Honor the stored user preferences: pill buttons over dropdowns; the math
roadmap stays a tree.

## Verification / definition of done

- Settings edits persist and demonstrably change review/new-card behavior
  (set cap to 5 → session takes 5 new)
- Milestone auto-completes when crossing its target (fake it by lowering a
  milestone target below the current count)
- Objectives check/uncheck; review filter works; leech→mistake appears in
  /mistakes
- `npm test` + `npm run build` clean; quick browser pass over every nav tab

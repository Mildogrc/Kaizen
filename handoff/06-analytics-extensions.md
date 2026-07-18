# 06 — Analytics extensions (in-app reviews, weak areas, study time)

## Context

Hyperlearning (repo `/Users/milindc/gitrepos/Kaizen`; see `handoff.md`). The
Analytics page (`src/app/analytics/page.tsx`) is currently **Anki-only**: it
renders per-course sections from `AnkiCardSnapshot`/`AnkiReviewLog` via pure
functions in `src/lib/anki-analytics.ts` and charts in
`src/components/anki-charts.tsx`. Meanwhile the in-app SM-2 system
accumulates its own history in `Attempt` + `ReviewRecord` (flashcards AND
practice items), and `Mistake` rows carry categories — none of it visualized.

## Current state

- `Attempt`: rating, correct, timeMs (mostly null today), createdAt,
  flashcardId/practiceItemId; `ReviewRecord`: ease/interval/maturity/leech
- The Anki analytics functions take plain row shapes — they are reusable if
  in-app rows are mapped to the same `LogRow`/`SnapshotRow` interfaces
  (ratings 1–4 ↔ AGAIN..EASY; intervalBefore/After exist on the SRS side
  only implicitly — extend `rateFlashcard` in `src/lib/actions.ts` to write
  interval-before/after onto the Attempt so retention math works)
- Charts available: heatmap, Bars, StateBar, BandLine
- `StudySession` model exists but nothing writes it

## Task

1. **In-app analytics section** on the Analytics page (below the Anki
   sections, one block per course with in-app cards): reuse
   `anki-analytics.ts` functions by adapting `Attempt`→`LogRow` and
   `ReviewRecord`→`SnapshotRow` in a new `src/lib/inapp-analytics-data.ts`.
   Requires persisting interval-before/after + rating on Attempt (small
   migration: add `intervalBeforeDays`/`intervalAfterDays` Float columns).
2. **Weak-area detection**: per course, group failures by dimension —
   flashcard metadata rule name, practice type, mistake category, and (for
   Anki) leech density per deck — rank the worst 5 with failure rates.
   Render as a compact "Weak areas" card per course; pure function + tests.
3. **Study time**: record session time — the review session already tracks
   per-card elapsed implicitly; capture `timeMs` per rating in
   `session.tsx` (Date.now diff between reveal and rate) and pass through
   `rateFlashcard`. Add minutes/day to the in-app activity chart tooltip.
4. **Dashboard**: "weak areas" stat becomes real (worst area name), and the
   weekly-progress line: reviews this week vs last (Anki + in-app combined).

## Verification / definition of done

- Vitest for the weak-area ranking (ties, empty data) and the Attempt→LogRow
  adapter
- Live: rate ~10 NATO cards with a mix of Again/Good → in-app section shows
  the session in the heatmap/day bars, retention numbers move, weak area
  shows the rule with the most Agains; timeMs lands in Attempt rows (psql)
- `npm test` + `npm run build` clean

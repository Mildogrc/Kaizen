# 02 — Book → flashcard flow + reading progress

## Context

Hyperlearning (repo `/Users/milindc/gitrepos/Kaizen`; see `handoff.md`).
Books live in `Book`/`BookNote` (10 note kinds, `remember: Boolean` flag,
`pageCount` on Book). `Flashcard` has an optional `bookNoteId` relation
already in the schema. The daily queue (`src/lib/daily.ts`) already surfaces
"Convert 'remember' book notes: N" linking to /books — but conversion doesn't
exist yet.

## Current state

- Books UI: `src/app/books/page.tsx`, `src/app/books/[id]/page.tsx`
  (add/edit/notes/remember toggle); actions in `src/lib/actions.ts`
- Card creation pattern to copy: `generateCourseCards` in
  `src/lib/actions.ts` (creates `Flashcard` with `review: { create: {} }` so
  it enters the SM-2 queue); books belong to the `books` course
  (`prisma.course.findUnique({ where: { slug: 'books' } })`)
- Review session (`src/app/review/session.tsx`) renders card
  metadata generically — plain front/back works out of the box
- Daily queue counts pending notes via
  `bookNote.count({ where: { remember: true, flashcards: { none: {} } } })`

## Task

1. **Convert-to-flashcard**: on the book detail page, each remembered note
   gets a "→ flashcard" action, plus a book-level "Convert all remembered
   notes (N)" button. Card synthesis by note kind:
   - QUOTE: front "Who/where is this from? …quote…" → back book + context;
     or front the quote prompt, back the source — keep it simple: front =
     note content trimmed, back = book title + kind + location
   - DEFINITION/FORMULA: front = "Define: <first line>" → back = rest
   - default: front = "From <book>: recall…" prompt, back = note content
   Link via `bookNoteId`, course = books, `review: { create: {} }`.
   Idempotent: skip notes that already have a flashcard.
2. **Un-convert / cleanup**: deleting the note cascades nothing today —
   decide: deleting a note with cards should delete its generated cards
   (change relation to Cascade in a migration) — do that.
3. **Reading progress**: Book gets `currentPage Int?`; detail page shows a
   progress bar (currentPage/pageCount) with a quick-update field; Books
   index shows % on cards; dashboard "Books reading" hint shows average %.
4. Books tab counts ("remember items") should split converted vs pending.

## Verification / definition of done

- Convert the two seeded Gödel, Escher, Bach remembered notes → they appear
  in /review as due NEW cards and the daily-queue books block drops to 0
- Re-clicking convert creates nothing new; deleting a note removes its card
- Progress bar renders and persists (set 777-page GEB to page 300 ≈ 39%)
- `npm test` + `npm run build` clean; add a small vitest for the note→card
  synthesis mapping (pure function in `src/lib/book-cards.ts`)

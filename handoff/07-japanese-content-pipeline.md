# 07 — Japanese content pipeline

## Context

Hyperlearning (repo `/Users/milindc/gitrepos/Kaizen`; see `handoff.md`). The
Japanese course has full scaffolding — 5 schemas (vocabulary, grammar, kanji,
sentence, pitch accent in `prisma/seed-data/schemas.ts`), JLPT/BJT/Kanji
Kentei exam tracks, LLM generation prompts per schema — but essentially **no
content** (2 test vocabulary items). The user owns Japanese Anki decks
("RTK1 Kanji - Reversed Recognition", "Graveyard::RTK1 Kanji" visible in
their collection) and studies with Migaku (Japanese known words import
already works).

## Current state

- Import pipeline ready: `/import` (JSON, schema-validated), per-schema LLM
  prompt downloads; card generation from schema rules works (`⚡ Generate
  cards` on the Japanese page — skips Anki-mapped subsections automatically)
- Anki tab can map Japanese decks to japanese/subsections; known-words
  extraction handles ja via kuromoji (`src/lib/known-words-sync.ts`)
- The Words page counts ja words from Migaku already

## Task

1. **Seed JLPT N5 starter content** the honest way: generate it with the
   existing per-schema prompts (do NOT hand-invent readings). Produce and
   commit JSON files under `prisma/seed-data/content/` for: ~100 N5
   vocabulary items, ~30 N5 grammar points, ~50 N5 kanji — then wire a
   `scripts/import-content.ts` (reuse `runImport`'s validation path, not a
   parallel loader) so `npm run db:seed-content` loads them. Accuracy beats
   volume; verify a sample against JLPT lists before committing.
2. **Map Japanese Anki decks**: with the user's Anki running, offer mapping
   of the RTK1 deck → Japanese / Japanese Kanji in the Anki tab (this is a
   user action — document it in the PR/summary rather than forcing it).
   Kanji-deck fronts are single characters: confirm known-words extraction
   either skips them (kanji ≠ words) — add a per-mapping "counts words"
   default OFF for kanji subsections, or leave the existing toggle and note
   it.
3. **Pitch accent content**: the JapanesePitchAccentItem schema exists —
   generate a starter set (~50 common minimal pairs / core words) via its
   LLM prompt, same JSON-file + seed-content path.
4. **Japanese page polish**: exam-track chips could show per-level content
   coverage (items tagged jlptLevel vs target counts) — a small coverage bar
   per level using existing `targets` JSON.

## Verification / definition of done

- `npm run db:seed-content` is idempotent (re-run adds nothing) and all
  items pass schema validation during load (fail loudly otherwise)
- Live: Japanese page shows content-database counts; Generate cards produces
  recognition+production cards; a review session serves them; N5 coverage
  bar reflects imported counts
- Spot-check 10 vocabulary readings against a trusted JLPT N5 list — zero
  errors tolerated (wrong readings poison SRS)
- `npm test` + `npm run build` clean

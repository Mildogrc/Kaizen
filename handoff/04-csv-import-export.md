# 04 — CSV import with column mapping + export suite

## Context

Hyperlearning (repo `/Users/milindc/gitrepos/Kaizen`; see `handoff.md`). The
import page (`src/app/import/`) currently accepts **JSON only**, validated by
Zod validators built from schema fields (`src/lib/schema-zod.ts` →
`validateItems`, used by `runImport` in `src/lib/actions.ts`). Schema JSON
export exists per schema (`buildSchemaExport` in
`src/lib/schema-serialize.ts`, shown on `/schemas/[slug]`). The spec's
remaining items: CSV import with column mapping, plus course export and full
data export.

## Current state

- Import flow UI: `src/app/import/import-form.tsx` — 4 steps (area → content
  type → LLM prompt → paste JSON → validate/preview/save)
- A tolerant CSV line splitter already exists in `src/lib/known-words.ts`
  (`splitCsvLine`) — lift it into a shared util rather than duplicating
- `ImportBatch` records format ('json' today), counts, errors

## Task

1. **CSV parsing + mapping**: when pasted/uploaded content parses as CSV
   (header row), show a mapping table: each schema field (from the selected
   schema version) with a column selector (pill buttons per the UI
   preference; columns auto-matched by name/label first). Unmapped optional
   fields skip; unmapped required fields block. Typed coercion per fieldType:
   NUMBER → Number(), BOOLEAN → true/false/1/0/yes/no, LIST → split on `;`
   or `|`, ENUM → exact match after trim (case-insensitive match maps to the
   canonical option).
2. Convert mapped rows to plain objects and feed the **existing**
   `validateItems` pipeline unchanged (preview, errors with row indices,
   commit as `ImportBatch{format:'csv'}`).
3. **Course export**: on each course page header, "Export course (.json)" —
   route handler streaming `{course, goals, milestones, schemas(+versions,
   fields), learningItems}` as attachment. Reuse `buildSchemaExport`.
4. **Full data export**: Settings page button → one JSON file of every
   domain table (exclude Anki snapshots/logs — they're re-syncable — but
   include mappings). Include schema version numbers for future import.
5. (Optional if quick) **Course import**: accept the course export file on
   the import page as a special "restore course" path.

## Verification / definition of done

- Vitest: CSV → object mapping (coercions, list splitting, enum
  normalization, required-column blocking); reuse fixtures with quoted cells
- Live: import a 3-row CSV of Japanese vocabulary with deliberately misnamed
  headers → map columns manually → 2 valid + 1 enum error → save 2; export
  the Chinese course and eyeball the JSON (1000 items, schemas embedded)
- `npm test` + `npm run build` clean

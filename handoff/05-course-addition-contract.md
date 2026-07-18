# 05 — Course Addition Contract (course-level LLM bundle)

## Context

Hyperlearning (repo `/Users/milindc/gitrepos/Kaizen`; see `handoff.md`).
Per-schema LLM prompts already exist: `src/lib/llm-prompt.ts`
(`buildLlmPromptMd`) renders a markdown contract for ONE schema (field spec
table, valid/invalid examples, output rules), served by
`src/app/schemas/[slug]/prompt/route.ts` and surfaced in the import flow.
The original spec wants a **Course Addition Contract**: one copyable document
for a whole course that tells a cheaper LLM everything — what course is being
added, all its schemas, how many items to generate, what not to include, and
that it must return only valid JSON.

## Current state

- Schema designer wizard: `src/app/schemas/new/wizard.tsx` (10-question
  flow, creates course + schema + fields via `createSchemaWithCourse` in
  `src/lib/actions.ts`; captures target/exam/date, practice modes,
  completion criteria, llmPrompt)
- Course metadata JSON already stores `{exam, targetDate}` for wizard-created
  courses
- Download/copy pattern: `copy-button.tsx` + markdown route handlers

## Task

1. **Contract builder** `src/lib/course-contract.ts` (pure): given a course
   with goals + all schemas (latest versions incl. fields/config), emit one
   markdown document:
   - course intro (name, category, target, exam, target date, completion
     criteria)
   - global output rules (single JSON object keyed by schema slug, each an
     array; no markdown fences; unknown keys rejected; per-schema counts)
   - per-schema sections reusing `buildLlmPromptMd`'s field-table logic
     (refactor its field-spec renderer into an exported helper rather than
     duplicating)
   - a combined valid example + one invalid example with the reason
   - suggested generation counts: pull from goal targetValue when present,
     else a `<N>` placeholder the user fills in
2. **Route** `src/app/courses/[slug]/contract/route.ts` (or hang it off the
   course pages) returning the .md as attachment.
3. **UI**: "Copy Course Generation Prompt" + download buttons on the course
   pages (header next to Generate cards) and in the schema designer's
   post-create screen. The import page's step 3 gains a "whole course
   contract" link when the course has >1 schema.
4. The import flow must accept the contract's combined shape: a JSON object
   `{ "<schema-slug>": [items…] }` — extend `runImport` to detect an object
   of arrays and validate/save each slug against its schema (per-slug
   summaries).

## Verification / definition of done

- Vitest: contract renders all schemas for a multi-schema course; combined
  import shape validates per-slug and reports per-slug errors
- Live: download the Japanese course contract (5 schemas), paste a
  hand-crafted combined JSON with one valid vocab item + one invalid grammar
  item → preview shows per-slug results, save persists only the valid item
- `npm test` + `npm run build` clean

# Adaptive Japanese Anki New-Card Budget

## Status

Implemented and verified locally on 2026-09-23. This document reflects the final architecture.

## Existing Hyperlearning integration

- Hyperlearning talks to local Anki Desktop through AnkiConnect API v6 at `127.0.0.1:8765`.
- `src/lib/anki-connect.ts` is the typed transport boundary. It already supports deck discovery, card snapshots, review logs, and note creation.
- `src/lib/anki-sync.ts` syncs explicitly mapped decks into Postgres. It upserts card state and appends Anki revlog rows without modifying Anki scheduling.
- `AnkiDeckMapping` associates a deck with a course and optional content schema. Japanese vocabulary cannot currently be inferred safely from every course-level mapping, so adaptive-budget participation will be an explicit mapping flag.
- Existing revlog storage contains rating, intervals, and response time, but discards Anki's review `type`. The adaptive feature needs that field to distinguish review-card recall from learning/relearning repetitions, so a nullable `reviewType` column will be added. Historical rows remain untouched.
- User-facing settings are stored in `User.settings`; durable operational state and history use Prisma/Postgres.
- The existing vocabulary frequency rank is content metadata and Anki's own new-card order determines which eligible cards are shown. This feature limits only how many new cards appear; it does not reorder or reschedule them.

## Research findings

Research was performed against the current stable Anki release available on 2026-09-23 (Anki 26.09.2), Anki's current manual/source, and the current AnkiConnect source checkout (`de6e6e1b8aaf4ae195eb1d1ff6db5409b99b2a3e`, 2025-12-05).

Primary sources:

- [Anki 26.09.2 release](https://github.com/ankitects/anki/releases/tag/26.09.2)
- [Anki deck options and daily limits](https://docs.ankiweb.net/deck-options.html#daily-limits)
- [Anki statistics and true retention](https://docs.ankiweb.net/stats.html#true-retention-table)
- [Anki preferences and 4 AM default day boundary](https://docs.ankiweb.net/preferences.html#scheduler)
- [Anki FSRS FAQ](https://docs.ankiweb.net/faqs/frequently-asked-questions-about-fsrs.html)
- [Anki scheduler explanation](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm.html#fsrs)
- [Anki deck limit protobuf](https://github.com/ankitects/anki/blob/main/proto/anki/deck_config.proto)
- [Anki deck storage protobuf](https://github.com/ankitects/anki/blob/main/proto/anki/decks.proto)
- [AnkiConnect current repository](https://git.sr.ht/~foosoft/anki-connect)
- [AnkiConnect API documentation mirror](https://github.com/cjappl/anki-connect/blob/master/README.md)

Findings:

- Anki supports preset, per-deck, and temporary **Today only** new-card limits. The internal data model has `new_limit_today`, and the scheduler exposes timing/limit operations to Anki itself.
- Standard AnkiConnect does **not** expose Anki's today-only deck limit or scheduler `ExtendLimits`. Its supported deck mutation APIs are `getDeckConfig`, `saveDeckConfig`, `cloneDeckConfigId`, and `setDeckConfigId`.
- `saveDeckConfig` modifies a preset. Presets may be shared by unrelated decks, so modifying the existing preset directly is unsafe.
- The safest supported AnkiConnect fallback is to clone the selected deck's preset once, assign the clone only to that mapped vocabulary deck, and change only `new.perDay` on the managed clone. This does not modify FSRS parameters or card intervals. It is not a true today-only override; the most recently applied conservative budget remains in place if Hyperlearning is offline.
- Anki's true-retention definition counts only the first review of a card per day; Again is failure and Hard/Good/Easy are passes. A single day is noisy, so this controller aggregates recent reliable days.
- A lapse is an Again response on a review card. A raw lapse rate therefore substantially duplicates true-retention failure rate. The separate lapse signal will measure **repeated lapsers**: cards failed on at least two distinct days in the recent window.
- FSRS does not prescribe an optimal number of new cards per day and remains responsible for scheduling review intervals. Anki recommends reducing/stopping new cards when review backlog exists, and notes that roughly 20 new cards/day can create roughly 200 daily reviews.
- Anki's default day boundary is 4 AM and is user-configurable. AnkiConnect does not expose the configured cutoff directly. Hyperlearning will expose a matching day-start-hour setting, defaulting to 4.

## Scope and deck selection

- Only mapped decks explicitly marked **Adaptive Japanese vocabulary** participate.
- The mapping must belong to the Japanese course. Other courses, grammar decks, RTK/kanji decks, and unselected Japanese decks are excluded.
- Multiple selected decks are supported. The total daily budget is distributed proportionally to each deck's available new cards, with deterministic largest-remainder allocation. The allocations sum to at most the daily budget.
- Card choice inside each deck remains Anki's responsibility, preserving existing due positions, gather order, and any frequency-based ordering.

## Persistent architecture

1. **Anki sync** imports snapshots and complete review tuples, including review type.
2. **Evidence extraction** groups only post-activation revlogs into configured Anki days.
3. **Daily evidence records** persist review observations, true retention inputs, time, completed/due counts, and reliability.
4. **Pure controller** calculates a performance target, confidence ceiling, completion/backlog protection, and final budget.
5. **Budget history** persists the complete explainable decision once per Anki day.
6. **Anki application service** isolates selected decks with managed presets and applies each deck allocation.
7. **UI** exposes settings, target-deck toggles, today's decision, explanations, history, reset, and application errors.

The controller runs after every successful manual/automatic sync. Opening the Anki page also triggers the existing at-most-hourly automatic sync, and bypasses that hourly throttle when the current Anki day does not yet have a stored adaptive decision.

Operational state is separate from Anki history. No Anki cards, revlogs, FSRS parameters, due dates, intervals, or scheduling history are deleted or rewritten.

## Configuration defaults

- Enabled: `false`
- Starting budget: `10`
- Maximum budget: `40`
- Cold-start protection: `true`
- Target maximum review time: `60 minutes/day`
- Anki day start hour: `4`
- Evidence window: latest `7` reliable days
- Minimum review observations for a reliable day: `20`
- Minimum valid response-time coverage: `80%`
- Minimum evidence before an increase: `3` reliable days with completion measurements

Internal thresholds are centralized in one configuration module rather than scattered through UI/service code.

## Evidence definitions

All controller evidence must be timestamped on or after `activatedAt`. Importing old revlogs after activation does not make them trustworthy because their original review timestamps remain before the baseline.

### Anki day

The day key is the local calendar date after shifting by the configured Anki day-start hour. The default 4 AM matches Anki's default. If the user's Anki preference differs, the Hyperlearning setting must be changed to match.

### True-retention observation

- Keep the earliest `reviewType = 1` review for each vocabulary card on each Anki day.
- Again (`rating = 1`) is failure; Hard/Good/Easy are passes.
- Learning (`type = 0`), relearning (`type = 2`), filtered/cram (`type = 3`), and manual operations are excluded from retention.

### Reliable data day

A completed Anki day is reliable when:

- it is strictly after the activation day;
- the latest deck sync succeeded;
- it contains at least 20 first review-card observations across selected vocabulary decks; and
- at least 80% of those observations have positive, valid response times.

Calendar days with no use, failed syncs, missing revlog data, or only a handful of reviews do not increase confidence. Poor but sufficiently observed performance is still reliable evidence and can reduce the budget.

### Completion

At calculation time, Hyperlearning records the selected decks' due/overdue scheduled-card count. To tolerate calculation after some reviews were already completed, today's unique scheduled cards already reviewed are added back into the baseline. The following day, unique completed scheduled cards are divided by that baseline. Completion is a conservative operational proxy; AnkiConnect does not expose a historical per-deck "due at start of day" series.

### Review time

Daily review minutes are the sum of valid `timeMs` values for all selected-deck revlog events, including learning/relearning repetitions. The controller uses the median across the recent evidence window to limit outlier impact.

### Repeated-lapse signal

Across the recent reliable window:

`repeat_lapse_rate = cards failed on 2+ distinct days / unique review cards`

This is intentionally different from raw failure rate so retention and lapse penalties do not count the exact same event twice.

## Final controller

The confidence ramp remains the proposed conservative policy because neither Anki nor FSRS prescribes a new-card ramp, and it satisfies the invariant that sparse data cannot rapidly increase workload:

`confidence_ceiling = min(max_budget, starting_budget + 2 * floor(reliable_data_days / 7))`

When cold-start protection is disabled, the ceiling is `max_budget`.

Retention adjustment over the latest seven reliable days:

- `>= 94%`: `+3`
- `>= 91%`: `+2`
- `>= 87%`: `0`
- `>= 82%`: `-3`
- `< 82%`: `-6`

These bands are kept around FSRS's 90% default target, but are applied to a multi-day aggregate rather than a single noisy day.

Review-time adjustment is relative to the configurable target `T` (default 60 minutes):

- `< 0.5T`: `+2`
- `0.5T–T`: `0`
- `T–1.5T`: `-2`
- `> 1.5T`: `-5`

Repeated-lapse adjustment:

- `< 10%`: `0`
- `10–15%`: `-2`
- `15–20%`: `-4`
- `>= 20%`: `-7`

Core calculation:

`performance_target = clamp(previous_budget + retention_adjustment + time_adjustment + lapse_adjustment, 0, max_budget)`

- If the target is above the previous budget, apply the confidence ceiling.
- Reductions are never blocked by the confidence ceiling.
- Until at least three reliable completion observations exist, increases are blocked.
- If rolling completion is below 95%, increases are blocked.

Backlog protection uses recent median unique completed review cards as a personalized one-day workload unit:

- Moderate backlog: overdue cards are at least one normal day of reviews (minimum 10). Cap at half the previous budget.
- Serious backlog: overdue cards are at least two normal days of reviews (minimum 20). Set budget to `0`.

This relative rule is more defensible than a single arbitrary card count and follows Anki's recommendation to stop new cards when an overdue backlog is substantial.

## Once-per-day behavior

- `(userId, ankiDay)` is unique in budget history.
- The first successful calculation creates the day's decision. Subsequent starts/syncs reuse it.
- A failed Anki application may retry the same stored allocation; it does not recalculate the budget.
- Today's reviews affect tomorrow's calculation, never today's already-issued allowance.

## Applying the limit to Anki

For each selected mapping:

1. Read its current preset with `getDeckConfig`.
2. On first management, clone that preset with `cloneDeckConfigId` using a Hyperlearning-specific name.
3. Assign only the selected deck to the clone with `setDeckConfigId`.
4. Change only `config.new.perDay` and save with `saveDeckConfig`.
5. Persist original and managed preset IDs.

If a user manually moves the deck to another preset, Hyperlearning detects the mismatch and refuses to overwrite the new preset. Disabling the feature restores the original preset when Anki is next reachable and the deck still uses the managed preset.

## Failure behavior

- Anki/AnkiConnect unavailable: retain the stored budget, mark application failed, do not create evidence, do not increase confidence, and retry later.
- Missing/malformed data: exclude invalid rows and fail closed for increases.
- Concurrent starts: database uniqueness makes calculation idempotent.
- Manual preset change: report a conflict and do not mutate the user's replacement preset.
- Missing deck: mark that deck allocation failed; unrelated decks remain untouched.
- Nested deck names: resolve a uniquely matching `Parent::MappedName` before reading or changing its preset, matching the existing sync fallback behavior.
- Multiple selected decks: allocate deterministically and report per-deck results.
- Sync/backfill: old timestamps before activation remain excluded even if imported later.

## Reset behavior

Reset creates a fresh activation timestamp, returns current budget to the configured starting value, clears adaptive evidence/decision history, and resets reliable days. It does not delete Anki cards or review logs and does not alter FSRS scheduling history. Managed deck presets remain isolated and receive the reset starting budget.

## Decisions changed from the request

- **Raw lapse rate → repeated-lapse rate:** raw lapse rate duplicates true-retention failures; repeated lapses provide a distinct chronic-difficulty signal.
- **Absolute review-time thresholds → target-relative thresholds:** defaults reproduce 30/60/90 minutes, while a single workload setting keeps the controller coherent when customized.
- **Absolute backlog threshold → personalized days-of-work threshold:** scales to the learner's normal workload while retaining minimum floors.
- **Today-only override → isolated managed preset:** Anki supports today-only limits internally, but AnkiConnect exposes no supported action for them. Direct collection mutation is explicitly avoided.
- **Local midnight → configurable 4 AM boundary:** matches Anki's documented default and can be aligned with a customized Anki preference.

## Edge cases

- No selected vocabulary deck: calculate/persist nothing and show configuration guidance.
- No new cards: allocations can be lower than the calculated budget; this is recorded.
- A selected deck disappears: fail that allocation without touching other decks.
- A mapping is removed: restore its original Anki preset first. If restoration fails, keep the mapping and show an error rather than orphaning the managed preset.
- Feature disabled while Anki is offline: stop new calculations immediately and restore managed presets on the next successful sync.
- Response times of zero or implausible values: exclude from time coverage and totals.
- Activation near the day boundary: activation day is never counted as reliable.

## Implementation checklist

- [x] Add settings parser/defaults and centralized controller constants.
- [x] Add Prisma state, evidence, decision, deck-state, mapping flag, and review-type fields.
- [x] Add migration and regenerate Prisma client.
- [x] Extend AnkiConnect boundary for preset operations and new-card counts.
- [x] Preserve review type during sync.
- [x] Implement day grouping, evidence extraction, controller, allocation, and explainability.
- [x] Implement idempotent persistence/orchestration and sync hook.
- [x] Add settings, target-deck controls, status/history UI, and reset.
- [x] Add pure controller, day-boundary, allocation, concurrency-claim, and mocked integration tests.
- [x] Run migration validation, tests, lint, type checking, and production build.
- [x] Reconcile this document with the final implementation.

## Final implementation verification

- The additive migration was applied successfully to the local `hyperlearning` PostgreSQL database.
- The full test suite passes: 29 files and 183 tests at implementation time.
- ESLint passes without errors; one unrelated pre-existing warning remains in an output-generation script.
- TypeScript and the Next.js 16 production build pass.
- Same-day decisions are protected by the database's `(userId, ankiDay)` unique key. Applying a decision uses an atomic status claim; concurrent launches do not both modify Anki. Failed applications can retry the same stored decision, and abandoned `applying` claims become retryable after five minutes.
- A real preset mutation could not be tested because Anki Desktop/AnkiConnect was not reachable on `127.0.0.1:8765`. The boundary was verified with mocks against the researched AnkiConnect API contract.

## Testing strategy

- Pure unit tests for ramp, adjustments, completion gate, backlog protection, lower/upper bounds, day keys, evidence reliability, and deck allocation.
- Mocked Anki boundary tests for isolated preset creation, same-day reapplication behavior, config conflicts, unrelated decks, and connection errors.
- Persistence-oriented tests keep the controller deterministic and verify unique day decisions conceptually; Prisma schema/migration validation covers durable constraints.
- Existing Anki analytics/sync tests ensure backward compatibility.
- A real Anki mutation cannot be verified unless Anki Desktop with AnkiConnect is running. Final verification will clearly report whether that was available.

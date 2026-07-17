// Builds the "leech lesson plan" markdown prompt: a list of a deck's leech
// cards plus instructions for an external LLM to turn them into a short,
// focused lesson plan.

import type { SnapshotRow } from './anki-analytics';

export function buildLeechLessonPlanMd(input: {
  deckName: string;
  courseName: string;
  leeches: SnapshotRow[];
}): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const rows = input.leeches
    .map((c) => `| ${esc(c.front)} | ${esc(c.back)} | ${c.lapses} | ${c.intervalDays}d | ${c.ease.toFixed(2)} |`)
    .join('\n');

  return `# Leech lesson plan request — ${input.deckName}

These are my **leech cards** from the Anki deck "${input.deckName}" (course: ${input.courseName}).
A leech is a card I keep forgetting — each has lapsed many times despite repeated review.

## Your task

Build a **basic lesson plan** that helps me finally learn these items. Please:

1. Group the leeches by likely confusion pattern (similar-looking items, similar meanings, abstract usage, interference between pairs, etc.).
2. For each group, explain the distinction or memory hook that untangles it (mnemonics, example sentences, contrasts with the items I confuse them with).
3. End with a short daily practice plan (10–15 min/day for a week) that drills these items in mixed order, hardest first.
4. Keep it practical and concise — this is a study aid, not an essay.

## My leech cards (${input.leeches.length})

| card front | answer | lapses | current interval | ease |
|---|---|---|---|---|
${rows}

Notes: higher lapses = more forgotten. Low ease (≤1.5) means the scheduler already punishes the card heavily.
`;
}

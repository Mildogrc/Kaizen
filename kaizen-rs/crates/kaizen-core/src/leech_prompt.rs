//! The "leech lesson plan" prompt: a deck's leech cards plus instructions for
//! an LLM to turn them into a short, focused lesson plan.

use crate::anki_analytics::SnapshotRow;
use crate::util::to_fixed;

pub fn build_leech_lesson_plan_md(deck_name: &str, course_name: &str, leeches: &[SnapshotRow]) -> String {
    let esc = |s: &str| s.replace('|', "\\|");
    let rows = leeches
        .iter()
        .map(|c| {
            format!(
                "| {} | {} | {} | {}d | {} |",
                esc(&c.front),
                esc(&c.back),
                c.lapses,
                c.interval_days,
                to_fixed(c.ease, 2)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "# Leech lesson plan request — {deck_name}

These are my **leech cards** from the Anki deck \"{deck_name}\" (course: {course_name}).
A leech is a card I keep forgetting — each has lapsed many times despite repeated review.

## Your task

Build a **basic lesson plan** that helps me finally learn these items. Please:

1. Group the leeches by likely confusion pattern (similar-looking items, similar meanings, abstract usage, interference between pairs, etc.).
2. For each group, explain the distinction or memory hook that untangles it (mnemonics, example sentences, contrasts with the items I confuse them with).
3. End with a short daily practice plan (10–15 min/day for a week) that drills these items in mixed order, hardest first.
4. Keep it practical and concise — this is a study aid, not an essay.

## My leech cards ({count})

| card front | answer | lapses | current interval | ease |
|---|---|---|---|---|
{rows}

Notes: higher lapses = more forgotten. Low ease (≤1.5) means the scheduler already punishes the card heavily.
",
        count = leeches.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anki_analytics::CardState;

    #[test]
    fn escapes_pipes_and_lists_cards() {
        let card = SnapshotRow {
            anki_card_id: "1".into(),
            mapping_id: None,
            front: "a|b".into(),
            back: "c".into(),
            state: CardState::Young,
            interval_days: 3,
            ease: 1.3,
            due_at: None,
            reps: 9,
            lapses: 8,
            is_leech: true,
        };
        let md = build_leech_lesson_plan_md("Deck", "Chinese", &[card]);
        assert!(md.contains("| a\\|b | c | 8 | 3d | 1.30 |"));
        assert!(md.contains("## My leech cards (1)"));
    }
}

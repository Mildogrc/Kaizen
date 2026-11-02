//! Tracks: language profiles, level estimates, exam pacing, and coverage read
//! from a deck's tag tree. A new language or exam is data here, not a new page.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;

use crate::util::thousands;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageProfile {
    pub code: &'static str,
    pub name: &'static str,
    pub glyph: &'static str,
    /// The `lang` attribute for this language's content.
    pub lang: &'static str,
    pub rtl: bool,
    pub script: &'static str,
    pub reading_aid: Option<&'static str>,
    pub tones: Option<&'static str>,
    pub inflection: Option<&'static str>,
    pub character_repair: Option<&'static str>,
    pub framework: &'static str,
    /// (level, words a learner roughly needs), easiest first.
    pub levels: &'static [(&'static str, i64)],
}

const CEFR: [(&str, i64); 6] = [("A1", 500), ("A2", 1000), ("B1", 2000), ("B2", 4000), ("C1", 8000), ("C2", 16000)];

pub const LANGUAGES: [LanguageProfile; 5] = [
    LanguageProfile {
        code: "ja",
        name: "Japanese",
        glyph: "日",
        lang: "ja",
        rtl: false,
        script: "Kana and kanji",
        reading_aid: Some("Furigana"),
        tones: None,
        inflection: Some("verb forms"),
        character_repair: Some("kanji"),
        framework: "JLPT",
        levels: &[("N5", 800), ("N4", 1500), ("N3", 3750), ("N2", 6000), ("N1", 10000)],
    },
    LanguageProfile {
        code: "zh",
        name: "Chinese",
        glyph: "中",
        lang: "zh-Hans",
        rtl: false,
        script: "Hanzi",
        reading_aid: Some("Pinyin"),
        tones: Some("4 tones and neutral"),
        inflection: None,
        character_repair: Some("hanzi"),
        framework: "HSK",
        levels: &[
            ("HSK 1", 500),
            ("HSK 2", 1272),
            ("HSK 3", 2245),
            ("HSK 4", 3245),
            ("HSK 5", 4316),
            ("HSK 6", 5456),
            ("HSK 7", 7000),
            ("HSK 8", 9000),
            ("HSK 9", 11092),
        ],
    },
    LanguageProfile {
        code: "es",
        name: "Spanish",
        glyph: "ñ",
        lang: "es",
        rtl: false,
        script: "Latin",
        reading_aid: None,
        tones: None,
        inflection: Some("conjugation"),
        character_repair: None,
        framework: "CEFR",
        levels: &CEFR,
    },
    LanguageProfile {
        code: "ru",
        name: "Russian",
        glyph: "Я",
        lang: "ru",
        rtl: false,
        script: "Cyrillic",
        reading_aid: Some("Stress marks"),
        tones: None,
        inflection: Some("cases and aspect"),
        character_repair: None,
        framework: "CEFR",
        levels: &CEFR,
    },
    LanguageProfile {
        code: "ar",
        name: "Arabic",
        glyph: "ع",
        lang: "ar",
        rtl: true,
        script: "Arabic, right to left",
        reading_aid: Some("Harakat"),
        tones: None,
        inflection: Some("roots and patterns"),
        character_repair: None,
        framework: "CEFR (MSA)",
        levels: &CEFR,
    },
];

pub fn profile(code: &str) -> Option<&'static LanguageProfile> {
    LANGUAGES.iter().find(|p| p.code == code)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelEstimate {
    pub label: String,
    pub meaning: String,
    pub next_pct: f64,
}

/// "~B1" and how far into the next level: a level reads better than a count.
pub fn level_estimate(levels: &[(&str, i64)], words: i64) -> LevelEstimate {
    let reached = levels.iter().rfind(|(_, target)| words >= *target);
    let next = levels.iter().find(|(_, target)| words < *target);
    match (reached, next) {
        (_, None) => LevelEstimate {
            label: levels.last().map_or("Done".into(), |(name, _)| format!("~{name}")),
            meaning: "the top level of this framework".into(),
            next_pct: 100.0,
        },
        (reached, Some((name, target))) => {
            let pct = (words as f64 / *target as f64 * 100.0).min(100.0);
            LevelEstimate {
                label: reached.map_or_else(|| format!("Starting {name}"), |(r, _)| format!("~{r}")),
                meaning: format!("{}% of {name} words known", pct.round()),
                next_pct: pct,
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LadderRung {
    pub label: String,
    pub primary: f64,
    pub complete: bool,
    pub current: bool,
}

pub fn ladder(levels: &[(&str, i64)], words: i64) -> Vec<LadderRung> {
    let current = levels.iter().position(|(_, target)| words < *target);
    levels
        .iter()
        .enumerate()
        .map(|(i, (name, target))| LadderRung {
            label: (*name).into(),
            primary: (words as f64 / *target as f64 * 100.0).min(100.0),
            complete: words >= *target,
            current: current == Some(i),
        })
        .collect()
}

/// New cards a day needed to meet an exam date.
pub fn new_per_day(cards_left: i64, days_left: i64) -> Option<i64> {
    (cards_left > 0 && days_left > 0).then(|| (cards_left + days_left - 1) / days_left)
}

pub fn review_minutes(cards: i64, avg_ms: Option<f64>) -> i64 {
    let seconds = avg_ms.filter(|ms| *ms > 0.0).map_or(8.0, |ms| ms / 1000.0);
    (cards as f64 * seconds / 60.0).ceil() as i64
}

/// "40 min", "1 h 10 min", rounded the way a person would say it.
pub fn spoken_time(minutes: i64) -> String {
    match minutes {
        m if m < 60 => format!("{} min", m.max(1)),
        m if m % 60 == 0 => format!("{} h", m / 60),
        m if m < 600 => format!("{} h {} min", m / 60, m % 60),
        m => format!("{} h", (m + 30) / 60),
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseStep {
    pub headline: String,
    pub meaning: String,
    pub progress: f64,
}

/// "Lecture 8 next · 17 left · about 4 h" from a playlist's position.
pub fn course_step(position: i64, total: i64, completed: i64, seconds_left: i64) -> CourseStep {
    if total > 0 && completed >= total {
        return CourseStep { headline: "Finished".into(), meaning: format!("all {total} lectures watched"), progress: 100.0 };
    }
    let left = (total - position).max(0);
    let time = if seconds_left > 0 { format!(" · about {}", spoken_time(seconds_left / 60)) } else { String::new() };
    CourseStep {
        headline: format!("Lecture {} next", position + 1),
        meaning: format!("{} left{time}", thousands(left)),
        progress: if total > 0 { position as f64 / total as f64 * 100.0 } else { 0.0 },
    }
}

// ------------------------------------------------------------- tag tree

#[derive(Clone, Debug)]
pub struct TaggedCard {
    pub tags: Vec<String>,
    pub suspended: bool,
    pub mature: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageRow {
    pub name: String,
    pub tag: String,
    pub total: i64,
    pub unlocked: i64,
    pub mature: i64,
    pub unlocked_pct: f64,
    pub mature_pct: f64,
}

fn child_under<'a>(tag: &'a str, root: &str) -> Option<&'a str> {
    let rest = if root.is_empty() { tag } else { tag.strip_prefix(root)?.strip_prefix("::")? };
    (!rest.is_empty()).then(|| rest.split("::").next().unwrap_or(rest))
}

fn join(root: &str, child: &str) -> String {
    if root.is_empty() { child.to_string() } else { format!("{root}::{child}") }
}

pub fn pretty_segment(segment: &str) -> String {
    segment.trim_start_matches(['#', '$', '^']).replace('_', " ").trim().to_string()
}

/// "Renal › Nephritic syndromes": the last two levels, which is what a learner recognises.
pub fn tag_label(tag: &str) -> String {
    let parts: Vec<String> = tag.split("::").map(pretty_segment).collect();
    parts[parts.len().saturating_sub(2)..].join(" › ")
}

/// One bar per child of `root`. Each card counts once per child.
pub fn coverage(cards: &[TaggedCard], root: &str, limit: usize) -> Vec<CoverageRow> {
    let mut rows: BTreeMap<String, (i64, i64, i64)> = BTreeMap::new();
    for card in cards {
        let mut children: Vec<&str> = card.tags.iter().filter_map(|t| child_under(t, root)).collect();
        children.sort_unstable();
        children.dedup();
        for child in children {
            let row = rows.entry(child.to_string()).or_default();
            row.0 += 1;
            row.1 += i64::from(!card.suspended);
            row.2 += i64::from(card.mature);
        }
    }
    let mut out: Vec<CoverageRow> = rows
        .into_iter()
        .map(|(child, (total, unlocked, mature))| CoverageRow {
            name: pretty_segment(&child),
            tag: join(root, &child),
            total,
            unlocked,
            mature,
            unlocked_pct: unlocked as f64 / total as f64 * 100.0,
            mature_pct: mature as f64 / total as f64 * 100.0,
        })
        .collect();
    out.sort_by_key(|r| std::cmp::Reverse(r.total));
    out.truncate(limit);
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// The tag levels worth grouping by: prefixes that branch, biggest first.
pub fn tag_roots(cards: &[TaggedCard], limit: usize) -> Vec<String> {
    let mut children: HashMap<String, std::collections::HashSet<&str>> = HashMap::new();
    let mut counts: HashMap<String, i64> = HashMap::new();
    for card in cards {
        for tag in &card.tags {
            let parts: Vec<&str> = tag.split("::").collect();
            for depth in 0..parts.len().saturating_sub(1).min(3) {
                let prefix = parts[..=depth].join("::");
                children.entry(prefix.clone()).or_default().insert(parts[depth + 1]);
                *counts.entry(prefix).or_default() += 1;
            }
        }
    }
    let mut roots: Vec<String> = children.into_iter().filter(|(_, c)| c.len() >= 2).map(|(prefix, _)| prefix).collect();
    roots.sort_by_key(|r| (std::cmp::Reverse(counts.get(r).copied().unwrap_or(0)), r.clone()));
    roots.truncate(limit);
    roots
}

#[derive(Clone, Debug)]
pub struct ReviewedCard {
    pub tags: Vec<String>,
    pub passed: i64,
    pub total: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeakTag {
    pub tag: String,
    pub label: String,
    pub remembering_pct: i64,
    pub cards: i64,
}

/// Lowest-recall tags this week. Tags with too few reviews say nothing.
pub fn weak_tags(cards: &[ReviewedCard], min_reviews: i64, limit: usize) -> Vec<WeakTag> {
    let mut by_tag: HashMap<&str, (i64, i64, i64)> = HashMap::new();
    for card in cards {
        for tag in &card.tags {
            let row = by_tag.entry(tag).or_default();
            row.0 += card.passed;
            row.1 += card.total;
            row.2 += 1;
        }
    }
    let mut out: Vec<WeakTag> = by_tag
        .into_iter()
        .filter(|(tag, (_, total, _))| *total >= min_reviews && *tag != "leech" && !tag.starts_with("concept::"))
        .map(|(tag, (passed, total, count))| WeakTag {
            tag: tag.to_string(),
            label: tag_label(tag),
            remembering_pct: (passed as f64 / total as f64 * 100.0).round() as i64,
            cards: count,
        })
        .filter(|w| w.remembering_pct < 90)
        .collect();
    out.sort_by(|a, b| a.remembering_pct.cmp(&b.remembering_pct).then_with(|| a.tag.cmp(&b.tag)));
    out.truncate(limit);
    out
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagMatch {
    pub tag: String,
    pub label: String,
    pub waiting: i64,
    pub total: i64,
}

/// Tags matching every word of a search, with how many cards are still suspended.
pub fn search_tags(cards: &[TaggedCard], query: &str, limit: usize) -> Vec<TagMatch> {
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(str::to_string).collect();
    if words.is_empty() {
        return vec![];
    }
    let mut hits: HashMap<&str, (i64, i64)> = HashMap::new();
    for card in cards {
        for tag in &card.tags {
            let lower = tag.to_lowercase().replace('_', " ");
            if words.iter().all(|w| lower.contains(w.as_str())) {
                let row = hits.entry(tag).or_default();
                row.0 += i64::from(card.suspended);
                row.1 += 1;
            }
        }
    }
    let mut out: Vec<TagMatch> = hits
        .into_iter()
        .map(|(tag, (waiting, total))| TagMatch { tag: tag.to_string(), label: tag_label(tag), waiting, total })
        .collect();
    out.sort_by(|a, b| b.waiting.cmp(&a.waiting).then_with(|| a.tag.cmp(&b.tag)));
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(tags: &[&str], suspended: bool, mature: bool) -> TaggedCard {
        TaggedCard { tags: tags.iter().map(|t| t.to_string()).collect(), suspended, mature }
    }

    #[test]
    fn levels_read_as_levels() {
        let ru = profile("ru").unwrap();
        assert_eq!(level_estimate(ru.levels, 200).label, "Starting A1");
        let b1 = level_estimate(ru.levels, 2000);
        assert_eq!(b1.label, "~B1");
        assert_eq!(b1.meaning, "50% of B2 words known");
        assert_eq!(level_estimate(ru.levels, 20000).label, "~C2");
    }

    #[test]
    fn ladder_marks_the_current_rung() {
        let rungs = ladder(profile("es").unwrap().levels, 1200);
        assert!(rungs[1].complete && !rungs[1].current);
        assert!(rungs[2].current);
        assert_eq!(rungs[2].primary, 60.0);
    }

    #[test]
    fn every_language_is_a_profile() {
        assert_eq!(LANGUAGES.len(), 5);
        assert!(profile("ar").unwrap().rtl);
        assert!(profile("zh").unwrap().tones.is_some());
        assert!(profile("es").unwrap().character_repair.is_none());
        assert!(profile("xx").is_none());
    }

    #[test]
    fn pacing_rounds_up() {
        assert_eq!(new_per_day(100, 7), Some(15));
        assert_eq!(new_per_day(0, 7), None);
        assert_eq!(new_per_day(100, 0), None);
    }

    #[test]
    fn time_is_said_plainly() {
        assert_eq!(spoken_time(40), "40 min");
        assert_eq!(spoken_time(70), "1 h 10 min");
        assert_eq!(spoken_time(120), "2 h");
        assert_eq!(spoken_time(0), "1 min");
        assert_eq!(review_minutes(312, Some(7692.0)), 40);
        assert_eq!(review_minutes(60, None), 8);
    }

    #[test]
    fn course_step_names_the_next_lecture() {
        let step = course_step(7, 24, 7, 4 * 3600);
        assert_eq!(step.headline, "Lecture 8 next");
        assert_eq!(step.meaning, "17 left · about 4 h");
        assert_eq!(course_step(24, 24, 24, 0).headline, "Finished");
    }

    #[test]
    fn coverage_groups_by_the_next_tag_level() {
        let cards = [
            card(&["AK::Renal::Stones"], false, true),
            card(&["AK::Renal::Glomerular", "AK::Renal::Stones"], true, false),
            card(&["AK::Cardio"], false, false),
            card(&["other"], false, false),
        ];
        let rows = coverage(&cards, "AK", 10);
        assert_eq!(rows.len(), 2);
        let renal = rows.iter().find(|r| r.name == "Renal").unwrap();
        assert_eq!((renal.total, renal.unlocked, renal.mature), (2, 1, 1));
        assert_eq!(renal.tag, "AK::Renal");
        assert_eq!(coverage(&cards, "", 10).len(), 2);
    }

    #[test]
    fn roots_are_levels_that_branch() {
        let cards = [card(&["AK::Renal::Stones"], false, false), card(&["AK::Renal::Acid"], false, false), card(&["AK::Cardio::Valves"], false, false)];
        let roots = tag_roots(&cards, 5);
        assert_eq!(roots[0], "AK");
        assert!(roots.contains(&"AK::Renal".to_string()));
        assert!(!roots.contains(&"AK::Cardio".to_string()));
    }

    #[test]
    fn weak_tags_need_enough_reviews() {
        let reviewed = |tag: &str, passed, total| ReviewedCard { tags: vec![tag.to_string()], passed, total };
        let weak = weak_tags(&[reviewed("AK::Renal::Nephritic", 7, 10), reviewed("AK::Rare", 0, 2), reviewed("AK::Fine", 19, 20)], 5, 5);
        assert_eq!(weak.len(), 1);
        assert_eq!(weak[0].label, "Renal › Nephritic");
        assert_eq!(weak[0].remembering_pct, 70);
    }

    #[test]
    fn tag_search_needs_every_word() {
        let cards = [card(&["AK::Renal::Glomerular_nephritis"], true, false), card(&["AK::Renal::Stones"], false, false)];
        let hits = search_tags(&cards, "renal glomerular", 5);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].waiting, 1);
        assert!(search_tags(&cards, "  ", 5).is_empty());
    }
}

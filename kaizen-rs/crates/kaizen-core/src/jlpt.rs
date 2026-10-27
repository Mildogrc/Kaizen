//! JLPT grammar curriculum CSVs and JLPT level progress.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

pub const LEVELS: [&str; 5] = ["N5", "N4", "N3", "N2", "N1"];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarRow {
    pub pattern: String,
    pub related_kanji: Option<String>,
    pub meaning: String,
    pub example_japanese: String,
    pub example_english: String,
    pub jlpt_level: String,
}

/// RFC-4180-ish CSV rows (quoted cells, doubled quotes, CRLF tolerant).
pub fn parse_csv_rows(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    let push_row = |row: &mut Vec<String>, cell: &mut String, rows: &mut Vec<Vec<String>>| {
        row.push(cell.trim().to_string());
        cell.clear();
        if row.iter().any(|v| !v.is_empty()) {
            rows.push(std::mem::take(row));
        } else {
            row.clear();
        }
    };
    while i < chars.len() {
        let c = chars[i];
        if quoted {
            if c == '"' && chars.get(i + 1) == Some(&'"') {
                cell.push('"');
                i += 1;
            } else if c == '"' {
                quoted = false;
            } else {
                cell.push(c);
            }
        } else if c == '"' {
            quoted = true;
        } else if c == ',' {
            row.push(cell.trim().to_string());
            cell.clear();
        } else if c == '\n' {
            push_row(&mut row, &mut cell, &mut rows);
        } else if c != '\r' {
            cell.push(c);
        }
        i += 1;
    }
    if !cell.is_empty() || !row.is_empty() {
        push_row(&mut row, &mut cell, &mut rows);
    }
    rows
}

fn correction(level: &str, pattern: &str) -> Option<(Option<&'static str>, Option<&'static str>)> {
    // (pattern, exampleJapanese) fixes for known typos in the source sheets.
    match (level, pattern) {
        ("N4", "～のようてほしい") => Some((Some("～のようにしてほしい"), None)),
        ("N4", "～させられる") => Some((None, Some("先生に読ませられた。"))),
        ("N4", "～られる") => Some((None, Some("漢字が読めます。"))),
        ("N3", "～になれる") => Some((Some("～に慣れる"), None)),
        ("N2", "いったんーば") => Some((Some("いったん～ば"), None)),
        _ => None,
    }
}

/// The N1 sheet has a one-row shift starting at ～が早いか: patterns are
/// offset from their explanations by one row.
fn repair_shifted_n1_rows(rows: Vec<GrammarRow>) -> Vec<GrammarRow> {
    let Some(shift_start) =
        rows.iter().enumerate().position(|(i, r)| i > 0 && r.pattern == "～が早いか" && r.meaning == "If only")
    else {
        return rows;
    };
    let mut repaired = rows.clone();
    for index in shift_start..repaired.len().saturating_sub(1) {
        repaired[index].pattern = rows[index + 1].pattern.clone();
    }
    repaired.pop();
    repaired
}

pub fn parse_grammar_csv(text: &str, level: &str) -> Result<Vec<GrammarRow>, String> {
    let rows = parse_csv_rows(text);
    let headers = rows.first().cloned().unwrap_or_default();
    let column = |name: &str| headers.iter().position(|h| h == name);
    let (Some(grammar), Some(explanation), Some(example_jp), Some(example_en)) =
        (column("Grammar"), column("Explanation"), column("Example (JP)"), column("Translation (EN)"))
    else {
        return Err(format!("Missing required columns in {level} grammar CSV."));
    };
    let kanji = column("Kanji");
    let get = |row: &[String], col: Option<usize>| col.and_then(|c| row.get(c)).map(|s| s.trim().to_string()).unwrap_or_default();

    let mut parsed: Vec<GrammarRow> = rows
        .iter()
        .skip(1)
        .filter_map(|row| {
            let pattern = get(row, Some(grammar));
            let meaning = get(row, Some(explanation));
            if pattern.is_empty() || (pattern.chars().all(|c| c.is_ascii_digit()) && meaning.is_empty()) {
                return None;
            }
            let related = get(row, kanji);
            Some(GrammarRow {
                pattern,
                related_kanji: (!related.is_empty()).then_some(related),
                meaning,
                example_japanese: get(row, Some(example_jp)),
                example_english: get(row, Some(example_en)),
                jlpt_level: level.to_string(),
            })
        })
        .collect();
    if level == "N1" {
        parsed = repair_shifted_n1_rows(parsed);
    }
    for row in &mut parsed {
        if let Some((pattern, example)) = correction(level, &row.pattern) {
            if let Some(p) = pattern {
                row.pattern = p.to_string();
            }
            if let Some(e) = example {
                row.example_japanese = e.to_string();
            }
        }
    }
    let mut seen = HashSet::new();
    Ok(parsed.into_iter().filter(|row| !row.meaning.is_empty() && seen.insert(row.pattern.clone())).collect())
}

/// Stable identity of a curriculum row: `jlpt:N5:<NFKC pattern, whitespace collapsed>`.
pub fn grammar_source_key(row: &GrammarRow) -> String {
    use unicode_normalization::UnicodeNormalization;
    let nfkc: String = row.pattern.nfkc().collect();
    format!("jlpt:{}:{}", row.jlpt_level, nfkc.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Learning-item data stored for a curriculum row.
pub fn grammar_item_data(row: &GrammarRow) -> serde_json::Value {
    let mut data = serde_json::json!({
        "pattern": row.pattern,
        "meaning": row.meaning,
        "jlptLevel": row.jlpt_level,
        "examples": if !row.example_japanese.is_empty() && !row.example_english.is_empty() {
            vec![format!("{} / {}", row.example_japanese, row.example_english)]
        } else {
            vec![]
        },
    });
    if let Some(kanji) = &row.related_kanji {
        data["notes"] = serde_json::Value::String(format!("Related kanji/form: {kanji}"));
    }
    data
}

// ----------------------------------------------------------- JLPT progress

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelState {
    pub name: String,
    pub rank: i64,
    pub target_vocab: i64,
    pub grammar_total: i64,
    pub grammar_mastered: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentProgress {
    #[serde(flatten)]
    pub level: LevelState,
    pub words_remaining: i64,
    pub grammar_remaining: i64,
    pub word_progress: f64,
    pub grammar_progress: f64,
}

/// Grammar totals accumulate across levels (N4 includes N5's points, …).
pub fn cumulative_levels(levels: &[LevelState]) -> Vec<LevelState> {
    let mut sorted = levels.to_vec();
    sorted.sort_by_key(|l| l.rank);
    let (mut total, mut mastered) = (0, 0);
    sorted
        .into_iter()
        .map(|level| {
            total += level.grammar_total;
            mastered += level.grammar_mastered;
            LevelState { grammar_total: total, grammar_mastered: mastered, ..level }
        })
        .collect()
}

/// The first level (by rank) whose vocabulary or grammar is not complete.
pub fn current_progress(levels: &[LevelState], known_words: i64) -> Option<CurrentProgress> {
    let mut sorted = levels.to_vec();
    sorted.sort_by_key(|l| l.rank);
    sorted.into_iter().find_map(|level| {
        let words_remaining = (level.target_vocab - known_words).max(0);
        let grammar_remaining = (level.grammar_total - level.grammar_mastered).max(0);
        if words_remaining == 0 && grammar_remaining == 0 {
            return None;
        }
        let word_progress =
            if level.target_vocab > 0 { (known_words as f64 / level.target_vocab as f64 * 100.0).min(100.0) } else { 0.0 };
        let grammar_progress = if level.grammar_total > 0 {
            (level.grammar_mastered as f64 / level.grammar_total as f64 * 100.0).min(100.0)
        } else {
            0.0
        };
        Some(CurrentProgress { level, words_remaining, grammar_remaining, word_progress, grammar_progress })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seed;

    #[test]
    fn matches_the_original_parser_output() {
        let golden: Vec<serde_json::Value> = serde_json::from_str(seed::JLPT_GOLDEN_JSON).unwrap();
        let mut produced = Vec::new();
        for level in LEVELS {
            for row in parse_grammar_csv(seed::jlpt_csv(level), level).unwrap() {
                produced.push((row.clone(), grammar_source_key(&row)));
            }
        }
        assert_eq!(produced.len(), golden.len());
        for ((row, key), expected) in produced.iter().zip(golden.iter()) {
            assert_eq!(row.pattern, expected["pattern"].as_str().unwrap());
            assert_eq!(row.meaning, expected["meaning"].as_str().unwrap());
            assert_eq!(row.example_japanese, expected["exampleJapanese"].as_str().unwrap());
            assert_eq!(row.example_english, expected["exampleEnglish"].as_str().unwrap());
            assert_eq!(row.related_kanji.as_deref(), expected["relatedKanji"].as_str());
            assert_eq!(key, expected["sourceKey"].as_str().unwrap());
        }
    }

    #[test]
    fn progress_levels() {
        let levels = vec![
            LevelState { name: "N4".into(), rank: 2, target_vocab: 1500, grammar_total: 10, grammar_mastered: 0 },
            LevelState { name: "N5".into(), rank: 1, target_vocab: 800, grammar_total: 5, grammar_mastered: 5 },
        ];
        let cumulative = cumulative_levels(&levels);
        assert_eq!(cumulative[1].grammar_total, 15);
        let current = current_progress(&levels, 900).unwrap();
        assert_eq!(current.level.name, "N4");
        assert_eq!(current.words_remaining, 600);
        assert_eq!(current_progress(&levels, 500).unwrap().level.name, "N5");
    }
}

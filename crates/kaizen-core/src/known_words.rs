//! Known-word logic: parsing Migaku exports (JSON/CSV/TXT) and computing union
//! cardinality bounds over normalized entries (see `lemmatize`).

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;

/// Hiragana/katakana (U+3040–U+30FF, includes the long-vowel mark).
pub fn is_kana_only(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| ('\u{3040}'..='\u{30FF}').contains(&c))
}

/// Hiragana → katakana (U+3041–U+3096 shifted by 0x60).
pub fn to_katakana(s: &str) -> String {
    s.chars()
        .map(|c| if ('\u{3041}'..='\u{3096}').contains(&c) { char::from_u32(c as u32 + 0x60).unwrap_or(c) } else { c })
        .collect()
}

// ------------------------------------------------------------- Migaku parse

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ParsedWord {
    pub word: String,
    pub reading: Option<String>,
    pub status: Option<String>,
    pub language: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    /// "json" | "csv" | "txt"
    pub format: &'static str,
    pub words: Vec<ParsedWord>,
    /// dropped by the status/language filters
    pub filtered_out: usize,
}

const WORD_KEYS: [&str; 6] = ["word", "term", "text", "front", "vocab", "expression"];
const STATUS_KEYS: [&str; 3] = ["status", "state", "knownstatus"];
const READING_KEYS: [&str; 3] = ["reading", "kana", "pronunciation"];
const LANGUAGE_KEYS: [&str; 2] = ["language", "lang"];

fn keep_status(status: Option<&str>, include_learning: bool) -> bool {
    let Some(status) = status else { return true };
    let s = status.trim().to_lowercase();
    s.is_empty() || s == "known" || (include_learning && s == "learning")
}

fn normalized_language(language: &str) -> Option<String> {
    let value = language.trim().to_lowercase().replacen('_', "-", 1);
    if value.is_empty() {
        return None;
    }
    Some(match value.as_str() {
        "ja" | "jp" | "japanese" => "ja".into(),
        "zh" | "cn" | "chinese" => "zh".into(),
        v if v.starts_with("zh-") => "zh".into(),
        v => v.into(),
    })
}

fn keep_language(language: Option<&str>, target: Option<&str>) -> bool {
    match (target, language) {
        (None, _) | (_, None) => true,
        (Some(_), Some("")) => true,
        (Some(target), Some(language)) => normalized_language(language).as_deref() == Some(target),
    }
}

fn filter_words(words: Vec<ParsedWord>, include_learning: bool, target: Option<&str>) -> Vec<ParsedWord> {
    words
        .into_iter()
        .filter(|w| keep_status(w.status.as_deref(), include_learning) && keep_language(w.language.as_deref(), target))
        .collect()
}

/// Minimal CSV line split honoring double-quoted fields.
fn split_csv_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if quoted {
            if ch == '"' && chars.get(i + 1) == Some(&'"') {
                cur.push('"');
                i += 1;
            } else if ch == '"' {
                quoted = false;
            } else {
                cur.push(ch);
            }
        } else if ch == '"' {
            quoted = true;
        } else if ch == ',' {
            out.push(std::mem::take(&mut cur));
        } else {
            cur.push(ch);
        }
        i += 1;
    }
    out.push(cur);
    out.into_iter().map(|s| s.trim().to_string()).collect()
}

fn pick(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    obj.iter().find_map(|(k, v)| {
        let s = v.as_str()?.trim();
        (keys.contains(&k.to_lowercase().as_str()) && !s.is_empty()).then(|| s.to_string())
    })
}

/// Auto-detect and parse a Migaku word export: Word Exporter JSON, CSV with a
/// header row, or plain text (one word per line, optional tab/comma status).
/// Keeps Known (+Learning when requested); entries without a status are kept.
pub fn parse_migaku_export(text: &str, include_learning: bool, target_language: Option<&str>) -> ParseResult {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return ParseResult { format: "txt", words: vec![], filtered_out: 0 };
    }

    if (trimmed.starts_with('[') || trimmed.starts_with('{'))
        && let Ok(parsed) = serde_json::from_str::<Value>(trimmed)
    {
        let array: Vec<Value> = match &parsed {
            Value::Array(items) => items.clone(),
            Value::Object(obj) => obj.get("words").and_then(Value::as_array).cloned().unwrap_or_default(),
            _ => vec![],
        };
        let mut all = Vec::new();
        for entry in array {
            match entry {
                Value::String(s) if !s.trim().is_empty() => {
                    all.push(ParsedWord { word: s.trim().to_string(), reading: None, status: None, language: None })
                }
                Value::Object(obj) => {
                    if let Some(word) = pick(&obj, &WORD_KEYS) {
                        all.push(ParsedWord {
                            word,
                            reading: pick(&obj, &READING_KEYS),
                            status: pick(&obj, &STATUS_KEYS),
                            language: pick(&obj, &LANGUAGE_KEYS),
                        });
                    }
                }
                _ => {}
            }
        }
        let total = all.len();
        let kept = filter_words(all, include_learning, target_language);
        return ParseResult { format: "json", filtered_out: total - kept.len(), words: kept };
    }

    let lines: Vec<&str> = trimmed.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let header: Vec<String> =
        lines.first().map(|l| split_csv_line(l).into_iter().map(|h| h.to_lowercase()).collect()).unwrap_or_default();
    let column = |keys: &[&str]| header.iter().position(|h| keys.contains(&h.as_str()));
    if let (true, Some(word_col)) = (lines.first().is_some_and(|l| l.contains(',')), column(&WORD_KEYS)) {
        let status_col = column(&STATUS_KEYS);
        let reading_col = column(&READING_KEYS);
        let language_col = column(&LANGUAGE_KEYS);
        let cell = |cells: &[String], col: Option<usize>| {
            col.and_then(|c| cells.get(c)).filter(|s| !s.is_empty()).cloned()
        };
        let mut all = Vec::new();
        for line in &lines[1..] {
            let cells = split_csv_line(line);
            let Some(word) = cells.get(word_col).filter(|w| !w.is_empty()).cloned() else { continue };
            all.push(ParsedWord {
                word,
                reading: cell(&cells, reading_col),
                status: cell(&cells, status_col),
                language: cell(&cells, language_col),
            });
        }
        let total = all.len();
        let kept = filter_words(all, include_learning, target_language);
        return ParseResult { format: "csv", filtered_out: total - kept.len(), words: kept };
    }

    let all: Vec<ParsedWord> = lines
        .iter()
        .map(|line| {
            let mut parts = line.split(['\t', ',']).map(str::trim);
            let word = parts.next().unwrap_or("").to_string();
            let status = parts.next().filter(|s| !s.is_empty()).map(str::to_string);
            ParsedWord { word, reading: None, status, language: None }
        })
        .collect();
    let total = all.len();
    let kept = filter_words(all.into_iter().filter(|w| !w.word.is_empty()).collect(), include_learning, target_language);
    ParseResult { format: "txt", filtered_out: total - kept.len(), words: kept }
}

// ------------------------------------------------------------ Union bounds

#[derive(Clone, Debug)]
pub struct UnionEntry {
    pub strict_key: String,
    pub loose_key: String,
    pub reading: Option<String>,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnionBounds {
    pub lower: usize,
    pub upper: usize,
    /// distinct strict keys per source
    pub by_source: HashMap<String, usize>,
    /// strict keys seen in 2+ sources — definite overlap
    pub overlap: usize,
}

/// Cardinality bounds for the union of known words. Upper: distinct strict
/// keys. Lower: distinct loose keys, additionally merging kana-only lemmas
/// into a kanji entry that reads the same (わかる ≡ 分かる).
pub fn union_bounds(entries: &[UnionEntry]) -> UnionBounds {
    let strict: HashSet<&str> = entries.iter().map(|e| e.strict_key.as_str()).collect();

    let mut group_of: HashMap<&str, &str> = HashMap::new();
    for e in entries {
        group_of.entry(e.loose_key.as_str()).or_insert(e.loose_key.as_str());
    }
    let mut reading_to_kanji_group: HashMap<&str, &str> = HashMap::new();
    for e in entries {
        if let Some(reading) = e.reading.as_deref()
            && !is_kana_only(&e.loose_key)
        {
            reading_to_kanji_group.insert(reading, group_of[e.loose_key.as_str()]);
        }
    }
    let mut merges: Vec<(&str, &str)> = Vec::new();
    for e in entries {
        if !is_kana_only(&e.loose_key) {
            continue;
        }
        let katakana = to_katakana(&e.loose_key);
        if let Some(group) = reading_to_kanji_group.get(katakana.as_str()) {
            merges.push((e.loose_key.as_str(), group));
        }
    }
    for (key, group) in merges {
        group_of.insert(key, group);
    }
    let lower = group_of.values().collect::<HashSet<_>>().len();

    let mut by_source: HashMap<&str, HashSet<&str>> = HashMap::new();
    let mut sources_per_key: HashMap<&str, HashSet<&str>> = HashMap::new();
    for e in entries {
        by_source.entry(e.source.as_str()).or_default().insert(e.strict_key.as_str());
        sources_per_key.entry(e.strict_key.as_str()).or_default().insert(e.source.as_str());
    }
    UnionBounds {
        lower,
        upper: strict.len(),
        by_source: by_source.into_iter().map(|(k, v)| (k.to_string(), v.len())).collect(),
        overlap: sources_per_key.values().filter(|s| s.len() > 1).count(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(r: &ParseResult) -> Vec<&str> {
        r.words.iter().map(|w| w.word.as_str()).collect()
    }

    #[test]
    fn parses_json_and_filters_status() {
        let json = r#"[{"word":"食べる","reading":"たべる","status":"KNOWN"},{"word":"走る","status":"LEARNING"},{"word":"猫","status":"known"},{"word":"謎","status":"IGNORED"}]"#;
        let r = parse_migaku_export(json, false, None);
        assert_eq!(r.format, "json");
        assert_eq!(words(&r), vec!["食べる", "猫"]);
        assert_eq!(r.filtered_out, 2);
        assert_eq!(r.words[0].reading.as_deref(), Some("たべる"));
        assert_eq!(parse_migaku_export(r#"[{"word":"走る","status":"Learning"}]"#, true, None).words.len(), 1);
    }

    #[test]
    fn filters_languages() {
        let json = r#"{"words":[{"word":"食べる","reading":"たべる","language":"ja","status":"KNOWN"},{"word":"学习","language":"zh","status":"KNOWN"},{"word":"study","language":"en","status":"KNOWN"},{"word":"猫","status":"KNOWN"}]}"#;
        let r = parse_migaku_export(json, false, Some("ja"));
        assert_eq!(words(&r), vec!["食べる", "猫"]);
        assert_eq!(r.filtered_out, 2);
        let aliases = r#"[{"word":"猫","language":"Japanese"},{"word":"勉強","language":"jp"},{"word":"学习","language":"zh-CN"}]"#;
        assert_eq!(words(&parse_migaku_export(aliases, false, Some("ja"))), vec!["猫", "勉強"]);
        assert_eq!(words(&parse_migaku_export(aliases, false, Some("zh"))), vec!["学习"]);
    }

    #[test]
    fn parses_csv_and_text() {
        let csv = "Word,Status,Reading\n食べる,Known,たべる\n\"走る\",Learning,はしる\n猫,Known,ねこ";
        let r = parse_migaku_export(csv, false, None);
        assert_eq!(r.format, "csv");
        assert_eq!(words(&r), vec!["食べる", "猫"]);
        let mixed = "Word,Status,Reading,Language\n食べる,Known,たべる,ja\nstudy,Known,,en\n学习,Known,,zh";
        assert_eq!(words(&parse_migaku_export(mixed, false, Some("ja"))), vec!["食べる"]);
        let txt = "食べる\n猫\tKNOWN\n走る\tunknown\n";
        let r = parse_migaku_export(txt, false, None);
        assert_eq!(r.format, "txt");
        assert_eq!(words(&r), vec!["食べる", "猫"]);
        assert!(parse_migaku_export("", false, None).words.is_empty());
    }

    fn entry(strict: &str, loose: &str, reading: Option<&str>, source: &str) -> UnionEntry {
        UnionEntry { strict_key: strict.into(), loose_key: loose.into(), reading: reading.map(Into::into), source: source.into() }
    }

    #[test]
    fn union_bounds_rules() {
        let b = union_bounds(&[entry("食べる|タベル", "食べる", Some("タベル"), "migaku"), entry("食べる|タベル", "食べる", Some("タベル"), "anki")]);
        assert_eq!((b.lower, b.upper, b.overlap), (1, 1, 1));
        assert_eq!(b.by_source["migaku"], 1);
        assert_eq!(b.by_source["anki"], 1);
        let b = union_bounds(&[entry("わかる|ワカル", "わかる", Some("ワカル"), "migaku"), entry("分かる|ワカル", "分かる", Some("ワカル"), "anki")]);
        assert_eq!((b.lower, b.upper), (1, 2));
        let b = union_bounds(&[entry("行く|イク", "行く", Some("イク"), "migaku"), entry("行く|ユク", "行く", Some("ユク"), "migaku")]);
        assert_eq!((b.lower, b.upper), (1, 2));
        let b = union_bounds(&[entry("猫|ネコ", "猫", Some("ネコ"), "migaku"), entry("犬|イヌ", "犬", Some("イヌ"), "migaku")]);
        assert_eq!((b.lower, b.upper, b.overlap), (2, 2, 0));
        let b = union_bounds(&[entry("学习", "学习", None, "migaku"), entry("学习", "学习", None, "anki"), entry("电视", "电视", None, "anki")]);
        assert_eq!((b.lower, b.upper, b.overlap), (2, 2, 1));
    }
}

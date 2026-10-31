//! Kanji Repair: rank RTK kanji for a focused daily intervention from direct
//! RTK-card evidence (and optionally vocabulary cards), with cooldowns.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::anki_analytics::LogRow;
use crate::util::clamp01;

const DAY_MS: f64 = 86_400_000.0;

#[derive(Clone, Copy, Debug)]
pub struct ScoringConfig {
    pub minimum_direct_reviews: usize,
    pub recent_review_window: usize,
    pub recent_half_life_days: f64,
    pub bayesian_prior_reviews: f64,
    pub bayesian_prior_failure_rate: f64,
    pub hard_failure_weight: f64,
    pub recent_failure_weight: f64,
    pub lifetime_failure_weight: f64,
    pub repeated_failure_weight: f64,
    pub lapse_weight: f64,
    pub difficulty_weight: f64,
    pub response_time_weight: f64,
    pub slow_response_floor_ms: f64,
    pub slow_response_ceiling_ms: f64,
    pub minimum_repair_score: f64,
    pub cooldown_days: i64,
    pub daily_repair_limit: usize,
    pub vocabulary_signal_weight: f64,
    pub minimum_vocabulary_reviews: f64,
    pub minimum_vocabulary_cards: usize,
    pub minimum_vocabulary_card_reviews: usize,
}

/// Defaults favor recent evidence while requiring enough reviews to avoid
/// promoting a kanji after one or two unlucky answers.
pub const DEFAULTS: ScoringConfig = ScoringConfig {
    minimum_direct_reviews: 4,
    recent_review_window: 8,
    recent_half_life_days: 45.0,
    bayesian_prior_reviews: 6.0,
    bayesian_prior_failure_rate: 0.15,
    hard_failure_weight: 0.4,
    recent_failure_weight: 0.42,
    lifetime_failure_weight: 0.18,
    repeated_failure_weight: 0.12,
    lapse_weight: 0.1,
    difficulty_weight: 0.1,
    response_time_weight: 0.08,
    slow_response_floor_ms: 5_000.0,
    slow_response_ceiling_ms: 15_000.0,
    minimum_repair_score: 0.2,
    cooldown_days: 14,
    daily_repair_limit: 1,
    vocabulary_signal_weight: 0.3,
    minimum_vocabulary_reviews: 8.0,
    minimum_vocabulary_cards: 2,
    minimum_vocabulary_card_reviews: 2,
};

// ---------------------------------------------------------------- RTK extract

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RtkKanjiEntry {
    pub kanji: String,
    pub keyword: Option<String>,
    pub rtk_number: Option<i64>,
    pub book: Option<i64>,
    pub lesson: Option<i64>,
    #[serde(skip)]
    pub metadata: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanjiExtract {
    pub entries: Vec<RtkKanjiEntry>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

static HAN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{Han}").unwrap());
static DIGITS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+").unwrap());
static NUMERIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*\d+(?:\.\d+)?\s*$").unwrap());
static DIRECT_DECK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(?:kanji|rtk|remembering the kanji)").unwrap());

const ARRAY_KEYS: [&str; 6] = ["kanji", "characters", "entries", "items", "records", "data"];
const KANJI_KEYS: [&str; 5] = ["kanji", "character", "literal", "glyph", "symbol"];
const KEYWORD_KEYS: [&str; 6] = ["keyword", "rtkKeyword", "heisigKeyword", "meaning", "keyWord", "english"];
const NUMBER_KEYS: [&str; 9] =
    ["rtkNumber", "rtk_number", "heisigNumber", "heisig_number", "frame", "frameNumber", "frame_number", "number", "index"];
const BOOK_KEYS: [&str; 4] = ["book", "volume", "rtkBook", "rtk_book"];
const LESSON_KEYS: [&str; 3] = ["lesson", "lessonNumber", "lesson_number"];

/// Unique Han characters in order of first appearance.
pub fn extract_kanji_characters(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    HAN.find_iter(text)
        .map(|m| m.as_str().to_string())
        .filter(|k| seen.insert(k.clone()))
        .collect()
}

pub fn is_direct_kanji_deck_name(deck_name: &str) -> bool {
    DIRECT_DECK.is_match(deck_name)
}

fn first_value<'a>(record: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().filter_map(|key| record.get(*key)).find(|v| !v.is_null())
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn optional_number(value: Option<&Value>) -> Option<i64> {
    let parsed = match value? {
        Value::String(s) if !NUMERIC.is_match(s) => DIGITS.find(s)?.as_str().parse::<f64>().ok()?,
        Value::String(s) => s.trim().parse::<f64>().ok()?,
        Value::Number(n) => n.as_f64()?,
        Value::Bool(b) => f64::from(u8::from(*b)),
        _ => return None,
    };
    (parsed.is_finite() && parsed > 0.0).then(|| crate::util::js_round(parsed) as i64)
}

fn single_kanji(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    let found: Vec<&str> = HAN.find_iter(text).map(|m| m.as_str()).collect();
    (found.len() == 1).then(|| found[0].to_string())
}

fn raw_rows(input: &Value) -> Option<Vec<(Option<String>, Value)>> {
    if let Value::Array(items) = input {
        return Some(items.iter().map(|v| (None, v.clone())).collect());
    }
    let record = input.as_object()?;
    for key in ARRAY_KEYS {
        if let Some(Value::Array(items)) = record.get(key) {
            return Some(items.iter().map(|v| (None, v.clone())).collect());
        }
    }
    let direct: Vec<Value> = record.values().filter_map(Value::as_array).flatten().cloned().collect();
    if !direct.is_empty() {
        return Some(direct.into_iter().map(|v| (None, v)).collect());
    }
    let nested: Vec<Value> = record
        .values()
        .filter_map(Value::as_object)
        .flat_map(|o| o.values().filter_map(Value::as_array).flatten().cloned())
        .collect();
    if !nested.is_empty() {
        return Some(nested.into_iter().map(|v| (None, v)).collect());
    }
    let keyed: Vec<(Option<String>, Value)> = record
        .iter()
        .filter(|(key, value)| single_kanji(Some(&Value::String((*key).clone()))).is_some() && value.is_object())
        .map(|(key, value)| (Some(key.clone()), value.clone()))
        .collect();
    (!keyed.is_empty()).then_some(keyed)
}

/// Parse an RTK extract in any of the shapes the original accepted.
pub fn parse_kanji_extract(input: &Value) -> KanjiExtract {
    let Some(rows) = raw_rows(input) else {
        return KanjiExtract {
            entries: vec![],
            warnings: vec![],
            error: Some("The RTK extract must contain an array of kanji records.".into()),
        };
    };
    let mut warnings = Vec::new();
    let mut entries: Vec<RtkKanjiEntry> = Vec::new();
    let mut seen = HashSet::new();
    for (index, (fallback, value)) in rows.into_iter().enumerate() {
        let Some(record) = value.as_object() else {
            warnings.push(format!("Record {} is not an object and was skipped.", index + 1));
            continue;
        };
        let kanji = single_kanji(first_value(record, &KANJI_KEYS))
            .or_else(|| single_kanji(fallback.map(Value::String).as_ref()));
        let Some(kanji) = kanji else {
            warnings.push(format!("Record {} has no single kanji character and was skipped.", index + 1));
            continue;
        };
        if !seen.insert(kanji.clone()) {
            warnings.push(format!("Duplicate kanji {kanji} was ignored."));
            continue;
        }
        let keyword = optional_string(first_value(record, &KEYWORD_KEYS));
        if keyword.is_none() {
            warnings.push(format!("Kanji {kanji} has no RTK keyword."));
        }
        entries.push(RtkKanjiEntry {
            kanji,
            keyword,
            rtk_number: optional_number(first_value(record, &NUMBER_KEYS)),
            book: optional_number(first_value(record, &BOOK_KEYS)),
            lesson: optional_number(first_value(record, &LESSON_KEYS)),
            metadata: value.clone(),
        });
    }
    if entries.is_empty() {
        return KanjiExtract {
            entries: vec![],
            warnings,
            error: Some("The RTK extract did not contain any valid kanji records.".into()),
        };
    }
    KanjiExtract { entries, warnings, error: None }
}

// -------------------------------------------------------------------- Scoring

#[derive(Clone, Debug)]
pub struct EvidenceCard {
    pub anki_card_id: String,
    pub label: String,
    pub kanji: Vec<String>,
    pub interval_days: f64,
    pub ease: f64,
    pub lapses: i64,
    pub logs: Vec<LogRow>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairState {
    pub kanji: String,
    pub last_repaired_at: DateTime<Utc>,
    pub cooldown_until: DateTime<Utc>,
    pub repair_count: i64,
    pub last_repair_score: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectPerformance {
    pub cards: usize,
    pub reviews: usize,
    pub again: usize,
    pub hard: usize,
    pub good: usize,
    pub easy: usize,
    pub recent_reviews: usize,
    pub recent_failures: usize,
    pub recent_failure_rate: f64,
    pub lifetime_failure_rate: f64,
    pub lapses: i64,
    pub average_response_ms: Option<f64>,
    pub interval_days: f64,
    pub ease: f64,
    pub confidence: f64,
    pub score: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyEvidence {
    pub card_id: String,
    pub word: String,
    pub reviews: usize,
    pub failures: usize,
    pub weakness: f64,
    pub attribution: f64,
    pub contribution: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyPerformance {
    pub enabled: bool,
    pub available: bool,
    pub cards: usize,
    pub reviews: usize,
    pub attributed_reviews: f64,
    pub score: f64,
    pub evidence: Vec<VocabularyEvidence>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub entry: RtkKanjiEntry,
    pub direct: DirectPerformance,
    pub vocabulary: VocabularyPerformance,
    pub repair_state: Option<RepairState>,
    pub score: f64,
    pub eligible: bool,
    /// "cooldown" | "insufficient-evidence" | "below-threshold"
    pub exclusion_reason: Option<&'static str>,
}

fn rating_failure(rating: i32, config: &ScoringConfig) -> f64 {
    match rating {
        1 => 1.0,
        2 => config.hard_failure_weight,
        _ => 0.0,
    }
}

fn weighted_failure(logs: &[&LogRow], now: DateTime<Utc>, config: &ScoringConfig) -> f64 {
    if logs.is_empty() {
        return 0.0;
    }
    let (mut numerator, mut denominator) = (0.0, 0.0);
    for log in logs {
        let age_days = ((now - log.reviewed_at).num_milliseconds() as f64 / DAY_MS).max(0.0);
        let weight = 0.5f64.powf(age_days / config.recent_half_life_days);
        numerator += rating_failure(log.rating, config) * weight;
        denominator += weight;
    }
    if denominator > 0.0 { numerator / denominator } else { 0.0 }
}

fn smoothed_lifetime_failure(logs: &[&LogRow], config: &ScoringConfig) -> f64 {
    let observed: f64 = logs.iter().map(|log| rating_failure(log.rating, config)).sum();
    (observed + config.bayesian_prior_failure_rate * config.bayesian_prior_reviews)
        / (logs.len() as f64 + config.bayesian_prior_reviews)
}

fn average(values: &[f64], fallback: f64) -> f64 {
    if values.is_empty() { fallback } else { values.iter().sum::<f64>() / values.len() as f64 }
}

fn direct_performance(
    cards: &[&EvidenceCard],
    state: Option<&RepairState>,
    now: DateTime<Utc>,
    config: &ScoringConfig,
) -> DirectPerformance {
    let mut logs: Vec<&LogRow> = cards.iter().flat_map(|card| card.logs.iter()).collect();
    logs.sort_by_key(|l| std::cmp::Reverse(l.reviewed_at));
    let recent: Vec<&LogRow> = logs.iter().copied().take(config.recent_review_window).collect();
    let post_repair: Vec<&LogRow> = match state {
        Some(state) => logs
            .iter()
            .copied()
            .filter(|log| log.reviewed_at > state.last_repaired_at)
            .take(config.recent_review_window)
            .collect(),
        None => vec![],
    };
    let recent_base = weighted_failure(&recent, now, config);
    let recent_failure_rate = if post_repair.is_empty() {
        recent_base
    } else {
        weighted_failure(&post_repair, now, config) * 0.75 + recent_base * 0.25
    };
    let lifetime_failure_rate = smoothed_lifetime_failure(&logs, config);
    let repeated_failure = clamp01(recent.iter().filter(|log| log.rating == 1).count() as f64 / 3.0);
    let lapses: i64 = cards.iter().map(|card| card.lapses).sum();
    let lapse_signal = 1.0 - (-(lapses as f64) / 3.0).exp();
    let interval_days = average(&cards.iter().map(|card| card.interval_days).collect::<Vec<_>>(), 0.0);
    let ease = average(&cards.iter().map(|card| card.ease).collect::<Vec<_>>(), 2.5);
    let interval_difficulty = 1.0 - clamp01(interval_days / 180.0);
    let ease_difficulty = clamp01((2.5 - ease) / 1.2);
    let difficulty_signal = interval_difficulty * 0.6 + ease_difficulty * 0.4;
    let response_times: Vec<f64> = recent
        .iter()
        .map(|log| (log.time_ms as f64).clamp(0.0, 60_000.0))
        .filter(|time| *time > 0.0)
        .collect();
    let average_response_ms = (!response_times.is_empty()).then(|| average(&response_times, 0.0));
    let response_signal = match average_response_ms {
        None => 0.0,
        Some(ms) => clamp01(
            (ms - config.slow_response_floor_ms) / (config.slow_response_ceiling_ms - config.slow_response_floor_ms),
        ),
    };
    let confidence = clamp01((logs.len() as f64 / (config.minimum_direct_reviews as f64 * 3.0)).sqrt());

    // Recent errors dominate; lifetime errors are Bayesian-smoothed; lapses,
    // short intervals/low ease, and slow responses are supporting signals.
    let score = clamp01(
        (recent_failure_rate * config.recent_failure_weight
            + lifetime_failure_rate * config.lifetime_failure_weight
            + repeated_failure * config.repeated_failure_weight
            + lapse_signal * config.lapse_weight
            + difficulty_signal * config.difficulty_weight
            + response_signal * config.response_time_weight)
            * confidence,
    );

    DirectPerformance {
        cards: cards.len(),
        reviews: logs.len(),
        again: logs.iter().filter(|l| l.rating == 1).count(),
        hard: logs.iter().filter(|l| l.rating == 2).count(),
        good: logs.iter().filter(|l| l.rating == 3).count(),
        easy: logs.iter().filter(|l| l.rating == 4).count(),
        recent_reviews: recent.len(),
        recent_failures: recent.iter().filter(|l| l.rating == 1).count(),
        recent_failure_rate,
        lifetime_failure_rate,
        lapses,
        average_response_ms,
        interval_days,
        ease,
        confidence,
        score,
    }
}

#[derive(Default)]
struct VocabularyAccumulator {
    cards: HashSet<String>,
    reviews: usize,
    attributed_reviews: f64,
    numerator: f64,
    evidence: Vec<VocabularyEvidence>,
}

fn vocabulary_performance(
    cards: &[EvidenceCard],
    direct_by_kanji: &HashMap<String, DirectPerformance>,
    enabled: bool,
    now: DateTime<Utc>,
    config: &ScoringConfig,
) -> HashMap<String, VocabularyPerformance> {
    let mut output = HashMap::new();
    if !enabled {
        return output;
    }
    let scored: Vec<(&EvidenceCard, f64)> = cards
        .iter()
        .filter(|card| card.logs.len() >= config.minimum_vocabulary_card_reviews && !card.kanji.is_empty())
        .map(|card| {
            let mut sorted: Vec<&LogRow> = card.logs.iter().collect();
            sorted.sort_by_key(|l| std::cmp::Reverse(l.reviewed_at));
            let recent: Vec<&LogRow> = sorted.iter().copied().take(config.recent_review_window).collect();
            let confidence = clamp01((sorted.len() as f64 / config.minimum_vocabulary_reviews).sqrt());
            let weakness = clamp01(
                (weighted_failure(&recent, now, config) * 0.7 + smoothed_lifetime_failure(&sorted, config) * 0.3)
                    * confidence,
            );
            (card, weakness)
        })
        .collect();
    let corpus_baseline = average(&scored.iter().map(|(_, w)| *w).collect::<Vec<_>>(), 0.0);
    let mut accumulators: HashMap<String, VocabularyAccumulator> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for (card, weakness) in &scored {
        // A difficult multi-kanji word does not penalize every character
        // equally: attribution leans toward characters with direct weakness,
        // and part of the corpus baseline is subtracted.
        let weights: Vec<f64> = card
            .kanji
            .iter()
            .map(|k| 0.5 + direct_by_kanji.get(k).map(|d| d.score).unwrap_or(0.0))
            .collect();
        let total: f64 = weights.iter().sum();
        let card_specific = (weakness - corpus_baseline * 0.25).max(0.0);
        for (index, kanji) in card.kanji.iter().enumerate() {
            let attribution = if total > 0.0 { weights[index] / total } else { 1.0 / card.kanji.len() as f64 };
            let contribution = card_specific * attribution;
            if !accumulators.contains_key(kanji) {
                order.push(kanji.clone());
            }
            let acc = accumulators.entry(kanji.clone()).or_default();
            acc.cards.insert(card.anki_card_id.clone());
            acc.reviews += card.logs.len();
            acc.attributed_reviews += card.logs.len() as f64 * attribution;
            acc.numerator += contribution * card.logs.len() as f64;
            acc.evidence.push(VocabularyEvidence {
                card_id: card.anki_card_id.clone(),
                word: card.label.clone(),
                reviews: card.logs.len(),
                failures: card.logs.iter().filter(|l| l.rating == 1).count(),
                weakness: *weakness,
                attribution,
                contribution,
            });
        }
    }

    for kanji in order {
        let mut acc = accumulators.remove(&kanji).unwrap_or_default();
        let available = acc.cards.len() >= config.minimum_vocabulary_cards
            && acc.attributed_reviews >= config.minimum_vocabulary_reviews;
        let confidence = clamp01((acc.attributed_reviews / config.minimum_vocabulary_reviews).sqrt());
        acc.evidence.sort_by(|a, b| b.contribution.partial_cmp(&a.contribution).unwrap_or(std::cmp::Ordering::Equal));
        acc.evidence.truncate(8);
        output.insert(
            kanji,
            VocabularyPerformance {
                enabled: true,
                available,
                cards: acc.cards.len(),
                reviews: acc.reviews,
                attributed_reviews: acc.attributed_reviews,
                score: if available { clamp01((acc.numerator / (acc.reviews.max(1) as f64)) * confidence) } else { 0.0 },
                evidence: acc.evidence,
            },
        );
    }
    output
}

pub struct ScoreInput<'a> {
    pub entries: &'a [RtkKanjiEntry],
    pub direct_cards: &'a [EvidenceCard],
    pub vocabulary_cards: &'a [EvidenceCard],
    pub repair_states: &'a [RepairState],
    pub use_vocabulary_performance: bool,
    pub now: DateTime<Utc>,
    pub config: ScoringConfig,
}

pub fn score_candidates(input: ScoreInput<'_>) -> Vec<Candidate> {
    let config = &input.config;
    let states: HashMap<&str, &RepairState> = input.repair_states.iter().map(|s| (s.kanji.as_str(), s)).collect();
    let mut direct_cards_by_kanji: HashMap<&str, Vec<&EvidenceCard>> = HashMap::new();
    for card in input.direct_cards {
        for kanji in &card.kanji {
            direct_cards_by_kanji.entry(kanji.as_str()).or_default().push(card);
        }
    }
    let direct_by_kanji: HashMap<String, DirectPerformance> = input
        .entries
        .iter()
        .map(|entry| {
            let cards = direct_cards_by_kanji.get(entry.kanji.as_str()).map(Vec::as_slice).unwrap_or(&[]);
            let state = states.get(entry.kanji.as_str()).copied();
            (entry.kanji.clone(), direct_performance(cards, state, input.now, config))
        })
        .collect();
    let vocabulary_by_kanji = vocabulary_performance(
        input.vocabulary_cards,
        &direct_by_kanji,
        input.use_vocabulary_performance,
        input.now,
        config,
    );

    let mut candidates: Vec<Candidate> = input
        .entries
        .iter()
        .map(|entry| {
            let direct = direct_by_kanji.get(&entry.kanji).cloned().unwrap_or_default();
            let vocabulary = vocabulary_by_kanji.get(&entry.kanji).cloned().unwrap_or(VocabularyPerformance {
                enabled: input.use_vocabulary_performance,
                ..Default::default()
            });
            let repair_state = states.get(entry.kanji.as_str()).map(|s| (*s).clone());
            let score = clamp01(
                direct.score
                    + if input.use_vocabulary_performance { vocabulary.score * config.vocabulary_signal_weight } else { 0.0 },
            );
            let has_evidence = direct.reviews >= config.minimum_direct_reviews || vocabulary.available;
            let on_cooldown = repair_state.as_ref().is_some_and(|s| s.cooldown_until > input.now);
            let exclusion_reason = if on_cooldown {
                Some("cooldown")
            } else if !has_evidence {
                Some("insufficient-evidence")
            } else if score < config.minimum_repair_score {
                Some("below-threshold")
            } else {
                None
            };
            Candidate {
                entry: entry.clone(),
                direct,
                vocabulary,
                repair_state,
                score,
                eligible: exclusion_reason.is_none(),
                exclusion_reason,
            }
        })
        .collect();
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.entry.rtk_number.unwrap_or(i64::MAX).cmp(&b.entry.rtk_number.unwrap_or(i64::MAX)))
    });
    candidates
}

pub fn select_target(candidates: &[Candidate]) -> Option<&Candidate> {
    candidates.iter().find(|c| c.eligible)
}

pub fn performance_snapshot(candidate: &Candidate, now: DateTime<Utc>) -> Value {
    serde_json::json!({
        "capturedAt": now.to_rfc3339(),
        "score": candidate.score,
        "direct": candidate.direct,
        "vocabulary": candidate.vocabulary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, TimeZone};

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 23, 16, 0, 0).unwrap()
    }
    fn entry(kanji: &str, n: i64) -> RtkKanjiEntry {
        RtkKanjiEntry { kanji: kanji.into(), keyword: Some(format!("keyword-{kanji}")), rtk_number: Some(n), book: Some(1), lesson: Some(1), metadata: Value::Null }
    }
    fn card(kanji: &[&str], ratings: &[(i32, i64)], id: Option<&str>) -> EvidenceCard {
        let id = id.map(str::to_string).unwrap_or_else(|| format!("card-{}", kanji.concat()));
        EvidenceCard {
            anki_card_id: id.clone(),
            label: kanji.concat(),
            kanji: kanji.iter().map(|k| k.to_string()).collect(),
            interval_days: 30.0,
            ease: 2.3,
            lapses: ratings.iter().filter(|(r, _)| *r == 1).count() as i64,
            logs: ratings
                .iter()
                .map(|(rating, days_ago)| LogRow {
                    anki_card_id: id.clone(),
                    reviewed_at: now() - Duration::days(*days_ago),
                    rating: *rating,
                    interval_before_days: 10,
                    interval_after_days: if *rating == 1 { 1 } else { 20 },
                    time_ms: if *rating <= 2 { 11_000 } else { 3_000 },
                })
                .collect(),
        }
    }
    fn score(entries: &[RtkKanjiEntry], direct: &[EvidenceCard], vocab: &[EvidenceCard], states: &[RepairState], use_vocab: bool) -> Vec<Candidate> {
        score_candidates(ScoreInput { entries, direct_cards: direct, vocabulary_cards: vocab, repair_states: states, use_vocabulary_performance: use_vocab, now: now(), config: DEFAULTS })
    }
    fn find<'a>(c: &'a [Candidate], k: &str) -> &'a Candidate {
        c.iter().find(|c| c.entry.kanji == k).unwrap()
    }

    #[test]
    fn recent_failures_outweigh_old_ones() {
        let old_fail: Vec<_> = [100, 90, 80, 70].iter().map(|d| (1, *d)).collect();
        let recent_good: Vec<_> = [4, 3, 2, 1].iter().map(|d| (3, *d)).collect();
        let old_good: Vec<_> = [100, 90, 80, 70].iter().map(|d| (3, *d)).collect();
        let recent_fail: Vec<_> = [4, 3, 2, 1].iter().map(|d| (1, *d)).collect();
        let c = score(
            &[entry("古", 1), entry("新", 2)],
            &[card(&["古"], &[old_fail, recent_good].concat(), None), card(&["新"], &[old_good, recent_fail].concat(), None)],
            &[], &[], false,
        );
        assert!(find(&c, "新").score > find(&c, "古").score);
    }

    #[test]
    fn tiny_samples_are_ineligible() {
        let many: Vec<_> = (0..40).map(|i| (if i < 10 { 1 } else { 3 }, 40 - i)).collect();
        let c = score(&[entry("少", 1), entry("多", 2)], &[card(&["少"], &[(1, 2), (3, 1)], None), card(&["多"], &many, None)], &[], &[], false);
        assert!(!find(&c, "少").eligible);
        assert_eq!(find(&c, "少").exclusion_reason, Some("insufficient-evidence"));
        assert_eq!(find(&c, "多").direct.reviews, 40);
    }

    #[test]
    fn cooldowns() {
        let ratings: Vec<_> = (0..8).map(|i| (1, i + 1)).collect();
        let direct = [card(&["議"], &ratings, None)];
        let future = RepairState { kanji: "議".into(), last_repaired_at: now() - Duration::days(1), cooldown_until: now() + Duration::days(13), repair_count: 1, last_repair_score: 0.5 };
        let cooling = score(&[entry("議", 1)], &direct, &[], std::slice::from_ref(&future), false);
        assert_eq!(cooling[0].exclusion_reason, Some("cooldown"));
        assert!(select_target(&cooling).is_none());
        let expired = RepairState { cooldown_until: now() - Duration::hours(16), ..future };
        let c = score(&[entry("議", 1)], &direct, &[], &[expired], false);
        assert!(c[0].eligible);
        assert_eq!(select_target(&c).unwrap().entry.kanji, "議");
    }

    #[test]
    fn post_repair_improvement_lowers_priority() {
        let ratings: Vec<_> = [30, 25, 20, 15].iter().map(|d| (1, *d)).chain([4, 3, 2, 1].iter().map(|d| (3, *d))).collect();
        let base = score(&[entry("議", 1)], &[card(&["議"], &ratings, None)], &[], &[], false)[0].score;
        let state = RepairState { kanji: "議".into(), last_repaired_at: now() - Duration::days(5), cooldown_until: now() - Duration::milliseconds(1), repair_count: 1, last_repair_score: 0.5 };
        let repaired = score(&[entry("議", 1)], &[card(&["議"], &ratings, None)], &[], &[state], false)[0].score;
        assert!(repaired < base);
    }

    #[test]
    fn vocabulary_signal_is_opt_in() {
        let good: Vec<_> = (0..8).map(|i| (3, i + 1)).collect();
        let direct = [card(&["会"], &good, None), card(&["議"], &good, None)];
        let bad: Vec<_> = (0..4).map(|i| (1, i + 1)).collect();
        let vocab = [card(&["議"], &bad, Some("word-1")), card(&["議"], &bad, Some("word-2"))];
        let entries = [entry("会", 1), entry("議", 2)];
        let off = score(&entries, &direct, &vocab, &[], false);
        assert_eq!(find(&off, "会").score, find(&off, "議").score);
        assert!(off.iter().all(|c| c.vocabulary.score == 0.0));
        let on = score(&entries, &direct, &vocab, &[], true);
        assert!(find(&on, "議").score > find(&on, "会").score);
        assert!(find(&on, "議").vocabulary.available);
    }

    #[test]
    fn parses_the_bundled_extract() {
        let value: Value = serde_json::from_str(crate::seed::KANJI_EXTRACT_JSON).unwrap();
        let parsed = parse_kanji_extract(&value);
        assert!(parsed.error.is_none());
        assert_eq!(parsed.entries.len(), 3000);
        assert_eq!(parsed.entries[0].kanji, "一");
        assert_eq!(parsed.entries[0].rtk_number, Some(1));
        assert_eq!(parsed.entries[0].keyword.as_deref(), Some("one"));
    }
}

//! Per-user configuration stored in `users.settings` (JSON). Every parser is
//! total: missing or malformed values fall back to defaults and numbers are
//! bounded, so stored JSON can never break a page.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::adaptive_budget::defaults as adaptive;
use crate::kanji_repair::DEFAULTS as KANJI_DEFAULTS;
use crate::util::{bounded_number, json_number, js_round};

fn section<'a>(settings: &'a Value, key: &str) -> Option<&'a Map<String, Value>> {
    settings.as_object()?.get(key)?.as_object()
}

fn get<'a>(section: Option<&'a Map<String, Value>>, key: &str) -> Option<&'a Value> {
    section.and_then(|s| s.get(key))
}

fn non_empty_string(value: Option<&Value>, max_len: usize) -> Option<String> {
    let s = value?.as_str()?.trim();
    (!s.is_empty()).then(|| s.chars().take(max_len).collect())
}

// ------------------------------------------------------------ Speed reading

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedReadingConfiguration {
    /// RSVP | PACED | CHUNKING | BENCHMARK
    pub mode: String,
    pub wpm: i64,
    pub chunk_size: i64,
    pub font_size: i64,
    pub session_minutes: i64,
    pub comprehension_threshold: i64,
    pub punctuation_pause: bool,
    pub category: String,
    pub difficulty: String,
}

pub const READING_MODES: [&str; 4] = ["RSVP", "PACED", "CHUNKING", "BENCHMARK"];

pub fn speed_reading(settings: &Value) -> SpeedReadingConfiguration {
    let saved = section(settings, "speedReading");
    let mode = get(saved, "mode")
        .and_then(Value::as_str)
        .filter(|m| READING_MODES.contains(m))
        .unwrap_or("RSVP")
        .to_string();
    let chunk_min = if mode == "CHUNKING" { 2 } else { 1 };
    SpeedReadingConfiguration {
        wpm: bounded_number(get(saved, "wpm"), 250, 50, 2_000),
        chunk_size: bounded_number(get(saved, "chunkSize"), 1, chunk_min, 5),
        font_size: bounded_number(get(saved, "fontSize"), 42, 16, 96),
        session_minutes: bounded_number(get(saved, "sessionMinutes"), 5, 1, 30),
        comprehension_threshold: bounded_number(get(saved, "comprehensionThreshold"), 80, 50, 100),
        punctuation_pause: get(saved, "punctuationPause").and_then(Value::as_bool).unwrap_or(true),
        category: non_empty_string(get(saved, "category"), 200).unwrap_or_else(|| "all".into()),
        difficulty: non_empty_string(get(saved, "difficulty"), 200).unwrap_or_else(|| "all".into()),
        mode,
    }
}

// ------------------------------------------------------- Mandarin Blueprint

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MandarinBlueprintConfiguration {
    pub character_deck_name: String,
    pub reversed_character_deck_name: String,
    pub word_deck_name: String,
}

pub fn mandarin_blueprint(settings: &Value) -> MandarinBlueprintConfiguration {
    let saved = section(settings, "mandarinBlueprint");
    let deck = |key: &str, fallback: &str| non_empty_string(get(saved, key), 100).unwrap_or_else(|| fallback.into());
    MandarinBlueprintConfiguration {
        character_deck_name: deck("characterDeckName", "Mandarin Characters"),
        reversed_character_deck_name: deck("reversedCharacterDeckName", "Mandarin Characters Reversed"),
        word_deck_name: deck("wordDeckName", "Mandarin Words"),
    }
}

// --------------------------------------------------------------- Meditation

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeditationConfiguration {
    pub session_minutes: i64,
    pub target_days_per_week: i64,
}

pub fn meditation(settings: &Value) -> MeditationConfiguration {
    let saved = section(settings, "meditation");
    MeditationConfiguration {
        session_minutes: bounded_number(get(saved, "sessionMinutes"), 10, 1, 180),
        target_days_per_week: bounded_number(get(saved, "targetDaysPerWeek"), 7, 1, 7),
    }
}

// ----------------------------------------------------------- Grammar coach

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JapaneseGrammarConfiguration {
    pub new_points_per_batch: i64,
    pub new_batch_interval_days: i64,
}

pub const DEFAULT_GRAMMAR: JapaneseGrammarConfiguration =
    JapaneseGrammarConfiguration { new_points_per_batch: 5, new_batch_interval_days: 7 };

pub fn japanese_grammar(settings: &Value) -> JapaneseGrammarConfiguration {
    let saved = section(settings, "japaneseGrammar");
    JapaneseGrammarConfiguration {
        new_points_per_batch: bounded_number(get(saved, "newPointsPerBatch"), 5, 1, 50),
        new_batch_interval_days: bounded_number(get(saved, "newBatchIntervalDays"), 7, 1, 90),
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorItemOverride {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub miss_rate_percent: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluded: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JapaneseGrammarTutorConfiguration {
    pub plan_size: i64,
    pub item_overrides: BTreeMap<String, TutorItemOverride>,
}

impl Default for JapaneseGrammarTutorConfiguration {
    fn default() -> Self {
        Self { plan_size: 3, item_overrides: BTreeMap::new() }
    }
}

pub fn japanese_grammar_tutor(settings: &Value) -> JapaneseGrammarTutorConfiguration {
    let saved = section(settings, "japaneseGrammarTutor");
    let mut item_overrides = BTreeMap::new();
    if let Some(raw) = get(saved, "itemOverrides").and_then(Value::as_object) {
        for (id, value) in raw.iter().take(1_000) {
            let Some(raw) = value.as_object().filter(|_| !id.trim().is_empty()) else { continue };
            let mut entry = TutorItemOverride::default();
            if let Some(v) = raw.get("missRatePercent")
                && v.as_str() != Some("")
                && let Some(n) = json_number(v).filter(|n| n.is_finite())
            {
                entry.miss_rate_percent = Some((js_round(n) as i64).clamp(0, 100));
            }
            if raw.get("excluded") == Some(&Value::Bool(true)) {
                entry.excluded = Some(true);
            }
            if entry.miss_rate_percent.is_some() || entry.excluded.is_some() {
                item_overrides.insert(id.clone(), entry);
            }
        }
    }
    JapaneseGrammarTutorConfiguration { plan_size: bounded_number(get(saved, "planSize"), 3, 1, 10), item_overrides }
}

// ------------------------------------------------------------- Kanji Repair

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanjiRepairConfiguration {
    pub use_vocabulary_performance: bool,
    pub cooldown_days: i64,
}

pub fn kanji_repair(settings: &Value) -> KanjiRepairConfiguration {
    let saved = section(settings, "japaneseKanjiRepair");
    KanjiRepairConfiguration {
        use_vocabulary_performance: get(saved, "useVocabularyPerformance") == Some(&Value::Bool(true)),
        cooldown_days: bounded_number(get(saved, "cooldownDays"), KANJI_DEFAULTS.cooldown_days, 1, 90),
    }
}

// ------------------------------------------------------------ Adaptive Anki

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveAnkiConfiguration {
    pub enabled: bool,
    pub starting_budget: i64,
    pub maximum_budget: i64,
    pub cold_start_protection: bool,
    pub target_review_minutes: i64,
    pub anki_day_start_hour: i64,
}

pub fn adaptive_anki(settings: &Value) -> AdaptiveAnkiConfiguration {
    let saved = section(settings, "japaneseAdaptiveAnki");
    let starting_budget = bounded_number(get(saved, "startingBudget"), adaptive::STARTING_BUDGET, 1, 100);
    AdaptiveAnkiConfiguration {
        enabled: get(saved, "enabled") == Some(&Value::Bool(true)),
        starting_budget,
        maximum_budget: bounded_number(get(saved, "maximumBudget"), adaptive::MAXIMUM_BUDGET, starting_budget, 100),
        cold_start_protection: get(saved, "coldStartProtection")
            .and_then(Value::as_bool)
            .unwrap_or(adaptive::COLD_START_PROTECTION),
        target_review_minutes: bounded_number(get(saved, "targetReviewMinutes"), adaptive::TARGET_REVIEW_MINUTES, 10, 240),
        anki_day_start_hour: bounded_number(get(saved, "ankiDayStartHour"), adaptive::ANKI_DAY_START_HOUR, 0, 23),
    }
}

// --------------------------------------------------------------------- AI

/// Which assistant answers "ask the AI" requests and how it authenticates.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfiguration {
    /// claude | openai | gemini
    pub provider: String,
    /// subscription (official CLI signed in to your plan) | api (API key)
    pub mode: String,
    /// Optional model override; empty = provider default.
    pub model: String,
}

pub const AI_PROVIDERS: [&str; 3] = ["claude", "openai", "gemini"];
pub const AI_MODES: [&str; 2] = ["subscription", "api"];
/// Providers whose subscription (plan) can be used. Claude and Gemini plans
/// are API-key only for now.
pub const SUBSCRIPTION_PROVIDERS: [&str; 1] = ["openai"];

pub fn ai(settings: &Value) -> AiConfiguration {
    let saved = section(settings, "ai");
    let pick = |key: &str, allowed: &[&str], fallback: &str| {
        get(saved, key).and_then(Value::as_str).filter(|v| allowed.contains(v)).unwrap_or(fallback).to_string()
    };
    let provider = pick("provider", &AI_PROVIDERS, "openai");
    let mut mode = pick("mode", &AI_MODES, "subscription");
    if !SUBSCRIPTION_PROVIDERS.contains(&provider.as_str()) {
        mode = "api".into();
    }
    AiConfiguration {
        provider,
        mode,
        model: get(saved, "model")
            .and_then(Value::as_str)
            .map(|m| m.trim().chars().take(120).collect::<String>())
            .filter(|m| m.chars().all(|c| c.is_ascii_alphanumeric() || "-._:/[]".contains(c)))
            .unwrap_or_default(),
    }
}

/// Merge one configuration section into the settings object.
pub fn with_section(settings: &Value, key: &str, value: impl Serialize) -> Value {
    let mut root = settings.as_object().cloned().unwrap_or_default();
    root.insert(key.to_string(), serde_json::to_value(value).unwrap_or(Value::Null));
    Value::Object(root)
}

pub fn default_user_settings() -> Value {
    json!({ "dailyNewCards": 20, "dailyReviewCap": 200, "defaultStudyMode": "balanced" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_bounds() {
        let empty = json!({});
        assert_eq!(speed_reading(&empty).wpm, 250);
        assert_eq!(speed_reading(&json!({"speedReading": {"wpm": 5000, "mode": "CHUNKING", "chunkSize": 1}})).wpm, 2000);
        assert_eq!(speed_reading(&json!({"speedReading": {"mode": "CHUNKING", "chunkSize": 1}})).chunk_size, 2);
        assert_eq!(meditation(&json!({"meditation": {"sessionMinutes": "15"}})).session_minutes, 15);
        let adaptive = adaptive_anki(&json!({"japaneseAdaptiveAnki": {"startingBudget": 30, "maximumBudget": 5}}));
        assert_eq!((adaptive.starting_budget, adaptive.maximum_budget), (30, 30));
        assert!(!adaptive.enabled);
    }

    #[test]
    fn tutor_overrides_are_sanitized() {
        let parsed = japanese_grammar_tutor(&json!({"japaneseGrammarTutor": {"planSize": 2, "itemOverrides": {
            "a": {"missRatePercent": "140"}, "b": {"excluded": true}, "c": {"missRatePercent": ""}, " ": {"excluded": true}
        }}}));
        assert_eq!(parsed.plan_size, 2);
        assert_eq!(parsed.item_overrides["a"].miss_rate_percent, Some(100));
        assert_eq!(parsed.item_overrides["b"].excluded, Some(true));
        assert!(!parsed.item_overrides.contains_key("c"));
        assert_eq!(parsed.item_overrides.len(), 2);
    }

    #[test]
    fn ai_defaults_to_chatgpt_subscription() {
        let c = ai(&json!({}));
        assert_eq!((c.provider.as_str(), c.mode.as_str(), c.model.as_str()), ("openai", "subscription", ""));
        // Claude and Gemini plans can't be used: their subscription mode falls back to API key.
        let c = ai(&json!({"ai": {"provider": "claude", "mode": "subscription"}}));
        assert_eq!((c.provider.as_str(), c.mode.as_str()), ("claude", "api"));
        let c = ai(&json!({"ai": {"provider": "gemini", "mode": "subscription"}}));
        assert_eq!((c.provider.as_str(), c.mode.as_str()), ("gemini", "api"));
        let c = ai(&json!({"ai": {"provider": "openai", "mode": "api", "model": "gpt-5; rm -rf"}}));
        assert_eq!((c.provider.as_str(), c.mode.as_str(), c.model.as_str()), ("openai", "api", ""));
    }
}

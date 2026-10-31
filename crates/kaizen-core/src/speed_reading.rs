//! Speed reading: tokenization for RSVP/paced display, adaptive pacing,
//! passage validation, and the passage-generation prompt.

use std::collections::{BTreeSet, HashSet};

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use unicode_segmentation::UnicodeSegmentation;

use crate::time::local_date;

pub const DEFAULT_WPM: i64 = 250;

fn is_japanese_char(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0xFF66..=0xFF9F)
}

pub fn count_japanese_characters(text: &str) -> usize {
    text.chars().filter(|c| is_japanese_char(*c)).count()
}

fn is_word_like(segment: &str) -> bool {
    segment.chars().any(char::is_alphanumeric)
}

/// Display tokens: word-like segments, with punctuation attached to the
/// preceding token. Japanese text is segmented morphologically.
pub fn tokenize_passage(text: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut push = |segment: &str, word_like: bool| {
        if segment.trim().is_empty() {
            return;
        }
        if word_like || tokens.is_empty() {
            tokens.push(segment.to_string());
        } else if let Some(last) = tokens.last_mut() {
            last.push_str(segment);
        }
    };
    if count_japanese_characters(text) > 0 {
        for morpheme in crate::lemmatize::tokenize_ja(text) {
            let word_like = morpheme.pos != "記号" && is_word_like(&morpheme.surface);
            push(&morpheme.surface, word_like);
        }
    } else {
        for segment in text.split_word_bounds() {
            push(segment, is_word_like(segment));
        }
    }
    tokens
}

/// Next session speed: +5% (≥10) when comfortably above the comprehension
/// threshold, −5% (≥10) when below; the latest retention check caps accuracy.
pub fn adaptive_wpm(current_wpm: i64, accuracy: f64, threshold: f64, latest_retention: Option<f64>) -> i64 {
    let effective = latest_retention.map_or(accuracy, |r| accuracy.min(r));
    let step = 10.max(crate::util::js_round(current_wpm as f64 * 0.05) as i64);
    if effective >= threshold + 0.1 {
        (current_wpm + step).min(2_000)
    } else if effective < threshold {
        (current_wpm - step).max(50)
    } else {
        current_wpm
    }
}

pub fn reading_streak(dates: &[DateTime<Utc>], now: DateTime<Utc>, tz: Tz) -> (u32, u32) {
    let days: BTreeSet<_> = dates.iter().map(|d| local_date(*d, tz)).collect();
    crate::time::streak_from_dates(&days, local_date(now, tz))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub prompt: String,
    pub choices: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerKey {
    pub question_id: String,
    pub correct_index: usize,
    pub explanation: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageInput {
    pub title: String,
    pub topic: String,
    pub category: String,
    pub difficulty: String,
    #[serde(default)]
    pub source_url: Option<String>,
    pub text: String,
    pub questions: Vec<Question>,
    pub answer_key: Vec<AnswerKey>,
}

fn bounded(field: &str, value: &str, max: usize, errors: &mut Vec<String>) {
    let len = value.trim().chars().count();
    if len == 0 {
        errors.push(format!("{field} is required."));
    } else if len > max {
        errors.push(format!("{field} must be at most {max} characters."));
    }
}

/// Validate a generated passage. (The original reused the grammar-lesson
/// contract here — exactly two questions and 100+ Japanese characters — which
/// rejected every passage produced by its own generation prompt.)
pub fn validate_passage(value: &Value) -> Result<PassageInput, String> {
    let object = value.as_object().ok_or("The passage must be a JSON object.")?;
    let allowed = ["title", "topic", "category", "difficulty", "sourceUrl", "text", "questions", "answerKey"];
    if let Some(unknown) = object.keys().find(|k| !allowed.contains(&k.as_str())) {
        return Err(format!("Unrecognized key \"{unknown}\"."));
    }
    let mut passage: PassageInput =
        serde_json::from_value(value.clone()).map_err(|e| format!("The passage JSON does not match the required shape: {e}"))?;
    let mut errors = Vec::new();
    bounded("title", &passage.title, 200, &mut errors);
    bounded("topic", &passage.topic, 120, &mut errors);
    bounded("category", &passage.category, 80, &mut errors);
    bounded("difficulty", &passage.difficulty, 120, &mut errors);
    if let Some(url) = &passage.source_url
        && url::Url::parse(url).is_err()
    {
        errors.push("sourceUrl must be a valid URL.".into());
    }
    let text_len = passage.text.trim().chars().count();
    if text_len < 100 {
        errors.push("The passage text must contain at least 100 characters.".into());
    }
    if passage.questions.is_empty() || passage.questions.len() > 10 {
        errors.push("Include between 1 and 10 questions.".into());
    }
    let mut ids = HashSet::new();
    for q in &passage.questions {
        if q.id.trim().is_empty() || q.prompt.trim().is_empty() {
            errors.push("Every question needs an id and a prompt.".into());
        }
        if !ids.insert(q.id.trim().to_string()) {
            errors.push("Question IDs must be unique.".into());
        }
        if !(2..=6).contains(&q.choices.len()) || q.choices.iter().any(|c| c.trim().is_empty()) {
            errors.push(format!("Question {} needs 2–6 non-empty choices.", q.id));
        }
    }
    let mut answered = HashSet::new();
    for a in &passage.answer_key {
        match passage.questions.iter().find(|q| q.id == a.question_id) {
            None => errors.push(format!("Answer {} does not reference a question.", a.question_id)),
            Some(q) if a.correct_index >= q.choices.len() => {
                errors.push(format!("correctIndex for {} is outside the question choices.", a.question_id))
            }
            _ => {}
        }
        if a.explanation.trim().is_empty() {
            errors.push(format!("Answer {} needs an explanation.", a.question_id));
        }
        if !answered.insert(a.question_id.clone()) {
            errors.push("Each question may have only one answer.".into());
        }
    }
    if passage.questions.iter().any(|q| !answered.contains(&q.id)) {
        errors.push("Every question must have an answer-key entry.".into());
    }
    if !errors.is_empty() {
        errors.dedup();
        return Err(errors.join(" "));
    }
    passage.title = passage.title.trim().into();
    passage.text = passage.text.trim().into();
    Ok(passage)
}

/// Score answers against the key; returns (correct, per-question explanations).
pub fn score_answers(questions: &[Question], answer_key: &[AnswerKey], answers: &serde_json::Map<String, Value>) -> Result<(usize, Vec<Value>), String> {
    if questions.is_empty() || questions.len() != answer_key.len() {
        return Err("This passage has an invalid question set.".into());
    }
    let mut correct = 0;
    let mut explanations = Vec::new();
    for q in questions {
        let key = answer_key.iter().find(|a| a.question_id == q.id).ok_or(format!("Missing answer for {}.", q.id))?;
        let selected = answers.get(&q.id).and_then(Value::as_u64).map(|v| v as usize);
        let is_correct = selected == Some(key.correct_index);
        if is_correct {
            correct += 1;
        }
        explanations.push(json!({
            "questionId": q.id,
            "selected": selected,
            "correctIndex": key.correct_index,
            "isCorrect": is_correct,
            "explanation": key.explanation,
        }));
    }
    Ok((correct, explanations))
}

pub fn build_generation_prompt(category: &str, difficulty: &str, target_words: i64) -> String {
    let choices = json!(["Choice A", "Choice B", "Choice C", "Choice D"]);
    let example = json!({
        "title": "Descriptive title",
        "topic": "Specific topic",
        "category": category,
        "difficulty": difficulty,
        "sourceUrl": "https://en.wikipedia.org/wiki/Relevant_article",
        "text": "Three to six paragraphs of self-contained informational prose.",
        "questions": [
            { "id": "q1", "prompt": "A question answerable only from the passage", "choices": choices },
            { "id": "q2", "prompt": "A second passage-only question", "choices": choices },
            { "id": "q3", "prompt": "A third passage-only question", "choices": choices },
            { "id": "q4", "prompt": "A fourth passage-only question", "choices": choices }
        ],
        "answerKey": [
            { "questionId": "q1", "correctIndex": 0, "explanation": "Brief passage-grounded explanation" },
            { "questionId": "q2", "correctIndex": 1, "explanation": "Brief passage-grounded explanation" },
            { "questionId": "q3", "correctIndex": 2, "explanation": "Brief passage-grounded explanation" },
            { "questionId": "q4", "correctIndex": 3, "explanation": "Brief passage-grounded explanation" }
        ]
    });
    format!(
        "# Speed-reading passage generation

Create one self-contained educational reading exercise for a speed-reading trainer.

Requirements:
1. Select a random informational topic in the category \"{category}\" at \"{difficulty}\" difficulty.
2. Base factual claims on a reliable public source, preferably Wikipedia, and include the direct source URL.
3. Write approximately {target_words} words in three to six short paragraphs. Paraphrase; do not copy long source passages.
4. Write 4–6 multiple-choice comprehension questions based only on the passage. Include plausible distractors.
5. Provide exactly one answer-key entry per question, with a zero-based correctIndex and a brief explanation.
6. Do not rely on images, tables, equations, or outside knowledge to answer.
7. Return only one JSON object, with no markdown fence or commentary.

Required shape:
{}
",
        serde_json::to_string_pretty(&example).unwrap_or_default()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizes_english_with_attached_punctuation() {
        let tokens = tokenize_passage("Hello, world! It's 9 a.m. here.");
        assert_eq!(tokens.first().map(String::as_str), Some("Hello,"));
        assert!(tokens.contains(&"world!".to_string()));
        assert!(tokens.iter().all(|t| !t.trim().is_empty()));
    }

    #[test]
    fn tokenizes_japanese_morphologically() {
        let tokens = tokenize_passage("今日は良い天気です。");
        assert!(tokens.len() >= 4, "{tokens:?}");
        assert!(tokens.last().unwrap().ends_with('。'));
    }

    #[test]
    fn pacing() {
        assert_eq!(adaptive_wpm(250, 1.0, 0.8, None), 263);
        assert_eq!(adaptive_wpm(250, 0.5, 0.8, None), 237);
        assert_eq!(adaptive_wpm(250, 0.85, 0.8, None), 250);
        assert_eq!(adaptive_wpm(250, 1.0, 0.8, Some(0.6)), 237);
        assert_eq!(adaptive_wpm(55, 0.0, 0.8, None), 50);
    }

    #[test]
    fn starter_passage_validates() {
        let p = validate_passage(&crate::seed::starter_passage()).unwrap();
        assert_eq!(p.questions.len(), 4);
        let mut bad = crate::seed::starter_passage();
        bad["answerKey"][0]["correctIndex"] = json!(9);
        assert!(validate_passage(&bad).unwrap_err().contains("outside"));
    }
}

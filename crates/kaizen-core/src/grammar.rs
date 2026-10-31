//! Japanese grammar coach: SRS queue selection, lesson prompts, rating
//! mapping, tutor plans, and lesson analytics.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::settings::{JapaneseGrammarConfiguration, JapaneseGrammarTutorConfiguration, TutorItemOverride, DEFAULT_GRAMMAR};
use crate::srs::{rate, Maturity, Rating, SrsResult, SrsState};
use crate::time::{date_key, local_date, start_of_day, start_of_week};
use crate::util::{js_round, thousands};

pub const REVIEW_LIMIT: usize = 12;
pub const FIRST_TRY_MATURE_DAYS: f64 = 30.0;
pub const PROMPT_VERSION: &str = "grammar-placement-v7";

/// Ratings the learner picks in the app (mapped onto SRS ratings).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AppRating {
    Again,
    Good,
    Perfect,
}

impl AppRating {
    pub fn parse(value: &str) -> Option<AppRating> {
        match value.trim().to_ascii_uppercase().as_str() {
            "AGAIN" => Some(AppRating::Again),
            "GOOD" => Some(AppRating::Good),
            "PERFECT" => Some(AppRating::Perfect),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ScheduledType {
    New,
    Review,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarResult {
    pub learning_item_id: String,
    pub rating: Rating,
    pub mastered_on_placement: bool,
    pub correct: i64,
    pub total: i64,
    pub notes: String,
}

/// App rating → SRS result. Perfect on a NEW point = mastered on placement.
pub fn result_from_app_rating(learning_item_id: &str, rating: AppRating, scheduled: ScheduledType) -> GrammarResult {
    let perfect = rating == AppRating::Perfect;
    GrammarResult {
        learning_item_id: learning_item_id.to_string(),
        rating: match rating {
            AppRating::Again => Rating::Again,
            AppRating::Good => Rating::Good,
            AppRating::Perfect => Rating::Easy,
        },
        mastered_on_placement: perfect && scheduled == ScheduledType::New,
        correct: if rating == AppRating::Again { 0 } else { 1 },
        total: 1,
        notes: match (rating, scheduled) {
            (AppRating::Perfect, ScheduledType::New) => "Rated Perfect on first exposure.",
            (AppRating::Perfect, ScheduledType::Review) => "Rated Perfect on review.",
            (AppRating::Good, _) => "Rated Good in the app.",
            (AppRating::Again, _) => "Rated Again in the app.",
        }
        .to_string(),
    }
}

/// Grammar progress status (`grammar_progress.status`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Status {
    New,
    Learning,
    Review,
    Mastered,
}

impl Status {
    pub fn parse(value: &str) -> Status {
        match value {
            "LEARNING" => Status::Learning,
            "REVIEW" => Status::Review,
            "MASTERED" => Status::Mastered,
            _ => Status::New,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Status::New => "NEW",
            Status::Learning => "LEARNING",
            Status::Review => "REVIEW",
            Status::Mastered => "MASTERED",
        }
    }
}

pub struct Scheduled {
    pub status: Status,
    pub next: SrsResult,
}

pub fn schedule_result(state: SrsState, status: Status, rating: Rating, mastered_on_placement: bool, now: DateTime<Utc>) -> Scheduled {
    let mut next = rate(state, rating, now);
    if status == Status::New && mastered_on_placement {
        next.state.interval_days = FIRST_TRY_MATURE_DAYS;
        next.due_at = now + Duration::days(FIRST_TRY_MATURE_DAYS as i64);
        next.maturity = Maturity::Mature;
        return Scheduled { status: Status::Mastered, next };
    }
    let status = if next.state.interval_days >= 21.0 {
        Status::Mastered
    } else if next.state.interval_days >= 1.0 {
        Status::Review
    } else {
        Status::Learning
    };
    Scheduled { status, next }
}

/// Status after an ordinary in-app review rating.
pub fn status_for_interval(interval_days: f64) -> Status {
    if interval_days >= 21.0 {
        Status::Mastered
    } else if interval_days >= 1.0 {
        Status::Review
    } else {
        Status::Learning
    }
}

#[derive(Clone, Debug)]
pub struct QueueRow {
    pub learning_item_id: String,
    pub status: Status,
    pub curriculum_order: i64,
    pub due_at: DateTime<Utc>,
    pub introduced_at: Option<DateTime<Utc>>,
    pub is_leech: bool,
}

/// Start of the local day on which the next batch of new points unlocks.
pub fn next_batch_at(rows: &[QueueRow], configuration: &JapaneseGrammarConfiguration, tz: Tz) -> Option<DateTime<Utc>> {
    if !rows.iter().any(|r| r.status == Status::New) {
        return None;
    }
    let latest = rows.iter().filter_map(|r| r.introduced_at).max()?;
    let date = local_date(latest, tz) + Duration::days(configuration.new_batch_interval_days);
    Some(crate::time::start_of_date(date, tz))
}

pub fn new_due_today(rows: &[QueueRow], now: DateTime<Utc>, configuration: &JapaneseGrammarConfiguration, tz: Tz) -> usize {
    let unseen = rows.iter().filter(|r| r.status == Status::New).count();
    if unseen == 0 {
        return 0;
    }
    if let Some(next) = next_batch_at(rows, configuration, tz)
        && start_of_day(now, tz) < next
    {
        return 0;
    }
    (configuration.new_points_per_batch.max(0) as usize).min(unseen)
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Queue {
    pub review_ids: Vec<String>,
    pub new_ids: Vec<String>,
}

impl Queue {
    pub fn ids(&self) -> Vec<String> {
        self.review_ids.iter().chain(self.new_ids.iter()).cloned().collect()
    }
    pub fn len(&self) -> usize {
        self.review_ids.len() + self.new_ids.len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Due reviews (leeches first, then due date, then curriculum order, capped)
/// plus the next batch of unseen points in curriculum order.
pub fn select_queue(rows: &[QueueRow], now: DateTime<Utc>, configuration: &JapaneseGrammarConfiguration, tz: Tz) -> Queue {
    let mut reviews: Vec<&QueueRow> = rows.iter().filter(|r| r.status != Status::New && r.due_at <= now).collect();
    reviews.sort_by(|a, b| {
        b.is_leech
            .cmp(&a.is_leech)
            .then(a.due_at.cmp(&b.due_at))
            .then(a.curriculum_order.cmp(&b.curriculum_order))
    });
    let mut new: Vec<&QueueRow> = rows.iter().filter(|r| r.status == Status::New).collect();
    new.sort_by_key(|r| r.curriculum_order);
    Queue {
        review_ids: reviews.into_iter().take(REVIEW_LIMIT).map(|r| r.learning_item_id.clone()).collect(),
        new_ids: new
            .into_iter()
            .take(new_due_today(rows, now, configuration, tz))
            .map(|r| r.learning_item_id.clone())
            .collect(),
    }
}

/// A saved lesson is current when it was generated today for exactly this queue.
pub fn lesson_matches_queue(scheduled_for: DateTime<Utc>, grammar_item_ids: &[String], queue: &Queue, now: DateTime<Utc>, tz: Tz) -> bool {
    local_date(scheduled_for, tz) == local_date(now, tz) && grammar_item_ids == queue.ids().as_slice()
}

pub fn level_from_known_words(known_words: i64) -> &'static str {
    match known_words {
        n if n < 500 => "absolute beginner (pre-JLPT N5 vocabulary)",
        n if n < 800 => "beginner (early JLPT N5 vocabulary)",
        n if n < 1_500 => "upper beginner (strong N5, approaching N4 vocabulary)",
        n if n < 3_750 => "lower intermediate (approximately N4–N3 vocabulary)",
        n if n < 6_000 => "intermediate (approximately N3–N2 vocabulary)",
        n if n < 10_000 => "upper intermediate (approximately N2 vocabulary)",
        _ => "advanced (approximately N1+ vocabulary)",
    }
}

// ------------------------------------------------------------- Vocabulary

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonVocabulary {
    /// anki-mature | migaku | anki-leech | known-word
    pub source: String,
    pub term: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reading: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

fn vocabulary_seed(value: &str) -> u32 {
    crate::util::fnv1a_utf16(value)
}

/// Deterministic per-day shuffle (mulberry32 over the date key), so a lesson
/// regenerated later the same day gets the same words.
pub fn select_daily_vocabulary(candidates: &[LessonVocabulary], count: usize, now: DateTime<Utc>, tz: Tz) -> Vec<LessonVocabulary> {
    let key_of = |c: &LessonVocabulary| {
        c.key.clone().unwrap_or_else(|| format!("{}|{}", c.term, c.reading.as_deref().unwrap_or("")))
    };
    let mut sorted: Vec<&LessonVocabulary> = candidates.iter().collect();
    sorted.sort_by(|a, b| key_of(a).cmp(&key_of(b)).then_with(|| a.source.cmp(&b.source)));
    let mut unique: Vec<LessonVocabulary> = Vec::new();
    let mut seen = HashSet::new();
    for c in sorted {
        let key = c
            .key
            .as_deref()
            .map(str::trim)
            .filter(|k| !k.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{}|{}", c.term.trim(), c.reading.as_deref().map(str::trim).unwrap_or("")));
        if !c.term.trim().is_empty() && seen.insert(key.clone()) {
            unique.push(LessonVocabulary { key: Some(key), ..c.clone() });
        }
    }
    let mut state = vocabulary_seed(&date_key(local_date(now, tz)));
    let mut random = || {
        state = state.wrapping_add(0x6D2B_79F5);
        let mut value = state;
        value = (value ^ (value >> 15)).wrapping_mul(value | 1);
        value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(value | 61));
        (value ^ (value >> 14)) as f64 / 4_294_967_296.0
    };
    for index in (1..unique.len()).rev() {
        let swap = (random() * (index + 1) as f64).floor() as usize;
        unique.swap(index, swap);
    }
    unique.truncate(count);
    unique
}

// ----------------------------------------------------------------- Prompts

#[derive(Clone, Debug)]
pub struct PromptItem {
    pub learning_item_id: String,
    pub pattern: String,
}

pub fn build_lesson_prompt(
    level_label: &str,
    known_words: i64,
    items: &[PromptItem],
    vocabulary: &[LessonVocabulary],
    schedule: Option<&JapaneseGrammarConfiguration>,
) -> String {
    let schedule = schedule.copied().unwrap_or(DEFAULT_GRAMMAR);
    let item_rows = items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let words: Vec<&str> =
                vocabulary.iter().skip(index * 3).take(3).map(|w| w.term.as_str()).collect();
            let words = if words.is_empty() { "No assigned words".to_string() } else { words.join(" / ") };
            format!("{}. Grammar: {}\n   Words to use: {}", index + 1, item.pattern, words)
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let final_rows =
        (1..=items.len()).map(|n| format!("{n}. <Again-or-Good-or-Perfect>")).collect::<Vec<_>>().join("\n");
    let days = schedule.new_batch_interval_days;
    let day_word = if days == 1 { "day" } else { "days" };

    format!(
        r#"# Today's Japanese grammar lesson

Prompt version: {PROMPT_VERSION}

You are my interactive Japanese grammar coach. Finish every scheduled grammar point before moving to secondary Japanese feedback. The scheduled grammar points are the lesson; do not introduce random grammar problems.

## Learner profile

- Algorithmic level estimate: **{level_label}**
- Conservative known-word count: **{known}**
- New grammar pace: **{points} points every {days} {day_word}**
- The assigned words come from mature Anki cards and imported Migaku known words.

## Daily vocabulary assignments

Each grammar point below has three words selected by the app for today. Use all three assigned words across the generated placement sentence, explanation examples, confirmation question, or production practice for that grammar point. They do not all need to appear in one sentence. Do not replace them with your usual stock nouns and verbs. All three assigned words must be used before that grammar point receives its final rating.

## Grammar points and words

{item_rows}

No curriculum examples have been supplied. Create every sentence yourself from the grammar pattern and assigned words.

## First response: generate a fresh placement check

Create exactly one new, natural Japanese sentence for each numbered grammar point above. For each sentence:

- Use the target grammar construction correctly and naturally.
- Use at least one of that point's three assigned words.
- Bold only the complete target construction, not the entire sentence.
- Do not name the grammar pattern, explain it, translate it, or reveal its meaning.
- Do not reuse a sentence from a previous lesson or fall back to a stock textbook sentence.

Print only the numbered Japanese sentences in the same order as the grammar points. Then ask me to translate each sentence and explain the bold target construction. Wait for my answer before teaching anything.

## Lesson flow

1. Grade the placement translation and explanation for each numbered grammar point.
2. If the target grammar is clearly understood, do not overteach it.
3. If understanding is uncertain, ask exactly one focused confirmation question.
4. If the target grammar is misunderstood, explain formation, meaning, and nuance, then test it with a fresh example.
5. Keep progressing automatically until every numbered point has a final rating. Do not ask whether I want to continue.
6. After the grammar points are finished, briefly explain and correct only Japanese issues that actually occurred, such as word choice, particles, tense, naturalness, or nuance.

An unrelated vocabulary or English-naturalness mistake must not erase demonstrated understanding of the target grammar.

## Rating rubric

- Again: the target grammar was still fundamentally misunderstood or unusable after teaching.
- Good: the target grammar was understood after a correction, hint, confirmation, or meaningful effort.
- Perfect: immediate, complete command of the target grammar without help.

Do not use Hard, Easy, scores, percentages, JSON, learningItemIds, explanations, or commentary in the final output.

## Final output

After every scheduled point is finished, output exactly one numbered rating line per point in the original order:

{final_rows}

Replace every placeholder with exactly Again, Good, or Perfect. The app will interpret Perfect as EASY for a review item and as mastered on placement for a NEW item. Do not print anything before or after the numbered list.
"#,
        known = thousands(known_words),
        points = schedule.new_points_per_batch,
    )
}

/// Extract the coach's final numbered rating list ("1. Good\n2. Again …") from
/// an AI reply. Returns ratings only when exactly `expected` lines are found.
pub fn parse_final_ratings(text: &str, expected: usize) -> Option<Vec<AppRating>> {
    let re = regex::Regex::new(r"(?m)^\s*(\d+)[.)]\s*\**\s*(again|good|perfect)\b").ok()?;
    let mut by_number: BTreeMap<usize, AppRating> = BTreeMap::new();
    for caps in re.captures_iter(&text.to_lowercase()) {
        let n: usize = caps[1].parse().ok()?;
        if let Some(rating) = AppRating::parse(&caps[2]) {
            by_number.insert(n, rating); // last occurrence wins (the final list)
        }
    }
    let ratings: Vec<AppRating> = (1..=expected).map_while(|n| by_number.get(&n).copied()).collect();
    (expected > 0 && ratings.len() == expected).then_some(ratings)
}

// --------------------------------------------------------------- Tutor plan

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorPlanItem {
    pub learning_item_id: String,
    pub pattern: String,
    pub meaning: String,
    pub jlpt_level: String,
    pub examples: Vec<String>,
    pub curriculum_order: i64,
    pub total_correct: i64,
    pub total_questions: i64,
    pub lapse_count: i64,
    pub is_leech: bool,
    pub last_rating: Option<Rating>,
}

pub fn recorded_miss_rate_percent(item: &TutorPlanItem) -> i64 {
    if item.total_questions <= 0 {
        return 0;
    }
    let misses = (item.total_questions - item.total_correct).max(0);
    js_round(misses as f64 / item.total_questions as f64 * 100.0) as i64
}

pub fn tutor_miss_rate_percent(item: &TutorPlanItem, override_: Option<&TutorItemOverride>) -> i64 {
    override_.and_then(|o| o.miss_rate_percent).unwrap_or_else(|| recorded_miss_rate_percent(item))
}

/// Whether an item has enough history to appear in tutor customization.
pub fn has_tutor_history(item: &TutorPlanItem) -> bool {
    item.total_questions > 0
        || item.lapse_count > 0
        || item.is_leech
        || matches!(item.last_rating, Some(Rating::Again) | Some(Rating::Hard))
}

pub fn select_worst_points<'a>(
    items: &'a [TutorPlanItem],
    limit: usize,
    overrides: &BTreeMap<String, TutorItemOverride>,
) -> Vec<&'a TutorPlanItem> {
    let mut selected: Vec<&TutorPlanItem> = items
        .iter()
        .filter(|item| {
            let o = overrides.get(&item.learning_item_id);
            if o.and_then(|o| o.excluded) == Some(true) {
                return false;
            }
            tutor_miss_rate_percent(item, o) > 0
                || item.lapse_count > 0
                || item.is_leech
                || matches!(item.last_rating, Some(Rating::Again) | Some(Rating::Hard))
        })
        .collect();
    selected.sort_by(|a, b| {
        let ra = tutor_miss_rate_percent(a, overrides.get(&a.learning_item_id));
        let rb = tutor_miss_rate_percent(b, overrides.get(&b.learning_item_id));
        rb.cmp(&ra)
            .then(b.is_leech.cmp(&a.is_leech))
            .then(b.lapse_count.cmp(&a.lapse_count))
            .then(b.total_questions.cmp(&a.total_questions))
            .then(a.curriculum_order.cmp(&b.curriculum_order))
    });
    selected.truncate(limit);
    selected
}

pub fn build_tutor_lesson_plan(items: &[TutorPlanItem], configuration: &JapaneseGrammarTutorConfiguration) -> String {
    let selected = select_worst_points(items, configuration.plan_size.max(0) as usize, &configuration.item_overrides);
    if selected.is_empty() {
        return String::new();
    }
    let rows = selected
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let misses = (item.total_questions - item.total_correct).max(0);
            let recorded = recorded_miss_rate_percent(item);
            let o = configuration.item_overrides.get(&item.learning_item_id);
            let rate = tutor_miss_rate_percent(item, o);
            let history = match o.and_then(|o| o.miss_rate_percent) {
                None => format!("{rate}% missed ({misses}/{} recorded attempts)", item.total_questions),
                Some(_) => format!(
                    "{rate}% missed for tutor planning (manually set; recorded history is {recorded}% or {misses}/{})",
                    item.total_questions
                ),
            };
            let mut lines = vec![
                format!("{}. {} ({}) — {}", index + 1, item.pattern, item.jlpt_level, item.meaning),
                format!(
                    "   History: {history}; {} SRS lapses{}.",
                    item.lapse_count,
                    if item.is_leech { "; currently marked as a leech" } else { "" }
                ),
            ];
            if let Some(example) = item.examples.first() {
                lines.push(format!("   Reference example: {example}"));
            }
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "# Japanese grammar tutor lesson plan

Please spend this session expanding and correcting the learner's weakest recurring grammar points. These were selected primarily by percentage of recorded attempts missed, with lapses and leech status used as supporting signals. Tutor-plan overrides and exclusions have already been applied.

{rows}

For each point:
1. Diagnose the learner with one fresh recognition or translation example.
2. Explain formation, meaning, register, and the most important nuance or contrast.
3. Compare it with one easily confused construction when useful.
4. Ask for one controlled production sentence and one natural conversational use.
5. Correct vocabulary, particles, tense, and naturalness separately from the target grammar.

Spend the most time on errors that recur. Do not mark a point secure merely because the learner recognizes the explanation."
    )
}

// ---------------------------------------------------------------- Analytics

#[derive(Clone, Debug)]
pub struct AnalyticsProgressRow {
    pub status: Status,
    pub due_at: DateTime<Utc>,
    pub total_correct: i64,
    pub total_questions: i64,
}

#[derive(Clone, Debug)]
pub struct AnalyticsLessonRow {
    pub completed_at: Option<DateTime<Utc>>,
    pub response: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Bar {
    pub label: String,
    pub value: i64,
    pub tooltip: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarAnalytics {
    pub completed_lessons: usize,
    pub lessons_today: usize,
    pub total_correct: i64,
    pub total_questions: i64,
    pub accuracy: Option<f64>,
    pub mastered: usize,
    pub due: usize,
    pub current_streak: u32,
    pub imported_passages: i64,
    pub rating_distribution: Vec<Bar>,
    pub weekly_progress: Vec<Bar>,
}

fn lesson_ratings(response: &Value) -> Vec<Rating> {
    response
        .get("grammarResults")
        .and_then(Value::as_array)
        .map(|results| {
            results
                .iter()
                .filter_map(|r| r.get("rating").and_then(Value::as_str).and_then(Rating::parse))
                .collect()
        })
        .unwrap_or_default()
}

pub fn analyze(
    progress: &[AnalyticsProgressRow],
    lessons: &[AnalyticsLessonRow],
    imported_passages: i64,
    now: DateTime<Utc>,
    tz: Tz,
) -> GrammarAnalytics {
    let completed: Vec<(DateTime<Utc>, Vec<Rating>)> = lessons
        .iter()
        .filter_map(|lesson| {
            let ratings = lesson.response.as_ref().map(lesson_ratings).unwrap_or_default();
            match lesson.completed_at {
                Some(at) if !ratings.is_empty() => Some((at, ratings)),
                _ => None,
            }
        })
        .collect();
    let total_correct: i64 = progress.iter().map(|r| r.total_correct).sum();
    let total_questions: i64 = progress.iter().map(|r| r.total_questions).sum();
    let mut counts: HashMap<Rating, i64> = HashMap::new();
    for (_, ratings) in &completed {
        for rating in ratings {
            *counts.entry(*rating).or_default() += 1;
        }
    }
    let days: std::collections::BTreeSet<_> = completed.iter().map(|(at, _)| local_date(*at, tz)).collect();
    let (current_streak, _) = crate::time::streak_from_dates(&days, local_date(now, tz));

    let current_week = start_of_week(now, tz);
    let weekly_progress = (0..8)
        .map(|index| {
            let start_date = current_week - Duration::days((7 - index) * 7);
            let start = crate::time::start_of_date(start_date, tz);
            let end = crate::time::start_of_date(start_date + Duration::days(7), tz);
            let rows: Vec<&(DateTime<Utc>, Vec<Rating>)> =
                completed.iter().filter(|(at, _)| *at >= start && *at < end).collect();
            let points: usize = rows.iter().map(|(_, r)| r.len()).sum();
            Bar {
                label: format!("{}/{}", start_date.format("%-m"), start_date.format("%-d")),
                value: points as i64,
                tooltip: format!(
                    "{}: {points} grammar results across {} {}",
                    start_date.format("%-m/%-d/%Y"),
                    rows.len(),
                    if rows.len() == 1 { "lesson" } else { "lessons" }
                ),
            }
        })
        .collect();
    let today = local_date(now, tz);
    GrammarAnalytics {
        completed_lessons: completed.len(),
        lessons_today: completed.iter().filter(|(at, _)| local_date(*at, tz) == today).count(),
        total_correct,
        total_questions,
        accuracy: (total_questions > 0).then(|| total_correct as f64 / total_questions as f64),
        mastered: progress.iter().filter(|r| r.status == Status::Mastered).count(),
        due: progress.iter().filter(|r| r.status != Status::New && r.due_at <= now).count(),
        current_streak,
        imported_passages,
        rating_distribution: Rating::ALL
            .iter()
            .map(|rating| {
                let value = counts.get(rating).copied().unwrap_or(0);
                let label = match rating {
                    Rating::Easy => "Perfect",
                    Rating::Hard => "Hard (legacy)",
                    Rating::Again => "Again",
                    Rating::Good => "Good",
                };
                Bar { label: label.into(), value, tooltip: format!("{}: {value} results", rating.as_str()) }
            })
            .collect(),
        weekly_progress,
    }
}

/// `{ pattern, meaning, jlptLevel, examples, notes }` of a grammar learning item.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarData {
    pub pattern: String,
    pub meaning: String,
    pub jlpt_level: String,
    pub examples: Vec<String>,
    pub notes: Option<String>,
}

pub fn grammar_data(data: &Value) -> GrammarData {
    let text = |key: &str| match data.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    };
    GrammarData {
        pattern: text("pattern"),
        meaning: text("meaning"),
        jlpt_level: text("jlptLevel"),
        examples: data
            .get("examples")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        notes: data.get("notes").and_then(Value::as_str).map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn tz() -> Tz {
        chrono_tz::America::Los_Angeles
    }
    fn local(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        tz().with_ymd_and_hms(y, m, d, h, min, 0).unwrap().with_timezone(&Utc)
    }
    fn row(id: &str, status: Status, order: i64) -> QueueRow {
        QueueRow { learning_item_id: id.into(), status, curriculum_order: order, due_at: local(2026, 7, 13, 12, 0), introduced_at: None, is_leech: false }
    }

    #[test]
    fn scheduling_batches() {
        let rows: Vec<_> = (0..7).map(|i| row(&format!("new-{i}"), Status::New, i)).collect();
        assert_eq!(new_due_today(&rows, local(2026, 7, 13, 12, 0), &DEFAULT_GRAMMAR, tz()), 5);
        let rows = vec![
            QueueRow { introduced_at: Some(local(2026, 7, 13, 12, 0)), ..row("introduced", Status::Learning, 0) },
            row("next", Status::New, 1),
        ];
        assert_eq!(new_due_today(&rows, local(2026, 7, 19, 12, 0), &DEFAULT_GRAMMAR, tz()), 0);
        assert_eq!(new_due_today(&rows, local(2026, 7, 20, 0, 1), &DEFAULT_GRAMMAR, tz()), 1);
        let mut rows = vec![QueueRow { introduced_at: Some(local(2026, 7, 13, 12, 0)), ..row("introduced", Status::Learning, 0) }];
        rows.extend((0..12).map(|i| row(&format!("new-{i}"), Status::New, i + 1)));
        let config = JapaneseGrammarConfiguration { new_points_per_batch: 9, new_batch_interval_days: 3 };
        assert_eq!(new_due_today(&rows, local(2026, 7, 15, 12, 0), &config, tz()), 0);
        assert_eq!(new_due_today(&rows, local(2026, 7, 16, 0, 1), &config, tz()), 9);
        assert_eq!(select_queue(&rows, local(2026, 7, 16, 0, 1), &config, tz()).new_ids.len(), 9);
    }

    #[test]
    fn queue_priorities() {
        let rows = vec![
            row("new-2", Status::New, 2),
            row("new-1", Status::New, 1),
            QueueRow { due_at: local(2026, 7, 10, 12, 0), ..row("review", Status::Review, 0) },
            QueueRow { is_leech: true, due_at: local(2026, 7, 12, 12, 0), ..row("leech", Status::Review, 0) },
        ];
        let q = select_queue(&rows, local(2026, 7, 13, 12, 0), &DEFAULT_GRAMMAR, tz());
        assert_eq!(q.review_ids, vec!["leech", "review"]);
        assert_eq!(q.new_ids, vec!["new-1", "new-2"]);
    }

    #[test]
    fn placement_mastery() {
        let s = schedule_result(SrsState::default(), Status::New, Rating::Easy, true, local(2026, 7, 17, 12, 0));
        assert_eq!(s.status, Status::Mastered);
        assert_eq!(s.next.state.interval_days, 30.0);
        assert_eq!(s.next.maturity, Maturity::Mature);
        let s = schedule_result(SrsState::default(), Status::New, Rating::Easy, false, local(2026, 7, 17, 12, 0));
        assert_eq!(s.status, Status::Review);
        assert_eq!(s.next.state.interval_days, 4.0);
    }

    #[test]
    fn lesson_matching() {
        let queue = Queue { review_ids: vec!["review".into()], new_ids: vec!["new".into()] };
        let ids = vec!["review".to_string(), "new".to_string()];
        let now = local(2026, 7, 25, 20, 0);
        assert!(lesson_matches_queue(local(2026, 7, 25, 10, 0), &ids, &queue, now, tz()));
        assert!(!lesson_matches_queue(local(2026, 7, 24, 20, 0), &ids, &queue, now, tz()));
        assert!(!lesson_matches_queue(local(2026, 7, 25, 10, 0), &ids[..1], &queue, now, tz()));
    }

    #[test]
    fn prompt_contract() {
        assert!(level_from_known_words(1_250).contains("upper beginner"));
        assert!(level_from_known_words(4_000).contains("intermediate"));
        let vocab: Vec<_> = ["猫", "図書館", "静か", "読む", "電車", "早い"]
            .iter()
            .map(|t| LessonVocabulary { source: "migaku".into(), term: (*t).into(), reading: None, key: None })
            .collect();
        let items = vec![
            PromptItem { learning_item_id: "g1".into(), pattern: "～んです".into() },
            PromptItem { learning_item_id: "g2".into(), pattern: "～にいく".into() },
        ];
        let prompt = build_lesson_prompt(level_from_known_words(1_250), 1_250, &items, &vocab, None);
        assert!(prompt.contains("grammar-placement-v7"));
        assert!(prompt.contains("Words to use: 猫 / 図書館 / 静か"));
        assert!(prompt.contains("Words to use: 読む / 電車 / 早い"));
        assert!(prompt.contains("1. Grammar: ～んです"));
        assert!(prompt.contains("Conservative known-word count: **1,250**"));
        assert!(prompt.contains("1. <Again-or-Good-or-Perfect>"));
        assert!(!prompt.contains("learningItemId:"));
        let custom = JapaneseGrammarConfiguration { new_points_per_batch: 8, new_batch_interval_days: 4 };
        assert!(build_lesson_prompt("x", 0, &items, &[], Some(&custom)).contains("New grammar pace: **8 points every 4 days**"));
    }

    #[test]
    fn vocabulary_is_stable_per_day() {
        let mut candidates: Vec<_> = (0..20)
            .map(|i| LessonVocabulary { source: if i % 2 == 1 { "migaku" } else { "anki-mature" }.into(), term: format!("word-{i}"), reading: None, key: Some(format!("key-{i}")) })
            .collect();
        candidates.push(LessonVocabulary { source: "migaku".into(), term: "duplicate".into(), reading: None, key: Some("key-1".into()) });
        let first = select_daily_vocabulary(&candidates, 9, local(2026, 9, 19, 12, 0), tz());
        let mut reversed = candidates.clone();
        reversed.reverse();
        let repeated = select_daily_vocabulary(&reversed, 9, local(2026, 9, 19, 20, 0), tz());
        let next_day = select_daily_vocabulary(&candidates, 9, local(2026, 9, 20, 12, 0), tz());
        let keys = |v: &[LessonVocabulary]| v.iter().map(|w| w.key.clone().unwrap()).collect::<Vec<_>>();
        assert_eq!(keys(&first), keys(&repeated));
        assert_eq!(keys(&first).into_iter().collect::<HashSet<_>>().len(), 9);
        assert_ne!(keys(&first), keys(&next_day));
    }

    #[test]
    fn app_ratings() {
        let r = result_from_app_rating("g", AppRating::Perfect, ScheduledType::New);
        assert_eq!((r.rating, r.mastered_on_placement, r.correct, r.total), (Rating::Easy, true, 1, 1));
        assert!(!result_from_app_rating("g", AppRating::Perfect, ScheduledType::Review).mastered_on_placement);
        assert_eq!(result_from_app_rating("g", AppRating::Good, ScheduledType::New).rating, Rating::Good);
        assert!(AppRating::parse("HARD").is_none());
    }

    #[test]
    fn parses_final_rating_lists() {
        let reply = "Great work!\n\n1. Good\n2. **Perfect**\n3) again";
        assert_eq!(parse_final_ratings(reply, 3), Some(vec![AppRating::Good, AppRating::Perfect, AppRating::Again]));
        assert_eq!(parse_final_ratings(reply, 4), None);
        assert_eq!(parse_final_ratings("1. Good", 0), None);
    }

    fn tutor(id: &str, pattern: &str, order: i64, correct: i64, questions: i64, lapses: i64, leech: bool, last: Rating) -> TutorPlanItem {
        TutorPlanItem { learning_item_id: id.into(), pattern: pattern.into(), meaning: id.into(), jlpt_level: "N5".into(), examples: vec![format!("例{id}。")], curriculum_order: order, total_correct: correct, total_questions: questions, lapse_count: lapses, is_leech: leech, last_rating: Some(last) }
    }

    #[test]
    fn tutor_plans() {
        let items = vec![
            tutor("one", "～一", 1, 2, 10, 2, false, Rating::Again),
            tutor("two", "～二", 2, 5, 10, 1, false, Rating::Good),
            tutor("three", "～三", 3, 4, 10, 8, true, Rating::Again),
            tutor("secure", "～四", 4, 10, 10, 0, false, Rating::Easy),
        ];
        let worst: Vec<_> = select_worst_points(&items, 3, &BTreeMap::new()).iter().map(|i| i.learning_item_id.clone()).collect();
        assert_eq!(worst, vec!["one", "three", "two"]);
        let plan = build_tutor_lesson_plan(&items, &JapaneseGrammarTutorConfiguration::default());
        assert!(plan.contains("percentage of recorded attempts missed"));
        assert!(plan.contains("80% missed (8/10 recorded attempts)"));
        assert!(!plan.contains("～四"));

        let items = vec![
            tutor("one", "～一", 1, 1, 10, 0, false, Rating::Again),
            tutor("two", "～二", 2, 5, 10, 0, false, Rating::Good),
            tutor("three", "～三", 3, 8, 10, 0, false, Rating::Good),
        ];
        let mut overrides = BTreeMap::new();
        overrides.insert("one".to_string(), TutorItemOverride { excluded: Some(true), miss_rate_percent: None });
        overrides.insert("three".to_string(), TutorItemOverride { excluded: None, miss_rate_percent: Some(75) });
        let config = JapaneseGrammarTutorConfiguration { plan_size: 2, item_overrides: overrides };
        let worst: Vec<_> = select_worst_points(&items, 2, &config.item_overrides).iter().map(|i| i.learning_item_id.clone()).collect();
        assert_eq!(worst, vec!["three", "two"]);
        let plan = build_tutor_lesson_plan(&items, &config);
        assert!(plan.contains("75% missed for tutor planning"));
        assert!(!plan.contains("～一"));
    }
}

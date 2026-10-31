//! Speed reading: passages, timed sessions, and next-day retention checks.

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Duration, Utc};
use kaizen_core::settings as core_settings;
use kaizen_core::speed_reading::{self as sr, AnswerKey, Question};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

fn questions(value: &Value) -> Vec<Question> {
    serde_json::from_value::<Vec<Value>>(value.clone())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|q| serde_json::from_value::<Question>(q).ok())
        .filter(|q| q.choices.len() >= 2)
        .collect()
}

fn answer_key(value: &Value) -> Vec<AnswerKey> {
    serde_json::from_value(value.clone()).unwrap_or_default()
}

#[derive(sqlx::FromRow)]
struct PassageRow {
    id: String,
    title: String,
    topic: String,
    category: String,
    difficulty: String,
    source_url: Option<String>,
    text: String,
    word_count: i32,
    questions: Value,
}

pub async fn page(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let now = Utc::now();
    let passages: Vec<PassageRow> = sqlx::query_as(
        "SELECT id, title, topic, category, difficulty, source_url, text, word_count, questions FROM speed_reading_passages
         WHERE user_id = $1 ORDER BY created_at DESC",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let sessions: Vec<(DateTime<Utc>, f64, i32)> = sqlx::query_as(
        "SELECT completed_at, accuracy, recommended_next_wpm FROM speed_reading_sessions WHERE user_id = $1 ORDER BY completed_at",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let due: Vec<(String, String, DateTime<Utc>, Value)> = sqlx::query_as(
        "SELECT s.id, p.title, s.completed_at, p.questions FROM speed_reading_sessions s JOIN speed_reading_passages p ON p.id = s.passage_id
         WHERE s.user_id = $1 AND s.retention_due_at <= $2 AND s.retention_completed_at IS NULL ORDER BY s.retention_due_at LIMIT 5",
    )
    .bind(&user.id)
    .bind(now)
    .fetch_all(&app.db)
    .await?;
    let settings = core_settings::speed_reading(&user.settings);
    let recommended = sessions.last().map_or(settings.wpm, |s| s.2 as i64);
    let accuracy = (!sessions.is_empty()).then(|| sessions.iter().map(|s| s.1).sum::<f64>() / sessions.len() as f64);
    let (streak, _) = sr::reading_streak(&sessions.iter().map(|s| s.0).collect::<Vec<_>>(), now, user.tz);
    let due: Vec<Value> = due
        .into_iter()
        .filter_map(|(id, title, read_at, qs)| {
            let qs = questions(&qs);
            (!qs.is_empty()).then(|| json!({ "sessionId": id, "title": title, "readAt": read_at, "questions": qs }))
        })
        .collect();
    Ok(Json(json!({
        "settings": settings,
        "recommendedWpm": recommended,
        "accuracy": accuracy,
        "streak": streak,
        "retentionDue": due,
        "passages": passages.into_iter().filter_map(|p| {
            let qs = questions(&p.questions);
            (!qs.is_empty()).then(|| json!({
                "id": p.id, "title": p.title, "topic": p.topic, "category": p.category, "difficulty": p.difficulty,
                "sourceUrl": p.source_url, "text": p.text, "wordCount": p.word_count, "questions": qs,
            }))
        }).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptQuery {
    category: Option<String>,
    difficulty: Option<String>,
    target_words: Option<i64>,
}

pub async fn prompt(user: User, Query(q): Query<PromptQuery>) -> ApiResult<Json<Value>> {
    let settings = core_settings::speed_reading(&user.settings);
    let category = q.category.map(|c| c.trim().chars().take(80).collect::<String>()).filter(|c| !c.is_empty()).unwrap_or(settings.category);
    let difficulty = q.difficulty.filter(|d| ["beginner", "intermediate", "advanced"].contains(&d.as_str())).unwrap_or(settings.difficulty);
    let words = q.target_words.unwrap_or(450).clamp(150, 1500);
    Ok(Json(json!({ "prompt": sr::build_generation_prompt(&category, &difficulty, words) })))
}

#[derive(Deserialize)]
pub struct ImportBody {
    /// Either a parsed JSON object or the raw text the AI returned.
    json: Option<Value>,
    text: Option<String>,
}

pub async fn import_passage(State(app): State<App>, user: User, Json(body): Json<ImportBody>) -> ApiResult<Json<Value>> {
    let value = match (body.json, body.text) {
        (Some(v), _) if !v.is_null() => v,
        (_, Some(text)) => kaizen_core::schema::parse_json_text(&text).map_err(|_| ApiError::bad("Invalid JSON. Check the commas, quotation marks, and closing braces."))?,
        _ => return Err(ApiError::bad("Paste the passage JSON first.")),
    };
    let passage = sr::validate_passage(&value).map_err(ApiError::bad)?;
    let mut tx = app.db.begin().await?;
    let id = crate::workspace::insert_passage(&mut tx, &user.id, &passage, "llm").await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "passageId": id, "title": passage.title })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionInput {
    passage_id: String,
    mode: String,
    wpm: i64,
    chunk_size: i64,
    font_size: i64,
    punctuation_pause: bool,
    comprehension_threshold: f64,
    started_at: DateTime<Utc>,
    duration_sec: i64,
    response_time_ms: i64,
    answers: Map<String, Value>,
}

impl SessionInput {
    fn validate(&self) -> Result<(), String> {
        if !["RSVP", "PACED", "CHUNKING", "BENCHMARK"].contains(&self.mode.as_str()) {
            return Err("Unknown reading mode.".into());
        }
        let checks = [
            ((50..=2_000).contains(&self.wpm), "wpm must be 50–2000."),
            ((1..=5).contains(&self.chunk_size), "chunkSize must be 1–5."),
            ((16..=96).contains(&self.font_size), "fontSize must be 16–96."),
            ((0.5..=1.0).contains(&self.comprehension_threshold), "comprehensionThreshold must be 0.5–1."),
            ((1..=7_200).contains(&self.duration_sec), "durationSec must be 1–7200."),
            ((0..=7_200_000).contains(&self.response_time_ms), "responseTimeMs must be 0–7200000."),
            (
                self.answers.values().all(|v| v.as_u64().is_some_and(|n| n <= 5)),
                "Each answer must be a choice index 0–5.",
            ),
        ];
        match checks.iter().find(|(ok, _)| !ok) {
            Some((_, message)) => Err((*message).into()),
            None => Ok(()),
        }
    }
}

pub async fn complete_session(State(app): State<App>, user: User, Json(input): Json<SessionInput>) -> ApiResult<Json<Value>> {
    input.validate().map_err(ApiError::bad)?;
    let passage: Option<(Value, Value)> =
        sqlx::query_as("SELECT questions, answer_key FROM speed_reading_passages WHERE id = $1 AND user_id = $2")
            .bind(&input.passage_id)
            .bind(&user.id)
            .fetch_optional(&app.db)
            .await?;
    let (qs, key) = passage.ok_or_else(|| ApiError::not_found("Passage"))?;
    let qs = questions(&qs);
    let (correct, explanations) = sr::score_answers(&qs, &answer_key(&key), &input.answers).map_err(ApiError::bad)?;
    let accuracy = correct as f64 / qs.len() as f64;
    let latest_retention: Option<f64> = sqlx::query_scalar(
        "SELECT retention_accuracy FROM speed_reading_sessions WHERE user_id = $1 AND retention_accuracy IS NOT NULL
         ORDER BY retention_completed_at DESC LIMIT 1",
    )
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?
    .flatten();
    let next_wpm = sr::adaptive_wpm(input.wpm, accuracy, input.comprehension_threshold, latest_retention);
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO speed_reading_sessions (id, user_id, passage_id, mode, wpm, chunk_size, font_size, punctuation_pause, started_at,
           completed_at, duration_sec, correct_answers, total_questions, accuracy, response_time_ms, estimated_retention,
           recommended_next_wpm, answers, retention_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
    )
    .bind(new_id())
    .bind(&user.id)
    .bind(&input.passage_id)
    .bind(&input.mode)
    .bind(input.wpm as i32)
    .bind(input.chunk_size as i32)
    .bind(input.font_size as i32)
    .bind(input.punctuation_pause)
    .bind(input.started_at)
    .bind(now)
    .bind(input.duration_sec as i32)
    .bind(correct as i32)
    .bind(qs.len() as i32)
    .bind(accuracy)
    .bind(input.response_time_ms as i32)
    .bind(accuracy * 0.9)
    .bind(next_wpm as i32)
    .bind(Value::Object(input.answers.clone()))
    .bind(now + Duration::days(1))
    .execute(&app.db)
    .await?;
    Ok(Json(json!({
        "ok": true, "correct": correct, "total": qs.len(), "accuracy": accuracy, "recommendedNextWpm": next_wpm,
        "explanations": explanations,
    })))
}

#[derive(Deserialize)]
pub struct RetentionBody {
    answers: Map<String, Value>,
}

pub async fn retention(State(app): State<App>, user: User, Path(id): Path<String>, Json(body): Json<RetentionBody>) -> ApiResult<Json<Value>> {
    let row: Option<(Option<DateTime<Utc>>, Option<DateTime<Utc>>, Value, Value)> = sqlx::query_as(
        "SELECT s.retention_due_at, s.retention_completed_at, p.questions, p.answer_key FROM speed_reading_sessions s
         JOIN speed_reading_passages p ON p.id = s.passage_id WHERE s.id = $1 AND s.user_id = $2",
    )
    .bind(&id)
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?;
    let (due_at, completed_at, qs, key) = row.ok_or_else(|| ApiError::not_found("Reading session"))?;
    if completed_at.is_some() {
        return Err(ApiError::bad("This retention check is already complete."));
    }
    if due_at.is_none_or(|d| d > Utc::now()) {
        return Err(ApiError::bad("This retention check is not due yet."));
    }
    let qs = questions(&qs);
    let key = answer_key(&key);
    let correct = qs
        .iter()
        .filter(|q| {
            let selected = body.answers.get(&q.id).and_then(Value::as_u64).map(|v| v as usize);
            key.iter().find(|k| k.question_id == q.id).is_some_and(|k| selected == Some(k.correct_index))
        })
        .count();
    let accuracy = if qs.is_empty() { 0.0 } else { correct as f64 / qs.len() as f64 };
    sqlx::query("UPDATE speed_reading_sessions SET retention_completed_at = now(), retention_accuracy = $2, retention_answers = $3 WHERE id = $1")
        .bind(&id)
        .bind(accuracy)
        .bind(Value::Object(body.answers))
        .execute(&app.db)
        .await?;
    Ok(Json(json!({ "ok": true, "correct": correct, "total": qs.len(), "accuracy": accuracy })))
}

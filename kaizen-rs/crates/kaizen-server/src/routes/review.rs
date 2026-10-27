//! In-app review: generated flashcards / practice items and grammar reviews.

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::Utc;
use kaizen_core::grammar;
use kaizen_core::srs::{self, Rating, SrsState};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

const NEW_PER_SESSION: i64 = 20;
const REVIEWS_PER_SESSION: i64 = 200;

#[derive(Deserialize)]
pub struct ReviewQuery {
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(sqlx::FromRow)]
struct CardRow {
    id: String,
    maturity: String,
    kind: String,
    practice_type: Option<String>,
    front: String,
    back: String,
    metadata: Value,
    course_name: String,
    course_color: Option<String>,
}

const CARD_QUERY: &str = "SELECT r.id, r.maturity,
       CASE WHEN r.flashcard_id IS NOT NULL THEN 'flashcard' ELSE 'practice' END AS kind,
       p.type AS practice_type, COALESCE(f.front, p.prompt) AS front, COALESCE(f.back, p.answer) AS back,
       COALESCE(f.metadata, '{}'::jsonb) AS metadata, c.name AS course_name, c.color AS course_color
     FROM review_records r
     LEFT JOIN flashcards f ON f.id = r.flashcard_id
     LEFT JOIN practice_items p ON p.id = r.practice_item_id
     JOIN courses c ON c.id = COALESCE(f.course_id, p.course_id)
     WHERE r.user_id = $1 AND NOT r.is_suspended";

pub async fn page(State(app): State<App>, user: User, Query(query): Query<ReviewQuery>) -> ApiResult<Json<Value>> {
    let now = Utc::now();
    let grammar_mode = query.kind.as_deref() == Some("grammar");
    let counts: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT
           (SELECT count(*) FROM review_records WHERE user_id = $1 AND due_at <= $2 AND NOT is_suspended AND maturity <> 'NEW'),
           (SELECT count(*) FROM review_records WHERE user_id = $1),
           (SELECT count(*) FROM review_records WHERE user_id = $1 AND is_suspended),
           (SELECT count(*) FROM review_records WHERE user_id = $1 AND is_leech),
           (SELECT count(*) FROM review_records WHERE user_id = $1 AND maturity = 'NEW' AND NOT is_suspended),
           (SELECT count(*) FROM grammar_progress WHERE user_id = $1 AND status <> 'NEW' AND due_at <= $2)",
    )
    .bind(&user.id)
    .bind(now)
    .fetch_one(&app.db)
    .await?;
    let (due, total, suspended, leeches, new_count, grammar_due) = counts;
    let (cards, grammar_cards) = if grammar_mode {
        let rows: Vec<(String, String, Value)> = sqlx::query_as(
            "SELECT gp.id, gp.status, li.data FROM grammar_progress gp JOIN learning_items li ON li.id = gp.learning_item_id
             WHERE gp.user_id = $1 AND gp.status <> 'NEW' AND gp.due_at <= $2 ORDER BY gp.is_leech DESC, gp.due_at LIMIT 50",
        )
        .bind(&user.id)
        .bind(now)
        .fetch_all(&app.db)
        .await?;
        let cards: Vec<Value> = rows
            .into_iter()
            .map(|(id, status, data)| {
                let d = grammar::grammar_data(&data);
                json!({ "progressId": id, "status": status, "pattern": d.pattern, "meaning": d.meaning, "level": d.jlpt_level, "examples": d.examples })
            })
            .collect();
        (vec![], cards)
    } else {
        let mut rows: Vec<CardRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "{CARD_QUERY} AND r.due_at <= $2 AND r.maturity <> 'NEW' ORDER BY r.due_at LIMIT {REVIEWS_PER_SESSION}"
        )))
        .bind(&user.id)
        .bind(now)
        .fetch_all(&app.db)
        .await?;
        let fresh: Vec<CardRow> =
            sqlx::query_as(sqlx::AssertSqlSafe(format!("{CARD_QUERY} AND r.maturity = 'NEW' ORDER BY r.due_at LIMIT {NEW_PER_SESSION}")))
                .bind(&user.id)
                .fetch_all(&app.db)
                .await?;
        rows.extend(fresh);
        let cards: Vec<Value> = rows
            .into_iter()
            .map(|r| {
                json!({
                    "recordId": r.id, "kind": r.kind, "practiceType": r.practice_type, "front": r.front, "back": r.back,
                    "metadata": r.metadata, "maturity": r.maturity, "courseName": r.course_name, "courseColor": r.course_color,
                })
            })
            .collect();
        (cards, vec![])
    };
    Ok(Json(json!({
        "type": if grammar_mode { "grammar" } else { "flashcards" },
        "stats": {
            "queued": due + new_count.min(NEW_PER_SESSION), "grammarDue": grammar_due, "total": total,
            "leeches": leeches, "suspended": suspended,
        },
        "cards": cards,
        "grammarCards": grammar_cards,
    })))
}

#[derive(Deserialize)]
pub struct RateBody {
    rating: String,
}

fn parse_rating(value: &str) -> ApiResult<Rating> {
    Rating::parse(&value.to_ascii_uppercase()).ok_or_else(|| ApiError::bad("Rating must be AGAIN, HARD, GOOD, or EASY."))
}

pub async fn rate(State(app): State<App>, user: User, Path(id): Path<String>, Json(body): Json<RateBody>) -> ApiResult<Json<Value>> {
    let rating = parse_rating(&body.rating)?;
    let row: Option<(f64, f64, i32, i32, bool, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT ease, interval_days, repetitions, lapse_count, is_leech, flashcard_id, practice_item_id FROM review_records WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?;
    let (ease, interval_days, repetitions, lapse_count, is_leech, flashcard_id, practice_item_id) =
        row.ok_or_else(|| ApiError::not_found("Review card"))?;
    let now = Utc::now();
    let next = srs::rate(SrsState { ease, interval_days, repetitions, lapse_count, is_leech }, rating, now);
    let mut tx = app.db.begin().await?;
    sqlx::query(
        "UPDATE review_records SET ease = $2, interval_days = $3, due_at = $4, repetitions = $5, lapse_count = $6, is_leech = $7,
           maturity = $8, last_rating = $9, last_reviewed_at = $10 WHERE id = $1",
    )
    .bind(&id)
    .bind(next.state.ease)
    .bind(next.state.interval_days)
    .bind(next.due_at)
    .bind(next.state.repetitions)
    .bind(next.state.lapse_count)
    .bind(next.state.is_leech)
    .bind(next.maturity.as_str())
    .bind(rating.as_str())
    .bind(now)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO attempts (id, user_id, flashcard_id, practice_item_id, rating, correct) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(new_id())
        .bind(&user.id)
        .bind(&flashcard_id)
        .bind(&practice_item_id)
        .bind(rating.as_str())
        .bind(rating != Rating::Again)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "dueAt": next.due_at, "intervalDays": next.state.interval_days })))
}

pub async fn rate_grammar(State(app): State<App>, user: User, Path(id): Path<String>, Json(body): Json<RateBody>) -> ApiResult<Json<Value>> {
    let rating = parse_rating(&body.rating)?;
    let row: Option<(f64, f64, i32, i32, bool)> = sqlx::query_as(
        "SELECT ease, interval_days, repetitions, lapse_count, is_leech FROM grammar_progress WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?;
    let (ease, interval_days, repetitions, lapse_count, is_leech) = row.ok_or_else(|| ApiError::not_found("Grammar point"))?;
    let now = Utc::now();
    let next = srs::rate(SrsState { ease, interval_days, repetitions, lapse_count, is_leech }, rating, now);
    sqlx::query(
        "UPDATE grammar_progress SET status = $2, ease = $3, interval_days = $4, due_at = $5, repetitions = $6, lapse_count = $7,
           is_leech = $8, introduced_at = COALESCE(introduced_at, $9), last_studied_at = $9, last_rating = $10, updated_at = now()
         WHERE id = $1",
    )
    .bind(&id)
    .bind(grammar::status_for_interval(next.state.interval_days).as_str())
    .bind(next.state.ease)
    .bind(next.state.interval_days)
    .bind(next.due_at)
    .bind(next.state.repetitions)
    .bind(next.state.lapse_count)
    .bind(next.state.is_leech)
    .bind(now)
    .bind(rating.as_str())
    .execute(&app.db)
    .await?;
    Ok(Json(json!({ "dueAt": next.due_at, "intervalDays": next.state.interval_days })))
}

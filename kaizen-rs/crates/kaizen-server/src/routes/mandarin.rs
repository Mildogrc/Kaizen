//! Chinese: Mandarin Blueprint levels and the tone-pair pronunciation grid.

use axum::Json;
use axum::extract::{Path, State};
use chrono::{DateTime, Utc};
use kaizen_core::mandarin;
use serde_json::{Value, json};

use crate::anki::Anki;
use crate::auth::User;
use crate::db::json_strings;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

#[derive(sqlx::FromRow)]
struct LevelRow {
    level: i32,
    phase: Option<i32>,
    characters: Value,
    words: Value,
    completed_at: Option<DateTime<Utc>>,
    pushed_at: Option<DateTime<Utc>>,
    push_error: Option<String>,
}

pub async fn page(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let levels: Vec<LevelRow> = sqlx::query_as(
        "SELECT l.level, l.phase, l.characters, l.words, p.completed_at, p.pushed_at, p.push_error
         FROM mandarin_blueprint_levels l LEFT JOIN mandarin_blueprint_progress p ON p.level = l.level AND p.user_id = $1
         ORDER BY l.level",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let dictionary: i64 = sqlx::query_scalar("SELECT count(*) FROM mandarin_dictionary_entries").fetch_one(&app.db).await?;
    let completed = levels.iter().filter(|l| l.completed_at.is_some()).count();
    let current = levels.iter().find(|l| l.completed_at.is_none()).map_or(mandarin::LEVELS as i32, |l| l.level);
    Ok(Json(json!({
        "totalLevels": mandarin::LEVELS,
        "completed": completed,
        "pushed": levels.iter().filter(|l| l.pushed_at.is_some()).count(),
        "dictionaryEntries": dictionary,
        "currentLevel": current,
        "levels": levels.iter().map(|l| json!({
            "level": l.level, "phase": l.phase,
            "characters": json_strings(&l.characters), "words": json_strings(&l.words),
            "completedAt": l.completed_at, "pushedAt": l.pushed_at, "pushError": l.push_error,
            "status": if l.pushed_at.is_some() { "pushed" } else if l.push_error.is_some() { "failed" }
                else if l.completed_at.is_some() { "completed" } else if l.level == current { "current" } else { "ready" },
        })).collect::<Vec<_>>(),
    })))
}

/// Mark a level complete and push its new characters and words to Anki.
pub async fn complete_level(State(app): State<App>, user: User, Path(level): Path<i64>) -> ApiResult<Json<Value>> {
    if !(1..=mandarin::LEVELS).contains(&level) {
        return Err(ApiError::bad("Invalid level."));
    }
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM mandarin_blueprint_levels WHERE level = $1)")
        .bind(level as i32)
        .fetch_one(&app.db)
        .await?;
    if !exists {
        return Err(ApiError::bad("Import the Mandarin Blueprint catalog first (kaizen import-mandarin --csv …)."));
    }
    sqlx::query(
        "INSERT INTO mandarin_blueprint_progress (user_id, level, completed_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id, level) DO UPDATE SET completed_at = COALESCE(mandarin_blueprint_progress.completed_at, now()),
           push_error = NULL, updated_at = now()",
    )
    .bind(&user.id)
    .bind(level as i32)
    .execute(&app.db)
    .await?;
    match crate::integrations::mandarin::push_level(&app, &user, level).await {
        Ok(summary) => {
            sqlx::query("UPDATE mandarin_blueprint_progress SET pushed_at = now(), push_error = NULL, updated_at = now() WHERE user_id = $1 AND level = $2")
                .bind(&user.id)
                .bind(level as i32)
                .execute(&app.db)
                .await?;
            Ok(Json(json!({
                "ok": true, "summary": summary,
                "message": format!("Added {} cards; {} duplicates skipped.", summary.added, summary.skipped),
            })))
        }
        Err(message) => {
            sqlx::query("UPDATE mandarin_blueprint_progress SET push_error = $3, updated_at = now() WHERE user_id = $1 AND level = $2")
                .bind(&user.id)
                .bind(level as i32)
                .bind(&message)
                .execute(&app.db)
                .await?;
            Err(ApiError::Unavailable(message))
        }
    }
}

/// Tone-pair grid from reviewed two-syllable Mandarin vocabulary in Anki.
pub async fn pronunciation(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let now = Utc::now();
    let card_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT s.anki_card_id FROM anki_card_snapshots s JOIN anki_deck_mappings m ON m.id = s.mapping_id JOIN courses c ON c.id = m.course_id
         WHERE s.user_id = $1 AND c.slug = 'chinese' AND s.reps > 0 AND s.state IN ('LEARNING', 'YOUNG', 'MATURE')
         ORDER BY s.anki_card_id",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let next_rotation = kaizen_core::time::date_key(mandarin::next_rotation_at(now, user.tz));
    if card_ids.is_empty() {
        return Ok(Json(json!({ "reviewed": 0, "unavailable": false, "candidates": 0, "entries": {}, "nextRotation": next_rotation })));
    }
    let cards = Anki::new(&app, &user.id).cards_fields(&card_ids).await;
    let Ok(cards) = cards else {
        return Ok(Json(json!({ "reviewed": card_ids.len(), "unavailable": true, "candidates": 0, "entries": {}, "nextRotation": next_rotation })));
    };
    let candidates: Vec<mandarin::PronunciationCandidate> = cards
        .iter()
        .filter_map(|card| {
            let id = card.get("cardId").and_then(Value::as_i64)?;
            mandarin::pronunciation_candidate(&id.to_string(), card.get("fields").unwrap_or(&Value::Null))
        })
        .collect();
    let entries = mandarin::select_tone_grid(&candidates, now, user.tz);
    Ok(Json(json!({
        "reviewed": card_ids.len(),
        "unavailable": false,
        "candidates": candidates.len(),
        "filled": entries.values().filter(|e| e.is_some()).count(),
        "entries": entries,
        "nextRotation": next_rotation,
    })))
}

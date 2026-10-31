//! NATO alphabet recall trainer.

use axum::Json;
use axum::extract::State;
use chrono::{DateTime, Utc};
use kaizen_core::nato;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

pub async fn page(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let sessions: Vec<(DateTime<Utc>, Value)> =
        sqlx::query_as("SELECT date, stats FROM study_sessions WHERE user_id = $1 AND mode = 'nato' ORDER BY date")
            .bind(&user.id)
            .fetch_all(&app.db)
            .await?;
    let (analytics, _) = nato::analyze_sessions(&sessions);
    let word = nato::select_word(&analytics.metrics, analytics.sessions);
    let mut practiced: Vec<&nato::LetterMetric> = analytics.metrics.iter().filter(|m| m.attempts > 0).collect();
    practiced.sort_by(|a, b| b.average_ms.partial_cmp(&a.average_ms).unwrap_or(std::cmp::Ordering::Equal));
    Ok(Json(json!({
        "word": word,
        "codeWords": nato::CODE_WORDS.iter().map(|(letter, code)| (letter.to_string(), *code)).collect::<std::collections::BTreeMap<_, _>>(),
        "analytics": {
            "sessions": analytics.sessions, "accuracy": analytics.accuracy, "averageRecallMs": analytics.average_recall_ms,
            "nextDueAt": analytics.next_due_at, "lastSessionAt": analytics.last_session_at,
        },
        "letters": practiced,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptBody {
    typed: String,
    time_ms: f64,
}

#[derive(Deserialize)]
pub struct SessionBody {
    word: String,
    attempts: Vec<AttemptBody>,
}

/// Grade a timed word on the server (the client only reports what was typed).
pub async fn save(State(app): State<App>, user: User, Json(body): Json<SessionBody>) -> ApiResult<Json<Value>> {
    let typed: Vec<(String, i64)> = body.attempts.iter().map(|a| (a.typed.clone(), a.time_ms.round() as i64)).collect();
    let stats = nato::grade_session(&body.word, &typed).map_err(ApiError::bad)?;
    sqlx::query("INSERT INTO study_sessions (id, user_id, mode, duration_min, stats) VALUES ($1, $2, 'nato', $3, $4)")
        .bind(new_id())
        .bind(&user.id)
        .bind(((stats.total_time_ms as f64 / 60_000.0).round() as i32).max(1))
        .bind(serde_json::to_value(&stats).map_err(anyhow::Error::from)?)
        .execute(&app.db)
        .await?;
    Ok(Json(json!({ "ok": true, "stats": stats })))
}

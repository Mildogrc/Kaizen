//! Codeforces public API sync (profile, submissions, rated contests).

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::crypto::new_id;
use crate::state::App;

const API_BASE: &str = "https://codeforces.com/api";
/// Codeforces allows one call every two seconds.
const API_DELAY: Duration = Duration::from_millis(2100);

#[derive(Deserialize)]
struct Envelope<T> {
    status: String,
    result: Option<T>,
    comment: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiUser {
    handle: String,
    first_name: Option<String>,
    last_name: Option<String>,
    rating: Option<i32>,
    max_rating: Option<i32>,
    rank: Option<String>,
    max_rank: Option<String>,
    avatar: Option<String>,
    contribution: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiProblem {
    contest_id: Option<i64>,
    index: String,
    name: String,
    rating: Option<i32>,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiAuthor {
    participant_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiSubmission {
    id: i64,
    contest_id: Option<i64>,
    creation_time_seconds: i64,
    problem: ApiProblem,
    author: Option<ApiAuthor>,
    programming_language: Option<String>,
    verdict: Option<String>,
    time_consumed_millis: Option<i64>,
    memory_consumed_bytes: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiRatingChange {
    contest_id: i64,
    contest_name: String,
    rank: i64,
    rating_update_time_seconds: i64,
    old_rating: i64,
    new_rating: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub profile_id: String,
    pub handle: String,
    pub submissions: usize,
    pub rating_changes: usize,
}

async fn request<T: DeserializeOwned>(app: &App, method: &str, params: &[(&str, &str)]) -> Result<T, String> {
    let response = app
        .http
        .get(format!("{API_BASE}/{method}"))
        .query(params)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Could not reach Codeforces: {e}"))?;
    let status = response.status();
    let body: Envelope<T> = response.json().await.map_err(|_| format!("Codeforces returned HTTP {}.", status.as_u16()))?;
    match (body.status.as_str(), body.result) {
        ("OK", Some(result)) => Ok(result),
        _ => Err(body.comment.unwrap_or_else(|| "Codeforces API request failed.".into())),
    }
}

/// Fetch the profile and merge new submissions and contests (idempotent).
pub async fn sync_profile(app: &App, user_id: &str, handle: &str) -> Result<SyncSummary, String> {
    let users: Vec<ApiUser> = request(app, "user.info", &[("handles", handle)]).await?;
    let user = users.into_iter().next().ok_or("Codeforces did not return that user.")?;
    tokio::time::sleep(API_DELAY).await;
    let submissions: Vec<ApiSubmission> =
        request(app, "user.status", &[("handle", &user.handle), ("from", "1"), ("count", "10000")]).await?;
    tokio::time::sleep(API_DELAY).await;
    let changes: Vec<ApiRatingChange> = request(app, "user.rating", &[("handle", &user.handle)]).await?;

    let display_name = [user.first_name.as_deref(), user.last_name.as_deref()]
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let profile_url = format!("https://codeforces.com/profile/{}", urlencoding(&user.handle));
    let db_error = |e: sqlx::Error| {
        tracing::error!(error = %e, "codeforces sync write failed");
        "Saving the Codeforces data failed.".to_string()
    };
    let mut tx = app.db.begin().await.map_err(db_error)?;
    let profile_id: String = sqlx::query_scalar(
        "INSERT INTO codeforces_profiles (id, user_id, handle, profile_url, display_name, rating, max_rating, rank, max_rank, avatar_url, contribution, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (user_id, handle) DO UPDATE SET profile_url = EXCLUDED.profile_url, display_name = EXCLUDED.display_name,
           rating = EXCLUDED.rating, max_rating = EXCLUDED.max_rating, rank = EXCLUDED.rank, max_rank = EXCLUDED.max_rank,
           avatar_url = EXCLUDED.avatar_url, contribution = EXCLUDED.contribution, last_synced_at = now(), sync_error = NULL, updated_at = now()
         RETURNING id",
    )
    .bind(new_id())
    .bind(user_id)
    .bind(&user.handle)
    .bind(&profile_url)
    .bind((!display_name.is_empty()).then_some(display_name))
    .bind(user.rating)
    .bind(user.max_rating)
    .bind(&user.rank)
    .bind(&user.max_rank)
    .bind(&user.avatar)
    .bind(user.contribution)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;

    let rows: Vec<Value> = submissions
        .iter()
        .map(|s| {
            json!({
                "id": new_id(), "cf": s.id, "contest": s.contest_id.or(s.problem.contest_id), "index": s.problem.index,
                "name": s.problem.name, "rating": s.problem.rating, "tags": s.problem.tags, "verdict": s.verdict,
                "participant": s.author.as_ref().and_then(|a| a.participant_type.clone()), "language": s.programming_language,
                "at": s.creation_time_seconds, "ms": s.time_consumed_millis, "bytes": s.memory_consumed_bytes,
            })
        })
        .collect();
    sqlx::query(
        "INSERT INTO codeforces_submissions (id, profile_id, codeforces_id, contest_id, problem_index, problem_name, problem_rating,
           problem_tags, verdict, participant_type, programming_language, submitted_at, time_consumed_millis, memory_consumed_bytes)
         SELECT x->>'id', $1, (x->>'cf')::bigint, (x->>'contest')::int, x->>'index', x->>'name', (x->>'rating')::int,
           COALESCE(x->'tags', '[]'::jsonb), x->>'verdict', x->>'participant', x->>'language', to_timestamp((x->>'at')::bigint),
           (x->>'ms')::int, (x->>'bytes')::bigint
         FROM jsonb_array_elements($2::jsonb) x
         ON CONFLICT (profile_id, codeforces_id) DO UPDATE SET verdict = EXCLUDED.verdict",
    )
    .bind(&profile_id)
    .bind(Value::Array(rows))
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;

    let rows: Vec<Value> = changes
        .iter()
        .map(|c| {
            json!({
                "id": new_id(), "contest": c.contest_id, "name": c.contest_name, "rank": c.rank,
                "old": c.old_rating, "new": c.new_rating, "at": c.rating_update_time_seconds,
            })
        })
        .collect();
    sqlx::query(
        "INSERT INTO codeforces_rating_changes (id, profile_id, contest_id, contest_name, contest_rank, old_rating, new_rating, updated_at)
         SELECT x->>'id', $1, (x->>'contest')::int, x->>'name', (x->>'rank')::int, (x->>'old')::int, (x->>'new')::int,
           to_timestamp((x->>'at')::bigint)
         FROM jsonb_array_elements($2::jsonb) x
         ON CONFLICT (profile_id, contest_id) DO NOTHING",
    )
    .bind(&profile_id)
    .bind(Value::Array(rows))
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    Ok(SyncSummary { profile_id, handle: user.handle, submissions: submissions.len(), rating_changes: changes.len() })
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

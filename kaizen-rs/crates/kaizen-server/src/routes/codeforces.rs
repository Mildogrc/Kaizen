//! Codeforces dashboard.

use axum::Json;
use axum::extract::{Query, State};
use chrono::{DateTime, Utc};
use kaizen_core::codeforces::{self, Analytics, Problem, RatingChange, Submission};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::User;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

#[derive(sqlx::FromRow)]
struct SubmissionRow {
    submitted_at: DateTime<Utc>,
    verdict: Option<String>,
    contest_id: Option<i32>,
    problem_index: String,
    problem_name: String,
    problem_rating: Option<i32>,
    problem_tags: Value,
}

#[derive(sqlx::FromRow)]
struct ChangeRow {
    id: String,
    contest_name: String,
    contest_rank: i32,
    old_rating: i32,
    new_rating: i32,
    updated_at: DateTime<Utc>,
}

async fn load(app: &App, profile_id: &str) -> ApiResult<(Vec<Submission>, Vec<ChangeRow>)> {
    let submissions: Vec<SubmissionRow> = sqlx::query_as(
        "SELECT submitted_at, verdict, contest_id, problem_index, problem_name, problem_rating, problem_tags
         FROM codeforces_submissions WHERE profile_id = $1 ORDER BY submitted_at DESC",
    )
    .bind(profile_id)
    .fetch_all(&app.db)
    .await?;
    let changes: Vec<ChangeRow> = sqlx::query_as(
        "SELECT id, contest_name, contest_rank, old_rating, new_rating, updated_at FROM codeforces_rating_changes
         WHERE profile_id = $1 ORDER BY updated_at",
    )
    .bind(profile_id)
    .fetch_all(&app.db)
    .await?;
    let submissions = submissions
        .into_iter()
        .map(|s| Submission {
            submitted_at: s.submitted_at,
            verdict: s.verdict,
            problem: Problem {
                contest_id: s.contest_id.map(i64::from),
                problemset_name: None,
                index: s.problem_index,
                name: s.problem_name,
                rating: s.problem_rating.map(i64::from),
                tags: crate::db::json_strings(&s.problem_tags),
            },
        })
        .collect();
    Ok((submissions, changes))
}

fn analyze(user: &User, submissions: &[Submission], changes: &[ChangeRow]) -> Analytics {
    let changes: Vec<RatingChange> = changes
        .iter()
        .map(|c| RatingChange {
            contest_name: c.contest_name.clone(),
            contest_rank: c.contest_rank as i64,
            old_rating: c.old_rating as i64,
            new_rating: c.new_rating as i64,
            updated_at: c.updated_at,
        })
        .collect();
    codeforces::analyze(submissions, &changes, Utc::now(), user.tz)
}

/// Analytics for one of the user's profiles (also used by the Analytics page).
pub async fn analytics_for(app: &App, user: &User, profile_id: &str) -> ApiResult<Analytics> {
    let (submissions, changes) = load(app, profile_id).await?;
    Ok(analyze(user, &submissions, &changes))
}

#[derive(sqlx::FromRow)]
struct ProfileRow {
    id: String,
    handle: String,
    profile_url: String,
    display_name: Option<String>,
    rating: Option<i32>,
    max_rating: Option<i32>,
    rank: Option<String>,
    max_rank: Option<String>,
    avatar_url: Option<String>,
    last_synced_at: Option<DateTime<Utc>>,
    sync_error: Option<String>,
}

#[derive(Deserialize)]
pub struct PageQuery {
    profile: Option<String>,
}

pub async fn page(State(app): State<App>, user: User, Query(query): Query<PageQuery>) -> ApiResult<Json<Value>> {
    let profiles: Vec<ProfileRow> = sqlx::query_as(
        "SELECT id, handle, profile_url, display_name, rating, max_rating, rank, max_rank, avatar_url, last_synced_at, sync_error
         FROM codeforces_profiles WHERE user_id = $1 ORDER BY updated_at DESC",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let selected = profiles.iter().find(|p| Some(&p.id) == query.profile.as_ref()).or(profiles.first());
    let (analytics, contests) = match selected {
        Some(profile) => {
            let (submissions, changes) = load(&app, &profile.id).await?;
            let analytics = analyze(&user, &submissions, &changes);
            let contests: Vec<Value> = changes
                .iter()
                .rev()
                .take(12)
                .map(|c| {
                    json!({
                        "id": c.id, "contestName": c.contest_name, "rank": c.contest_rank, "rating": c.new_rating,
                        "delta": c.new_rating - c.old_rating, "date": kaizen_core::time::day_key(c.updated_at, user.tz),
                    })
                })
                .collect();
            (Some(analytics), contests)
        }
        None => (None, vec![]),
    };
    Ok(Json(json!({
        "profiles": profiles.iter().map(|p| json!({ "id": p.id, "handle": p.handle })).collect::<Vec<_>>(),
        "selected": selected.map(|p| json!({
            "id": p.id, "handle": p.handle, "profileUrl": p.profile_url, "displayName": p.display_name, "rating": p.rating,
            "maxRating": p.max_rating, "rank": p.rank, "maxRank": p.max_rank, "avatarUrl": p.avatar_url,
            "lastSyncedAt": p.last_synced_at, "syncError": p.sync_error,
        })),
        "analytics": analytics,
        "contests": contests,
    })))
}

#[derive(Deserialize)]
pub struct SyncBody {
    input: String,
}

pub async fn sync(State(app): State<App>, user: User, Json(body): Json<SyncBody>) -> ApiResult<Json<Value>> {
    let handle = codeforces::parse_handle(&body.input).map_err(ApiError::bad)?;
    match crate::integrations::codeforces::sync_profile(&app, &user.id, &handle).await {
        Ok(summary) => Ok(Json(json!({ "ok": true, "summary": summary }))),
        Err(message) => {
            sqlx::query("UPDATE codeforces_profiles SET sync_error = $3, updated_at = now() WHERE user_id = $1 AND lower(handle) = lower($2)")
                .bind(&user.id)
                .bind(&handle)
                .bind(&message)
                .execute(&app.db)
                .await?;
            Err(ApiError::Unavailable(message))
        }
    }
}

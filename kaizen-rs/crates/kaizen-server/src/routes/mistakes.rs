//! Mistake log.

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::{ok, owns_course};
use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

#[derive(Deserialize)]
pub struct MistakeQuery {
    course: Option<String>,
}

pub async fn list(State(app): State<App>, user: User, Query(query): Query<MistakeQuery>) -> ApiResult<Json<Value>> {
    let courses: Vec<(String, String, String)> = sqlx::query_as("SELECT id, slug, name FROM courses WHERE user_id = $1 ORDER BY name")
        .bind(&user.id)
        .fetch_all(&app.db)
        .await?;
    let rows: Vec<(String, String, Option<String>, i32, bool, DateTime<Utc>, String, String, Option<String>)> = sqlx::query_as(
        "SELECT m.id, m.description, m.category, m.count, m.resolved, m.updated_at, c.slug, c.name, c.color
         FROM mistakes m JOIN courses c ON c.id = m.course_id WHERE c.user_id = $1 AND ($2::text IS NULL OR c.slug = $2)
         ORDER BY m.resolved, m.updated_at DESC",
    )
    .bind(&user.id)
    .bind(&query.course)
    .fetch_all(&app.db)
    .await?;
    let with_mistakes: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT c.slug FROM mistakes m JOIN courses c ON c.id = m.course_id WHERE c.user_id = $1",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let open = rows.iter().filter(|r| !r.4).count();
    Ok(Json(json!({
        "courses": courses.into_iter().map(|(id, slug, name)| json!({ "id": id, "slug": slug, "name": name, "hasMistakes": with_mistakes.contains(&slug) })).collect::<Vec<_>>(),
        "stats": { "open": open, "resolved": rows.len() - open, "repeat": rows.iter().filter(|r| r.3 > 1).count() },
        "mistakes": rows.into_iter().map(|(id, description, category, count, resolved, updated, slug, name, color)| json!({
            "id": id, "description": description, "category": category, "count": count, "resolved": resolved, "updatedAt": updated,
            "course": { "slug": slug, "name": name, "color": color },
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMistake {
    description: String,
    course_id: String,
    category: Option<String>,
}

pub async fn create(State(app): State<App>, user: User, Json(body): Json<NewMistake>) -> ApiResult<Json<Value>> {
    let description = body.description.trim();
    if description.is_empty() {
        return Err(ApiError::bad("Describe the mistake first."));
    }
    if !owns_course(&app, &user, &body.course_id).await? {
        return Err(ApiError::bad("Choose a course."));
    }
    sqlx::query("INSERT INTO mistakes (id, course_id, description, category) VALUES ($1, $2, $3, $4)")
        .bind(new_id())
        .bind(&body.course_id)
        .bind(description)
        .bind(body.category.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()))
        .execute(&app.db)
        .await?;
    Ok(ok())
}

async fn update(app: &App, user: &User, id: &str, set: &'static str) -> ApiResult<Json<Value>> {
    let sql = match set {
        "toggle" => "UPDATE mistakes m SET resolved = NOT m.resolved, updated_at = now() FROM courses c WHERE m.id = $1 AND c.id = m.course_id AND c.user_id = $2",
        _ => "UPDATE mistakes m SET count = m.count + 1, updated_at = now() FROM courses c WHERE m.id = $1 AND c.id = m.course_id AND c.user_id = $2",
    };
    sqlx::query(sqlx::AssertSqlSafe(sql)).bind(id).bind(&user.id).execute(&app.db).await?;
    Ok(ok())
}

pub async fn toggle(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    update(&app, &user, &id, "toggle").await
}

pub async fn bump(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    update(&app, &user, &id, "bump").await
}

pub async fn remove(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM mistakes m USING courses c WHERE m.id = $1 AND c.id = m.course_id AND c.user_id = $2")
        .bind(&id)
        .bind(&user.id)
        .execute(&app.db)
        .await?;
    Ok(ok())
}

//! Anki page: connection, deck mappings, sync, adaptive budget, leech plans,
//! and the media proxy used by pronunciation practice.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use chrono::{DateTime, Utc};
use kaizen_core::settings as core_settings;
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::{anki_snapshots, camelize, ok, owns_course};
use crate::anki::adaptive::{DeckState, restore_deck};
use crate::anki::{Anki, sync as anki_sync};
use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

pub async fn page(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let anki = Anki::new(&app, &user.id);
    let version = anki.version().await;
    if version.is_some() {
        anki_sync::maybe_auto_sync(&app, &user).await;
    }
    let mappings: Vec<(String, String, String, String, String, Option<String>, Option<String>, bool, bool, Option<DateTime<Utc>>, i64, i64)> =
        sqlx::query_as(
            "SELECT m.id, m.deck_name, m.course_id, c.name, c.slug, m.schema_id, s.name, m.counts_known_words, m.adaptive_new_cards, m.last_synced_at,
                    (SELECT count(*) FROM anki_card_snapshots x WHERE x.mapping_id = m.id),
                    (SELECT count(*) FROM anki_review_logs x WHERE x.mapping_id = m.id)
             FROM anki_deck_mappings m JOIN courses c ON c.id = m.course_id LEFT JOIN content_schemas s ON s.id = m.schema_id
             WHERE m.user_id = $1 ORDER BY m.created_at",
        )
        .bind(&user.id)
        .fetch_all(&app.db)
        .await?;
    let courses: Vec<(String, String, Value)> = sqlx::query_as(
        "SELECT c.id, c.name, COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
           FROM content_schemas s WHERE s.course_id = c.id), '[]'::jsonb)
         FROM courses c WHERE c.user_id = $1 ORDER BY c.name",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let runs: Vec<(String, DateTime<Utc>, String, i32, i32, i32, Option<String>)> = sqlx::query_as(
        "SELECT id, started_at, status, decks_synced, cards_synced, reviews_added, error FROM anki_sync_runs WHERE user_id = $1 ORDER BY started_at DESC LIMIT 5",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let totals: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM anki_card_snapshots WHERE user_id = $1), (SELECT count(*) FROM anki_review_logs WHERE user_id = $1)",
    )
    .bind(&user.id)
    .fetch_one(&app.db)
    .await?;
    let settings = crate::db::user_settings(&app.db, &user.id).await?;
    let adaptive = core_settings::adaptive_anki(&settings);
    let state: Option<(i32, i32)> =
        sqlx::query_as("SELECT current_budget, reliable_data_days FROM anki_adaptive_budget_states WHERE user_id = $1")
            .bind(&user.id)
            .fetch_optional(&app.db)
            .await?;
    let decisions: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(d) - 'user_id' FROM anki_adaptive_budget_decisions d WHERE user_id = $1 ORDER BY calculated_at DESC LIMIT 14",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?
    .into_iter()
    .map(camelize)
    .collect();
    Ok(Json(json!({
        "connection": { "connected": version.is_some(), "version": version, "transport": anki.transport() },
        "totals": { "mappings": mappings.len(), "cards": totals.0, "reviews": totals.1 },
        "adaptive": {
            "settings": adaptive,
            "currentBudget": state.map(|s| s.0),
            "reliableDays": state.map_or(0, |s| s.1),
            "participating": mappings.iter().filter(|m| m.8 && m.4 == "japanese").count(),
            "latest": decisions.first(),
            "history": decisions,
        },
        "mappings": mappings.into_iter().map(|(id, deck, course_id, course, slug, schema_id, schema, words, adaptive, synced, cards, reviews)| json!({
            "id": id, "deckName": deck, "courseId": course_id, "courseName": course, "courseSlug": slug, "schemaId": schema_id, "schemaName": schema,
            "countsKnownWords": words, "adaptiveNewCards": adaptive, "lastSyncedAt": synced, "cards": cards, "reviews": reviews,
        })).collect::<Vec<_>>(),
        "courses": courses.into_iter().map(|(id, name, schemas)| json!({ "id": id, "name": name, "schemas": schemas })).collect::<Vec<_>>(),
        "runs": runs.into_iter().map(|(id, started, status, decks, cards, reviews, error)| json!({
            "id": id, "startedAt": started, "status": status, "decksSynced": decks, "cardsSynced": cards, "reviewsAdded": reviews, "error": error,
        })).collect::<Vec<_>>(),
    })))
}

pub async fn decks(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let anki = Anki::new(&app, &user.id);
    match anki.deck_names().await {
        Ok(mut decks) => {
            decks.retain(|d| d != "Default");
            decks.sort();
            Ok(Json(json!({ "connected": true, "decks": decks })))
        }
        Err(_) => Ok(Json(json!({ "connected": false, "decks": [] }))),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMapping {
    deck_name: String,
    course_id: String,
    schema_id: Option<String>,
}

pub async fn save_mapping(State(app): State<App>, user: User, Json(body): Json<SaveMapping>) -> ApiResult<Json<Value>> {
    if body.deck_name.trim().is_empty() || !owns_course(&app, &user, &body.course_id).await? {
        return Err(ApiError::bad("Choose a course and a deck."));
    }
    sqlx::query(
        "INSERT INTO anki_deck_mappings (id, user_id, deck_name, course_id, schema_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, deck_name) DO UPDATE SET course_id = EXCLUDED.course_id, schema_id = EXCLUDED.schema_id",
    )
    .bind(new_id())
    .bind(&user.id)
    .bind(body.deck_name.trim())
    .bind(&body.course_id)
    .bind(body.schema_id.filter(|s| !s.is_empty()))
    .execute(&app.db)
    .await?;
    Ok(ok())
}

pub async fn remove_mapping(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let mapping: Option<(String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT m.deck_name, s.original_config_id, s.managed_config_id, s.managed_config_name
         FROM anki_deck_mappings m LEFT JOIN anki_adaptive_deck_states s ON s.mapping_id = m.id WHERE m.id = $1 AND m.user_id = $2",
    )
    .bind(&id)
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?;
    let Some((deck, original, managed, name)) = mapping else { return Ok(ok()) };
    if let (Some(original), Some(managed), Some(name)) = (original, managed, name) {
        let state = DeckState { mapping_id: id.clone(), original_config_id: original, managed_config_id: managed, managed_config_name: name };
        restore_deck(&app, &user.id, &deck, &state).await.map_err(ApiError::Conflict)?;
    }
    sqlx::query("DELETE FROM anki_deck_mappings WHERE id = $1 AND user_id = $2").bind(&id).bind(&user.id).execute(&app.db).await?;
    Ok(ok())
}

pub async fn toggle_words(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query("UPDATE anki_deck_mappings SET counts_known_words = NOT counts_known_words WHERE id = $1 AND user_id = $2")
        .bind(&id)
        .bind(&user.id)
        .execute(&app.db)
        .await?;
    let summary = crate::known_words::refresh_anki_words(&app, &user).await?;
    Ok(Json(json!({ "ok": true, "words": summary })))
}

pub async fn toggle_adaptive(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query(
        "UPDATE anki_deck_mappings m SET adaptive_new_cards = NOT m.adaptive_new_cards FROM courses c
         WHERE m.id = $1 AND m.user_id = $2 AND c.id = m.course_id AND c.slug = 'japanese'",
    )
    .bind(&id)
    .bind(&user.id)
    .execute(&app.db)
    .await?;
    if let Err(e) = crate::anki::adaptive::reconcile(&app, &user).await {
        tracing::warn!(error = %e, "adaptive reconcile failed");
    }
    Ok(ok())
}

pub async fn sync(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    Ok(Json(serde_json::to_value(anki_sync::sync(&app, &user).await).map_err(anyhow::Error::from)?))
}

#[derive(Deserialize)]
pub struct LeechQuery {
    limit: Option<usize>,
    download: Option<bool>,
}

pub async fn leech_plan(State(app): State<App>, user: User, Path(mapping_id): Path<String>, Query(query): Query<LeechQuery>) -> ApiResult<Response> {
    let (deck, course): (String, String) = sqlx::query_as(
        "SELECT m.deck_name, c.name FROM anki_deck_mappings m JOIN courses c ON c.id = m.course_id WHERE m.id = $1 AND m.user_id = $2",
    )
    .bind(&mapping_id)
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?
    .ok_or_else(|| ApiError::not_found("Deck mapping"))?;
    let snapshots = anki_snapshots(&app, std::slice::from_ref(&mapping_id)).await?;
    let mut leeches = kaizen_core::anki_analytics::leeches(&snapshots);
    leeches.truncate(query.limit.filter(|l| *l > 0).unwrap_or(usize::MAX));
    let md = kaizen_core::leech_prompt::build_leech_lesson_plan_md(&deck, &course, &leeches);
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/markdown; charset=utf-8"));
    if query.download.unwrap_or(false) {
        let slug: String = kaizen_core::util::slugify(&deck);
        if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename=\"{slug}-leech-lesson-plan.md\"")) {
            headers.insert(header::CONTENT_DISPOSITION, value);
        }
    }
    Ok((headers, md).into_response())
}

#[derive(Deserialize)]
pub struct MediaQuery {
    file: String,
}

pub async fn media(State(app): State<App>, user: User, Query(query): Query<MediaQuery>) -> ApiResult<Response> {
    let file = query.file;
    let extension = file.rsplit('.').next().unwrap_or("").to_lowercase();
    let content_type = match extension.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "webm" => "audio/webm",
        _ => return Err(ApiError::bad("Invalid audio filename.")),
    };
    let valid = !file.is_empty() && file.len() <= 255 && !file.contains("..") && file.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c));
    if !valid {
        return Err(ApiError::bad("Invalid audio filename."));
    }
    let anki = Anki::new(&app, &user.id);
    match anki.retrieve_media_file(&file).await {
        Ok(Some(encoded)) => {
            let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(anyhow::Error::from)?;
            Ok((
                [(header::CONTENT_TYPE, content_type), (header::CACHE_CONTROL, "private, max-age=2592000")],
                bytes,
            )
                .into_response())
        }
        Ok(None) => Ok((StatusCode::NOT_FOUND, "Word audio was not found in Anki.").into_response()),
        Err(_) => Ok((StatusCode::SERVICE_UNAVAILABLE, "Anki is not available.").into_response()),
    }
}

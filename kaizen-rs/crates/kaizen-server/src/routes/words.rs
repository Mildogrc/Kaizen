//! Known words: union of Migaku, mature Anki cards, and manual adds.

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::ok;
use crate::auth::User;
use crate::error::{ApiError, ApiResult};
use crate::known_words;
use crate::state::App;

#[derive(Deserialize)]
pub struct WordsQuery {
    q: Option<String>,
    lang: Option<String>,
    source: Option<String>,
}

pub async fn page(State(app): State<App>, user: User, Query(query): Query<WordsQuery>) -> ApiResult<Json<Value>> {
    known_words::maybe_recompute(&app, &user).await;
    let mut languages = Vec::new();
    for language in ["ja", "zh"] {
        let bounds = known_words::bounds(&app, &user.id, language).await?;
        languages.push(json!({
            "language": language, "lower": bounds.lower, "upper": bounds.upper, "bySource": bounds.by_source, "overlap": bounds.overlap,
        }));
    }
    let stats: Vec<(NaiveDate, String, i32, i32)> =
        sqlx::query_as("SELECT date, language, lower_bound, upper_bound FROM known_word_stats WHERE user_id = $1 ORDER BY date")
            .bind(&user.id)
            .fetch_all(&app.db)
            .await?;
    let lang = query.lang.filter(|l| l == "ja" || l == "zh");
    let source = query.source.filter(|s| ["migaku", "anki", "manual"].contains(&s.as_str()));
    let search = query.q.map(|q| q.trim().to_string()).filter(|q| !q.is_empty());
    let words: Vec<(String, String, String, Option<String>, String, String, Option<String>, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, surface, lemma, reading, language, source, source_detail, created_at FROM known_words
         WHERE user_id = $1 AND ($2::text IS NULL OR language = $2) AND ($3::text IS NULL OR source = $3)
           AND ($4::text IS NULL OR strpos(surface, $4) > 0 OR strpos(lemma, $4) > 0 OR strpos(coalesce(reading, ''), $4) > 0)
         ORDER BY created_at DESC LIMIT 200",
    )
    .bind(&user.id)
    .bind(&lang)
    .bind(&source)
    .bind(&search)
    .fetch_all(&app.db)
    .await?;
    let history: Vec<Value> = ["ja", "zh"]
        .iter()
        .map(|language| {
            json!({
                "language": language,
                "points": stats.iter().filter(|s| s.1 == *language).map(|s| json!({
                    "date": kaizen_core::time::date_key(s.0), "lower": s.2, "upper": s.3,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    Ok(Json(json!({
        "languages": languages,
        "history": history,
        "filters": { "q": search, "lang": lang, "source": source },
        "words": words.into_iter().map(|(id, surface, lemma, reading, language, source, detail, created)| json!({
            "id": id, "surface": surface, "lemma": lemma, "reading": reading, "language": language, "source": source,
            "sourceDetail": detail, "createdAt": created,
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
pub struct AddBody {
    word: String,
    language: String,
}

pub async fn add(State(app): State<App>, user: User, Json(body): Json<AddBody>) -> ApiResult<Json<Value>> {
    let word = body.word.trim();
    if word.is_empty() || word.chars().count() > 64 {
        return Err(ApiError::bad("Enter a single word."));
    }
    let language = if body.language == "zh" { "zh" } else { "ja" };
    let added = known_words::add_manual(&app, &user, language, word).await?;
    if !added {
        return Err(ApiError::bad("That word could not be normalized, or it is already in your list."));
    }
    known_words::recompute_stats(&app, &user).await?;
    Ok(ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigakuBody {
    language: String,
    text: String,
    #[serde(default)]
    include_learning: bool,
}

pub async fn migaku(State(app): State<App>, user: User, Json(body): Json<MigakuBody>) -> ApiResult<Json<Value>> {
    if body.text.trim().is_empty() {
        return Err(ApiError::bad("Paste or upload a Migaku export first."));
    }
    let language = if body.language == "zh" { "zh" } else { "ja" };
    let summary = known_words::import_migaku(&app, &user, language, &body.text, body.include_learning).await?;
    let stats = known_words::recompute_stats(&app, &user).await?;
    Ok(Json(json!({ "ok": true, "summary": summary, "stats": stats })))
}

pub async fn refresh_anki(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let summary = known_words::refresh_anki_words(&app, &user).await.map_err(|e| ApiError::Unavailable(format!("{e:#}")))?;
    let stats = known_words::recompute_stats(&app, &user).await?;
    Ok(Json(json!({ "ok": true, "summary": summary, "stats": stats })))
}

pub async fn remove(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM known_words WHERE id = $1 AND user_id = $2").bind(&id).bind(&user.id).execute(&app.db).await?;
    known_words::recompute_stats(&app, &user).await?;
    Ok(ok())
}

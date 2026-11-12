//! YouTube lecture playlists: import, resume, progress, and artwork.

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Multipart, Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use kaizen_core::youtube::{self as yt, PlaylistMetadata, WatchItem};
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::ok;
use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

const MAX_ARTWORK_BYTES: usize = 8 * 1024 * 1024;

#[derive(sqlx::FromRow)]
struct PlaylistRow {
    id: String,
    youtube_playlist_id: String,
    source_url: String,
    title: String,
    description: Option<String>,
    channel_title: Option<String>,
    thumbnail_url: Option<String>,
    custom_image_url: Option<String>,
    image_prompt: Option<String>,
    current_video_id: Option<String>,
    current_position: i32,
    current_seconds: i32,
    status: String,
    total_items: i32,
    metadata_source: String,
    last_fetched_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow, Clone)]
struct ItemRow {
    id: String,
    playlist_id: String,
    youtube_video_id: String,
    position: i32,
    title: String,
    thumbnail_url: Option<String>,
    duration_seconds: Option<i32>,
    completed: bool,
    watched_seconds: i32,
}

impl ItemRow {
    fn watch(&self) -> WatchItem {
        WatchItem {
            position: self.position as i64,
            duration_seconds: self.duration_seconds.map(i64::from),
            watched_seconds: self.watched_seconds as i64,
            completed: self.completed,
        }
    }
}

const PLAYLIST_COLUMNS: &str = "id, youtube_playlist_id, source_url, title, description, channel_title, thumbnail_url, custom_image_url, image_prompt,
    current_video_id, current_position, current_seconds, status, total_items, metadata_source, last_fetched_at, updated_at";

async fn playlist(app: &App, user: &User, id: &str) -> ApiResult<PlaylistRow> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT {PLAYLIST_COLUMNS} FROM youtube_playlists WHERE id = $1 AND user_id = $2")))
        .bind(id)
        .bind(&user.id)
        .fetch_optional(&app.db)
        .await?
        .ok_or_else(|| ApiError::not_found("Playlist"))
}

async fn items(app: &App, playlist_ids: &[String]) -> ApiResult<Vec<ItemRow>> {
    Ok(sqlx::query_as(
        "SELECT id, playlist_id, youtube_video_id, position, title, thumbnail_url, duration_seconds, completed, watched_seconds
         FROM youtube_playlist_items WHERE playlist_id = ANY($1) ORDER BY position",
    )
    .bind(playlist_ids)
    .fetch_all(&app.db)
    .await?)
}

fn summarize(p: &PlaylistRow, items: &[ItemRow]) -> yt::WatchProgress {
    let watch: Vec<WatchItem> = items.iter().map(ItemRow::watch).collect();
    let total = (p.total_items as i64).max(items.len() as i64);
    yt::playlist_progress(&watch, total, Some((p.current_position as i64, p.current_seconds as i64)))
}

fn runtime(p: &PlaylistRow, items: &[ItemRow]) -> yt::Runtime {
    let durations: Vec<Option<i64>> = items.iter().map(|i| i.duration_seconds.map(i64::from)).collect();
    yt::runtime(&durations, (p.total_items as i64).max(items.len() as i64))
}

pub async fn list(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let playlists: Vec<PlaylistRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PLAYLIST_COLUMNS} FROM youtube_playlists WHERE user_id = $1 ORDER BY status, updated_at DESC"
    )))
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let ids: Vec<String> = playlists.iter().map(|p| p.id.clone()).collect();
    let mut by_playlist: HashMap<String, Vec<ItemRow>> = HashMap::new();
    for item in items(&app, &ids).await? {
        by_playlist.entry(item.playlist_id.clone()).or_default().push(item);
    }
    let empty = Vec::new();
    let cards: Vec<Value> = playlists
        .iter()
        .map(|p| {
            let items = by_playlist.get(&p.id).unwrap_or(&empty);
            json!({
                "id": p.id, "title": p.title, "channelTitle": p.channel_title, "status": p.status,
                "image": p.custom_image_url.clone().or_else(|| p.thumbnail_url.clone()), "customImage": p.custom_image_url.is_some(),
                "total": (p.total_items as usize).max(items.len()), "completed": items.iter().filter(|i| i.completed).count(),
                "currentPosition": p.current_position, "progress": summarize(p, items), "runtime": runtime(p, items),
            })
        })
        .collect();
    let finished: usize = by_playlist.values().map(|items| items.iter().filter(|i| i.completed).count()).sum();
    Ok(Json(json!({
        "stats": { "playlists": playlists.len(), "active": playlists.iter().filter(|p| p.status == "ACTIVE").count(), "lecturesFinished": finished },
        "playlists": cards,
    })))
}

pub async fn detail(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let p = playlist(&app, &user, &id).await?;
    let items = items(&app, std::slice::from_ref(&p.id)).await?;
    let current = items
        .iter()
        .find(|i| Some(&i.youtube_video_id) == p.current_video_id.as_ref())
        .or_else(|| items.iter().find(|i| i.position == p.current_position))
        .or(items.first());
    let total = (p.total_items as usize).max(items.len());
    let watch_url = match current {
        Some(item) => format!(
            "https://www.youtube.com/watch?v={}&list={}&index={}&t={}s",
            item.youtube_video_id,
            p.youtube_playlist_id,
            item.position + 1,
            p.current_seconds
        ),
        None => p.source_url.clone(),
    };
    Ok(Json(json!({
        "playlist": {
            "id": p.id, "youtubePlaylistId": p.youtube_playlist_id, "sourceUrl": p.source_url, "title": p.title,
            "description": p.description, "channelTitle": p.channel_title, "image": p.custom_image_url.clone().or_else(|| p.thumbnail_url.clone()),
            "customImageUrl": p.custom_image_url, "imagePrompt": p.image_prompt, "status": p.status,
            "currentSeconds": p.current_seconds, "metadataSource": p.metadata_source, "lastFetchedAt": p.last_fetched_at, "updatedAt": p.updated_at,
        },
        "art": art_json(&art_of(&user, &p.id, &p.title)),
        "total": total,
        "completed": items.iter().filter(|i| i.completed).count(),
        "progress": summarize(&p, &items),
        "runtime": runtime(&p, &items),
        "current": current.map(|i| json!({ "id": i.id, "videoId": i.youtube_video_id, "position": i.position, "title": i.title })),
        "watchUrl": watch_url,
        "embedUrl": yt::embed_url(&p.youtube_playlist_id, current.map(|i| i.youtube_video_id.as_str()), current.map(|i| i.position as i64), Some(p.current_seconds as i64)),
        "items": items.iter().map(|i| json!({
            "id": i.id, "videoId": i.youtube_video_id, "position": i.position, "title": i.title, "thumbnailUrl": i.thumbnail_url,
            "durationSeconds": i.duration_seconds, "completed": i.completed, "watchedSeconds": i.watched_seconds,
        })).collect::<Vec<_>>(),
    })))
}

/// Upsert playlist metadata, preserving per-lecture progress by video id.
async fn save_metadata(app: &App, user: &User, metadata: &PlaylistMetadata) -> ApiResult<String> {
    let existing: Option<(String, Option<String>, i32)> = sqlx::query_as(
        "SELECT id, current_video_id, current_position FROM youtube_playlists WHERE user_id = $1 AND youtube_playlist_id = $2",
    )
    .bind(&user.id)
    .bind(&metadata.playlist_id)
    .fetch_optional(&app.db)
    .await?;
    let old_items = match &existing {
        Some((id, _, _)) => items(app, std::slice::from_ref(id)).await?,
        None => vec![],
    };
    let old_by_video: HashMap<&str, &ItemRow> = old_items.iter().map(|i| (i.youtube_video_id.as_str(), i)).collect();
    let current = existing
        .as_ref()
        .and_then(|(_, video, position)| {
            metadata
                .items
                .iter()
                .find(|i| Some(&i.video_id) == video.as_ref())
                .or_else(|| metadata.items.iter().find(|i| i.position == *position as i64))
        })
        .or(metadata.items.first());
    let mut tx = app.db.begin().await?;
    let playlist_id: String = sqlx::query_scalar(
        "INSERT INTO youtube_playlists (id, user_id, youtube_playlist_id, source_url, title, description, channel_title, thumbnail_url,
           current_video_id, current_position, total_items, metadata_source, last_fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
         ON CONFLICT (user_id, youtube_playlist_id) DO UPDATE SET source_url = EXCLUDED.source_url, title = EXCLUDED.title,
           description = EXCLUDED.description, channel_title = EXCLUDED.channel_title, thumbnail_url = EXCLUDED.thumbnail_url,
           current_video_id = EXCLUDED.current_video_id, current_position = EXCLUDED.current_position, total_items = EXCLUDED.total_items,
           metadata_source = EXCLUDED.metadata_source, last_fetched_at = now(), updated_at = now()
         RETURNING id",
    )
    .bind(new_id())
    .bind(&user.id)
    .bind(&metadata.playlist_id)
    .bind(&metadata.source_url)
    .bind(&metadata.title)
    .bind(&metadata.description)
    .bind(&metadata.channel_title)
    .bind(&metadata.thumbnail_url)
    .bind(current.map(|c| c.video_id.clone()))
    .bind(current.map_or(0, |c| c.position as i32))
    .bind(metadata.total_items.max(metadata.items.len() as i64) as i32)
    .bind(metadata.source)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM youtube_playlist_items WHERE playlist_id = $1").bind(&playlist_id).execute(&mut *tx).await?;
    let rows: Vec<Value> = metadata
        .items
        .iter()
        .map(|item| {
            let old = old_by_video.get(item.video_id.as_str());
            let published = item.published_at.as_deref().and_then(|d| DateTime::parse_from_rfc3339(d).ok()).map(|d| d.with_timezone(&Utc));
            json!({
                "id": new_id(), "video": item.video_id, "position": item.position, "title": item.title, "description": item.description,
                "thumbnail": item.thumbnail_url, "published": published,
                "duration": item.duration_seconds.or_else(|| old.and_then(|o| o.duration_seconds.map(i64::from))),
                "completed": old.is_some_and(|o| o.completed), "watched": old.map_or(0, |o| o.watched_seconds),
            })
        })
        .collect();
    sqlx::query(
        "INSERT INTO youtube_playlist_items (id, playlist_id, youtube_video_id, position, title, description, thumbnail_url, published_at,
           duration_seconds, completed, watched_seconds)
         SELECT x->>'id', $1, x->>'video', (x->>'position')::int, x->>'title', x->>'description', x->>'thumbnail',
           (x->>'published')::timestamptz, (x->>'duration')::int, (x->>'completed')::boolean, (x->>'watched')::int
         FROM jsonb_array_elements($2::jsonb) x
         ON CONFLICT (playlist_id, position) DO NOTHING",
    )
    .bind(&playlist_id)
    .bind(Value::Array(rows))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(playlist_id)
}

#[derive(Deserialize)]
pub struct AddBody {
    url: String,
}

pub async fn add(State(app): State<App>, user: User, Json(body): Json<AddBody>) -> ApiResult<Json<Value>> {
    yt::parse_playlist_id(&body.url).map_err(ApiError::bad)?;
    let metadata = crate::integrations::youtube::fetch_metadata(&app, &body.url).await.map_err(ApiError::Unavailable)?;
    let id = save_metadata(&app, &user, &metadata).await?;
    Ok(Json(json!({ "ok": true, "playlistId": id, "message": "Playlist added." })))
}

pub async fn refresh(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let p = playlist(&app, &user, &id).await?;
    let metadata = crate::integrations::youtube::fetch_metadata(&app, &p.youtube_playlist_id).await.map_err(ApiError::Unavailable)?;
    save_metadata(&app, &user, &metadata).await?;
    Ok(Json(json!({ "ok": true, "message": "Playlist details refreshed." })))
}

pub async fn remove(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM youtube_playlists WHERE id = $1 AND user_id = $2").bind(&id).bind(&user.id).execute(&app.db).await?;
    Ok(ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionBody {
    item_id: String,
    minutes: i64,
    seconds: i64,
    #[serde(default)]
    record_progress: bool,
}

pub async fn set_position(State(app): State<App>, user: User, Path(id): Path<String>, Json(body): Json<PositionBody>) -> ApiResult<Json<Value>> {
    playlist(&app, &user, &id).await?;
    let total = body.minutes.max(0) * 60 + body.seconds.clamp(0, 59);
    if total > 10_000_000 {
        return Err(ApiError::bad("That time is too large."));
    }
    let item: ItemRow = sqlx::query_as(
        "SELECT id, playlist_id, youtube_video_id, position, title, thumbnail_url, duration_seconds, completed, watched_seconds
         FROM youtube_playlist_items WHERE id = $1 AND playlist_id = $2",
    )
    .bind(&body.item_id)
    .bind(&id)
    .fetch_optional(&app.db)
    .await?
    .ok_or_else(|| ApiError::not_found("Lecture"))?;
    let update = yt::playback_update(&item.watch(), total as f64, false);
    let mut tx = app.db.begin().await?;
    if body.record_progress {
        sqlx::query("UPDATE youtube_playlist_items SET completed = true, updated_at = now() WHERE playlist_id = $1 AND position < $2")
            .bind(&id)
            .bind(item.position)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE youtube_playlist_items SET watched_seconds = $2, completed = $3, updated_at = now() WHERE id = $1")
            .bind(&item.id)
            .bind(update.watched_seconds as i32)
            .bind(update.completed)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query(
        "UPDATE youtube_playlists SET current_video_id = $2, current_position = $3, current_seconds = $4, status = 'ACTIVE', updated_at = now() WHERE id = $1",
    )
    .bind(&id)
    .bind(&item.youtube_video_id)
    .bind(item.position)
    .bind(update.current_seconds as i32)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressBody {
    video_id: String,
    position: i64,
    seconds: f64,
    #[serde(default)]
    ended: bool,
}

/// Periodic playback reports from the embedded player.
pub async fn progress(State(app): State<App>, user: User, Path(id): Path<String>, Json(body): Json<ProgressBody>) -> ApiResult<Json<Value>> {
    let (app, user, id) = (&app, &user, id.as_str());
    if !yt::is_video_id(&body.video_id) || !(0..=100_000).contains(&body.position) || !(0.0..=10_000_000.0).contains(&body.seconds) {
        return Err(ApiError::bad("Invalid playback progress."));
    }
    let p = playlist(app, user, id).await?;
    let items = items(app, std::slice::from_ref(&p.id)).await?;
    let current = items
        .iter()
        .find(|i| i.youtube_video_id == body.video_id && i.position as i64 == body.position)
        .or_else(|| items.iter().find(|i| i.youtube_video_id == body.video_id))
        .ok_or_else(|| ApiError::bad("Lecture not found in this playlist."))?
        .clone();
    let update = yt::playback_update(&current.watch(), body.seconds, body.ended);
    let updated: Vec<ItemRow> = items
        .iter()
        .map(|i| {
            if i.id == current.id {
                ItemRow { watched_seconds: update.watched_seconds as i32, completed: update.completed, ..i.clone() }
            } else {
                i.clone()
            }
        })
        .collect();
    let next = PlaylistRow { current_position: current.position, current_seconds: update.current_seconds as i32, ..p };
    let summary = summarize(&next, &updated);
    let mut tx = app.db.begin().await?;
    sqlx::query("UPDATE youtube_playlist_items SET watched_seconds = $2, completed = $3, updated_at = now() WHERE id = $1")
        .bind(&current.id)
        .bind(update.watched_seconds as i32)
        .bind(update.completed)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE youtube_playlists SET current_video_id = $2, current_position = $3, current_seconds = $4, status = $5, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(&current.youtube_video_id)
    .bind(current.position)
    .bind(update.current_seconds as i32)
    .bind(if summary.percentage == Some(100.0) { "COMPLETED" } else { "ACTIVE" })
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "progress": summary })))
}

pub async fn image_prompt(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let p = playlist(&app, &user, &id).await?;
    let art = art_of(&user, &p.id, &p.title);
    let prompt = yt::build_image_prompt(&art.name, art.pairing, &p.title);
    sqlx::query("UPDATE youtube_playlists SET image_prompt = $2, updated_at = now() WHERE id = $1").bind(&id).bind(&prompt).execute(&app.db).await?;
    Ok(Json(json!({ "ok": true, "prompt": prompt })))
}

fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

/// Artwork: an uploaded image (stored in Postgres so app servers stay
/// stateless) or a remote http(s) image URL.
pub async fn artwork(State(app): State<App>, user: User, Path(id): Path<String>, mut form: Multipart) -> ApiResult<Json<Value>> {
    playlist(&app, &user, &id).await?;
    let mut image_url: Option<String> = None;
    let mut upload: Option<Vec<u8>> = None;
    while let Some(field) = form.next_field().await.map_err(|e| ApiError::bad(e.to_string()))? {
        match field.name() {
            Some("imageUrl") => image_url = Some(field.text().await.map_err(|e| ApiError::bad(e.to_string()))?.trim().to_string()),
            Some("imageFile") => {
                let bytes = field.bytes().await.map_err(|e| ApiError::bad(e.to_string()))?;
                if !bytes.is_empty() {
                    upload = Some(bytes.to_vec());
                }
            }
            _ => {}
        }
    }
    let custom = match (upload, image_url.filter(|u| !u.is_empty())) {
        (Some(bytes), _) => {
            if bytes.len() > MAX_ARTWORK_BYTES {
                return Err(ApiError::bad("The image must be smaller than 8 MB."));
            }
            let content_type = sniff_image(&bytes).ok_or_else(|| ApiError::bad("Upload a PNG, JPEG, WebP, or GIF image."))?;
            let blob_id = new_id();
            sqlx::query("INSERT INTO blobs (id, user_id, content_type, data) VALUES ($1, $2, $3, $4)")
                .bind(&blob_id)
                .bind(&user.id)
                .bind(content_type)
                .bind(bytes)
                .execute(&app.db)
                .await?;
            format!("/api/blobs/{blob_id}")
        }
        (None, Some(url)) => {
            let parsed = url::Url::parse(&url).map_err(|_| ApiError::bad("Use a valid http:// or https:// image URL."))?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err(ApiError::bad("Use a valid http:// or https:// image URL."));
            }
            parsed.to_string()
        }
        (None, None) => return Err(ApiError::bad("Choose an image file or paste an image URL.")),
    };
    set_custom_image(&app, &user, &id, &custom).await?;
    let mut art = art_of(&user, &id, "");
    art.style = Some("artistic".into());
    save_art(&app, &user, &id, &art).await?;
    Ok(Json(json!({ "ok": true, "imageUrl": custom, "message": "Cover updated." })))
}

/// Point a course at new artwork and drop the blob it replaces.
async fn set_custom_image(app: &App, user: &User, id: &str, url: &str) -> ApiResult<()> {
    let previous: Option<String> = sqlx::query_scalar(
        "UPDATE youtube_playlists p SET custom_image_url = $3, updated_at = now() FROM youtube_playlists old
         WHERE p.id = old.id AND p.id = $1 AND p.user_id = $2 RETURNING old.custom_image_url",
    )
    .bind(id)
    .bind(&user.id)
    .bind(url)
    .fetch_optional(&app.db)
    .await?
    .flatten();
    if let Some(old_blob) = previous.as_deref().and_then(|u| u.strip_prefix("/api/blobs/")) {
        sqlx::query("DELETE FROM blobs WHERE id = $1 AND user_id = $2").bind(old_blob).bind(&user.id).execute(&app.db).await?;
    }
    Ok(())
}

// ------------------------------------------------------------------ covers
//
// A course's cover name, colour pair and style live in `users.settings.courseArt`
// keyed by playlist id, so covers need no schema change.

struct Art {
    name: String,
    pairing: usize,
    style: Option<String>,
}

fn art_of(user: &User, id: &str, title: &str) -> Art {
    let saved = user.settings.get("courseArt").and_then(|a| a.get(id));
    let text = |k: &str| saved.and_then(|v| v.get(k)).and_then(Value::as_str).map(str::to_string);
    Art {
        name: text("name").unwrap_or_else(|| yt::simple_name(title)),
        pairing: saved.and_then(|v| v.get("pairing")).and_then(Value::as_u64).map_or_else(|| yt::default_pairing(id), |p| p as usize % yt::PAIRINGS.len()),
        style: text("style"),
    }
}

async fn save_art(app: &App, user: &User, id: &str, art: &Art) -> ApiResult<()> {
    let settings = crate::db::user_settings(&app.db, &user.id).await?;
    let mut section = settings.get("courseArt").cloned().filter(Value::is_object).unwrap_or_else(|| json!({}));
    section[id] = json!({ "name": art.name, "pairing": art.pairing, "style": art.style });
    crate::db::set_settings_section(&app.db, &user.id, "courseArt", &section).await?;
    Ok(())
}

fn art_json(art: &Art) -> Value {
    json!({
        "name": art.name, "pairing": art.pairing, "style": art.style,
        "pairings": yt::PAIRINGS.iter().map(|(name, background, ink)| json!({ "name": name, "background": background, "ink": ink })).collect::<Vec<_>>(),
    })
}

async fn store_simple_cover(app: &App, user: &User, id: &str, art: &Art) -> ApiResult<String> {
    let blob_id = new_id();
    sqlx::query("INSERT INTO blobs (id, user_id, content_type, data) VALUES ($1, $2, 'image/svg+xml', $3)")
        .bind(&blob_id)
        .bind(&user.id)
        .bind(yt::simple_cover_svg(&art.name, art.pairing).into_bytes())
        .execute(&app.db)
        .await?;
    let url = format!("/api/blobs/{blob_id}");
    set_custom_image(app, user, id, &url).await?;
    Ok(url)
}

#[derive(Deserialize)]
pub struct ArtBody {
    name: Option<String>,
    pairing: Option<usize>,
    /// "simple" draws the two-colour panel now; anything else only saves.
    style: Option<String>,
}

pub async fn update_art(State(app): State<App>, user: User, Path(id): Path<String>, Json(body): Json<ArtBody>) -> ApiResult<Json<Value>> {
    let p = playlist(&app, &user, &id).await?;
    let mut art = art_of(&user, &id, &p.title);
    if let Some(name) = body.name.map(|n| n.trim().chars().take(40).collect::<String>()).filter(|n| !n.is_empty()) {
        art.name = name;
    }
    if let Some(pairing) = body.pairing {
        art.pairing = pairing % yt::PAIRINGS.len();
    }
    let image = if body.style.as_deref() == Some("simple") {
        art.style = Some("simple".into());
        Some(store_simple_cover(&app, &user, &id, &art).await?)
    } else {
        None
    };
    save_art(&app, &user, &id, &art).await?;
    let prompt = yt::build_image_prompt(&art.name, art.pairing, &p.title);
    sqlx::query("UPDATE youtube_playlists SET image_prompt = $2, updated_at = now() WHERE id = $1").bind(&id).bind(&prompt).execute(&app.db).await?;
    Ok(Json(json!({ "ok": true, "imageUrl": image, "prompt": prompt })))
}

const NAMING_SYSTEM: &str = "You give study courses the plainest name a person would use, for a cover. 1 to 4 words, Title Case, no course codes, years, lecturer names, or punctuation.";

fn naming_examples() -> &'static str {
    "Examples: \"Lectures on Random Matrices\" → Random Matrix Theory. \"Quantum Mechanics & Quantum Computation - Umesh Vazirani\" → Quantum Computing. \"Quant Trading Learning Path\" → Quant Trading."
}

pub async fn suggest_name(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let p = playlist(&app, &user, &id).await?;
    let description: String = p.description.as_deref().unwrap_or("").chars().take(400).collect();
    let prompt = format!("{}\n\nCourse: {}\nDescription: {description}\n\nReply with the name only.", naming_examples(), p.title);
    let answer = crate::ai::ask_once(&app, &user, NAMING_SYSTEM, &prompt).await.map_err(|e| ApiError::bad(e.to_string()))?;
    let name = yt::tidy_name(&answer).ok_or_else(|| ApiError::bad("The AI didn't suggest a name. Try again or type one."))?;
    Ok(Json(json!({ "name": name })))
}

/// Give every course still on its YouTube thumbnail a simple cover. Names come
/// from the AI in one request when one is connected, otherwise from the title.
pub async fn simple_covers(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let missing: Vec<(String, String)> =
        sqlx::query_as("SELECT id, title FROM youtube_playlists WHERE user_id = $1 AND custom_image_url IS NULL ORDER BY created_at").bind(&user.id).fetch_all(&app.db).await?;
    if missing.is_empty() {
        return Ok(Json(json!({ "made": 0, "named": "none" })));
    }
    let list = missing.iter().enumerate().map(|(i, (_, title))| format!("{}. {title}", i + 1)).collect::<Vec<_>>().join("\n");
    let prompt = format!("{}\n\nName each course below. Reply with exactly one name per line, in the same order, nothing else.\n\n{list}", naming_examples());
    let suggested: Vec<String> = match crate::ai::ask_once(&app, &user, NAMING_SYSTEM, &prompt).await {
        Ok(answer) => answer.lines().filter_map(yt::tidy_name).collect(),
        Err(_) => vec![],
    };
    let from_ai = suggested.len() == missing.len();
    for (i, (id, title)) in missing.iter().enumerate() {
        let mut art = art_of(&user, id, title);
        if from_ai {
            art.name = suggested[i].clone();
        }
        art.style = Some("simple".into());
        store_simple_cover(&app, &user, id, &art).await?;
        save_art(&app, &user, id, &art).await?;
        let prompt = yt::build_image_prompt(&art.name, art.pairing, title);
        sqlx::query("UPDATE youtube_playlists SET image_prompt = $2 WHERE id = $1").bind(id).bind(&prompt).execute(&app.db).await?;
    }
    Ok(Json(json!({ "made": missing.len(), "named": if from_ai { "ai" } else { "title" } })))
}

#[derive(Deserialize)]
pub struct StatusBody {
    status: String,
}

/// Active courses show on Today and Tracks; back-burner ones wait in the Library.
pub async fn set_status(State(app): State<App>, user: User, Path(id): Path<String>, Json(body): Json<StatusBody>) -> ApiResult<Json<Value>> {
    if !matches!(body.status.as_str(), "ACTIVE" | "PAUSED") {
        return Err(ApiError::bad("A course is either active or on the back burner."));
    }
    let updated = sqlx::query("UPDATE youtube_playlists SET status = $3, updated_at = now() WHERE id = $1 AND user_id = $2")
        .bind(&id)
        .bind(&user.id)
        .bind(&body.status)
        .execute(&app.db)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::not_found("Playlist"));
    }
    Ok(ok())
}

pub async fn blob(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Response> {
    let row: Option<(String, Vec<u8>)> = sqlx::query_as("SELECT content_type, data FROM blobs WHERE id = $1 AND user_id = $2")
        .bind(&id)
        .bind(&user.id)
        .fetch_optional(&app.db)
        .await?;
    let Some((content_type, data)) = row else { return Ok((StatusCode::NOT_FOUND, "Not found.").into_response()) };
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "private, max-age=31536000, immutable".to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
            // Generated covers are SVG: never let one run script if opened directly.
            (header::CONTENT_SECURITY_POLICY, "default-src 'none'; style-src 'unsafe-inline'; sandbox".to_string()),
        ],
        data,
    )
        .into_response())
}

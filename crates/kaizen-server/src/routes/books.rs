//! Books: reading tracker, notes, and reading sessions.

use axum::Json;
use axum::extract::{Path, State};
use chrono::{DateTime, NaiveTime, Utc};
use kaizen_core::book_analytics::session_pages;
use kaizen_core::util::js_round_i64;
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::ok;
use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

const STATUSES: [&str; 5] = ["WANT_TO_READ", "READING", "FINISHED", "PAUSED", "ABANDONED"];
const NOTE_KINDS: [&str; 10] = ["NOTE", "QUOTE", "SUMMARY", "IDEA", "CHARACTER", "ARGUMENT", "DEFINITION", "FORMULA", "PASSAGE", "REFLECTION"];

pub async fn list(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String, Option<String>, Option<String>, String, Option<i32>, Option<i32>, i64, i64)> = sqlx::query_as(
        "SELECT b.id, b.title, b.author, b.category, b.status, b.rating, b.page_count,
                (SELECT count(*) FROM book_notes n WHERE n.book_id = b.id),
                (SELECT count(*) FROM book_notes n WHERE n.book_id = b.id AND n.remember)
         FROM books b WHERE b.user_id = $1 ORDER BY b.updated_at DESC",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let remember: i64 = rows.iter().map(|r| r.8).sum();
    Ok(Json(json!({
        "stats": {
            "books": rows.len(), "reading": rows.iter().filter(|r| r.4 == "READING").count(),
            "finished": rows.iter().filter(|r| r.4 == "FINISHED").count(), "remember": remember,
        },
        "books": rows.into_iter().map(|(id, title, author, category, status, rating, pages, notes, remember)| json!({
            "id": id, "title": title, "author": author, "category": category, "status": status, "rating": rating,
            "pageCount": pages, "notes": notes, "remember": remember,
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBook {
    title: String,
    author: Option<String>,
    category: Option<String>,
    source_language: Option<String>,
    page_count: Option<i32>,
    status: Option<String>,
}

fn clean(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

pub async fn create(State(app): State<App>, user: User, Json(body): Json<NewBook>) -> ApiResult<Json<Value>> {
    let title = body.title.trim();
    if title.is_empty() {
        return Err(ApiError::bad("A title is required."));
    }
    let status = body.status.filter(|s| STATUSES.contains(&s.as_str())).unwrap_or_else(|| "WANT_TO_READ".into());
    let id = new_id();
    sqlx::query(
        "INSERT INTO books (id, user_id, title, author, category, source_language, page_count, status, start_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'READING' THEN now() END)",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(title)
    .bind(clean(body.author))
    .bind(clean(body.category))
    .bind(clean(body.source_language))
    .bind(body.page_count.filter(|p| *p > 0))
    .bind(&status)
    .execute(&app.db)
    .await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(sqlx::FromRow)]
struct BookRow {
    id: String,
    title: String,
    author: Option<String>,
    category: Option<String>,
    status: String,
    start_date: Option<DateTime<Utc>>,
    finish_date: Option<DateTime<Utc>>,
    rating: Option<i32>,
    page_count: Option<i32>,
    source_language: Option<String>,
    related_course: Option<String>,
}

async fn owned(app: &App, user: &User, book_id: &str) -> ApiResult<BookRow> {
    sqlx::query_as(
        "SELECT b.id, b.title, b.author, b.category, b.status, b.start_date, b.finish_date, b.rating, b.page_count, b.source_language,
                c.name AS related_course
         FROM books b LEFT JOIN courses c ON c.id = b.related_course_id WHERE b.id = $1 AND b.user_id = $2",
    )
    .bind(book_id)
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?
    .ok_or_else(|| ApiError::not_found("Book"))
}

pub async fn detail(State(app): State<App>, user: User, Path(book_id): Path<String>) -> ApiResult<Json<Value>> {
    let book = owned(&app, &user, &book_id).await?;
    let notes: Vec<(String, String, String, Option<String>, bool, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, kind, content, location, remember, created_at FROM book_notes WHERE book_id = $1 ORDER BY created_at DESC",
    )
    .bind(&book_id)
    .fetch_all(&app.db)
    .await?;
    let sessions: Vec<(String, DateTime<Utc>, Option<i32>, Option<i32>, i32, i32, Option<String>)> = sqlx::query_as(
        "SELECT id, read_at, start_page, end_page, pages_read, duration_min, notes FROM book_reading_sessions WHERE book_id = $1 ORDER BY read_at DESC",
    )
    .bind(&book_id)
    .fetch_all(&app.db)
    .await?;
    let pages: i64 = sessions.iter().map(|s| s.4 as i64).sum();
    let minutes: i64 = sessions.iter().map(|s| s.5 as i64).sum();
    let current_page = sessions.iter().filter_map(|s| s.3).max().unwrap_or(0);
    let pace = if minutes == 0 { 0 } else { js_round_i64(pages as f64 / minutes as f64 * 60.0) };
    Ok(Json(json!({
        "book": {
            "id": book.id, "title": book.title, "author": book.author, "category": book.category, "status": book.status,
            "startDate": book.start_date, "finishDate": book.finish_date, "rating": book.rating, "pageCount": book.page_count,
            "sourceLanguage": book.source_language, "relatedCourse": book.related_course,
        },
        "stats": {
            "currentPage": current_page, "pagesLogged": pages, "minutes": minutes, "pacePerHour": pace,
            "progressPct": book.page_count.filter(|p| *p > 0 && current_page > 0).map(|p| (current_page as f64 / p as f64 * 100.0).min(100.0)),
        },
        "today": kaizen_core::time::day_key(Utc::now(), user.tz),
        "notes": notes.into_iter().map(|(id, kind, content, location, remember, created)| json!({
            "id": id, "kind": kind, "content": content, "location": location, "remember": remember, "createdAt": created,
        })).collect::<Vec<_>>(),
        "sessions": sessions.into_iter().map(|(id, read_at, start, end, pages, duration, notes)| json!({
            "id": id, "readAt": read_at, "date": kaizen_core::time::day_key(read_at, user.tz), "startPage": start, "endPage": end,
            "pagesRead": pages, "durationMin": duration, "notes": notes,
            "pacePerHour": if duration > 0 { js_round_i64(pages as f64 / duration as f64 * 60.0) } else { 0 },
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBook {
    status: Option<String>,
    rating: Option<i32>,
    /// 0 clears the page count.
    page_count: Option<i32>,
}

pub async fn update(State(app): State<App>, user: User, Path(book_id): Path<String>, Json(body): Json<UpdateBook>) -> ApiResult<Json<Value>> {
    owned(&app, &user, &book_id).await?;
    if let Some(status) = body.status.filter(|s| STATUSES.contains(&s.as_str())) {
        sqlx::query(
            "UPDATE books SET status = $2, updated_at = now(),
               start_date = CASE WHEN $2 = 'READING' THEN now() ELSE start_date END,
               finish_date = CASE WHEN $2 = 'FINISHED' THEN now() ELSE finish_date END
             WHERE id = $1",
        )
        .bind(&book_id)
        .bind(status)
        .execute(&app.db)
        .await?;
    }
    if let Some(rating) = body.rating {
        sqlx::query("UPDATE books SET rating = $2, updated_at = now() WHERE id = $1")
            .bind(&book_id)
            .bind((1..=5).contains(&rating).then_some(rating))
            .execute(&app.db)
            .await?;
    }
    if let Some(pages) = body.page_count {
        sqlx::query("UPDATE books SET page_count = $2, updated_at = now() WHERE id = $1")
            .bind(&book_id)
            .bind(Some(pages).filter(|p| *p > 0))
            .execute(&app.db)
            .await?;
    }
    Ok(ok())
}

pub async fn remove(State(app): State<App>, user: User, Path(book_id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM books WHERE id = $1 AND user_id = $2").bind(&book_id).bind(&user.id).execute(&app.db).await?;
    Ok(ok())
}

#[derive(Deserialize)]
pub struct NewNote {
    content: String,
    kind: Option<String>,
    location: Option<String>,
    remember: Option<bool>,
}

pub async fn add_note(State(app): State<App>, user: User, Path(book_id): Path<String>, Json(body): Json<NewNote>) -> ApiResult<Json<Value>> {
    owned(&app, &user, &book_id).await?;
    let content = body.content.trim();
    if content.is_empty() {
        return Err(ApiError::bad("Write the note first."));
    }
    let kind = body.kind.filter(|k| NOTE_KINDS.contains(&k.as_str())).unwrap_or_else(|| "NOTE".into());
    sqlx::query("INSERT INTO book_notes (id, book_id, kind, content, location, remember) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(new_id())
        .bind(&book_id)
        .bind(kind)
        .bind(content)
        .bind(clean(body.location))
        .bind(body.remember.unwrap_or(false))
        .execute(&app.db)
        .await?;
    sqlx::query("UPDATE books SET updated_at = now() WHERE id = $1").bind(&book_id).execute(&app.db).await?;
    Ok(ok())
}

pub async fn toggle_remember(State(app): State<App>, user: User, Path(note_id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query(
        "UPDATE book_notes n SET remember = NOT n.remember, updated_at = now() FROM books b WHERE n.id = $1 AND b.id = n.book_id AND b.user_id = $2",
    )
    .bind(&note_id)
    .bind(&user.id)
    .execute(&app.db)
    .await?;
    Ok(ok())
}

pub async fn delete_note(State(app): State<App>, user: User, Path(note_id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM book_notes n USING books b WHERE n.id = $1 AND b.id = n.book_id AND b.user_id = $2")
        .bind(&note_id)
        .bind(&user.id)
        .execute(&app.db)
        .await?;
    Ok(ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    pages_read: i64,
    duration_min: i64,
    end_page: Option<i64>,
    read_at: Option<String>,
    notes: Option<String>,
}

pub async fn add_session(State(app): State<App>, user: User, Path(book_id): Path<String>, Json(body): Json<NewSession>) -> ApiResult<Json<Value>> {
    let book = owned(&app, &user, &book_id).await?;
    if body.pages_read < 1 || body.duration_min < 1 {
        return Err(ApiError::bad("Pages and minutes must be at least 1."));
    }
    let previous: Option<i32> =
        sqlx::query_scalar("SELECT end_page FROM book_reading_sessions WHERE book_id = $1 ORDER BY read_at DESC LIMIT 1")
            .bind(&book_id)
            .fetch_optional(&app.db)
            .await?
            .flatten();
    let (start_page, end_page) =
        session_pages(body.pages_read, body.end_page, previous.map(i64::from), book.page_count.map(i64::from));
    // A plain date logs at local noon on that day.
    let read_at = body
        .read_at
        .as_deref()
        .and_then(kaizen_core::time::parse_date_key)
        .map(|d| kaizen_core::time::local_to_utc(d.and_time(NaiveTime::from_hms_opt(12, 0, 0).expect("noon")), user.tz))
        .unwrap_or_else(Utc::now);
    let mut tx = app.db.begin().await?;
    sqlx::query(
        "INSERT INTO book_reading_sessions (id, book_id, read_at, start_page, end_page, pages_read, duration_min, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(new_id())
    .bind(&book_id)
    .bind(read_at)
    .bind(start_page as i32)
    .bind(end_page as i32)
    .bind(body.pages_read as i32)
    .bind(body.duration_min as i32)
    .bind(clean(body.notes))
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE books SET status = CASE WHEN status = 'WANT_TO_READ' THEN 'READING' ELSE status END,
           start_date = COALESCE(start_date, $2), updated_at = now() WHERE id = $1",
    )
    .bind(&book_id)
    .bind(read_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(ok())
}

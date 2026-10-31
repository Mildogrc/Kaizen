//! Analytics, one area at a time.

use std::collections::BTreeMap;

use axum::Json;
use axum::extract::{Query, State};
use chrono::{DateTime, Utc};
use kaizen_core::anki_analytics::{self as aa, ProjectionGoal};
use kaizen_core::util::{js_round_i64, to_fixed};
use kaizen_core::{book_analytics, meditation, nato, settings as core_settings, speed_reading, time};
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::{anki_logs, anki_snapshots};
use crate::auth::User;
use crate::error::ApiResult;
use crate::state::App;

#[derive(Deserialize)]
pub struct AreaQuery {
    area: Option<String>,
}

pub const AREAS: [&str; 7] = ["japanese", "chinese", "codeforces", "nato", "reading", "books", "meditation"];

pub async fn page(State(app): State<App>, user: User, Query(query): Query<AreaQuery>) -> ApiResult<Json<Value>> {
    let area = query.area.filter(|a| AREAS.contains(&a.as_str())).unwrap_or_else(|| "japanese".into());
    let body = match area.as_str() {
        "codeforces" => codeforces_area(&app, &user).await?,
        "nato" => nato_area(&app, &user).await?,
        "reading" => reading_area(&app, &user).await?,
        "books" => books_area(&app, &user).await?,
        "meditation" => meditation_area(&app, &user).await?,
        _ => language_area(&app, &user, &area).await?,
    };
    Ok(Json(json!({ "area": area, "data": body })))
}

async fn language_area(app: &App, user: &User, area: &str) -> ApiResult<Value> {
    let (tab, language) = if area == "chinese" { ("CHINESE", "zh") } else { ("JAPANESE", "ja") };
    let stat = crate::db::latest_word_stat(&app.db, &user.id, language).await?;
    let courses: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT c.id, c.name, c.color FROM courses c WHERE c.user_id = $1 AND c.tab = $2
         AND EXISTS (SELECT 1 FROM anki_deck_mappings m WHERE m.course_id = c.id) ORDER BY c.name",
    )
    .bind(&user.id)
    .bind(tab)
    .fetch_all(&app.db)
    .await?;
    let now = Utc::now();
    let mut sections = Vec::new();
    for (course_id, name, color) in courses {
        let mappings: Vec<(String, String)> =
            sqlx::query_as("SELECT id, deck_name FROM anki_deck_mappings WHERE course_id = $1 ORDER BY created_at")
                .bind(&course_id)
                .fetch_all(&app.db)
                .await?;
        let ids: Vec<String> = mappings.iter().map(|m| m.0.clone()).collect();
        let snapshots = anki_snapshots(app, &ids).await?;
        let logs = anki_logs(app, &ids).await?;
        let goal: Option<(String, i32)> = sqlx::query_as(
            "SELECT title, target_value FROM course_goals WHERE course_id = $1 AND status = 'ACTIVE' AND target_value IS NOT NULL ORDER BY created_at LIMIT 1",
        )
        .bind(&course_id)
        .fetch_optional(&app.db)
        .await?;
        let goal = goal.map(|(title, target)| ProjectionGoal { title, target_value: target as i64, current_value: None });
        let activity30 = aa::reviews_per_day(&logs, 30, now, user.tz);
        let leeches = aa::leeches(&snapshots);
        sections.push(json!({
            "course": { "id": course_id, "name": name, "color": color },
            "decks": mappings.iter().map(|(id, deck)| json!({ "mappingId": id, "deckName": deck })).collect::<Vec<_>>(),
            "cards": snapshots.len(),
            "activity365": aa::reviews_per_day(&logs, 365, now, user.tz),
            "minutes30": activity30.iter().map(|d| d.minutes).sum::<i64>(),
            "reviews30": activity30.iter().map(|d| d.reviews as i64).sum::<i64>(),
            "activity30": activity30,
            "streak": aa::streaks(&logs, now, user.tz),
            "retention": aa::retention(&logs),
            "forecast": aa::forecast(&snapshots, 30, now, user.tz),
            "health": aa::health(&snapshots),
            "projections": aa::projections(&snapshots, &logs, goal.as_ref(), now, user.tz),
            "leeches": mappings.iter().map(|(id, deck)| json!({
                "mappingId": id, "deckName": deck,
                "cards": leeches.iter().filter(|c| c.mapping_id.as_deref() == Some(id.as_str())).map(|c| json!({
                    "ankiCardId": c.anki_card_id, "front": c.front, "back": c.back, "lapses": c.lapses, "intervalDays": c.interval_days, "ease": c.ease,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        }));
    }
    Ok(json!({ "language": language, "knownWords": stat, "sections": sections }))
}

async fn codeforces_area(app: &App, user: &User) -> ApiResult<Value> {
    let profile: Option<(String, Option<i32>, Option<i32>)> = sqlx::query_as(
        "SELECT id, rating, max_rating FROM codeforces_profiles WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?;
    let Some((profile_id, rating, max_rating)) = profile else { return Ok(Value::Null) };
    let analytics = super::codeforces::analytics_for(app, user, &profile_id).await?;
    Ok(json!({ "rating": rating, "maxRating": max_rating, "analytics": analytics }))
}

async fn nato_area(app: &App, user: &User) -> ApiResult<Value> {
    let sessions: Vec<(DateTime<Utc>, Value)> =
        sqlx::query_as("SELECT date, stats FROM study_sessions WHERE user_id = $1 AND mode = 'nato' ORDER BY date")
            .bind(&user.id)
            .fetch_all(&app.db)
            .await?;
    let (analytics, parsed) = nato::analyze_sessions(&sessions);
    let trend: Vec<Value> = parsed
        .iter()
        .map(|(date, s)| {
            json!({
                "label": time::day_key(*date, user.tz)[5..].to_string(), "value": js_round_i64(s.average_recall_ms),
                "tooltip": format!("{}s · {}% · {}", to_fixed(s.average_recall_ms / 1000.0, 1), js_round_i64(s.accuracy * 100.0), s.word),
            })
        })
        .collect();
    let mut practiced: Vec<&nato::LetterMetric> = analytics.metrics.iter().filter(|m| m.attempts > 0).collect();
    practiced.sort_by(|a, b| b.average_ms.partial_cmp(&a.average_ms).unwrap_or(std::cmp::Ordering::Equal));
    let slowest: Vec<Value> = practiced
        .iter()
        .take(12)
        .map(|m| {
            json!({
                "label": m.letter, "value": js_round_i64(m.average_ms),
                "tooltip": format!("{}: {}s · {}% correct", m.letter, to_fixed(m.average_ms / 1000.0, 1), js_round_i64(m.accuracy * 100.0)),
            })
        })
        .collect();
    Ok(json!({ "analytics": analytics, "trend": trend, "slowest": slowest }))
}

async fn reading_area(app: &App, user: &User) -> ApiResult<Value> {
    let sessions: Vec<(DateTime<Utc>, i32, f64, Option<f64>, f64, String, String)> = sqlx::query_as(
        "SELECT s.completed_at, s.wpm, s.accuracy, s.retention_accuracy, s.estimated_retention, p.category, p.difficulty
         FROM speed_reading_sessions s JOIN speed_reading_passages p ON p.id = s.passage_id WHERE s.user_id = $1 ORDER BY s.completed_at",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let n = sessions.len() as f64;
    let accuracy = (!sessions.is_empty()).then(|| sessions.iter().map(|s| s.2).sum::<f64>() / n);
    let retention = (!sessions.is_empty()).then(|| sessions.iter().map(|s| s.3.unwrap_or(s.4)).sum::<f64>() / n);
    let dates: Vec<DateTime<Utc>> = sessions.iter().map(|s| s.0).collect();
    let (streak, _) = speed_reading::reading_streak(&dates, Utc::now(), user.tz);
    let mut groups: BTreeMap<(String, String), (i64, i64, f64)> = BTreeMap::new();
    for s in &sessions {
        let g = groups.entry((s.5.clone(), s.6.clone())).or_default();
        g.0 += 1;
        g.1 += s.1 as i64;
        g.2 += s.2;
    }
    Ok(json!({
        "stats": { "sessions": sessions.len(), "maxWpm": sessions.iter().map(|s| s.1).max(), "accuracy": accuracy, "retention": retention, "streak": streak },
        "speed": sessions.iter().map(|s| json!({ "label": time::day_key(s.0, user.tz)[5..].to_string(), "value": s.1, "tooltip": format!("{} WPM · {}%", s.1, js_round_i64(s.2 * 100.0)) })).collect::<Vec<_>>(),
        "comprehension": sessions.iter().map(|s| json!({ "label": time::day_key(s.0, user.tz)[5..].to_string(), "value": js_round_i64(s.2 * 100.0), "tooltip": format!("{}% at {} WPM", js_round_i64(s.2 * 100.0), s.1) })).collect::<Vec<_>>(),
        "groups": groups.into_iter().map(|((category, difficulty), (count, wpm, acc))| json!({
            "category": category, "difficulty": difficulty, "wpm": js_round_i64(wpm as f64 / count as f64), "accuracy": js_round_i64(acc / count as f64 * 100.0),
        })).collect::<Vec<_>>(),
    }))
}

async fn books_area(app: &App, user: &User) -> ApiResult<Value> {
    let books: Vec<(String, String, Option<String>, String)> =
        sqlx::query_as("SELECT id, title, author, status FROM books WHERE user_id = $1 ORDER BY updated_at DESC")
            .bind(&user.id)
            .fetch_all(&app.db)
            .await?;
    let sessions: Vec<(DateTime<Utc>, i32, i32, String)> = sqlx::query_as(
        "SELECT s.read_at, s.pages_read, s.duration_min, b.title FROM book_reading_sessions s JOIN books b ON b.id = s.book_id
         WHERE b.user_id = $1 ORDER BY s.read_at",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let pages: i64 = sessions.iter().map(|s| s.1 as i64).sum();
    let minutes: i64 = sessions.iter().map(|s| s.2 as i64).sum();
    let activity = book_analytics::reading_activity(&sessions.iter().map(|s| (s.0, s.1 as i64)).collect::<Vec<_>>(), Utc::now(), user.tz);
    Ok(json!({
        "stats": {
            "reading": books.iter().filter(|b| b.3 == "READING").count(), "finished": books.iter().filter(|b| b.3 == "FINISHED").count(),
            "pages": pages, "time": book_analytics::format_minutes(minutes),
        },
        "activity365": activity,
        "pagesPerSession": sessions.iter().map(|s| json!({ "label": time::day_key(s.0, user.tz)[5..].to_string(), "value": s.1, "tooltip": format!("{}: {} pages", s.3, s.1) })).collect::<Vec<_>>(),
        "minutesPerSession": sessions.iter().map(|s| json!({ "label": time::day_key(s.0, user.tz)[5..].to_string(), "value": s.2, "tooltip": format!("{}: {} minutes", s.3, s.2) })).collect::<Vec<_>>(),
        "reading": books.iter().filter(|b| b.3 == "READING").map(|(id, title, author, _)| json!({ "id": id, "title": title, "author": author })).collect::<Vec<_>>(),
    }))
}

async fn meditation_area(app: &App, user: &User) -> ApiResult<Value> {
    let sessions: Vec<(DateTime<Utc>, Option<i32>)> =
        sqlx::query_as("SELECT date, duration_min FROM study_sessions WHERE user_id = $1 AND mode = 'meditation' ORDER BY date")
            .bind(&user.id)
            .fetch_all(&app.db)
            .await?;
    let config = core_settings::meditation(&user.settings);
    let sessions: Vec<meditation::Session> =
        sessions.into_iter().map(|(date, minutes)| meditation::Session { date, duration_min: minutes.map(i64::from) }).collect();
    let analytics = meditation::analyze(&sessions, config.session_minutes, Utc::now(), user.tz);
    Ok(json!({
        "analytics": analytics,
        "targetDaysPerWeek": config.target_days_per_week,
        "totalTime": book_analytics::format_minutes(analytics.total_minutes),
    }))
}

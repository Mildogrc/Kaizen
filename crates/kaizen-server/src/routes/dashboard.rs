//! Dashboard, Daily queue, and the Random Skills hub.

use std::collections::BTreeSet;

use axum::Json;
use axum::extract::State;
use chrono::{Duration, NaiveDate, Utc};
use kaizen_core::daily::{DailyQueueInput, ReadingBook, build_queue};
use kaizen_core::{grammar, jlpt, nato, roadmap, settings as core_settings, time};
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::{anki_due_today, grammar_queue_rows, jlpt_levels, known_words_lower, math_state, ok};
use crate::auth::User;
use crate::crypto::new_id;
use crate::error::ApiResult;
use crate::state::App;

/// A study day = any in-app rating, Anki review, or logged session.
pub(super) async fn study_streak(app: &App, user: &User) -> ApiResult<u32> {
    let cutoff = Utc::now() - Duration::days(400);
    let days: Vec<NaiveDate> = sqlx::query_scalar(
        "SELECT DISTINCT (t AT TIME ZONE $3)::date FROM (
           SELECT date AS t FROM study_sessions WHERE user_id = $1 AND date >= $2
           UNION ALL SELECT created_at FROM attempts WHERE user_id = $1 AND created_at >= $2
           UNION ALL SELECT reviewed_at FROM anki_review_logs WHERE user_id = $1 AND reviewed_at >= $2
         ) x",
    )
    .bind(&user.id)
    .bind(cutoff)
    .bind(&user.timezone)
    .fetch_all(&app.db)
    .await?;
    let set: BTreeSet<NaiveDate> = days.into_iter().collect();
    Ok(time::streak_from_dates(&set, time::local_date(Utc::now(), user.tz)).0)
}

pub async fn dashboard(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let now = Utc::now();
    let in_app_due: i64 = sqlx::query_scalar("SELECT count(*) FROM review_records WHERE user_id = $1 AND due_at <= $2 AND NOT is_suspended")
        .bind(&user.id)
        .bind(now)
        .fetch_one(&app.db)
        .await?;
    let anki_due = anki_due_today(&app, &user, None).await?;
    let open_mistakes: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM mistakes m JOIN courses c ON c.id = m.course_id WHERE c.user_id = $1 AND NOT m.resolved",
    )
    .bind(&user.id)
    .fetch_one(&app.db)
    .await?;
    let streak = study_streak(&app, &user).await?;
    let books: Vec<(String, String, Option<String>, String)> =
        sqlx::query_as("SELECT id, title, author, status FROM books WHERE user_id = $1 ORDER BY updated_at DESC")
            .bind(&user.id)
            .fetch_all(&app.db)
            .await?;
    let item_counts: Vec<(String, i64)> = sqlx::query_as(
        "SELECT c.tab, count(li.id) FROM courses c LEFT JOIN learning_items li ON li.course_id = c.id WHERE c.user_id = $1 GROUP BY c.tab",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let count_for = |tab: &str| item_counts.iter().find(|(t, _)| t == tab).map_or(0, |(_, n)| *n);

    let japanese_goal = jlpt::current_progress(&jlpt_levels(&app, &user).await?, known_words_lower(&app, &user, "ja").await?);
    let math_goal = math_state(&app, &user).await?.and_then(|math| {
        let slug = math.current.clone()?;
        let node = math.nodes.iter().find(|n| n.slug == slug)?;
        let progress = roadmap::path_progress(&node.id, &math.graph_nodes(), &math.edges);
        Some(json!({ "slug": slug, "title": node.title, "done": progress.done, "total": progress.total, "pct": progress.pct }))
    });
    let goals: Vec<(String, String, Option<String>, Option<i32>, i32, Option<String>, String, String, Option<String>)> = sqlx::query_as(
        "SELECT g.id, g.title, g.description, g.target_value, g.current_value, g.unit, c.slug, c.name, c.color
         FROM course_goals g JOIN courses c ON c.id = g.course_id
         WHERE c.user_id = $1 AND g.status = 'ACTIVE' AND c.slug NOT IN ('japanese', 'math') ORDER BY g.created_at",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let reading: Vec<Value> = books
        .iter()
        .filter(|b| b.3 == "READING")
        .map(|(id, title, author, status)| json!({ "id": id, "title": title, "author": author, "status": status }))
        .collect();
    let finished = books.iter().filter(|b| b.3 == "FINISHED").count();
    let active_goals = goals.len() + usize::from(japanese_goal.is_some()) + usize::from(math_goal.is_some());

    Ok(Json(json!({
        "greetingName": user.name.split_whitespace().next().unwrap_or(&user.name),
        "stats": {
            "dueReviews": in_app_due + anki_due, "ankiDue": anki_due, "inAppDue": in_app_due, "streak": streak,
            "activeGoals": active_goals, "openMistakes": open_mistakes, "reading": reading.len(), "finished": finished,
        },
        "japaneseGoal": japanese_goal,
        "mathGoal": math_goal,
        "goals": goals.into_iter().map(|(id, title, description, target, current, unit, slug, name, color)| json!({
            "id": id, "title": title, "description": description, "targetValue": target, "currentValue": current, "unit": unit,
            "course": { "slug": slug, "name": name, "color": color },
        })).collect::<Vec<_>>(),
        "areas": [
            { "label": "Japanese", "href": "/japanese", "value": count_for("JAPANESE"), "hint": "learning items" },
            { "label": "Chinese", "href": "/chinese", "value": count_for("CHINESE"), "hint": "learning items" },
            { "label": "Math", "href": "/math", "value": count_for("MATH"), "hint": "learning items" },
            { "label": "Skills", "href": "/skills", "value": count_for("SKILLS"), "hint": "learning items" },
            { "label": "Books", "href": "/books", "value": books.len(), "hint": "books tracked" },
        ],
        "reading": reading,
    })))
}

pub async fn daily(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    Ok(Json(daily_view(&app, &user).await?))
}

pub(super) async fn daily_view(app: &App, user: &User) -> ApiResult<Value> {
    let now = Utc::now();
    let (start, end) = time::day_bounds(now, user.tz);
    let anki_due = anki_due_today(app, user, None).await?;
    let rows = grammar_queue_rows(app, user).await?;
    let grammar_config = core_settings::japanese_grammar(&user.settings);
    let grammar_reviews = rows.iter().filter(|r| r.status != grammar::Status::New && r.due_at <= now).count() as i64;
    let grammar_new = grammar::new_due_today(&rows, now, &grammar_config, user.tz) as i64;
    let reading_book: Option<(String, String)> =
        sqlx::query_as("SELECT id, title FROM books WHERE user_id = $1 AND status = 'READING' ORDER BY updated_at DESC LIMIT 1")
            .bind(&user.id)
            .fetch_optional(&app.db)
            .await?;
    let meditated: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM study_sessions WHERE user_id = $1 AND mode = 'meditation' AND date >= $2 AND date < $3)",
    )
    .bind(&user.id)
    .bind(start)
    .bind(end)
    .fetch_one(&app.db)
    .await?;
    let read_today: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM book_reading_sessions s JOIN books b ON b.id = s.book_id WHERE b.user_id = $1 AND s.read_at >= $2 AND s.read_at < $3)",
    )
    .bind(&user.id)
    .bind(start)
    .bind(end)
    .fetch_one(&app.db)
    .await?;
    let last_nato: Option<(chrono::DateTime<Utc>, Value)> =
        sqlx::query_as("SELECT date, stats FROM study_sessions WHERE user_id = $1 AND mode = 'nato' ORDER BY date DESC LIMIT 1")
            .bind(&user.id)
            .fetch_optional(&app.db)
            .await?;
    let next_nato = last_nato
        .and_then(|(date, stats)| nato::parse_session_stats(&stats).map(|s| date + Duration::days(s.next_interval_days)));
    let queue = build_queue(&DailyQueueInput {
        anki_due,
        grammar_reviews,
        grammar_new,
        reading_book: reading_book.map(|(id, title)| ReadingBook { id, title }),
        read_today,
        weekend_skills: nato::weekend_skills(now, user.tz, next_nato),
    });
    let meditation = core_settings::meditation(&user.settings);
    Ok(json!({
        "meditation": { "complete": meditated, "minutes": meditation.session_minutes },
        "queue": queue,
        "date": time::day_key(now, user.tz),
    }))
}

#[derive(Deserialize)]
pub struct MeditationBody {
    complete: bool,
}

pub async fn meditation(State(app): State<App>, user: User, Json(body): Json<MeditationBody>) -> ApiResult<Json<Value>> {
    let (start, end) = time::day_bounds(Utc::now(), user.tz);
    if body.complete {
        let minutes = core_settings::meditation(&user.settings).session_minutes as i32;
        let updated = sqlx::query(
            "UPDATE study_sessions SET duration_min = $4, stats = '{\"complete\": true}'::jsonb
             WHERE user_id = $1 AND mode = 'meditation' AND date >= $2 AND date < $3",
        )
        .bind(&user.id)
        .bind(start)
        .bind(end)
        .bind(minutes)
        .execute(&app.db)
        .await?;
        if updated.rows_affected() == 0 {
            sqlx::query("INSERT INTO study_sessions (id, user_id, mode, duration_min, stats) VALUES ($1, $2, 'meditation', $3, '{\"complete\": true}'::jsonb)")
                .bind(new_id())
                .bind(&user.id)
                .bind(minutes)
                .execute(&app.db)
                .await?;
        }
    } else {
        sqlx::query("DELETE FROM study_sessions WHERE user_id = $1 AND mode = 'meditation' AND date >= $2 AND date < $3")
            .bind(&user.id)
            .bind(start)
            .bind(end)
            .execute(&app.db)
            .await?;
    }
    Ok(ok())
}

pub async fn skills(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let counts: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM codeforces_profiles WHERE user_id = $1),
                (SELECT count(*) FROM speed_reading_sessions WHERE user_id = $1),
                (SELECT count(*) FROM study_sessions WHERE user_id = $1 AND mode = 'nato'),
                (SELECT count(*) FROM youtube_playlists WHERE user_id = $1)",
    )
    .bind(&user.id)
    .fetch_one(&app.db)
    .await?;
    let course_items: Vec<(String, i64)> = sqlx::query_as(
        "SELECT c.slug, count(li.id) FROM courses c LEFT JOIN learning_items li ON li.course_id = c.id
         WHERE c.user_id = $1 AND c.tab = 'SKILLS' GROUP BY c.slug",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let items = |slug: &str| course_items.iter().find(|(s, _)| s == slug).map_or(0, |(_, n)| *n);
    let total_items: i64 = course_items.iter().map(|(_, n)| n).sum();
    Ok(Json(json!({
        "stats": { "skills": 6, "learningItems": total_items, "readingSessions": counts.1 },
        "skills": [
            { "key": "nato", "label": "NATO", "href": "/nato", "detail": "Timed code-word recall weighted toward slow letters", "count": counts.2, "unit": "sessions" },
            { "key": "geoguessr", "label": "GeoGuessr", "href": "https://www.geoguessr.com/analytics", "detail": "Open your GeoGuessr analytics and weekly practice", "count": items("geoguessr"), "unit": "items" },
            { "key": "typing", "label": "Typing", "href": "https://monkeytype.com/", "detail": "Open Monkeytype for typing practice", "count": items("typing"), "unit": "items" },
            { "key": "reading", "label": "Reading", "href": "/speed-reading", "detail": "RSVP, paced, chunking, benchmark, and retention", "count": counts.1, "unit": "sessions" },
            { "key": "codeforces", "label": "Codeforces", "href": "/codeforces", "detail": "Problem ratings, contests, and activity heatmaps", "count": counts.0, "unit": "profiles" },
            { "key": "youtube", "label": "YouTube", "href": "/youtube", "detail": "Lecture playlists with in-app playback and saved progress", "count": counts.3, "unit": "playlists" },
        ],
    })))
}

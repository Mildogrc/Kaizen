//! Today and Tracks: everything a learner is working toward, whatever its kind.
//! Language and exam tracks are course rows; their kind, language and exam date
//! live in `courses.metadata`, so adding one needs no new page or table.

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{NaiveDate, Utc};
use kaizen_core::tracks::{self as core, LanguageProfile, ReviewedCard, TaggedCard};
use kaizen_core::{concepts, jlpt, nato, roadmap, time, util::thousands};
use serde::Deserialize;
use serde_json::{Value, json};

use super::dashboard::{daily_view, study_streak};
use super::shared::{jlpt_levels, known_words_lower, math_state, ok};
use crate::anki::{Anki, escape};
use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

const RESERVED_SLUGS: [&str; 5] = ["math", "nato", "codeforces", "speed-reading", "reading"];

#[derive(sqlx::FromRow, Clone)]
struct TrackRow {
    id: String,
    slug: String,
    name: String,
    description: Option<String>,
    tab: String,
    status: String,
    metadata: Value,
}

impl TrackRow {
    fn kind(&self) -> &str {
        match self.tab.as_str() {
            "JAPANESE" | "CHINESE" => "language",
            _ => self.metadata.get("kind").and_then(Value::as_str).unwrap_or("course"),
        }
    }

    fn language(&self) -> Option<&'static LanguageProfile> {
        match self.tab.as_str() {
            "JAPANESE" => core::profile("ja"),
            "CHINESE" => core::profile("zh"),
            _ => self.metadata.get("language").and_then(Value::as_str).and_then(core::profile),
        }
    }

    fn text(&self, key: &str) -> Option<&str> {
        self.metadata.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
    }

    fn exam_date(&self) -> Option<NaiveDate> {
        self.text("examDate").and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
    }
}

const TRACK_COLUMNS: &str = "id, slug, name, description, tab, status, metadata";

async fn track_rows(app: &App, user: &User) -> ApiResult<Vec<TrackRow>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {TRACK_COLUMNS} FROM courses WHERE user_id = $1 AND tab IN ('JAPANESE', 'CHINESE', 'TRACK') ORDER BY tab = 'TRACK' DESC, created_at"
    )))
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?)
}

async fn track_by_slug(app: &App, user: &User, slug: &str) -> ApiResult<TrackRow> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT {TRACK_COLUMNS} FROM courses WHERE user_id = $1 AND slug = $2")))
        .bind(&user.id)
        .bind(slug)
        .fetch_optional(&app.db)
        .await?
        .ok_or_else(|| ApiError::not_found("Track"))
}

#[derive(Default, Clone, Copy)]
struct DeckStats {
    due: i64,
    total: i64,
    suspended: i64,
    mature: i64,
}

async fn deck_stats(app: &App, user: &User) -> ApiResult<HashMap<String, DeckStats>> {
    let end = time::end_of_day(Utc::now(), user.tz);
    let rows: Vec<(String, i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT m.course_id,
                count(s.id) FILTER (WHERE s.due_at <= $2 AND s.state IN ('LEARNING', 'YOUNG', 'MATURE')),
                count(s.id), count(s.id) FILTER (WHERE s.state = 'SUSPENDED'), count(s.id) FILTER (WHERE s.state = 'MATURE')
         FROM anki_deck_mappings m LEFT JOIN anki_card_snapshots s ON s.mapping_id = m.id
         WHERE m.user_id = $1 GROUP BY m.course_id",
    )
    .bind(&user.id)
    .bind(end)
    .fetch_all(&app.db)
    .await?;
    Ok(rows.into_iter().map(|(id, due, total, suspended, mature)| (id, DeckStats { due, total, suspended, mature })).collect())
}

/// Average seconds a review takes, from the last 30 days.
async fn average_review_ms(app: &App, user: &User) -> ApiResult<Option<f64>> {
    Ok(sqlx::query_scalar("SELECT avg(time_ms)::float8 FROM anki_review_logs WHERE user_id = $1 AND reviewed_at >= now() - interval '30 days'")
        .bind(&user.id)
        .fetch_one(&app.db)
        .await?)
}

/// Share of older cards remembered over 30 days, optionally for one track.
async fn remembering(app: &App, user: &User, course_id: Option<&str>) -> ApiResult<Option<i64>> {
    let (passed, total): (i64, i64) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE l.rating > 1), count(*) FROM anki_review_logs l JOIN anki_deck_mappings m ON m.id = l.mapping_id
         WHERE l.user_id = $1 AND l.interval_before_days >= 21 AND l.reviewed_at >= now() - interval '30 days'
           AND ($2::text IS NULL OR m.course_id = $2)",
    )
    .bind(&user.id)
    .bind(course_id)
    .fetch_one(&app.db)
    .await?;
    Ok((total > 0).then(|| (passed as f64 / total as f64 * 100.0).round() as i64))
}

struct Headline {
    goal: String,
    headline: String,
    meaning: String,
    tooltip: Option<String>,
    progress: f64,
    color: &'static str,
}

/// Mature cards stand in for known words where no lemmatiser exists yet.
async fn words_known(app: &App, user: &User, row: &TrackRow, profile: &LanguageProfile, stats: DeckStats) -> ApiResult<(i64, i64, bool)> {
    if matches!(profile.code, "ja" | "zh") && row.tab != "TRACK" {
        let stat = crate::db::latest_word_stat(&app.db, &user.id, profile.code).await?;
        Ok(stat.map_or((0, 0, false), |s| (s.lower_bound as i64, s.upper_bound as i64, false)))
    } else {
        let lower = known_words_lower(app, user, profile.code).await?.max(stats.mature);
        Ok((lower, lower, true))
    }
}

async fn language_headline(app: &App, user: &User, row: &TrackRow, profile: &LanguageProfile, stats: DeckStats) -> ApiResult<Headline> {
    let (lower, upper, from_cards) = words_known(app, user, row, profile, stats).await?;
    let tooltip = if from_cards {
        Some(format!("Estimated from {} mature cards", thousands(lower)))
    } else {
        Some(format!("{}–{} known words", thousands(lower), thousands(upper)))
    };
    if profile.code == "ja" && row.tab == "JAPANESE" {
        return Ok(match jlpt::current_progress(&jlpt_levels(app, user).await?, lower) {
            Some(goal) => {
                let previous = jlpt::LEVELS.iter().position(|l| *l == goal.level.name).and_then(|i| i.checked_sub(1)).map(|i| jlpt::LEVELS[i]);
                Headline {
                    goal: format!("Goal: JLPT {}", goal.level.name),
                    headline: previous.map_or_else(|| format!("Working on {}", goal.level.name), |p| format!("{p} ready")),
                    meaning: format!("{}: {}% of words, {}% of grammar", goal.level.name, goal.word_progress.round(), goal.grammar_progress.round()),
                    tooltip,
                    progress: goal.word_progress,
                    color: "var(--info)",
                }
            }
            None => Headline {
                goal: "JLPT complete".into(),
                headline: "N1 ready".into(),
                meaning: "every JLPT level's words and grammar".into(),
                tooltip,
                progress: 100.0,
                color: "var(--info)",
            },
        });
    }
    let estimate = core::level_estimate(profile.levels, lower);
    let next_level = profile.levels.iter().find(|(_, target)| lower < *target).map(|(name, _)| *name);
    Ok(Headline {
        goal: row.text("goal").or(next_level).map_or_else(|| format!("{} complete", profile.framework), |g| format!("Goal: {g}")),
        headline: estimate.label,
        meaning: estimate.meaning,
        tooltip,
        progress: estimate.next_pct,
        color: "var(--info)",
    })
}

fn exam_headline(row: &TrackRow, stats: DeckStats, today: NaiveDate) -> Headline {
    let unlocked = if stats.total > 0 { (stats.total - stats.suspended) as f64 / stats.total as f64 * 100.0 } else { 0.0 };
    let days = row.exam_date().map(|d| (d - today).num_days());
    let deck_line = if stats.total > 0 {
        format!("{}% of the deck unlocked · {} cards due", unlocked.round(), thousands(stats.due))
    } else {
        "Add a deck to see your coverage".to_string()
    };
    Headline {
        goal: row.exam_date().map_or_else(|| "Exam date not set".to_string(), |d| format!("Exam on {}", d.format("%-d %B %Y"))),
        headline: match days {
            Some(0) => "Today".into(),
            Some(1) => "1 day".into(),
            Some(d) if d > 1 => format!("{d} days"),
            Some(_) => "Exam passed".into(),
            None => format!("{}% unlocked", unlocked.round()),
        },
        meaning: deck_line,
        tooltip: None,
        progress: unlocked,
        color: "var(--accent)",
    }
}

#[derive(sqlx::FromRow)]
struct StartedCourse {
    id: String,
    title: String,
    current_position: i32,
    total: i64,
    completed: i64,
    seconds_left: i64,
    lesson_title: Option<String>,
    lesson_seconds: Option<i32>,
}

async fn started_courses(app: &App, user: &User) -> ApiResult<Vec<StartedCourse>> {
    Ok(sqlx::query_as(
        "SELECT p.id, p.title, p.current_position, GREATEST(p.total_items::bigint, (SELECT count(*) FROM youtube_playlist_items i WHERE i.playlist_id = p.id)) AS total,
                (SELECT count(*) FROM youtube_playlist_items i WHERE i.playlist_id = p.id AND i.completed) AS completed,
                (SELECT COALESCE(sum(i.duration_seconds), 0)::bigint FROM youtube_playlist_items i WHERE i.playlist_id = p.id AND i.position >= p.current_position AND NOT i.completed) AS seconds_left,
                (SELECT i.title FROM youtube_playlist_items i WHERE i.playlist_id = p.id AND i.position = p.current_position LIMIT 1) AS lesson_title,
                (SELECT i.duration_seconds FROM youtube_playlist_items i WHERE i.playlist_id = p.id AND i.position = p.current_position LIMIT 1) AS lesson_seconds
         FROM youtube_playlists p
         WHERE p.user_id = $1 AND p.status = 'ACTIVE'
           AND (p.current_position > 0 OR p.current_seconds > 0 OR EXISTS (SELECT 1 FROM youtube_playlist_items i WHERE i.playlist_id = p.id AND i.completed))
         ORDER BY p.updated_at DESC",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?)
}

#[allow(clippy::too_many_arguments)]
fn card(slug: &str, kind: &str, name: &str, glyph: &str, lang: Option<&str>, href: &str, h: &Headline, next: Option<String>) -> Value {
    json!({
        "slug": slug, "kind": kind, "name": name, "glyph": glyph, "lang": lang, "href": href, "goal": h.goal,
        "headline": h.headline, "meaning": h.meaning, "tooltip": h.tooltip, "progress": h.progress, "color": h.color, "next": next,
    })
}

fn due_step(due: i64) -> Option<String> {
    (due > 0).then(|| format!("Review {} cards", thousands(due)))
}

/// Every track as a summary card, active work first.
async fn track_cards(app: &App, user: &User) -> ApiResult<Vec<Value>> {
    let stats = deck_stats(app, user).await?;
    let today = time::local_date(Utc::now(), user.tz);
    let mut cards = Vec::new();
    for row in track_rows(app, user).await?.iter().filter(|r| r.status == "ACTIVE") {
        let s = stats.get(&row.id).copied().unwrap_or_default();
        let href = format!("/tracks/{}", row.slug);
        match (row.kind(), row.language()) {
            ("exam", _) => {
                let glyph = row.text("glyph").unwrap_or("⚕");
                cards.push(card(&row.slug, "exam", &row.name, glyph, None, &href, &exam_headline(row, s, today), due_step(s.due)));
            }
            ("language", Some(profile)) => {
                let h = language_headline(app, user, row, profile, s).await?;
                cards.push(card(&row.slug, "language", &row.name, profile.glyph, Some(profile.lang), &href, &h, due_step(s.due)));
            }
            _ => {}
        }
    }
    if let Some(math) = math_state(app, user).await? {
        let target = math.current.clone().and_then(|slug| math.nodes.iter().find(|n| n.slug == slug).cloned());
        if let Some(node) = target {
            let p = roadmap::path_progress(&node.id, &math.graph_nodes(), &math.edges);
            let h = Headline {
                goal: format!("Path to {}", node.title),
                headline: format!("{} of {} courses", p.done, p.total),
                meaning: format!("{} to go on the way to {}", p.total.saturating_sub(p.done), node.title),
                tooltip: None,
                progress: p.pct as f64,
                color: "var(--accent)",
            };
            cards.push(card("math", "course", "Mathematics", "∑", None, "/tracks/math", &h, None));
        }
    }
    for course in started_courses(app, user).await? {
        let step = core::course_step(course.current_position as i64, course.total, course.completed, course.seconds_left);
        let h = Headline {
            goal: format!("Course · {} lectures", thousands(course.total)),
            headline: step.headline,
            meaning: step.meaning,
            tooltip: None,
            progress: step.progress,
            color: "var(--video)",
        };
        cards.push(card(&course.id, "course", &course.title, "▶", None, &format!("/library/courses/{}", course.id), &h, course.lesson_title.clone()));
    }
    let reading: Vec<(String,)> = sqlx::query_as("SELECT title FROM books WHERE user_id = $1 AND status = 'READING' ORDER BY updated_at DESC")
        .bind(&user.id)
        .fetch_all(&app.db)
        .await?;
    if let Some((first,)) = reading.first() {
        let h = Headline {
            goal: "Books in progress".into(),
            headline: format!("{} {}", reading.len(), if reading.len() == 1 { "book" } else { "books" }),
            meaning: format!("Now reading {first}"),
            tooltip: None,
            progress: 0.0,
            color: "var(--accent)",
        };
        cards.push(card("reading", "reading", "Reading", "❦", None, "/tracks/reading", &h, None));
    }
    cards.extend(practice_cards(app, user).await?);
    Ok(cards)
}

async fn practice_cards(app: &App, user: &User) -> ApiResult<Vec<Value>> {
    let mut cards = Vec::new();
    let practice = |goal: &str, headline: String, meaning: String| Headline {
        goal: goal.into(),
        headline,
        meaning,
        tooltip: None,
        progress: 0.0,
        color: "var(--accent)",
    };
    let codeforces: Option<(Option<i32>, String)> =
        sqlx::query_as("SELECT rating, handle FROM codeforces_profiles WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1")
            .bind(&user.id)
            .fetch_optional(&app.db)
            .await?;
    let cf = match codeforces {
        Some((Some(rating), handle)) => practice("Competitive programming", format!("Rating {rating}"), format!("Codeforces as {handle}")),
        Some((None, handle)) => practice("Competitive programming", "Unrated".into(), format!("Codeforces as {handle}")),
        None => practice("Competitive programming", "Not set up".into(), "Add your Codeforces profile to start".into()),
    };
    cards.push(card("codeforces", "practice", "Codeforces", "</>", None, "/tracks/codeforces", &cf, None));

    let last_nato: Option<(chrono::DateTime<Utc>, Value)> =
        sqlx::query_as("SELECT date, stats FROM study_sessions WHERE user_id = $1 AND mode = 'nato' ORDER BY date DESC LIMIT 1")
            .bind(&user.id)
            .fetch_optional(&app.db)
            .await?;
    let next = last_nato.and_then(|(date, stats)| nato::parse_session_stats(&stats).map(|s| date + chrono::Duration::days(s.next_interval_days)));
    let days = next.map(|n| (n - Utc::now()).num_days());
    let nato_h = match days {
        Some(d) if d > 0 => practice("Code-word recall", format!("Next in {d} days"), "Spaced out as you get faster".into()),
        Some(_) => practice("Code-word recall", "Due now".into(), "A short timed session".into()),
        None => practice("Code-word recall", "Not started".into(), "A short timed session".into()),
    };
    cards.push(card("nato", "practice", "NATO alphabet", "Ⓝ", None, "/tracks/nato", &nato_h, None));

    let wpm: Option<i32> = sqlx::query_scalar("SELECT recommended_next_wpm FROM speed_reading_sessions WHERE user_id = $1 ORDER BY completed_at DESC LIMIT 1")
        .bind(&user.id)
        .fetch_optional(&app.db)
        .await?;
    let reading = match wpm {
        Some(w) => practice("Faster reading, same recall", format!("{w} words a minute"), "Your next session's pace".into()),
        None => practice("Faster reading, same recall", "Not started".into(), "Take a benchmark to set your pace".into()),
    };
    cards.push(card("speed-reading", "practice", "Speed reading", "»", None, "/tracks/speed-reading", &reading, None));
    Ok(cards)
}

pub async fn list(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let existing: Vec<String> = track_rows(&app, &user).await?.iter().filter_map(|r| r.language().map(|p| p.code.to_string())).collect();
    Ok(Json(json!({
        "tracks": track_cards(&app, &user).await?,
        "languages": core::LANGUAGES,
        "taken": existing,
        "external": [
            { "label": "Typing", "href": "https://monkeytype.com/", "detail": "Opens Monkeytype" },
            { "label": "GeoGuessr", "href": "https://www.geoguessr.com/analytics", "detail": "Opens your GeoGuessr analytics" },
        ],
    })))
}

/// The plan for today: Dashboard and Daily as one page.
pub async fn today(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let now = Utc::now();
    let daily = daily_view(&app, &user).await?;
    let in_app_due: i64 = sqlx::query_scalar("SELECT count(*) FROM review_records WHERE user_id = $1 AND due_at <= $2 AND NOT is_suspended")
        .bind(&user.id)
        .bind(now)
        .fetch_one(&app.db)
        .await?;
    let anki_due = super::shared::anki_due_today(&app, &user, None).await?;
    let due = anki_due + in_app_due;
    let minutes = core::review_minutes(due, average_review_ms(&app, &user).await?);

    let mut tasks = Vec::new();
    let meditation = &daily["meditation"];
    tasks.push(json!({
        "key": "meditate", "title": "Meditate", "detail": format!("{} min", meditation["minutes"]), "complete": meditation["complete"], "minutes": meditation["minutes"],
    }));
    for block in daily["queue"].as_array().into_iter().flatten() {
        let key = block["key"].as_str().unwrap_or_default();
        let complete = block["complete"].as_bool().unwrap_or(false);
        let task = match key {
            "anki" if due == 0 => json!({ "key": key, "title": "Nothing due", "track": "add new cards in Anki if you have time", "complete": true, "minutes": 0 }),
            "anki" => json!({
                "key": key, "title": format!("Review {} cards", thousands(due)), "track": "all decks", "detail": format!("~{}", core::spoken_time(minutes)),
                "href": "/review", "complete": false, "minutes": minutes,
            }),
            "read" => json!({ "key": key, "title": "Read", "track": block["detail"], "href": block["href"], "complete": complete, "detail": "~20 min", "minutes": 20 }),
            "grammar" => json!({ "key": key, "title": "Grammar coach", "track": format!("Japanese · {}", block["detail"].as_str().unwrap_or_default()), "detail": "~8 min", "href": block["href"], "complete": complete, "minutes": 8 }),
            _ => json!({ "key": key, "title": block["title"], "track": block["detail"], "href": block["href"], "complete": complete, "minutes": 10 }),
        };
        tasks.push(task);
    }
    for course in started_courses(&app, &user).await?.into_iter().take(3) {
        if course.completed >= course.total && course.total > 0 {
            continue;
        }
        let lesson_minutes = course.lesson_seconds.map_or(20, |s| i64::from(s) / 60);
        tasks.push(json!({
            "key": format!("lesson-{}", course.id), "title": format!("Watch lecture {}", course.current_position + 1), "track": course.title,
            "detail": course.lesson_seconds.map(|_| core::spoken_time(lesson_minutes)), "href": format!("/library/courses/{}", course.id),
            "complete": false, "minutes": lesson_minutes,
        }));
    }
    let open: Vec<&Value> = tasks.iter().filter(|t| !t["complete"].as_bool().unwrap_or(false)).collect();
    let left_minutes: i64 = open.iter().filter_map(|t| t["minutes"].as_i64()).sum();
    let start = open.iter().find_map(|t| t["href"].as_str()).map(str::to_string);
    let remaining = open.len();

    let (this_week, last_week): (i64, i64) = sqlx::query_as(
        "WITH t AS (
           SELECT reviewed_at AS at, time_ms / 60000.0 AS minutes FROM anki_review_logs WHERE user_id = $1 AND reviewed_at >= now() - interval '14 days'
           UNION ALL SELECT date, COALESCE(duration_min, 0) FROM study_sessions WHERE user_id = $1 AND mode <> 'meditation' AND date >= now() - interval '14 days'
           UNION ALL SELECT s.read_at, s.duration_min FROM book_reading_sessions s JOIN books b ON b.id = s.book_id WHERE b.user_id = $1 AND s.read_at >= now() - interval '14 days'
         )
         SELECT COALESCE(round(sum(minutes) FILTER (WHERE at >= now() - interval '7 days')), 0)::bigint,
                COALESCE(round(sum(minutes) FILTER (WHERE at < now() - interval '7 days')), 0)::bigint FROM t",
    )
    .bind(&user.id)
    .fetch_one(&app.db)
    .await?;

    Ok(Json(json!({
        "greetingName": user.name.split_whitespace().next().unwrap_or(&user.name),
        "date": daily["date"],
        "streak": study_streak(&app, &user).await?,
        "plan": { "tasks": tasks, "remaining": remaining, "time": (left_minutes > 0).then(|| core::spoken_time(left_minutes)), "start": start },
        "cardsDue": due,
        "cardsTime": (due > 0).then(|| core::spoken_time(minutes)),
        "remembering": remembering(&app, &user, None).await?,
        "week": { "minutes": this_week, "label": core::spoken_time(this_week), "delta": this_week - last_week, "deltaLabel": core::spoken_time((this_week - last_week).abs()) },
        "tracks": track_cards(&app, &user).await?,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTrack {
    kind: String,
    name: Option<String>,
    language: Option<String>,
    goal: Option<String>,
    exam_date: Option<String>,
    deck: Option<String>,
}

fn valid_date(value: &str) -> ApiResult<()> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map(|_| ()).map_err(|_| ApiError::bad("Enter the date as YYYY-MM-DD."))
}

pub async fn create(State(app): State<App>, user: User, Json(body): Json<CreateTrack>) -> ApiResult<Json<Value>> {
    let profile = body.language.as_deref().and_then(core::profile);
    let name = match (body.kind.as_str(), profile) {
        ("language", Some(p)) => p.name.to_string(),
        ("language", None) => return Err(ApiError::bad("Choose a language.")),
        ("exam", _) => body.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).ok_or_else(|| ApiError::bad("Name the exam."))?.to_string(),
        _ => return Err(ApiError::bad("Courses start from the Library; language and exam tracks start here.")),
    };
    if let Some(date) = body.exam_date.as_deref().filter(|d| !d.is_empty()) {
        valid_date(date)?;
    }
    let base = concepts::clean_slug(&name).ok_or_else(|| ApiError::bad("That name needs at least one letter or number."))?;
    let taken: Vec<String> = sqlx::query_scalar("SELECT slug FROM courses WHERE user_id = $1").bind(&user.id).fetch_all(&app.db).await?;
    let is_free = |s: &String| !taken.contains(s) && !RESERVED_SLUGS.contains(&s.as_str());
    let slug = std::iter::once(base.clone()).chain((2..100).map(|n| format!("{base}-{n}"))).find(is_free).ok_or_else(|| ApiError::bad("Too many tracks with this name."))?;
    let metadata = json!({
        "kind": body.kind, "language": profile.map(|p| p.code), "goal": body.goal.as_deref().map(str::trim),
        "examDate": body.exam_date.as_deref().filter(|d| !d.is_empty()), "glyph": if body.kind == "exam" { Some("⚕") } else { None },
    });
    let id = new_id();
    sqlx::query("INSERT INTO courses (id, user_id, slug, name, category, tab, metadata) VALUES ($1, $2, $3, $4, $5, 'TRACK', $6)")
        .bind(&id)
        .bind(&user.id)
        .bind(&slug)
        .bind(&name)
        .bind(body.kind.to_uppercase())
        .bind(&metadata)
        .execute(&app.db)
        .await?;
    if let Some(deck) = body.deck.as_deref().filter(|d| !d.trim().is_empty()) {
        add_mapping(&app, &user, &id, deck, body.kind == "language").await?;
    }
    Ok(Json(json!({ "slug": slug })))
}

async fn add_mapping(app: &App, user: &User, course_id: &str, deck: &str, counts_words: bool) -> ApiResult<()> {
    let added = sqlx::query(
        "INSERT INTO anki_deck_mappings (id, user_id, deck_name, course_id, counts_known_words) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, deck_name) DO NOTHING",
    )
    .bind(new_id())
    .bind(&user.id)
    .bind(deck)
    .bind(course_id)
    .bind(counts_words)
    .execute(&app.db)
    .await?;
    if added.rows_affected() == 0 {
        return Err(ApiError::bad("That deck already belongs to another track."));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTrack {
    name: Option<String>,
    goal: Option<String>,
    exam_date: Option<String>,
    tag_root: Option<String>,
    playlist_ids: Option<Vec<String>>,
}

pub async fn update(State(app): State<App>, user: User, Path(slug): Path<String>, Json(body): Json<UpdateTrack>) -> ApiResult<Json<Value>> {
    let row = track_by_slug(&app, &user, &slug).await?;
    let mut metadata = row.metadata.clone();
    if !metadata.is_object() {
        metadata = json!({});
    }
    if let Some(date) = body.exam_date {
        if !date.is_empty() {
            valid_date(&date)?;
        }
        metadata["examDate"] = json!(date);
    }
    if let Some(goal) = body.goal {
        metadata["goal"] = json!(goal.trim());
    }
    if let Some(root) = body.tag_root {
        metadata["tagRoot"] = json!(root);
    }
    if let Some(ids) = body.playlist_ids {
        metadata["playlistIds"] = json!(ids);
    }
    let name = body.name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).unwrap_or(row.name);
    sqlx::query("UPDATE courses SET name = $2, metadata = $3, updated_at = now() WHERE id = $1").bind(&row.id).bind(&name).bind(&metadata).execute(&app.db).await?;
    Ok(ok())
}

pub async fn remove(State(app): State<App>, user: User, Path(slug): Path<String>) -> ApiResult<Json<Value>> {
    let row = track_by_slug(&app, &user, &slug).await?;
    if row.tab != "TRACK" {
        return Err(ApiError::bad("This track came with Kaizen and can't be removed."));
    }
    sqlx::query("DELETE FROM courses WHERE id = $1").bind(&row.id).execute(&app.db).await?;
    Ok(ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDeck {
    deck_name: String,
}

pub async fn add_deck(State(app): State<App>, user: User, Path(slug): Path<String>, Json(body): Json<AddDeck>) -> ApiResult<Json<Value>> {
    let row = track_by_slug(&app, &user, &slug).await?;
    if body.deck_name.trim().is_empty() {
        return Err(ApiError::bad("Choose a deck."));
    }
    add_mapping(&app, &user, &row.id, &body.deck_name, row.kind() == "language").await?;
    Ok(ok())
}

async fn tagged_cards(app: &App, course_id: &str) -> ApiResult<Vec<TaggedCard>> {
    let rows: Vec<(Vec<String>, String)> = sqlx::query_as(
        "SELECT s.tags, s.state FROM anki_card_snapshots s JOIN anki_deck_mappings m ON m.id = s.mapping_id WHERE m.course_id = $1",
    )
    .bind(course_id)
    .fetch_all(&app.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(tags, state)| TaggedCard { tags, suspended: state == "SUSPENDED", mature: state == "MATURE" })
        .collect())
}

fn metric(noun: &str, value: String, meaning: String) -> Value {
    json!({ "noun": noun, "value": value, "meaning": meaning })
}

pub async fn detail(State(app): State<App>, user: User, Path(slug): Path<String>) -> ApiResult<Json<Value>> {
    let row = track_by_slug(&app, &user, &slug).await?;
    let stats = deck_stats(&app, &user).await?.get(&row.id).copied().unwrap_or_default();
    let today = time::local_date(Utc::now(), user.tz);
    let minutes = core::review_minutes(stats.due, average_review_ms(&app, &user).await?);
    let remembered = remembering(&app, &user, Some(&row.id)).await?;
    let decks: Vec<(String, Option<chrono::DateTime<Utc>>)> =
        sqlx::query_as("SELECT deck_name, last_synced_at FROM anki_deck_mappings WHERE course_id = $1 ORDER BY created_at").bind(&row.id).fetch_all(&app.db).await?;
    let due_line = if stats.due > 0 { format!("about {}", core::spoken_time(minutes)) } else { "Nothing due right now".to_string() };
    let remembered_metric = metric(
        "Remembering",
        remembered.map_or("—".into(), |r| format!("{r}%")),
        if remembered.is_some() { "of older cards, last 30 days".into() } else { "No older cards reviewed yet".into() },
    );
    let track = json!({
        "id": row.id, "slug": row.slug, "name": row.name, "description": row.description, "kind": row.kind(), "builtIn": row.tab != "TRACK",
        "goal": row.text("goal"), "examDate": row.text("examDate"), "tagRoot": row.text("tagRoot"), "glyph": row.text("glyph"), "playlistIds": row.metadata.get("playlistIds"),
    });
    let deck_list: Vec<Value> = decks.iter().map(|(name, synced)| json!({ "name": name, "lastSyncedAt": synced })).collect();
    let mut view = json!({ "track": track, "due": stats.due, "minutes": minutes, "decks": deck_list, "cards": stats.total });

    if row.kind() == "language" {
        let profile = row.language().ok_or_else(|| ApiError::not_found("Language"))?;
        let h = language_headline(&app, &user, &row, profile, stats).await?;
        let (lower, _, from_cards) = words_known(&app, &user, &row, profile, stats).await?;
        view["profile"] = json!(profile);
        view["headlineTooltip"] = json!(h.tooltip);
        view["metrics"] = json!([
            metric(if row.tab == "JAPANESE" { "Level" } else { "Level estimate" }, h.headline.clone(), h.meaning.clone()),
            metric("Cards due", thousands(stats.due), due_line),
            remembered_metric,
        ]);
        view["goalLine"] = json!(h.goal);
        view["knownWords"] = json!({ "lower": lower, "fromCards": from_cards });
        view["ladder"] = json!(core::ladder(profile.levels, lower));
        view["tools"] = json!(language_tools(&row, profile));
    } else {
        let h = exam_headline(&row, stats, today);
        let cards = tagged_cards(&app, &row.id).await?;
        let waiting = stats.suspended;
        let days_left = row.exam_date().map(|d| (d - today).num_days());
        let pace = days_left.and_then(|d| core::new_per_day(waiting, d));
        let days_value = match days_left {
            Some(d) if d >= 0 => thousands(d),
            Some(_) => "Passed".into(),
            None => "—".into(),
        };
        let pace_line = pace.map_or_else(
            || if row.exam_date().is_some() { "Nothing left to unlock".to_string() } else { "Set the exam date to see your pace".to_string() },
            |p| format!("unsuspend ~{} {} a day to finish", thousands(p), if p == 1 { "card" } else { "cards" }),
        );
        view["goalLine"] = json!(h.goal);
        view["metrics"] = json!([
            metric("Days left", days_value, pace_line),
            metric(
                "Deck unlocked",
                format!("{}%", h.progress.round()),
                format!("{} of {} cards", thousands(stats.total - stats.suspended), thousands(stats.total)),
            ),
            remembered_metric,
        ]);
        let root = row.text("tagRoot").map(str::to_string).or_else(|| core::tag_roots(&cards, 1).into_iter().next()).unwrap_or_default();
        view["coverage"] = json!(core::coverage(&cards, &root, 14));
        view["tagRoot"] = json!(root);
        view["tagRoots"] = json!(core::tag_roots(&cards, 8).iter().map(|r| json!({ "value": r, "label": core::tag_label(r) })).collect::<Vec<_>>());
        view["weak"] = json!(weak_for(&app, &row.id, &root).await?);
        view["lessons"] = exam_lessons(&app, &user, &row).await?;
        view["waiting"] = json!(waiting);
        view["misses"] = json!(recent_misses(&app, &row.id).await?);
    }
    Ok(Json(view))
}

fn language_tools(row: &TrackRow, profile: &LanguageProfile) -> Vec<Value> {
    let mut tools = Vec::new();
    match row.tab.as_str() {
        "JAPANESE" => {
            tools.push(json!({ "label": "Grammar coach", "glyph": "文", "detail": "AI lessons on today's grammar queue", "href": "/tracks/japanese/grammar" }));
            tools.push(json!({ "label": "Character repair", "glyph": "漢", "detail": "Fix the kanji you keep missing", "href": "/tracks/japanese/character-repair" }));
        }
        "CHINESE" => {
            tools.push(json!({ "label": "Mandarin Blueprint", "glyph": "蓝", "detail": "Push each finished level to Anki", "href": "/tracks/chinese/mandarin-blueprint" }));
            tools.push(json!({ "label": "Tone practice", "glyph": "声", "detail": "Tone pairs from words you know", "href": "/tracks/chinese/tones" }));
        }
        _ => {}
    }
    if let Some(inflection) = profile.inflection.filter(|_| row.tab == "TRACK") {
        tools.push(json!({
            "label": format!("Drill {inflection}"), "glyph": profile.glyph, "detail": "A short AI drill at your level",
            "prompt": format!("Run a short {} drill on {inflection} for me: ten questions, one at a time, correcting each answer before the next. Ask my level first if you don't know it.", profile.name),
        }));
    }
    if let Some(aid) = profile.reading_aid.filter(|_| row.tab == "TRACK") {
        tools.push(json!({
            "label": format!("Reading help: {aid}"), "glyph": profile.glyph, "detail": "Paste text and get it marked up",
            "prompt": format!("I'm learning {}. I'll paste a passage next. Rewrite it with {} added and give a short gloss of the harder words.", profile.name, aid.to_lowercase()),
        }));
    }
    tools
}

async fn weak_for(app: &App, course_id: &str, root: &str) -> ApiResult<Vec<core::WeakTag>> {
    let rows: Vec<(Vec<String>, i64, i64)> = sqlx::query_as(
        "SELECT s.tags, count(*) FILTER (WHERE l.rating > 1), count(*)
         FROM anki_review_logs l JOIN anki_deck_mappings m ON m.id = l.mapping_id
         JOIN anki_card_snapshots s ON s.user_id = l.user_id AND s.anki_card_id = l.anki_card_id
         WHERE m.course_id = $1 AND l.interval_before_days >= 1 AND l.reviewed_at >= now() - interval '7 days'
         GROUP BY s.anki_card_id, s.tags",
    )
    .bind(course_id)
    .fetch_all(&app.db)
    .await?;
    let prefix = format!("{root}::");
    let cards: Vec<ReviewedCard> = rows
        .into_iter()
        .map(|(tags, passed, total)| ReviewedCard {
            tags: tags.into_iter().filter(|t| root.is_empty() || t.starts_with(&prefix)).collect(),
            passed,
            total,
        })
        .collect();
    Ok(core::weak_tags(&cards, 5, 6))
}

async fn exam_lessons(app: &App, user: &User, row: &TrackRow) -> ApiResult<Value> {
    let ids: Vec<String> = row.metadata.get("playlistIds").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
    let playlists: Vec<(String, String, i32)> =
        sqlx::query_as("SELECT id, title, current_position FROM youtube_playlists WHERE user_id = $1 ORDER BY status, updated_at DESC").bind(&user.id).fetch_all(&app.db).await?;
    let mut linked = Vec::new();
    for (id, title, position) in playlists.iter().filter(|p| ids.contains(&p.0)) {
        let items: Vec<(i32, String, Option<i32>, bool)> = sqlx::query_as(
            "SELECT position, title, duration_seconds, completed FROM youtube_playlist_items WHERE playlist_id = $1 AND position >= $2 ORDER BY position LIMIT 4",
        )
        .bind(id)
        .bind((position - 1).max(0))
        .fetch_all(&app.db)
        .await?;
        linked.push(json!({
            "id": id, "title": title, "position": position,
            "items": items.into_iter().map(|(pos, title, seconds, completed)| json!({ "position": pos, "title": title, "seconds": seconds, "completed": completed })).collect::<Vec<_>>(),
        }));
    }
    Ok(json!({
        "linked": linked,
        "available": playlists.iter().map(|(id, title, _)| json!({ "id": id, "title": title })).collect::<Vec<_>>(),
    }))
}

async fn recent_misses(app: &App, course_id: &str) -> ApiResult<Vec<Value>> {
    let rows: Vec<(String, String, i32)> = sqlx::query_as(
        "SELECT id, description, count FROM mistakes WHERE course_id = $1 AND category = 'qbank' AND NOT resolved ORDER BY updated_at DESC LIMIT 6",
    )
    .bind(course_id)
    .fetch_all(&app.db)
    .await?;
    Ok(rows.into_iter().map(|(id, description, count)| json!({ "id": id, "description": description, "count": count })).collect())
}

#[derive(Deserialize)]
pub struct TagQuery {
    q: Option<String>,
}

pub async fn search(State(app): State<App>, user: User, Path(slug): Path<String>, Query(query): Query<TagQuery>) -> ApiResult<Json<Value>> {
    let row = track_by_slug(&app, &user, &slug).await?;
    let cards = tagged_cards(&app, &row.id).await?;
    Ok(Json(json!({ "matches": core::search_tags(&cards, query.q.as_deref().unwrap_or(""), 12) })))
}

#[derive(Deserialize)]
pub struct MissBody {
    topic: String,
}

/// Log a missed QBank topic and find the cards that cover it.
pub async fn log_miss(State(app): State<App>, user: User, Path(slug): Path<String>, Json(body): Json<MissBody>) -> ApiResult<Json<Value>> {
    let row = track_by_slug(&app, &user, &slug).await?;
    let topic = body.topic.trim();
    if topic.is_empty() {
        return Err(ApiError::bad("Name the topic you missed."));
    }
    let bumped = sqlx::query("UPDATE mistakes SET count = count + 1, updated_at = now() WHERE course_id = $1 AND category = 'qbank' AND NOT resolved AND lower(description) = lower($2)")
        .bind(&row.id)
        .bind(topic)
        .execute(&app.db)
        .await?;
    if bumped.rows_affected() == 0 {
        sqlx::query("INSERT INTO mistakes (id, course_id, description, category) VALUES ($1, $2, $3, 'qbank')")
            .bind(new_id())
            .bind(&row.id)
            .bind(topic)
            .execute(&app.db)
            .await?;
    }
    let cards = tagged_cards(&app, &row.id).await?;
    Ok(Json(json!({ "matches": core::search_tags(&cards, topic, 12) })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsuspendBody {
    tag: String,
    slug: Option<String>,
}

/// Wake up the suspended cards under one tag, through Anki. The learner asks
/// for this with a button that states the count; Anki keeps the schedule.
pub async fn unsuspend(State(app): State<App>, user: User, Json(body): Json<UnsuspendBody>) -> ApiResult<Json<Value>> {
    let tag = body.tag.trim();
    if tag.is_empty() {
        return Err(ApiError::bad("Choose a tag."));
    }
    let course_id = match body.slug.as_deref() {
        Some(slug) => Some(track_by_slug(&app, &user, slug).await?.id),
        None => None,
    };
    let decks: Vec<(String, String)> = sqlx::query_as("SELECT id, deck_name FROM anki_deck_mappings WHERE user_id = $1 AND ($2::text IS NULL OR course_id = $2)")
        .bind(&user.id)
        .bind(&course_id)
        .fetch_all(&app.db)
        .await?;
    let anki = Anki::new(&app, &user.id);
    let mut cards: Vec<i64> = Vec::new();
    for (_, deck) in &decks {
        let query = format!("deck:\"{}\" tag:\"{}\" is:suspended", escape(deck), escape(tag));
        cards.extend(anki.find_cards(&query).await.map_err(|e| ApiError::bad(e.to_string()))?);
    }
    cards.sort_unstable();
    cards.dedup();
    if !cards.is_empty() {
        anki.invoke::<Value>("unsuspend", json!({ "cards": cards })).await.map_err(|e| ApiError::bad(e.to_string()))?;
        sqlx::query("UPDATE anki_card_snapshots SET state = CASE WHEN reps > 0 THEN 'YOUNG' ELSE 'NEW' END WHERE user_id = $1 AND anki_card_id = ANY($2)")
            .bind(&user.id)
            .bind(&cards)
            .execute(&app.db)
            .await?;
    }
    Ok(Json(json!({ "unsuspended": cards.len() })))
}

#[derive(Deserialize)]
pub struct OpenBody {
    deck: Option<String>,
    tag: Option<String>,
}

/// Open a deck's review, or a tag's cards, in the learner's Anki window.
pub async fn open_in_anki(State(app): State<App>, user: User, Json(body): Json<OpenBody>) -> ApiResult<Json<Value>> {
    let anki = Anki::new(&app, &user.id);
    let result = match (body.deck, body.tag) {
        (Some(deck), _) => {
            anki.invoke::<Value>("guiDeckReview", json!({ "name": deck })).await
        }
        (None, Some(tag)) => anki.invoke::<Value>("guiBrowse", json!({ "query": format!("tag:\"{}\"", escape(&tag)) })).await,
        _ => return Err(ApiError::bad("Choose a deck or a tag.")),
    };
    result.map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(ok())
}

/// The review page's one queue: every deck's due cards plus Kaizen's own.
pub async fn review_summary(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let end = time::end_of_day(Utc::now(), user.tz);
    let decks: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT m.deck_name, c.name, c.slug, count(s.id) FILTER (WHERE s.due_at <= $2 AND s.state IN ('LEARNING', 'YOUNG', 'MATURE'))
         FROM anki_deck_mappings m JOIN courses c ON c.id = m.course_id LEFT JOIN anki_card_snapshots s ON s.mapping_id = m.id
         WHERE m.user_id = $1 GROUP BY m.id, c.id ORDER BY 4 DESC, m.deck_name",
    )
    .bind(&user.id)
    .bind(end)
    .fetch_all(&app.db)
    .await?;
    let average = average_review_ms(&app, &user).await?;
    let in_deck: i64 = decks.iter().map(|d| d.3).sum();
    let synced: Option<chrono::DateTime<Utc>> = sqlx::query_scalar("SELECT max(last_synced_at) FROM anki_deck_mappings WHERE user_id = $1").bind(&user.id).fetch_one(&app.db).await?;
    Ok(Json(json!({
        "ankiDue": in_deck,
        "ankiTime": (in_deck > 0).then(|| core::spoken_time(core::review_minutes(in_deck, average))),
        "lastSyncedAt": synced,
        "decks": decks.into_iter().map(|(deck, track, slug, due)| json!({
            "deck": deck, "track": track, "slug": slug, "due": due, "time": (due > 0).then(|| core::spoken_time(core::review_minutes(due, average))),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonCardsQuery {
    playlist_id: String,
}

/// Cards still suspended for the concepts each lesson covers, so finishing a
/// lecture can offer to unlock exactly those.
pub async fn lesson_cards(State(app): State<App>, user: User, Query(query): Query<LessonCardsQuery>) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT cs.youtube_video_id, c.subject, c.slug FROM concept_sources cs JOIN concepts c ON c.id = cs.concept_id
         WHERE c.user_id = $1 AND cs.youtube_playlist_id = $2 AND cs.youtube_video_id IS NOT NULL AND cs.status = 'LINKED'",
    )
    .bind(&user.id)
    .bind(&query.playlist_id)
    .fetch_all(&app.db)
    .await?;
    let mut by_video: HashMap<String, Vec<Value>> = HashMap::new();
    for (video, subject, slug) in rows {
        let tag = concepts::tag(&subject, &slug);
        let waiting: i64 = sqlx::query_scalar("SELECT count(*) FROM anki_card_snapshots WHERE user_id = $1 AND state = 'SUSPENDED' AND $2 = ANY(tags)")
            .bind(&user.id)
            .bind(&tag)
            .fetch_one(&app.db)
            .await?;
        if waiting > 0 {
            by_video.entry(video).or_default().push(json!({ "tag": tag, "waiting": waiting }));
        }
    }
    Ok(Json(json!({ "videos": by_video })))
}

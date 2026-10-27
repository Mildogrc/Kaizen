//! Japanese Grammar Coach: SRS queue, AI lesson prompt, rating import, tutor plans.

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::State;
use chrono::{DateTime, Utc};
use kaizen_core::grammar::{
    self, AnalyticsLessonRow, AnalyticsProgressRow, AppRating, LessonVocabulary, PromptItem, QueueRow, ScheduledType, Status,
    TutorPlanItem,
};
use kaizen_core::settings as core_settings;
use kaizen_core::srs::{Rating, SrsState};
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::known_words_lower;
use crate::auth::User;
use crate::crypto::new_id;
use crate::db::{json_strings, set_settings_section};
use crate::error::{ApiError, ApiResult};
use crate::state::App;

#[derive(sqlx::FromRow, Clone)]
struct ProgressRow {
    id: String,
    learning_item_id: String,
    status: String,
    curriculum_order: i32,
    ease: f64,
    interval_days: f64,
    due_at: DateTime<Utc>,
    repetitions: i32,
    lapse_count: i32,
    is_leech: bool,
    introduced_at: Option<DateTime<Utc>>,
    last_studied_at: Option<DateTime<Utc>>,
    last_rating: Option<String>,
    total_correct: i32,
    total_questions: i32,
    data: Value,
}

impl ProgressRow {
    fn queue_row(&self) -> QueueRow {
        QueueRow {
            learning_item_id: self.learning_item_id.clone(),
            status: Status::parse(&self.status),
            curriculum_order: self.curriculum_order as i64,
            due_at: self.due_at,
            introduced_at: self.introduced_at,
            is_leech: self.is_leech,
        }
    }
    fn tutor_item(&self) -> TutorPlanItem {
        let data = grammar::grammar_data(&self.data);
        TutorPlanItem {
            learning_item_id: self.learning_item_id.clone(),
            pattern: data.pattern,
            meaning: data.meaning,
            jlpt_level: data.jlpt_level,
            examples: data.examples,
            curriculum_order: self.curriculum_order as i64,
            total_correct: self.total_correct as i64,
            total_questions: self.total_questions as i64,
            lapse_count: self.lapse_count as i64,
            is_leech: self.is_leech,
            last_rating: self.last_rating.as_deref().and_then(Rating::parse),
        }
    }
}

async fn progress_rows(app: &App, user: &User) -> ApiResult<Vec<ProgressRow>> {
    Ok(sqlx::query_as(
        "SELECT gp.id, gp.learning_item_id, gp.status, gp.curriculum_order, gp.ease, gp.interval_days, gp.due_at, gp.repetitions,
           gp.lapse_count, gp.is_leech, gp.introduced_at, gp.last_studied_at, gp.last_rating, gp.total_correct, gp.total_questions, li.data
         FROM grammar_progress gp JOIN learning_items li ON li.id = gp.learning_item_id
         WHERE gp.user_id = $1 ORDER BY gp.curriculum_order",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?)
}

#[derive(sqlx::FromRow)]
struct LessonRow {
    id: String,
    scheduled_for: DateTime<Utc>,
    prompt: String,
    grammar_item_ids: Value,
}

pub async fn page(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let now = Utc::now();
    let progress = progress_rows(&app, &user).await?;
    let stored: Option<LessonRow> = sqlx::query_as(
        "SELECT id, scheduled_for, prompt, grammar_item_ids FROM grammar_lessons WHERE user_id = $1 AND status = 'GENERATED'
         ORDER BY scheduled_for DESC LIMIT 1",
    )
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?;
    let completed: Vec<(Option<DateTime<Utc>>, Option<Value>)> = sqlx::query_as(
        "SELECT completed_at, response FROM grammar_lessons WHERE user_id = $1 AND completed_at IS NOT NULL ORDER BY completed_at",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let imported_passages: i64 =
        sqlx::query_scalar("SELECT count(*) FROM speed_reading_passages WHERE user_id = $1 AND source = 'grammar-lesson'")
            .bind(&user.id)
            .fetch_one(&app.db)
            .await?;
    let config = core_settings::japanese_grammar(&user.settings);
    let tutor_config = core_settings::japanese_grammar_tutor(&user.settings);
    let queue_rows: Vec<QueueRow> = progress.iter().map(ProgressRow::queue_row).collect();
    let queue = grammar::select_queue(&queue_rows, now, &config, user.tz);
    let scheduled_work = queue.review_ids.len() + queue.new_ids.len();

    let current_prompt = stored.as_ref().filter(|l| l.prompt.contains(grammar::PROMPT_VERSION));
    let lesson = current_prompt.filter(|l| grammar::lesson_matches_queue(l.scheduled_for, &json_strings(&l.grammar_item_ids), &queue, now, user.tz));
    let lesson_state = match (&lesson, &stored, &current_prompt) {
        (Some(_), _, _) => "ready",
        (None, _, _) if scheduled_work == 0 => "empty",
        (None, Some(_), None) => "upgrade",
        (None, Some(_), Some(_)) => "refresh",
        (None, None, _) => "generate",
    };

    let mut counts: HashMap<&str, usize> = ["NEW", "LEARNING", "REVIEW", "MASTERED"].into_iter().map(|s| (s, 0)).collect();
    for row in &progress {
        if let Some(count) = counts.get_mut(row.status.as_str()) {
            *count += 1;
        }
    }
    let analytics = grammar::analyze(
        &progress
            .iter()
            .map(|r| AnalyticsProgressRow {
                status: Status::parse(&r.status),
                due_at: r.due_at,
                total_correct: r.total_correct as i64,
                total_questions: r.total_questions as i64,
            })
            .collect::<Vec<_>>(),
        &completed.into_iter().map(|(completed_at, response)| AnalyticsLessonRow { completed_at, response }).collect::<Vec<_>>(),
        imported_passages,
        now,
        user.tz,
    );
    let known_words = known_words_lower(&app, &user, "ja").await?;
    let by_item: HashMap<&str, &ProgressRow> = progress.iter().map(|r| (r.learning_item_id.as_str(), r)).collect();

    let lesson_json = lesson.map(|l| {
        let items: Vec<Value> = json_strings(&l.grammar_item_ids)
            .iter()
            .filter_map(|id| by_item.get(id.as_str()))
            .map(|row| {
                let data = grammar::grammar_data(&row.data);
                json!({
                    "learningItemId": row.learning_item_id, "pattern": data.pattern, "meaning": data.meaning,
                    "kind": if row.status == "NEW" { "new" } else { "review" }, "isLeech": row.is_leech,
                })
            })
            .collect();
        json!({ "id": l.id, "scheduledFor": l.scheduled_for, "prompt": l.prompt, "items": items })
    });

    let tutor_items: Vec<TutorPlanItem> = progress.iter().map(ProgressRow::tutor_item).collect();
    let weakest = grammar::select_worst_points(&tutor_items, tutor_config.plan_size.max(0) as usize, &tutor_config.item_overrides);
    let plan = grammar::build_tutor_lesson_plan(&tutor_items, &tutor_config);
    let mut configurable: Vec<&TutorPlanItem> = tutor_items
        .iter()
        .filter(|i| grammar::has_tutor_history(i) || tutor_config.item_overrides.contains_key(&i.learning_item_id))
        .collect();
    let miss = |i: &TutorPlanItem| grammar::tutor_miss_rate_percent(i, tutor_config.item_overrides.get(&i.learning_item_id));
    configurable.sort_by(|a, b| miss(b).cmp(&miss(a)).then(a.curriculum_order.cmp(&b.curriculum_order)));

    let levels: Vec<Value> = kaizen_core::jlpt::LEVELS
        .iter()
        .map(|level| {
            let rows: Vec<&ProgressRow> =
                progress.iter().filter(|r| r.data.get("jlptLevel").and_then(Value::as_str) == Some(*level)).collect();
            json!({
                "level": level, "total": rows.len(),
                "studied": rows.iter().filter(|r| r.status != "NEW").count(),
                "mastered": rows.iter().filter(|r| r.status == "MASTERED").count(),
            })
        })
        .collect();
    let mut recent: Vec<&ProgressRow> = progress.iter().filter(|r| r.last_studied_at.is_some()).collect();
    recent.sort_by_key(|r| std::cmp::Reverse(r.last_studied_at));

    Ok(Json(json!({
        "config": config,
        "counts": counts,
        "analytics": analytics,
        "knownWords": known_words,
        "levelLabel": grammar::level_from_known_words(known_words),
        "levels": levels,
        "scheduledWork": scheduled_work,
        "lessonState": lesson_state,
        "lesson": lesson_json,
        "tutor": {
            "config": tutor_config,
            "plan": plan,
            "weakest": weakest.iter().map(|i| json!({
                "learningItemId": i.learning_item_id, "pattern": i.pattern, "missRate": miss(i), "isLeech": i.is_leech,
            })).collect::<Vec<_>>(),
            "configurable": configurable.iter().map(|i| json!({
                "learningItemId": i.learning_item_id, "pattern": i.pattern,
                "recordedMissRate": grammar::recorded_miss_rate_percent(i),
                "misses": (i.total_questions - i.total_correct).max(0), "totalQuestions": i.total_questions,
                "override": tutor_config.item_overrides.get(&i.learning_item_id),
            })).collect::<Vec<_>>(),
        },
        "recent": recent.iter().take(12).map(|r| {
            let data = grammar::grammar_data(&r.data);
            json!({
                "id": r.id, "pattern": data.pattern, "meaning": data.meaning, "status": r.status, "isLeech": r.is_leech,
                "intervalDays": r.interval_days.round(),
            })
        }).collect::<Vec<_>>(),
    })))
}

/// Daily vocabulary for a lesson: known Anki/Migaku words, avoiding words
/// used in the last week of lessons when the pool allows.
async fn lesson_vocabulary(app: &App, user: &User, item_count: usize, now: DateTime<Utc>) -> ApiResult<Vec<LessonVocabulary>> {
    let words: Vec<(String, String, Option<String>, String, String)> = sqlx::query_as(
        "SELECT surface, lemma, reading, strict_key, source FROM known_words WHERE user_id = $1 AND language = 'ja' AND source IN ('anki', 'migaku')",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let recent: Vec<Value> = sqlx::query_scalar(
        "SELECT vocabulary FROM grammar_lessons WHERE user_id = $1 AND scheduled_for < $2 ORDER BY scheduled_for DESC LIMIT 7",
    )
    .bind(&user.id)
    .bind(kaizen_core::time::start_of_day(now, user.tz))
    .fetch_all(&app.db)
    .await?;
    let mut used: HashSet<String> = HashSet::new();
    for word in recent.iter().filter_map(Value::as_array).flatten() {
        if let Some(key) = word.get("key").and_then(Value::as_str) {
            used.insert(key.to_string());
        }
        if let Some(term) = word.get("term").and_then(Value::as_str) {
            used.insert(format!("term:{term}"));
        }
    }
    let candidates: Vec<LessonVocabulary> = words
        .into_iter()
        .map(|(surface, lemma, reading, key, source)| LessonVocabulary {
            source: if source == "anki" { "anki-mature".into() } else { "migaku".into() },
            term: if surface.is_empty() { lemma } else { surface },
            reading,
            key: Some(key),
        })
        .collect();
    let fresh: Vec<LessonVocabulary> = candidates
        .iter()
        .filter(|w| !used.contains(w.key.as_deref().unwrap_or("")) && !used.contains(&format!("term:{}", w.term)))
        .cloned()
        .collect();
    let required = item_count * 3;
    let pool = if fresh.len() >= required { &fresh } else { &candidates };
    Ok(grammar::select_daily_vocabulary(pool, required, now, user.tz))
}

/// Build (or refresh) today's lesson from due reviews plus the next new batch.
pub async fn generate_lesson(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let now = Utc::now();
    let progress = progress_rows(&app, &user).await?;
    let config = core_settings::japanese_grammar(&user.settings);
    let queue_rows: Vec<QueueRow> = progress.iter().map(ProgressRow::queue_row).collect();
    let queue = grammar::select_queue(&queue_rows, now, &config, user.tz);
    let ids = queue.ids();
    if ids.is_empty() {
        sqlx::query("UPDATE grammar_lessons SET status = 'COMPLETED', completed_at = $2 WHERE user_id = $1 AND status = 'GENERATED'")
            .bind(&user.id)
            .bind(now)
            .execute(&app.db)
            .await?;
        return Ok(Json(json!({ "lessonId": null })));
    }
    let by_item: HashMap<&str, &ProgressRow> = progress.iter().map(|r| (r.learning_item_id.as_str(), r)).collect();
    let items: Vec<PromptItem> = ids
        .iter()
        .map(|id| {
            let row = by_item.get(id.as_str()).ok_or_else(|| anyhow::anyhow!("missing grammar item {id}"))?;
            Ok(PromptItem { learning_item_id: id.clone(), pattern: grammar::grammar_data(&row.data).pattern })
        })
        .collect::<anyhow::Result<_>>()?;
    let known_words = known_words_lower(&app, &user, "ja").await?;
    let vocabulary = lesson_vocabulary(&app, &user, items.len(), now).await?;
    let level_label = grammar::level_from_known_words(known_words);
    let prompt = grammar::build_lesson_prompt(level_label, known_words, &items, &vocabulary, Some(&config));

    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM grammar_lessons WHERE user_id = $1 AND status = 'GENERATED' ORDER BY scheduled_for DESC LIMIT 1",
    )
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?;
    let lesson_id = existing.unwrap_or_else(new_id);
    let mut tx = app.db.begin().await?;
    sqlx::query(
        "INSERT INTO grammar_lessons (id, user_id, scheduled_for, level_label, prompt, grammar_item_ids, vocabulary)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET scheduled_for = EXCLUDED.scheduled_for, level_label = EXCLUDED.level_label,
           prompt = EXCLUDED.prompt, grammar_item_ids = EXCLUDED.grammar_item_ids, vocabulary = EXCLUDED.vocabulary",
    )
    .bind(&lesson_id)
    .bind(&user.id)
    .bind(now)
    .bind(level_label)
    .bind(&prompt)
    .bind(json!(ids))
    .bind(serde_json::to_value(&vocabulary).map_err(anyhow::Error::from)?)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE grammar_lessons SET status = 'COMPLETED', completed_at = $3 WHERE user_id = $1 AND status = 'GENERATED' AND id <> $2")
        .bind(&user.id)
        .bind(&lesson_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "lessonId": lesson_id })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingEntry {
    learning_item_id: String,
    rating: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingSubmission {
    lesson_id: String,
    ratings: Vec<RatingEntry>,
}

/// Apply one Again/Good/Perfect rating per scheduled point to the SRS.
pub async fn submit_ratings(State(app): State<App>, user: User, Json(body): Json<RatingSubmission>) -> ApiResult<Json<Value>> {
    let now = Utc::now();
    let mut submitted: HashMap<String, AppRating> = HashMap::new();
    for entry in &body.ratings {
        let rating = AppRating::parse(&entry.rating).ok_or_else(|| ApiError::bad("Choose Again, Good, or Perfect for every grammar point."))?;
        submitted.insert(entry.learning_item_id.clone(), rating);
    }
    let mut tx = app.db.begin().await?;
    let lesson: Option<(String, Value)> =
        sqlx::query_as("SELECT status, grammar_item_ids FROM grammar_lessons WHERE id = $1 AND user_id = $2 FOR UPDATE")
            .bind(&body.lesson_id)
            .bind(&user.id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((status, item_ids)) = lesson else {
        return Err(ApiError::bad("This lesson no longer exists. Refresh Grammar Coach and generate a current lesson."));
    };
    if status == "COMPLETED" {
        return Ok(Json(json!({ "ok": true, "duplicate": true, "message": "These lesson ratings were already saved." })));
    }
    let expected = json_strings(&item_ids);
    if submitted.len() != expected.len() || body.ratings.iter().any(|r| !expected.contains(&r.learning_item_id)) {
        return Err(ApiError::bad("The ratings do not match the current lesson. Refresh Grammar Coach and rate every displayed point once."));
    }
    let rows: Vec<ProgressRow> = sqlx::query_as(
        "SELECT gp.id, gp.learning_item_id, gp.status, gp.curriculum_order, gp.ease, gp.interval_days, gp.due_at, gp.repetitions,
           gp.lapse_count, gp.is_leech, gp.introduced_at, gp.last_studied_at, gp.last_rating, gp.total_correct, gp.total_questions, li.data
         FROM grammar_progress gp JOIN learning_items li ON li.id = gp.learning_item_id
         WHERE gp.user_id = $1 AND gp.learning_item_id = ANY($2) FOR UPDATE OF gp",
    )
    .bind(&user.id)
    .bind(&expected)
    .fetch_all(&mut *tx)
    .await?;
    if rows.len() != expected.len() {
        return Err(ApiError::bad("One or more grammar points are missing. Refresh Grammar Coach before saving."));
    }
    let by_item: HashMap<&str, &ProgressRow> = rows.iter().map(|r| (r.learning_item_id.as_str(), r)).collect();
    let mut results = Vec::with_capacity(expected.len());
    for id in &expected {
        let row = by_item[id.as_str()];
        let status = Status::parse(&row.status);
        let scheduled_type = if status == Status::New { ScheduledType::New } else { ScheduledType::Review };
        let result = grammar::result_from_app_rating(id, submitted[id], scheduled_type);
        let state = SrsState {
            ease: row.ease,
            interval_days: row.interval_days,
            repetitions: row.repetitions,
            lapse_count: row.lapse_count,
            is_leech: row.is_leech,
        };
        let scheduled = grammar::schedule_result(state, status, result.rating, result.mastered_on_placement, now);
        sqlx::query(
            "UPDATE grammar_progress SET status = $2, ease = $3, interval_days = $4, due_at = $5, repetitions = $6, lapse_count = $7,
               is_leech = $8, introduced_at = COALESCE(introduced_at, $9), last_studied_at = $9, last_rating = $10,
               total_correct = total_correct + $11, total_questions = total_questions + $12, updated_at = now()
             WHERE id = $1",
        )
        .bind(&row.id)
        .bind(scheduled.status.as_str())
        .bind(scheduled.next.state.ease)
        .bind(scheduled.next.state.interval_days)
        .bind(scheduled.next.due_at)
        .bind(scheduled.next.state.repetitions)
        .bind(scheduled.next.state.lapse_count)
        .bind(scheduled.next.state.is_leech)
        .bind(now)
        .bind(result.rating.as_str())
        .bind(result.correct.min(result.total) as i32)
        .bind(result.total as i32)
        .execute(&mut *tx)
        .await?;
        results.push(result);
    }
    sqlx::query("UPDATE grammar_lessons SET status = 'COMPLETED', response = $2, completed_at = $3 WHERE id = $1")
        .bind(&body.lesson_id)
        .bind(json!({ "lessonId": body.lesson_id, "grammarResults": results }))
        .bind(now)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE grammar_lessons SET status = 'COMPLETED', completed_at = $3 WHERE user_id = $1 AND status = 'GENERATED' AND id <> $2")
        .bind(&user.id)
        .bind(&body.lesson_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "duplicate": false, "message": "Lesson ratings saved." })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorItem {
    learning_item_id: String,
    miss_rate_percent: Option<Value>,
    #[serde(default)]
    excluded: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorConfigBody {
    plan_size: Value,
    #[serde(default)]
    items: Vec<TutorItem>,
}

pub async fn tutor_config(State(app): State<App>, user: User, Json(body): Json<TutorConfigBody>) -> ApiResult<Json<Value>> {
    let ids: Vec<String> = body.items.iter().map(|i| i.learning_item_id.clone()).collect();
    let valid: HashSet<String> = sqlx::query_scalar("SELECT learning_item_id FROM grammar_progress WHERE user_id = $1 AND learning_item_id = ANY($2)")
        .bind(&user.id)
        .bind(&ids)
        .fetch_all(&app.db)
        .await?
        .into_iter()
        .collect();
    let mut overrides = serde_json::Map::new();
    for item in body.items.iter().filter(|i| valid.contains(&i.learning_item_id)) {
        let mut entry = serde_json::Map::new();
        if let Some(rate) = item.miss_rate_percent.as_ref().filter(|v| !v.is_null() && v.as_str().is_none_or(|s| !s.trim().is_empty())) {
            entry.insert("missRatePercent".into(), rate.clone());
        }
        if item.excluded {
            entry.insert("excluded".into(), Value::Bool(true));
        }
        if !entry.is_empty() {
            overrides.insert(item.learning_item_id.clone(), Value::Object(entry));
        }
    }
    let config = core_settings::japanese_grammar_tutor(&json!({
        "japaneseGrammarTutor": { "planSize": body.plan_size, "itemOverrides": overrides },
    }));
    set_settings_section(&app.db, &user.id, "japaneseGrammarTutor", &serde_json::to_value(&config).map_err(anyhow::Error::from)?).await?;
    Ok(Json(json!({ "ok": true, "config": config })))
}

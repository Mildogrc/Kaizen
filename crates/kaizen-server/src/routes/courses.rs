//! Language course pages (Japanese / Chinese) and card generation.

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, State};
use chrono::{DateTime, Utc};
use kaizen_core::anki_analytics::{self, CardState};
use kaizen_core::progression::level_band_progress_percent;
use kaizen_core::schema::{self, FlashcardRule, PracticeRule, SchemaConfig, generate_practice};
use kaizen_core::{jlpt, util};
use serde_json::{Value, json};

use super::shared::{anki_due_today, anki_logs, anki_snapshots, grammar_by_level, jlpt_levels, ok, owns_course};
use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

#[derive(sqlx::FromRow)]
struct CourseRow {
    id: String,
    slug: String,
    name: String,
    description: Option<String>,
    tab: String,
    color: Option<String>,
}

pub async fn course_page(State(app): State<App>, user: User, Path(slug): Path<String>) -> ApiResult<Json<Value>> {
    let course: CourseRow =
        sqlx::query_as("SELECT id, slug, name, description, tab, color FROM courses WHERE user_id = $1 AND slug = $2")
            .bind(&user.id)
            .bind(&slug)
            .fetch_optional(&app.db)
            .await?
            .ok_or_else(|| ApiError::not_found("Course"))?;
    let now = Utc::now();
    let counts: (i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM learning_items WHERE course_id = $1), (SELECT count(*) FROM flashcards WHERE course_id = $1),
                (SELECT count(*) FROM mistakes WHERE course_id = $1)",
    )
    .bind(&course.id)
    .fetch_one(&app.db)
    .await?;
    let due_reviews: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM review_records r LEFT JOIN flashcards f ON f.id = r.flashcard_id LEFT JOIN practice_items p ON p.id = r.practice_item_id
         WHERE r.user_id = $1 AND r.due_at <= $2 AND NOT r.is_suspended AND (f.course_id = $3 OR p.course_id = $3)",
    )
    .bind(&user.id)
    .bind(now)
    .bind(&course.id)
    .fetch_one(&app.db)
    .await?;
    let goals: Vec<(String, String, Option<String>, Option<i32>, i32, Option<String>, String)> = sqlx::query_as(
        "SELECT id, title, description, target_value, current_value, unit, status FROM course_goals WHERE course_id = $1 ORDER BY created_at",
    )
    .bind(&course.id)
    .fetch_all(&app.db)
    .await?;
    let milestones: Vec<(String, String, i32, Option<String>, Option<i32>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT id, title, ord, metric, target_value, completed_at FROM course_milestones WHERE course_id = $1 ORDER BY ord",
    )
    .bind(&course.id)
    .fetch_all(&app.db)
    .await?;
    let schemas: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT s.slug, s.name, s.item_type, count(li.id) FROM content_schemas s LEFT JOIN learning_items li ON li.schema_id = s.id
         WHERE s.course_id = $1 GROUP BY s.id ORDER BY s.name",
    )
    .bind(&course.id)
    .fetch_all(&app.db)
    .await?;
    let imports: Vec<(String, Option<String>, String, i32, i32, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, source_name, status, valid_count, total_count, created_at FROM import_batches WHERE course_id = $1 ORDER BY created_at DESC LIMIT 5",
    )
    .bind(&course.id)
    .fetch_all(&app.db)
    .await?;

    // Anki strip.
    let mappings: Vec<(String, String, Option<DateTime<Utc>>)> =
        sqlx::query_as("SELECT id, deck_name, last_synced_at FROM anki_deck_mappings WHERE course_id = $1 ORDER BY created_at")
            .bind(&course.id)
            .fetch_all(&app.db)
            .await?;
    let language = match course.tab.as_str() {
        "JAPANESE" => Some("ja"),
        "CHINESE" => Some("zh"),
        _ => None,
    };
    let word_stat = match language {
        Some(l) => crate::db::latest_word_stat(&app.db, &user.id, l).await?,
        None => None,
    };
    let lower = word_stat.as_ref().map_or(0, |s| s.lower_bound as i64);
    let mut mature_kanji = 0i64;
    let anki = if mappings.is_empty() {
        Value::Null
    } else {
        let ids: Vec<String> = mappings.iter().map(|m| m.0.clone()).collect();
        let snapshots = anki_snapshots(&app, &ids).await?;
        let logs = anki_logs(&app, &ids).await?;
        let kanji_ids: HashSet<&str> =
            mappings.iter().filter(|m| m.1.to_lowercase().contains("kanji") || m.1.to_lowercase().contains("rtk")).map(|m| m.0.as_str()).collect();
        mature_kanji = snapshots
            .iter()
            .filter(|s| s.state == CardState::Mature && s.mapping_id.as_deref().is_some_and(|m| kanji_ids.contains(m)))
            .count() as i64;
        let mature = snapshots.iter().filter(|s| s.state == CardState::Mature).count();
        json!({
            "cards": snapshots.len(),
            "dueToday": anki_due_today(&app, &user, Some(&course.id)).await?,
            "streak": anki_analytics::streaks(&logs, now, user.tz).current,
            "matureRetention": anki_analytics::retention(&logs).mature,
            "maturePct": if snapshots.is_empty() { 0 } else { util::js_round_i64(mature as f64 / snapshots.len() as f64 * 100.0) },
            "deckNames": mappings.iter().map(|m| m.1.clone()).collect::<Vec<_>>(),
            "lastSyncedAt": mappings.iter().filter_map(|m| m.2).max(),
        })
    };

    // Exam tracks with per-level progress tiles.
    let grammar = if course.tab == "JAPANESE" { grammar_by_level(&app, &user).await? } else { HashMap::new() };
    let jlpt_states = if course.tab == "JAPANESE" { jlpt_levels(&app, &user).await? } else { vec![] };
    let cumulative: HashMap<String, jlpt::LevelState> =
        jlpt::cumulative_levels(&jlpt_states).into_iter().map(|l| (l.name.clone(), l)).collect();
    let exams: Vec<(String, String, String, Option<String>)> =
        sqlx::query_as("SELECT id, slug, name, description FROM exams WHERE course_id = $1 ORDER BY name")
            .bind(&course.id)
            .fetch_all(&app.db)
            .await?;
    let mut exam_tracks = Vec::new();
    for (exam_id, exam_slug, exam_name, exam_description) in exams {
        let levels: Vec<(String, String, i32, Value)> =
            sqlx::query_as("SELECT id, name, rank, targets FROM exam_levels WHERE exam_id = $1 ORDER BY rank")
                .bind(&exam_id)
                .fetch_all(&app.db)
                .await?;
        let (is_jlpt, is_hsk, is_kanken) = (exam_slug == "jlpt", exam_slug == "hsk", exam_slug == "kanji-kentei");
        let mut tiles = Vec::new();
        for (index, (level_id, name, _rank, targets)) in levels.iter().enumerate() {
            let target = |t: &Value, k: &str| t.get(k).and_then(Value::as_i64);
            let previous = index.checked_sub(1).map(|i| &levels[i].3);
            let word = level_band_progress_percent(lower, target(targets, "targetVocab"), previous.and_then(|p| target(p, "targetVocab")));
            let (g_total, g_mastered) = grammar.get(name).copied().unwrap_or((0, 0));
            let grammar_pct = level_band_progress_percent(g_mastered, Some(g_total), None);
            let cumulative_word = if is_jlpt { level_band_progress_percent(lower, target(targets, "targetVocab"), None) } else { word };
            let cumulative_grammar = cumulative
                .get(name)
                .filter(|_| is_jlpt)
                .map_or(grammar_pct, |c| level_band_progress_percent(c.grammar_mastered, Some(c.grammar_total), None));
            let kanji = level_band_progress_percent(mature_kanji, target(targets, "targetKanji"), previous.and_then(|p| target(p, "targetKanji")));
            let primary = if is_kanken { kanji } else if is_jlpt || is_hsk { word } else { 0.0 };
            let complete = if is_jlpt { word >= 100.0 && grammar_pct >= 100.0 } else { (is_hsk || is_kanken) && primary >= 100.0 };
            tiles.push(json!({
                "id": level_id, "label": name, "primary": primary, "secondary": if is_jlpt { Some(grammar_pct) } else { None },
                "complete": complete, "tone": if is_kanken { "amber" } else { "cyan" },
                "primaryLabel": if is_jlpt { "Words" } else if is_kanken { "Kanji" } else { "Progress" },
                "tooltipPrimary": cumulative_word.max(if is_kanken { kanji } else { 0.0 }),
                "tooltipSecondary": if is_jlpt { Some(cumulative_grammar) } else { None },
            }));
        }
        exam_tracks.push(json!({ "id": exam_id, "slug": exam_slug, "name": exam_name, "description": exam_description, "levels": tiles }));
    }
    let japanese_goal = if course.tab == "JAPANESE" { jlpt::current_progress(&jlpt_states, lower) } else { None };

    Ok(Json(json!({
        "course": { "id": course.id, "slug": course.slug, "name": course.name, "description": course.description, "tab": course.tab, "color": course.color },
        "stats": { "items": counts.0, "flashcards": counts.1, "mistakes": counts.2, "dueReviews": due_reviews },
        "anki": anki,
        "knownWords": word_stat,
        "matureKanji": mature_kanji,
        "japaneseGoal": japanese_goal,
        "jlptComplete": course.tab == "JAPANESE" && japanese_goal.is_none() && !jlpt_states.is_empty(),
        "goals": goals.into_iter().map(|(id, title, description, target, current, unit, status)| json!({
            "id": id, "title": title, "description": description, "targetValue": target, "currentValue": current, "unit": unit, "status": status,
        })).collect::<Vec<_>>(),
        "milestones": milestones.into_iter().map(|(id, title, ord, metric, target, completed)| json!({
            "id": id, "title": title, "order": ord, "metric": metric, "targetValue": target, "completedAt": completed,
        })).collect::<Vec<_>>(),
        "exams": exam_tracks,
        "schemas": schemas.into_iter().map(|(slug, name, item_type, count)| json!({ "slug": slug, "name": name, "itemType": item_type, "items": count })).collect::<Vec<_>>(),
        "imports": imports.into_iter().map(|(id, source, status, valid, total, created)| json!({
            "id": id, "sourceName": source, "status": status, "validCount": valid, "totalCount": total, "createdAt": created,
        })).collect::<Vec<_>>(),
    })))
}

/// Generate flashcards + practice items from schema rules. Schemas covered by
/// an Anki deck mapping are skipped — Anki reviews those.
pub async fn generate_cards(State(app): State<App>, user: User, Path(course_id): Path<String>) -> ApiResult<Json<Value>> {
    if !owns_course(&app, &user, &course_id).await? {
        return Err(ApiError::not_found("Course"));
    }
    let mappings: Vec<Option<String>> = sqlx::query_scalar("SELECT schema_id FROM anki_deck_mappings WHERE course_id = $1")
        .bind(&course_id)
        .fetch_all(&app.db)
        .await?;
    let whole_course_anki = mappings.iter().any(Option::is_none);
    let schemas: Vec<(String, String, Option<Value>)> = sqlx::query_as(
        "SELECT s.id, s.name, (SELECT v.config FROM content_schema_versions v WHERE v.schema_id = s.id AND v.is_active ORDER BY v.version DESC LIMIT 1)
         FROM content_schemas s WHERE s.course_id = $1",
    )
    .bind(&course_id)
    .fetch_all(&app.db)
    .await?;
    let (mut cards_created, mut practice_created, mut skipped_existing) = (0u64, 0u64, 0usize);
    let mut anki_skipped = Vec::new();
    for (schema_id, name, config) in schemas {
        let Some(config) = config else { continue };
        let items: Vec<(String, Value)> = sqlx::query_as("SELECT id, data FROM learning_items WHERE schema_id = $1")
            .bind(&schema_id)
            .fetch_all(&app.db)
            .await?;
        if items.is_empty() {
            continue;
        }
        if whole_course_anki || mappings.iter().any(|m| m.as_deref() == Some(schema_id.as_str())) {
            anki_skipped.push(name);
            continue;
        }
        let config: SchemaConfig = serde_json::from_value(config).unwrap_or_default();
        let ids: Vec<String> = items.iter().map(|(id, _)| id.clone()).collect();
        if !config.flashcard_rules.is_empty() {
            let rules: &[FlashcardRule] = &config.flashcard_rules;
            let existing: HashSet<String> = sqlx::query_as::<_, (Option<String>, Value)>(
                "SELECT learning_item_id, metadata FROM flashcards WHERE learning_item_id = ANY($1)",
            )
            .bind(&ids)
            .fetch_all(&app.db)
            .await?
            .into_iter()
            .map(|(item, meta)| format!("{}:{}", item.unwrap_or_default(), meta.get("rule").and_then(Value::as_str).unwrap_or("")))
            .collect();
            let generated = schema::generate_cards(&items, rules);
            let fresh: Vec<_> =
                generated.iter().filter(|c| !existing.contains(&format!("{}:{}", c.learning_item_id, c.rule_name))).collect();
            skipped_existing += generated.len() - fresh.len();
            let rows: Vec<Value> = fresh
                .iter()
                .map(|c| json!({ "id": new_id(), "reviewId": new_id(), "item": c.learning_item_id, "front": c.front, "back": c.back, "rule": c.rule_name }))
                .collect();
            if !rows.is_empty() {
                let rows = Value::Array(rows);
                sqlx::query(
                    "INSERT INTO flashcards (id, course_id, learning_item_id, front, back, metadata)
                     SELECT x->>'id', $1, x->>'item', x->>'front', x->>'back', jsonb_build_object('rule', x->>'rule', 'generated', true)
                     FROM jsonb_array_elements($2::jsonb) x",
                )
                .bind(&course_id)
                .bind(&rows)
                .execute(&app.db)
                .await?;
                cards_created += sqlx::query(
                    "INSERT INTO review_records (id, user_id, flashcard_id) SELECT x->>'reviewId', $1, x->>'id' FROM jsonb_array_elements($2::jsonb) x",
                )
                .bind(&user.id)
                .bind(&rows)
                .execute(&app.db)
                .await?
                .rows_affected();
            }
        }
        if !config.practice_rules.is_empty() {
            let rules: &[PracticeRule] = &config.practice_rules;
            let existing: HashSet<String> = sqlx::query_as::<_, (Option<String>, String)>(
                "SELECT learning_item_id, type FROM practice_items WHERE learning_item_id = ANY($1)",
            )
            .bind(&ids)
            .fetch_all(&app.db)
            .await?
            .into_iter()
            .map(|(item, kind)| format!("{}:{kind}", item.unwrap_or_default()))
            .collect();
            let rows: Vec<Value> = generate_practice(&items, rules)
                .into_iter()
                .filter(|p| !existing.contains(&format!("{}:{}", p.learning_item_id, p.kind)))
                .map(|p| json!({ "id": new_id(), "reviewId": new_id(), "item": p.learning_item_id, "type": p.kind, "prompt": p.prompt, "answer": p.answer }))
                .collect();
            if !rows.is_empty() {
                let rows = Value::Array(rows);
                sqlx::query(
                    "INSERT INTO practice_items (id, course_id, learning_item_id, type, prompt, answer, metadata)
                     SELECT x->>'id', $1, x->>'item', x->>'type', x->>'prompt', x->>'answer', '{\"generated\": true}'::jsonb
                     FROM jsonb_array_elements($2::jsonb) x",
                )
                .bind(&course_id)
                .bind(&rows)
                .execute(&app.db)
                .await?;
                practice_created += sqlx::query(
                    "INSERT INTO review_records (id, user_id, practice_item_id) SELECT x->>'reviewId', $1, x->>'id' FROM jsonb_array_elements($2::jsonb) x",
                )
                .bind(&user.id)
                .bind(&rows)
                .execute(&app.db)
                .await?
                .rows_affected();
            }
        }
    }
    Ok(Json(json!({
        "cardsCreated": cards_created, "practiceCreated": practice_created, "skippedExisting": skipped_existing, "ankiSkipped": anki_skipped,
    })))
}

pub async fn complete_goal(State(app): State<App>, user: User, Path(goal_id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query(
        "UPDATE course_goals g SET status = 'COMPLETED', updated_at = now() FROM courses c WHERE g.id = $1 AND c.id = g.course_id AND c.user_id = $2",
    )
    .bind(&goal_id)
    .bind(&user.id)
    .execute(&app.db)
    .await?;
    Ok(ok())
}

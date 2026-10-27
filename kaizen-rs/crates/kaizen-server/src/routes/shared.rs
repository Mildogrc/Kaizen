//! Queries shared by several views.

use std::collections::HashMap;

use axum::Json;
use chrono::{DateTime, Utc};
use kaizen_core::anki_analytics::{CardState, LogRow, SnapshotRow};
use kaizen_core::grammar::{QueueRow, Status};
use kaizen_core::jlpt::LevelState;
use kaizen_core::math_goals::{self, MathTarget};
use kaizen_core::roadmap::{Edge, Node};
use serde_json::{Value, json};

use crate::auth::User;
use crate::error::ApiResult;
use crate::state::App;

pub fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/// snake_case → camelCase for the top-level keys of a row rendered with `to_jsonb`.
pub fn camelize(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, v)| {
                    let mut out = String::with_capacity(key.len());
                    let mut upper = false;
                    for ch in key.chars() {
                        if ch == '_' {
                            upper = true;
                        } else if upper {
                            out.extend(ch.to_uppercase());
                            upper = false;
                        } else {
                            out.push(ch);
                        }
                    }
                    (out, v)
                })
                .collect(),
        ),
        other => other,
    }
}

#[derive(sqlx::FromRow)]
struct SnapshotDb {
    anki_card_id: i64,
    mapping_id: String,
    front: String,
    back: String,
    state: String,
    interval_days: i32,
    ease: f64,
    due_at: Option<DateTime<Utc>>,
    reps: i32,
    lapses: i32,
    is_leech: bool,
}

pub async fn anki_snapshots(app: &App, mapping_ids: &[String]) -> ApiResult<Vec<SnapshotRow>> {
    if mapping_ids.is_empty() {
        return Ok(vec![]);
    }
    let rows: Vec<SnapshotDb> = sqlx::query_as(
        "SELECT anki_card_id, mapping_id, front, back, state, interval_days, ease, due_at, reps, lapses, is_leech
         FROM anki_card_snapshots WHERE mapping_id = ANY($1)",
    )
    .bind(mapping_ids)
    .fetch_all(&app.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SnapshotRow {
            anki_card_id: r.anki_card_id.to_string(),
            mapping_id: Some(r.mapping_id),
            front: r.front,
            back: r.back,
            state: CardState::parse(&r.state),
            interval_days: r.interval_days,
            ease: r.ease,
            due_at: r.due_at,
            reps: r.reps,
            lapses: r.lapses,
            is_leech: r.is_leech,
        })
        .collect())
}

pub async fn anki_logs(app: &App, mapping_ids: &[String]) -> ApiResult<Vec<LogRow>> {
    if mapping_ids.is_empty() {
        return Ok(vec![]);
    }
    let rows: Vec<(i64, DateTime<Utc>, i32, i32, i32, i32)> = sqlx::query_as(
        "SELECT anki_card_id, reviewed_at, rating, interval_before_days, interval_after_days, time_ms
         FROM anki_review_logs WHERE mapping_id = ANY($1) ORDER BY reviewed_at",
    )
    .bind(mapping_ids)
    .fetch_all(&app.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(card, reviewed_at, rating, before, after, time_ms)| LogRow {
            anki_card_id: card.to_string(),
            reviewed_at,
            rating,
            interval_before_days: before,
            interval_after_days: after,
            time_ms: time_ms as i64,
        })
        .collect())
}

/// Anki cards due today or overdue (scheduled states), for a course or all.
pub async fn anki_due_today(app: &App, user: &User, course_id: Option<&str>) -> ApiResult<i64> {
    let end = kaizen_core::time::end_of_day(Utc::now(), user.tz);
    Ok(sqlx::query_scalar(
        "SELECT count(*) FROM anki_card_snapshots s JOIN anki_deck_mappings m ON m.id = s.mapping_id
         WHERE s.user_id = $1 AND s.due_at <= $2 AND s.state IN ('LEARNING', 'YOUNG', 'MATURE')
           AND ($3::text IS NULL OR m.course_id = $3)",
    )
    .bind(&user.id)
    .bind(end)
    .bind(course_id)
    .fetch_one(&app.db)
    .await?)
}

/// Grammar points per JLPT level: (total, mastered).
pub async fn grammar_by_level(app: &App, user: &User) -> ApiResult<HashMap<String, (i64, i64)>> {
    let rows: Vec<(Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT li.data->>'jlptLevel', count(*), count(*) FILTER (WHERE gp.status = 'MASTERED')
         FROM grammar_progress gp JOIN learning_items li ON li.id = gp.learning_item_id WHERE gp.user_id = $1 GROUP BY 1",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    Ok(rows.into_iter().map(|(level, total, mastered)| (level.unwrap_or_default(), (total, mastered))).collect())
}

/// JLPT levels with vocab targets and grammar counts (falls back to the
/// seeded grammar target when the curriculum has no points for a level).
pub async fn jlpt_levels(app: &App, user: &User) -> ApiResult<Vec<LevelState>> {
    let grammar = grammar_by_level(app, user).await?;
    let levels: Vec<(String, i32, Value)> = sqlx::query_as(
        "SELECT el.name, el.rank, el.targets FROM exam_levels el JOIN exams e ON e.id = el.exam_id JOIN courses c ON c.id = e.course_id
         WHERE c.user_id = $1 AND c.slug = 'japanese' AND e.slug = 'jlpt' ORDER BY el.rank",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    Ok(levels
        .into_iter()
        .map(|(name, rank, targets)| {
            let target = |k: &str| targets.get(k).and_then(Value::as_i64).unwrap_or(0);
            let (total, mastered) = grammar.get(&name).copied().unwrap_or((target("targetGrammar"), 0));
            LevelState { name, rank: rank as i64, target_vocab: target("targetVocab"), grammar_total: total, grammar_mastered: mastered }
        })
        .collect())
}

pub async fn known_words_lower(app: &App, user: &User, language: &str) -> ApiResult<i64> {
    Ok(crate::db::latest_word_stat(&app.db, &user.id, language).await?.map_or(0, |s| s.lower_bound as i64))
}

#[derive(sqlx::FromRow, Clone)]
pub struct NodeRow {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: Option<String>,
    pub branch: Option<String>,
    pub level: String,
    pub is_target: bool,
    pub status: String,
}

pub struct MathState {
    pub course_id: String,
    pub metadata: Value,
    pub nodes: Vec<NodeRow>,
    pub edges: Vec<Edge>,
    pub long_term: Vec<String>,
    pub current: Option<String>,
    pub active_goal: Option<(String, String)>,
}

impl MathState {
    pub fn graph_nodes(&self) -> Vec<Node> {
        self.nodes
            .iter()
            .map(|n| Node {
                id: n.id.clone(),
                slug: n.slug.clone(),
                title: n.title.clone(),
                status: n.status.clone(),
                branch: n.branch.clone(),
                level: n.level.clone(),
            })
            .collect()
    }
}

pub async fn math_state(app: &App, user: &User) -> ApiResult<Option<MathState>> {
    let Some((course_id, metadata)) = sqlx::query_as::<_, (String, Value)>(
        "SELECT id, metadata FROM courses WHERE user_id = $1 AND slug = 'math'",
    )
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?
    else {
        return Ok(None);
    };
    let Some(roadmap_id) = sqlx::query_scalar::<_, String>("SELECT id FROM roadmaps WHERE course_id = $1 AND slug = 'math-roadmap'")
        .bind(&course_id)
        .fetch_optional(&app.db)
        .await?
    else {
        return Ok(None);
    };
    let nodes: Vec<NodeRow> = sqlx::query_as(
        "SELECT id, slug, title, description, branch, level, is_target, status FROM roadmap_nodes WHERE roadmap_id = $1 ORDER BY ord",
    )
    .bind(&roadmap_id)
    .fetch_all(&app.db)
    .await?;
    let edges: Vec<Edge> = sqlx::query_as::<_, (String, String, String)>("SELECT from_node_id, to_node_id, kind FROM roadmap_edges WHERE roadmap_id = $1")
        .bind(&roadmap_id)
        .fetch_all(&app.db)
        .await?
        .into_iter()
        .map(|(from_node_id, to_node_id, kind)| Edge { from_node_id, to_node_id, kind })
        .collect();
    let active_goal: Option<(String, String)> = sqlx::query_as(
        "SELECT id, title FROM course_goals WHERE course_id = $1 AND status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(&course_id)
    .fetch_optional(&app.db)
    .await?;
    let targets: Vec<MathTarget> = nodes.iter().map(|n| MathTarget { slug: n.slug.clone(), title: n.title.clone(), is_target: n.is_target }).collect();
    let long_term = math_goals::long_term_target_slugs(&metadata, &targets);
    let long_term_targets: Vec<MathTarget> = targets.into_iter().filter(|t| long_term.contains(&t.slug)).collect();
    let current = math_goals::current_target_slug(&metadata, &long_term_targets, active_goal.as_ref().map(|(_, t)| t.as_str()));
    Ok(Some(MathState { course_id, metadata, nodes, edges, long_term, current, active_goal }))
}

#[derive(sqlx::FromRow)]
struct QueueDb {
    learning_item_id: String,
    status: String,
    curriculum_order: i32,
    due_at: DateTime<Utc>,
    introduced_at: Option<DateTime<Utc>>,
    is_leech: bool,
}

pub async fn grammar_queue_rows(app: &App, user: &User) -> ApiResult<Vec<QueueRow>> {
    let rows: Vec<QueueDb> = sqlx::query_as(
        "SELECT learning_item_id, status, curriculum_order, due_at, introduced_at, is_leech FROM grammar_progress WHERE user_id = $1",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| QueueRow {
            learning_item_id: r.learning_item_id,
            status: Status::parse(&r.status),
            curriculum_order: r.curriculum_order as i64,
            due_at: r.due_at,
            introduced_at: r.introduced_at,
            is_leech: r.is_leech,
        })
        .collect())
}

/// Ownership check helper: does this course belong to the user?
pub async fn owns_course(app: &App, user: &User, course_id: &str) -> ApiResult<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM courses WHERE id = $1 AND user_id = $2)")
        .bind(course_id)
        .bind(&user.id)
        .fetch_one(&app.db)
        .await?)
}

//! Math roadmap: the layered tree, readiness, closures, and status cycling.

use std::collections::HashSet;

use axum::Json;
use axum::extract::{Path, Query, State};
use kaizen_core::roadmap::{self, Node};
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::{MathState, math_state};
use crate::auth::User;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

/// Readiness and per-target progress (recomputed after every status change).
fn progress_bundle(math: &MathState, nodes: &[Node]) -> Value {
    let ready: Vec<String> = roadmap::ready_set(nodes, &math.edges).into_iter().collect();
    let done = nodes.iter().filter(|n| n.status == "COMPLETED").count();
    let targets: serde_json::Map<String, Value> = math
        .nodes
        .iter()
        .filter(|n| math.long_term.contains(&n.slug))
        .map(|n| {
            let p = roadmap::path_progress(&n.id, nodes, &math.edges);
            (n.slug.clone(), json!({ "done": p.done, "total": p.total, "pct": p.pct }))
        })
        .collect();
    json!({
        "statuses": nodes.iter().map(|n| (n.id.clone(), Value::String(n.status.clone()))).collect::<serde_json::Map<_, _>>(),
        "ready": ready,
        "full": { "done": done, "total": nodes.len() },
        "targets": targets,
    })
}

#[derive(Deserialize)]
pub struct MathQuery {
    target: Option<String>,
}

pub async fn page(State(app): State<App>, user: User, Query(query): Query<MathQuery>) -> ApiResult<Json<Value>> {
    let math = math_state(&app, &user).await?.ok_or_else(|| ApiError::not_found("Math course"))?;
    let nodes = math.graph_nodes();
    let refs: Vec<&Node> = nodes.iter().collect();
    let long_term: HashSet<&str> = math.long_term.iter().map(String::as_str).collect();
    let core: Vec<&Node> = nodes.iter().filter(|n| n.level == "FOUNDATION" || n.level == "CORE").collect();
    let mut target_views = serde_json::Map::new();
    for node in nodes.iter().filter(|n| long_term.contains(n.slug.as_str())) {
        let path = roadmap::path_to_target(&node.id, &nodes, &math.edges);
        target_views.insert(
            node.slug.clone(),
            json!({ "layers": roadmap::layers(&path, &math.edges), "order": path.iter().map(|n| n.id.clone()).collect::<Vec<_>>() }),
        );
    }
    let counts: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM learning_items WHERE course_id = $1),
                (SELECT count(*) FROM mistakes WHERE course_id = $1)",
    )
    .bind(&math.course_id)
    .fetch_one(&app.db)
    .await?;
    let schemas: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT s.slug, s.name, s.item_type, count(li.id) FROM content_schemas s LEFT JOIN learning_items li ON li.schema_id = s.id
         WHERE s.course_id = $1 GROUP BY s.id ORDER BY s.name",
    )
    .bind(&math.course_id)
    .fetch_all(&app.db)
    .await?;
    let description: Option<String> = sqlx::query_scalar("SELECT description FROM courses WHERE id = $1")
        .bind(&math.course_id)
        .fetch_one(&app.db)
        .await?;
    let initial = query.target.filter(|t| long_term.contains(t.as_str())).or_else(|| math.current.clone());
    let current_title = math.current.as_ref().and_then(|slug| math.nodes.iter().find(|n| &n.slug == slug)).map(|n| n.title.clone());
    let in_progress = nodes.iter().filter(|n| n.status == "IN_PROGRESS").count();

    Ok(Json(json!({
        "course": { "id": math.course_id, "description": description },
        "stats": {
            "completed": nodes.iter().filter(|n| n.status == "COMPLETED").count(),
            "inProgress": in_progress, "nodes": nodes.len(), "items": counts.0, "mistakes": counts.1,
        },
        "current": math.current.as_ref().map(|slug| json!({ "slug": slug, "title": current_title })),
        "initialTarget": initial,
        "nodes": math.nodes.iter().map(|n| json!({
            "id": n.id, "slug": n.slug, "title": n.title, "status": n.status, "branch": n.branch, "level": n.level,
            "isTarget": long_term.contains(n.slug.as_str()), "description": n.description,
        })).collect::<Vec<_>>(),
        "edges": math.edges,
        "views": {
            "full": roadmap::layers(&refs, &math.edges),
            "core": roadmap::layers(&core, &math.edges),
            "targets": target_views,
        },
        "ancestors": roadmap::ancestors(&nodes, &math.edges),
        "progress": progress_bundle(&math, &nodes),
        "schemas": schemas.into_iter().map(|(slug, name, item_type, count)| json!({ "slug": slug, "name": name, "itemType": item_type, "items": count })).collect::<Vec<_>>(),
    })))
}

pub async fn cycle_node(State(app): State<App>, user: User, Path(node_id): Path<String>) -> ApiResult<Json<Value>> {
    let status: Option<String> = sqlx::query_scalar(
        "SELECT n.status FROM roadmap_nodes n JOIN roadmaps r ON r.id = n.roadmap_id JOIN courses c ON c.id = r.course_id
         WHERE n.id = $1 AND c.user_id = $2",
    )
    .bind(&node_id)
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?;
    let current = status.ok_or_else(|| ApiError::not_found("Roadmap node"))?;
    let next = roadmap::next_status(&current);
    sqlx::query("UPDATE roadmap_nodes SET status = $2 WHERE id = $1").bind(&node_id).bind(next).execute(&app.db).await?;
    let math = math_state(&app, &user).await?.ok_or_else(|| ApiError::not_found("Math course"))?;
    let nodes = math.graph_nodes();
    Ok(Json(json!({ "status": next, "progress": progress_bundle(&math, &nodes) })))
}

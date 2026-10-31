//! Concepts: the prerequisite graph, sources linked at unit level (an episode,
//! a page range, a problem set), and the Anki cards tagged to each concept.

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Utc};
use kaizen_core::anki_analytics::LogRow;
use kaizen_core::concepts::{self as cx, Coverage, SourceKind};
use kaizen_core::roadmap::{self, Node};
use kaizen_core::util::js_round_i64;
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::ok;
use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

#[derive(sqlx::FromRow)]
struct ConceptRow {
    id: String,
    subject: String,
    slug: String,
    title: String,
    summary: Option<String>,
    roadmap_node_id: Option<String>,
    course_slug: Option<String>,
    course_title: Option<String>,
}

impl ConceptRow {
    fn tag(&self) -> String {
        cx::tag(&self.subject, &self.slug)
    }
}

#[derive(sqlx::FromRow)]
struct SourceRow {
    id: String,
    concept_id: String,
    youtube_playlist_id: Option<String>,
    youtube_video_id: Option<String>,
    book_id: Option<String>,
    url: Option<String>,
    label: String,
    role: String,
    range_start: Option<i32>,
    range_end: Option<i32>,
    status: String,
    suggested_by: Option<String>,
    progress_done: Option<i32>,
    progress_total: Option<i32>,
    playlist_title: Option<String>,
    video_title: Option<String>,
    video_position: Option<i32>,
    duration_seconds: Option<i32>,
    watched_seconds: Option<i32>,
    completed: Option<bool>,
    book_title: Option<String>,
    book_author: Option<String>,
    book_page_count: Option<i32>,
    book_status: Option<String>,
    book_current_page: Option<i32>,
}

const SOURCE_SELECT: &str = "
    SELECT s.id, s.concept_id, s.youtube_playlist_id, s.youtube_video_id, s.book_id, s.url, s.label, s.role,
           s.range_start, s.range_end, s.status, s.suggested_by, s.progress_done, s.progress_total,
           p.title AS playlist_title, i.title AS video_title, i.position AS video_position, i.duration_seconds,
           i.watched_seconds, i.completed,
           b.title AS book_title, b.author AS book_author, b.page_count AS book_page_count, b.status AS book_status,
           (SELECT max(r.end_page) FROM book_reading_sessions r WHERE r.book_id = b.id) AS book_current_page
    FROM concept_sources s
    JOIN concepts c ON c.id = s.concept_id
    LEFT JOIN youtube_playlists p ON p.id = s.youtube_playlist_id
    LEFT JOIN LATERAL (
        SELECT title, position, duration_seconds, watched_seconds, completed FROM youtube_playlist_items
        WHERE playlist_id = s.youtube_playlist_id AND youtube_video_id = s.youtube_video_id ORDER BY position LIMIT 1
    ) i ON true
    LEFT JOIN books b ON b.id = s.book_id
    WHERE c.user_id = $1";

impl SourceRow {
    fn kind(&self) -> SourceKind {
        if self.youtube_playlist_id.is_some() {
            SourceKind::Video
        } else if self.book_id.is_some() {
            SourceKind::Book
        } else {
            SourceKind::Link
        }
    }

    fn progress(&self) -> f64 {
        let (start, end) = (self.range_start.map(i64::from), self.range_end.map(i64::from));
        if self.progress_total.is_some() {
            return cx::manual_progress(self.progress_done.map(i64::from), self.progress_total.map(i64::from));
        }
        match self.kind() {
            SourceKind::Video => cx::video_progress(
                start,
                end,
                self.duration_seconds.map(i64::from),
                self.watched_seconds.unwrap_or(0).into(),
                self.completed.unwrap_or(false),
            ),
            SourceKind::Book => cx::book_progress(
                start,
                end,
                self.book_current_page.map(i64::from),
                self.book_page_count.map(i64::from),
                self.book_status.as_deref() == Some("FINISHED"),
            ),
            SourceKind::Link => 0.0,
        }
    }

    fn view(&self) -> Value {
        let kind = self.kind();
        let progress = self.progress();
        let (kind_name, title) = match kind {
            SourceKind::Video => ("video", self.playlist_title.clone()),
            SourceKind::Book => ("book", self.book_title.clone()),
            SourceKind::Link => ("link", self.url.as_deref().and_then(|u| url::Url::parse(u).ok()).and_then(|u| u.host_str().map(str::to_string))),
        };
        json!({
            "id": self.id, "conceptId": self.concept_id, "kind": kind_name, "role": self.role, "status": self.status,
            "suggestedBy": self.suggested_by, "label": self.label, "title": title,
            "range": cx::format_range(kind, self.range_start.map(i64::from), self.range_end.map(i64::from)),
            "rangeStart": self.range_start, "rangeEnd": self.range_end,
            "playlistId": self.youtube_playlist_id, "videoId": self.youtube_video_id, "videoTitle": self.video_title,
            "videoPosition": self.video_position, "missing": kind == SourceKind::Video && self.video_title.is_none(),
            "bookId": self.book_id, "author": self.book_author, "url": self.url,
            "progress": { "pct": js_round_i64(progress * 100.0), "done": self.progress_done, "total": self.progress_total },
            "finished": progress >= 1.0,
        })
    }
}

/// Everything a user has: concepts, prerequisite edges, and sources.
struct Graph {
    concepts: Vec<ConceptRow>,
    edges: Vec<(String, String)>,
    sources: Vec<SourceRow>,
}

impl Graph {
    fn coverage(&self) -> HashMap<&str, Coverage> {
        let mut progress: HashMap<&str, Vec<f64>> = HashMap::new();
        for s in self.sources.iter().filter(|s| s.status == "LINKED") {
            progress.entry(s.concept_id.as_str()).or_default().push(s.progress());
        }
        self.concepts.iter().map(|c| (c.id.as_str(), cx::coverage(progress.get(c.id.as_str()).map_or(&[][..], Vec::as_slice)))).collect()
    }

    /// Ordered layers for a subset of concepts, coloured by coverage.
    fn layers(&self, ids: &HashSet<String>, coverage: &HashMap<&str, Coverage>) -> Vec<Vec<String>> {
        let nodes: Vec<Node> = self
            .concepts
            .iter()
            .filter(|c| ids.contains(&c.id))
            .map(|c| Node {
                id: c.id.clone(),
                slug: c.slug.clone(),
                title: c.title.clone(),
                status: coverage.get(c.id.as_str()).copied().unwrap_or(Coverage::NotCovered).as_str().into(),
                branch: None,
                level: "CORE".into(),
            })
            .collect();
        let edges: Vec<roadmap::Edge> = self
            .edges
            .iter()
            .map(|(from, to)| roadmap::Edge { from_node_id: from.clone(), to_node_id: to.clone(), kind: "PREREQUISITE".into() })
            .collect();
        let refs: Vec<&Node> = nodes.iter().collect();
        roadmap::layers(&refs, &edges)
    }
}

async fn load_graph(app: &App, user: &User) -> ApiResult<Graph> {
    let concepts: Vec<ConceptRow> = sqlx::query_as(
        "SELECT c.id, c.subject, c.slug, c.title, c.summary, c.roadmap_node_id, n.slug AS course_slug, n.title AS course_title
         FROM concepts c LEFT JOIN roadmap_nodes n ON n.id = c.roadmap_node_id
         WHERE c.user_id = $1 ORDER BY c.subject, c.ord, c.title",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let edges: Vec<(String, String)> = sqlx::query_as(
        "SELECT e.from_concept_id, e.to_concept_id FROM concept_edges e JOIN concepts c ON c.id = e.to_concept_id
         WHERE c.user_id = $1 AND e.kind = 'PREREQUISITE'",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let sources: Vec<SourceRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!("{SOURCE_SELECT} ORDER BY s.created_at"))).bind(&user.id).fetch_all(&app.db).await?;
    Ok(Graph { concepts, edges, sources })
}

/// Anki cards carrying a concept tag, keyed by (subject, slug): card id and next due.
async fn tagged_cards(app: &App, user: &User) -> ApiResult<HashMap<(String, String), Vec<(i64, Option<DateTime<Utc>>)>>> {
    let rows: Vec<(i64, Option<DateTime<Utc>>, String, String)> = sqlx::query_as(
        "SELECT s.anki_card_id, s.due_at, s.state, t.tag FROM anki_card_snapshots s, unnest(s.tags) AS t(tag)
         WHERE s.user_id = $1 AND lower(t.tag) LIKE 'concept::%'",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let mut map: HashMap<(String, String), Vec<(i64, Option<DateTime<Utc>>)>> = HashMap::new();
    for (card, due, state, tag) in rows {
        if let Some(key) = cx::parse_tag(&tag) {
            let due = due.filter(|_| state != "SUSPENDED" && state != "NEW");
            let cards = map.entry(key).or_default();
            if !cards.iter().any(|(id, _)| *id == card) {
                cards.push((card, due));
            }
        }
    }
    Ok(map)
}

/// The last 60 days of reviews for these cards, by card.
async fn recent_logs(app: &App, user: &User, card_ids: &[i64]) -> ApiResult<HashMap<i64, Vec<LogRow>>> {
    if card_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(i64, DateTime<Utc>, i32, i32, i32, i32)> = sqlx::query_as(
        "SELECT anki_card_id, reviewed_at, rating, interval_before_days, interval_after_days, time_ms FROM anki_review_logs
         WHERE user_id = $1 AND anki_card_id = ANY($2) AND reviewed_at > now() - interval '60 days' AND rating > 0",
    )
    .bind(&user.id)
    .bind(card_ids)
    .fetch_all(&app.db)
    .await?;
    let mut map: HashMap<i64, Vec<LogRow>> = HashMap::new();
    for (card, at, rating, before, after, time_ms) in rows {
        map.entry(card).or_default().push(LogRow {
            anki_card_id: card.to_string(),
            reviewed_at: at,
            rating,
            interval_before_days: before,
            interval_after_days: after,
            time_ms: time_ms.into(),
        });
    }
    Ok(map)
}

fn memory_for(cards: &[(i64, Option<DateTime<Utc>>)], logs: &HashMap<i64, Vec<LogRow>>) -> cx::CardMemory {
    let due: Vec<Option<DateTime<Utc>>> = cards.iter().map(|(_, d)| *d).collect();
    let rows: Vec<LogRow> = cards.iter().flat_map(|(id, _)| logs.get(id).cloned().unwrap_or_default()).collect();
    cx::card_memory(cards.len(), &due, &rows, Utc::now())
}

pub async fn list(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let graph = load_graph(&app, &user).await?;
    let coverage = graph.coverage();
    let cards = tagged_cards(&app, &user).await?;
    let all_cards: Vec<i64> = cards.values().flatten().map(|(id, _)| *id).collect();
    let logs = recent_logs(&app, &user, &all_cards).await?;

    let mut subjects: Vec<&str> = graph.concepts.iter().map(|c| c.subject.as_str()).collect();
    subjects.dedup();
    let starters = cx::starter_maps();
    let subject_views: Vec<Value> = subjects
        .iter()
        .map(|subject| {
            let members: Vec<&ConceptRow> = graph.concepts.iter().filter(|c| c.subject == *subject).collect();
            let ids: HashSet<String> = members.iter().map(|c| c.id.clone()).collect();
            let title = starters
                .iter()
                .find(|s| s.subject == *subject)
                .map(|s| s.title.clone())
                .or_else(|| members.iter().find_map(|c| c.course_title.clone()))
                .unwrap_or_else(|| subject.to_string());
            json!({
                "subject": subject,
                "title": title,
                "concepts": members.iter().map(|c| {
                    let tagged = cards.get(&(c.subject.clone(), c.slug.clone())).map_or(&[][..], Vec::as_slice);
                    let memory = memory_for(tagged, &logs);
                    let linked = graph.sources.iter().filter(|s| s.concept_id == c.id && s.status == "LINKED").count();
                    let suggested = graph.sources.iter().filter(|s| s.concept_id == c.id && s.status == "SUGGESTED").count();
                    json!({
                        "id": c.id, "slug": c.slug, "title": c.title, "tag": c.tag(), "coverage": coverage[c.id.as_str()],
                        "sources": linked, "suggestions": suggested, "cards": memory.cards,
                        "rememberingPct": memory.remembering_pct, "weak": memory.weak,
                    })
                }).collect::<Vec<_>>(),
                "edges": graph.edges.iter().filter(|(a, b)| ids.contains(a) && ids.contains(b)).map(|(a, b)| json!([a, b])).collect::<Vec<_>>(),
                "layers": graph.layers(&ids, &coverage),
            })
        })
        .collect();
    let installed: HashSet<&str> = subjects.iter().copied().collect();
    Ok(Json(json!({
        "subjects": subject_views,
        "starters": starters.iter().map(|s| json!({
            "key": s.key, "subject": s.subject, "title": s.title, "description": s.description,
            "concepts": s.concepts.len(), "installed": installed.contains(s.subject.as_str()),
        })).collect::<Vec<_>>(),
    })))
}

pub async fn detail(State(app): State<App>, user: User, Path(concept_id): Path<String>) -> ApiResult<Json<Value>> {
    let graph = load_graph(&app, &user).await?;
    let concept = graph.concepts.iter().find(|c| c.id == concept_id).ok_or_else(|| ApiError::not_found("Concept"))?;
    let coverage = graph.coverage();
    let by_id: HashMap<&str, &ConceptRow> = graph.concepts.iter().map(|c| (c.id.as_str(), c)).collect();

    let own: Vec<&SourceRow> = graph.sources.iter().filter(|s| s.concept_id == concept.id).collect();
    let linked: Vec<Value> = cx::ROLES
        .iter()
        .filter_map(|role| {
            let group: Vec<Value> = own.iter().filter(|s| s.status == "LINKED" && s.role == *role).map(|s| s.view()).collect();
            (!group.is_empty()).then(|| json!({ "role": role, "sources": group }))
        })
        .collect();
    let suggested: Vec<Value> = own.iter().filter(|s| s.status == "SUGGESTED").map(|s| s.view()).collect();
    // What to revisit when the cards slip: an intuition source first, then any video.
    let rewatch = own
        .iter()
        .filter(|s| s.status == "LINKED")
        .min_by_key(|s| (s.role != "INTUITION", s.kind() != SourceKind::Video))
        .map(|s| s.view());

    let cards = tagged_cards(&app, &user).await?;
    let tagged = cards.get(&(concept.subject.clone(), concept.slug.clone())).cloned().unwrap_or_default();
    let ids: Vec<i64> = tagged.iter().map(|(id, _)| *id).collect();
    let logs = recent_logs(&app, &user, &ids).await?;
    let memory = memory_for(&tagged, &logs);

    let near = cx::neighbourhood(&concept.id, &graph.edges, 2, 1);
    let brief = |id: &str| {
        by_id.get(id).map(|c| json!({ "id": c.id, "slug": c.slug, "title": c.title, "coverage": coverage[c.id.as_str()] }))
    };
    Ok(Json(json!({
        "concept": {
            "id": concept.id, "subject": concept.subject, "slug": concept.slug, "title": concept.title, "summary": concept.summary,
            "tag": concept.tag(), "coverage": coverage[concept.id.as_str()],
            "course": concept.roadmap_node_id.as_ref().map(|id| json!({ "id": id, "slug": concept.course_slug, "title": concept.course_title })),
        },
        "sources": { "linked": linked, "suggested": suggested },
        "rewatch": if memory.weak { rewatch } else { None },
        "memory": memory,
        "prerequisites": graph.edges.iter().filter(|(_, to)| *to == concept.id).filter_map(|(from, _)| brief(from)).collect::<Vec<_>>(),
        "unlocks": graph.edges.iter().filter(|(from, _)| *from == concept.id).filter_map(|(_, to)| brief(to)).collect::<Vec<_>>(),
        "map": {
            "nodes": near.iter().filter_map(|id| brief(id)).collect::<Vec<_>>(),
            "edges": graph.edges.iter().filter(|(a, b)| near.contains(a) && near.contains(b)).map(|(a, b)| json!([a, b])).collect::<Vec<_>>(),
            "layers": graph.layers(&near, &coverage),
        },
    })))
}

async fn owned_concept(app: &App, user: &User, concept_id: &str) -> ApiResult<(String, String)> {
    sqlx::query_as("SELECT subject, slug FROM concepts WHERE id = $1 AND user_id = $2")
        .bind(concept_id)
        .bind(&user.id)
        .fetch_optional(&app.db)
        .await?
        .ok_or_else(|| ApiError::not_found("Concept"))
}

fn clean(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConcept {
    subject: String,
    title: String,
    slug: Option<String>,
    summary: Option<String>,
    #[serde(default)]
    prerequisite_ids: Vec<String>,
}

pub async fn create(State(app): State<App>, user: User, Json(body): Json<NewConcept>) -> ApiResult<Json<Value>> {
    let title = body.title.trim();
    if title.is_empty() {
        return Err(ApiError::bad("A title is required."));
    }
    let subject = cx::clean_slug(&body.subject).ok_or_else(|| ApiError::bad("Name the subject in Latin letters or digits, like linalg."))?;
    let slug = cx::clean_slug(body.slug.as_deref().unwrap_or(title))
        .ok_or_else(|| ApiError::bad("Give the concept a short slug in Latin letters or digits; it becomes the Anki tag."))?;
    // Same subject's course, if another concept in it already has one.
    let node: Option<String> = sqlx::query_scalar(
        "SELECT roadmap_node_id FROM concepts WHERE user_id = $1 AND subject = $2 AND roadmap_node_id IS NOT NULL LIMIT 1",
    )
    .bind(&user.id)
    .bind(&subject)
    .fetch_optional(&app.db)
    .await?;
    let id = new_id();
    let mut tx = app.db.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO concepts (id, user_id, subject, slug, title, summary, roadmap_node_id, ord)
         VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(max(ord) + 1, 0) FROM concepts WHERE user_id = $2 AND subject = $3))
         ON CONFLICT (user_id, subject, slug) DO NOTHING",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&subject)
    .bind(&slug)
    .bind(title)
    .bind(clean(body.summary))
    .bind(node)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(ApiError::bad(format!("You already have {} in {subject}.", cx::tag(&subject, &slug))));
    }
    // A new concept has no dependants yet, so its prerequisites cannot form a cycle.
    let edges: Vec<Value> = body.prerequisite_ids.iter().map(|from| json!({ "id": new_id(), "from": from })).collect();
    sqlx::query(
        "INSERT INTO concept_edges (id, from_concept_id, to_concept_id)
         SELECT x->>'id', c.id, $1 FROM jsonb_array_elements($2::jsonb) x JOIN concepts c ON c.id = x->>'from' AND c.user_id = $3
         ON CONFLICT DO NOTHING",
    )
    .bind(&id)
    .bind(Value::Array(edges))
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "tag": cx::tag(&subject, &slug) })))
}

#[derive(Deserialize)]
pub struct UpdateConcept {
    title: Option<String>,
    summary: Option<String>,
}

/// Title and summary only: the slug is the Anki tag, so it never changes.
pub async fn update(State(app): State<App>, user: User, Path(concept_id): Path<String>, Json(body): Json<UpdateConcept>) -> ApiResult<Json<Value>> {
    owned_concept(&app, &user, &concept_id).await?;
    if let Some(title) = clean(body.title) {
        sqlx::query("UPDATE concepts SET title = $2, updated_at = now() WHERE id = $1").bind(&concept_id).bind(title).execute(&app.db).await?;
    }
    if let Some(summary) = body.summary {
        sqlx::query("UPDATE concepts SET summary = $2, updated_at = now() WHERE id = $1")
            .bind(&concept_id)
            .bind(clean(Some(summary)))
            .execute(&app.db)
            .await?;
    }
    Ok(ok())
}

pub async fn remove(State(app): State<App>, user: User, Path(concept_id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM concepts WHERE id = $1 AND user_id = $2").bind(&concept_id).bind(&user.id).execute(&app.db).await?;
    Ok(ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPrerequisite {
    concept_id: String,
}

pub async fn add_prerequisite(
    State(app): State<App>,
    user: User,
    Path(concept_id): Path<String>,
    Json(body): Json<NewPrerequisite>,
) -> ApiResult<Json<Value>> {
    owned_concept(&app, &user, &concept_id).await?;
    owned_concept(&app, &user, &body.concept_id).await?;
    let edges: Vec<(String, String)> = sqlx::query_as(
        "SELECT e.from_concept_id, e.to_concept_id FROM concept_edges e JOIN concepts c ON c.id = e.to_concept_id
         WHERE c.user_id = $1 AND e.kind = 'PREREQUISITE'",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    if cx::would_cycle(&edges, &body.concept_id, &concept_id) {
        return Err(ApiError::bad("That would make a loop: this concept is already needed for that one."));
    }
    sqlx::query("INSERT INTO concept_edges (id, from_concept_id, to_concept_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(new_id())
        .bind(&body.concept_id)
        .bind(&concept_id)
        .execute(&app.db)
        .await?;
    Ok(ok())
}

pub async fn remove_prerequisite(
    State(app): State<App>,
    user: User,
    Path((concept_id, prerequisite_id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    owned_concept(&app, &user, &concept_id).await?;
    sqlx::query("DELETE FROM concept_edges WHERE from_concept_id = $1 AND to_concept_id = $2")
        .bind(&prerequisite_id)
        .bind(&concept_id)
        .execute(&app.db)
        .await?;
    Ok(ok())
}

fn check_range(start: Option<i64>, end: Option<i64>) -> ApiResult<(Option<i32>, Option<i32>)> {
    let fit = |v: Option<i64>| v.map(|v| i32::try_from(v).map_err(|_| ApiError::bad("That range is too large."))).transpose();
    let (start, end) = (fit(start)?, fit(end)?);
    if start.is_some_and(|s| s < 0) || end.is_some_and(|e| e < 0) {
        return Err(ApiError::bad("Ranges start at zero."));
    }
    if let (Some(s), Some(e)) = (start, end)
        && e < s
    {
        return Err(ApiError::bad("The range ends before it starts."));
    }
    Ok((start, end))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSource {
    playlist_id: Option<String>,
    video_id: Option<String>,
    book_id: Option<String>,
    url: Option<String>,
    label: Option<String>,
    role: Option<String>,
    range_start: Option<i64>,
    range_end: Option<i64>,
    progress_total: Option<i32>,
    /// Who proposed it ('ai', 'title'); sets the link to SUGGESTED.
    suggested_by: Option<String>,
}

pub async fn add_source(State(app): State<App>, user: User, Path(concept_id): Path<String>, Json(body): Json<NewSource>) -> ApiResult<Json<Value>> {
    owned_concept(&app, &user, &concept_id).await?;
    let role = body.role.filter(|r| cx::is_role(r)).unwrap_or_else(|| "LECTURE".into());
    let (start, end) = check_range(body.range_start, body.range_end)?;
    let label = clean(body.label);
    let (playlist, video, book, url, default_label) = match (body.playlist_id, body.video_id, body.book_id, clean(body.url)) {
        (Some(playlist), Some(video), None, None) => {
            let title: Option<String> = sqlx::query_scalar(
                "SELECT i.title FROM youtube_playlist_items i JOIN youtube_playlists p ON p.id = i.playlist_id
                 WHERE p.id = $1 AND p.user_id = $2 AND i.youtube_video_id = $3 ORDER BY i.position LIMIT 1",
            )
            .bind(&playlist)
            .bind(&user.id)
            .bind(&video)
            .fetch_optional(&app.db)
            .await?;
            let title = title.ok_or_else(|| ApiError::not_found("Video in that playlist"))?;
            (Some(playlist), Some(video), None, None, title)
        }
        (None, None, Some(book), None) => {
            let title: Option<String> = sqlx::query_scalar("SELECT title FROM books WHERE id = $1 AND user_id = $2")
                .bind(&book)
                .bind(&user.id)
                .fetch_optional(&app.db)
                .await?;
            let title = title.ok_or_else(|| ApiError::not_found("Book"))?;
            let pages = cx::format_range(SourceKind::Book, start.map(i64::from), end.map(i64::from));
            (None, None, Some(book), None, pages.unwrap_or(title))
        }
        (None, None, None, Some(link)) => {
            let parsed = url::Url::parse(&link).ok().filter(|u| matches!(u.scheme(), "http" | "https"));
            let host = parsed.and_then(|u| u.host_str().map(str::to_string)).ok_or_else(|| ApiError::bad("Paste a full http or https link."))?;
            (None, None, None, Some(link), host)
        }
        _ => return Err(ApiError::bad("Link one thing: a video in a playlist, a book, or a web link.")),
    };
    let suggested_by = clean(body.suggested_by);
    let id = new_id();
    sqlx::query(
        "INSERT INTO concept_sources (id, concept_id, youtube_playlist_id, youtube_video_id, book_id, url, label, role,
           range_start, range_end, status, suggested_by, progress_done, progress_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $13::int IS NULL THEN NULL ELSE 0 END, $13)",
    )
    .bind(&id)
    .bind(&concept_id)
    .bind(playlist)
    .bind(video)
    .bind(book)
    .bind(url)
    .bind(label.unwrap_or(default_label))
    .bind(role)
    .bind(start)
    .bind(end)
    .bind(if suggested_by.is_some() { "SUGGESTED" } else { "LINKED" })
    .bind(suggested_by)
    .bind(body.progress_total.filter(|t| *t > 0))
    .execute(&app.db)
    .await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSource {
    label: Option<String>,
    role: Option<String>,
    status: Option<String>,
    /// [start, end]; send [null, null] to clear the range.
    range: Option<[Option<i64>; 2]>,
    progress_done: Option<i32>,
    /// 0 stops tracking progress by hand.
    progress_total: Option<i32>,
}

pub async fn update_source(State(app): State<App>, user: User, Path(source_id): Path<String>, Json(body): Json<UpdateSource>) -> ApiResult<Json<Value>> {
    let owned: Option<String> = sqlx::query_scalar(
        "SELECT s.id FROM concept_sources s JOIN concepts c ON c.id = s.concept_id WHERE s.id = $1 AND c.user_id = $2",
    )
    .bind(&source_id)
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await?;
    owned.ok_or_else(|| ApiError::not_found("Linked source"))?;
    let range = body.range.map(|[s, e]| check_range(s, e)).transpose()?;
    sqlx::query(
        "UPDATE concept_sources SET
           label = COALESCE($2, label),
           role = COALESCE($3, role),
           status = COALESCE($4, status),
           range_start = CASE WHEN $5 THEN $6 ELSE range_start END,
           range_end = CASE WHEN $5 THEN $7 ELSE range_end END,
           progress_total = CASE WHEN $9::int IS NULL THEN progress_total WHEN $9 = 0 THEN NULL ELSE $9 END,
           progress_done = CASE WHEN $9 = 0 THEN NULL
                                WHEN $8::int IS NOT NULL THEN GREATEST(0, LEAST($8, COALESCE(NULLIF($9, 0), progress_total, $8)))
                                WHEN $9::int IS NOT NULL THEN COALESCE(progress_done, 0)
                                ELSE progress_done END,
           updated_at = now()
         WHERE id = $1",
    )
    .bind(&source_id)
    .bind(clean(body.label))
    .bind(body.role.filter(|r| cx::is_role(r)))
    .bind(body.status.filter(|s| cx::STATUSES.contains(&s.as_str())))
    .bind(range.is_some())
    .bind(range.and_then(|r| r.0))
    .bind(range.and_then(|r| r.1))
    .bind(body.progress_done)
    .bind(body.progress_total.map(|t| t.max(0)))
    .execute(&app.db)
    .await?;
    Ok(ok())
}

pub async fn remove_source(State(app): State<App>, user: User, Path(source_id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM concept_sources s USING concepts c WHERE s.id = $1 AND c.id = s.concept_id AND c.user_id = $2")
        .bind(&source_id)
        .bind(&user.id)
        .execute(&app.db)
        .await?;
    Ok(ok())
}

/// Add a bundled starter map. Concepts the learner already has are kept as they are.
pub async fn install_starter(State(app): State<App>, user: User, Path(key): Path<String>) -> ApiResult<Json<Value>> {
    let map = cx::starter_maps().into_iter().find(|m| m.key == key).ok_or_else(|| ApiError::not_found("Starter map"))?;
    let node: Option<String> = match &map.roadmap_node {
        Some(slug) => {
            sqlx::query_scalar(
                "SELECT n.id FROM roadmap_nodes n JOIN roadmaps r ON r.id = n.roadmap_id JOIN courses c ON c.id = r.course_id
                 WHERE c.user_id = $1 AND n.slug = $2 LIMIT 1",
            )
            .bind(&user.id)
            .bind(slug)
            .fetch_optional(&app.db)
            .await?
        }
        None => None,
    };
    let concepts: Vec<Value> = map
        .concepts
        .iter()
        .enumerate()
        .map(|(i, c)| json!({ "id": new_id(), "slug": c.slug, "title": c.title, "summary": c.summary, "ord": i }))
        .collect();
    let edges: Vec<Value> = map.edges.iter().map(|(from, to)| json!({ "id": new_id(), "from": from, "to": to })).collect();
    let mut tx = app.db.begin().await?;
    let added = sqlx::query(
        "INSERT INTO concepts (id, user_id, subject, slug, title, summary, roadmap_node_id, starter, ord)
         SELECT x->>'id', $1, $2, x->>'slug', x->>'title', x->>'summary', $3, $4, (x->>'ord')::int FROM jsonb_array_elements($5::jsonb) x
         ON CONFLICT (user_id, subject, slug) DO NOTHING",
    )
    .bind(&user.id)
    .bind(&map.subject)
    .bind(node)
    .bind(&map.key)
    .bind(Value::Array(concepts))
    .execute(&mut *tx)
    .await?
    .rows_affected();
    sqlx::query(
        "INSERT INTO concept_edges (id, from_concept_id, to_concept_id)
         SELECT x->>'id', a.id, b.id FROM jsonb_array_elements($3::jsonb) x
         JOIN concepts a ON a.user_id = $1 AND a.subject = $2 AND a.slug = x->>'from'
         JOIN concepts b ON b.user_id = $1 AND b.subject = $2 AND b.slug = x->>'to'
         ON CONFLICT DO NOTHING",
    )
    .bind(&user.id)
    .bind(&map.subject)
    .bind(Value::Array(edges))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "subject": map.subject, "added": added })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinksQuery {
    playlist_id: Option<String>,
    book_id: Option<String>,
}

/// Concept chips for a source's units: by video id for a playlist, as a list for a book.
pub async fn links(State(app): State<App>, user: User, Query(query): Query<LinksQuery>) -> ApiResult<Json<Value>> {
    let (filter, target) = match (query.playlist_id, query.book_id) {
        (Some(p), None) => ("s.youtube_playlist_id", p),
        (None, Some(b)) => ("s.book_id", b),
        _ => return Err(ApiError::bad("Ask for one playlist or one book.")),
    };
    let rows: Vec<SourceRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SOURCE_SELECT} AND {filter} = $2 AND s.status <> 'DISMISSED' ORDER BY s.range_start NULLS FIRST"
    )))
        .bind(&user.id)
        .bind(&target)
        .fetch_all(&app.db)
        .await?;
    let titles: HashMap<String, (String, String)> = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id, title, subject FROM concepts WHERE user_id = $1 AND id = ANY($2)",
    )
    .bind(&user.id)
    .bind(rows.iter().map(|r| r.concept_id.clone()).collect::<Vec<_>>())
    .fetch_all(&app.db)
    .await?
    .into_iter()
    .map(|(id, title, subject)| (id, (title, subject)))
    .collect();
    let chip = |r: &SourceRow| {
        let (title, subject) = titles.get(&r.concept_id).cloned().unwrap_or_default();
        json!({
            "sourceId": r.id, "conceptId": r.concept_id, "title": title, "label": r.label, "subject": subject, "role": r.role, "status": r.status,
            "range": cx::format_range(r.kind(), r.range_start.map(i64::from), r.range_end.map(i64::from)), "finished": r.progress() >= 1.0,
        })
    };
    let mut by_video: serde_json::Map<String, Value> = serde_json::Map::new();
    for r in rows.iter().filter(|r| r.youtube_video_id.is_some()) {
        let entry = by_video.entry(r.youtube_video_id.clone().unwrap_or_default()).or_insert_with(|| json!([]));
        if let Value::Array(list) = entry {
            list.push(chip(r));
        }
    }
    Ok(Json(json!({
        "videos": by_video,
        "links": rows.iter().filter(|r| r.book_id.is_some()).map(chip).collect::<Vec<_>>(),
    })))
}

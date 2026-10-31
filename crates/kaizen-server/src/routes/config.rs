//! Configurations: per-area defaults and connections.

use axum::Json;
use axum::extract::{Path, State};
use kaizen_core::math_goals;
use kaizen_core::settings as core_settings;
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::{math_state, ok};
use crate::anki::Anki;
use crate::auth::User;
use crate::crypto::new_id;
use crate::db::set_settings_section;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

fn is_kanji_deck(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("rtk") || lower.contains("kanji")
}

pub async fn page(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let settings = crate::db::user_settings(&app.db, &user.id).await?;
    let adaptive = core_settings::adaptive_anki(&settings);
    let japanese_mappings: Vec<(String, String, bool)> = sqlx::query_as(
        "SELECT m.id, m.deck_name, m.adaptive_new_cards FROM anki_deck_mappings m JOIN courses c ON c.id = m.course_id
         WHERE m.user_id = $1 AND c.slug = 'japanese' ORDER BY m.deck_name",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let has_adaptive = japanese_mappings.iter().any(|m| m.2);
    let recommended = (!has_adaptive).then(|| japanese_mappings.iter().find(|m| !is_kanji_deck(&m.1)).map(|m| m.0.clone())).flatten();
    let state: Option<(i32, i32)> =
        sqlx::query_as("SELECT current_budget, reliable_data_days FROM anki_adaptive_budget_states WHERE user_id = $1")
            .bind(&user.id)
            .fetch_optional(&app.db)
            .await?;
    let mandarin = core_settings::mandarin_blueprint(&settings);
    let mut deck_options: Vec<String> = Anki::new(&app, &user.id).deck_names().await.unwrap_or_default();
    deck_options.extend([
        mandarin.character_deck_name.clone(),
        mandarin.reversed_character_deck_name.clone(),
        mandarin.word_deck_name.clone(),
    ]);
    deck_options.sort();
    deck_options.dedup();
    let math = math_state(&app, &user).await?;
    let math_json = math.map(|m| {
        let long_term: Vec<Value> = m
            .nodes
            .iter()
            .filter(|n| m.long_term.contains(&n.slug))
            .map(|n| json!({ "slug": n.slug, "title": n.title }))
            .collect();
        let available: Vec<Value> = m
            .nodes
            .iter()
            .filter(|n| !m.long_term.contains(&n.slug))
            .map(|n| json!({ "slug": n.slug, "title": n.title }))
            .collect();
        json!({ "longTerm": long_term, "available": available, "current": m.current })
    });
    Ok(Json(json!({
        "japaneseGrammar": core_settings::japanese_grammar(&settings),
        "kanjiRepair": core_settings::kanji_repair(&settings),
        "adaptive": {
            "settings": adaptive,
            "currentBudget": state.map(|s| s.0),
            "reliableDays": state.map_or(0, |s| s.1),
            "mappings": japanese_mappings.iter().map(|(id, deck, on)| json!({
                "id": id, "deckName": deck, "adaptiveNewCards": on, "kanjiDeck": is_kanji_deck(deck),
                "checked": *on || recommended.as_deref() == Some(id.as_str()),
            })).collect::<Vec<_>>(),
        },
        "mandarin": { "settings": mandarin, "deckOptions": deck_options },
        "meditation": core_settings::meditation(&settings),
        "reading": core_settings::speed_reading(&settings),
        "math": math_json,
    })))
}

/// Save one configuration section; values are sanitized by the same parsers
/// that read them, so nothing invalid is ever stored.
pub async fn update_section(State(app): State<App>, user: User, Path(section): Path<String>, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let wrap = |key: &str| json!({ key: body.clone() });
    let (key, value) = match section.as_str() {
        "speed-reading" => ("speedReading", serde_json::to_value(core_settings::speed_reading(&wrap("speedReading")))),
        "mandarin-blueprint" => ("mandarinBlueprint", serde_json::to_value(core_settings::mandarin_blueprint(&wrap("mandarinBlueprint")))),
        "meditation" => ("meditation", serde_json::to_value(core_settings::meditation(&wrap("meditation")))),
        "japanese-grammar" => ("japaneseGrammar", serde_json::to_value(core_settings::japanese_grammar(&wrap("japaneseGrammar")))),
        "kanji-repair" => ("japaneseKanjiRepair", serde_json::to_value(core_settings::kanji_repair(&wrap("japaneseKanjiRepair")))),
        "adaptive-anki" => return update_adaptive(&app, &user, body).await,
        _ => return Err(ApiError::not_found("Settings section")),
    };
    let value = value.map_err(anyhow::Error::from)?;
    set_settings_section(&app.db, &user.id, key, &value).await?;
    Ok(Json(json!({ "ok": true, "value": value })))
}

async fn update_adaptive(app: &App, user: &User, body: Value) -> ApiResult<Json<Value>> {
    let previous = core_settings::adaptive_anki(&user.settings);
    let config = core_settings::adaptive_anki(&json!({ "japaneseAdaptiveAnki": body }));
    let requested: Vec<String> = crate::db::json_strings(body.get("adaptiveMappingIds").unwrap_or(&Value::Null));
    let mappings: Vec<(String, String)> = sqlx::query_as(
        "SELECT m.id, m.deck_name FROM anki_deck_mappings m JOIN courses c ON c.id = m.course_id WHERE m.user_id = $1 AND c.slug = 'japanese'",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let mut selected: Vec<String> = mappings.iter().filter(|m| requested.contains(&m.0)).map(|m| m.0.clone()).collect();
    if config.enabled && selected.is_empty() {
        let vocab: Vec<&(String, String)> = mappings.iter().filter(|m| !is_kanji_deck(&m.1)).collect();
        if vocab.len() == 1 {
            selected.push(vocab[0].0.clone());
        }
    }
    let mut tx = app.db.begin().await?;
    sqlx::query(
        "UPDATE users SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{japaneseAdaptiveAnki}', $2::jsonb, true), updated_at = now() WHERE id = $1",
    )
    .bind(&user.id)
    .bind(serde_json::to_value(config).map_err(anyhow::Error::from)?)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE anki_deck_mappings m SET adaptive_new_cards = (m.id = ANY($2)) FROM courses c
         WHERE m.user_id = $1 AND c.id = m.course_id AND c.slug = 'japanese'",
    )
    .bind(&user.id)
    .bind(&selected)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let user = User { settings: crate::db::user_settings(&app.db, &user.id).await?, ..user.clone() };
    if config.enabled && !previous.enabled {
        crate::anki::adaptive::reset(app, &user).await?;
    }
    if let Err(e) = crate::anki::adaptive::reconcile(app, &user).await {
        tracing::warn!(error = %e, "adaptive reconcile failed");
    }
    Ok(ok())
}

pub async fn reset_adaptive(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    crate::anki::adaptive::reset(&app, &user).await?;
    if let Err(e) = crate::anki::adaptive::reconcile(&app, &user).await {
        tracing::warn!(error = %e, "adaptive reconcile failed");
    }
    Ok(ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MathGoal {
    target_slug: String,
    intent: Option<String>,
}

async fn set_math_goal(app: &App, course_id: &str, metadata: &Value, goal_id: Option<&str>, title: &str) -> ApiResult<()> {
    let mut tx = app.db.begin().await?;
    sqlx::query("UPDATE courses SET metadata = $2, updated_at = now() WHERE id = $1")
        .bind(course_id)
        .bind(metadata)
        .execute(&mut *tx)
        .await?;
    let goal_title = format!("Path to {title}");
    let description = format!("Current roadmap path toward {title}.");
    match goal_id {
        Some(id) => {
            sqlx::query("UPDATE course_goals SET title = $2, description = $3, goal_type = 'roadmap_target', updated_at = now() WHERE id = $1")
                .bind(id)
                .bind(goal_title)
                .bind(description)
                .execute(&mut *tx)
                .await?;
        }
        None => {
            sqlx::query("INSERT INTO course_goals (id, course_id, title, description, goal_type, status) VALUES ($1, $2, $3, $4, 'roadmap_target', 'ACTIVE')")
                .bind(new_id())
                .bind(course_id)
                .bind(goal_title)
                .bind(description)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

pub async fn math_goal(State(app): State<App>, user: User, Json(body): Json<MathGoal>) -> ApiResult<Json<Value>> {
    let math = math_state(&app, &user).await?.ok_or_else(|| ApiError::not_found("Math course"))?;
    let node = math
        .nodes
        .iter()
        .find(|n| n.slug == body.target_slug && math.long_term.contains(&n.slug))
        .ok_or_else(|| ApiError::bad("Choose one of your long-term goals."))?;
    let metadata = math_goals::with_target(&math.metadata, &node.slug);
    set_math_goal(&app, &math.course_id, &metadata, math.active_goal.as_ref().map(|g| g.0.as_str()), &node.title).await?;
    Ok(ok())
}

pub async fn math_long_term(State(app): State<App>, user: User, Json(body): Json<MathGoal>) -> ApiResult<Json<Value>> {
    let math = math_state(&app, &user).await?.ok_or_else(|| ApiError::not_found("Math course"))?;
    let mut next = math.long_term.clone();
    match body.intent.as_deref() {
        Some("add") if math.nodes.iter().any(|n| n.slug == body.target_slug) && !next.contains(&body.target_slug) => {
            next.push(body.target_slug.clone());
        }
        Some("remove") if next.len() > 1 && next.contains(&body.target_slug) => next.retain(|s| s != &body.target_slug),
        _ => return Ok(ok()),
    }
    let current = math.current.clone().filter(|c| next.contains(c)).unwrap_or_else(|| next[0].clone());
    let title = math.nodes.iter().find(|n| n.slug == current).map(|n| n.title.clone()).unwrap_or_default();
    let metadata = math_goals::with_target(&math_goals::with_long_term_targets(&math.metadata, &next), &current);
    set_math_goal(&app, &math.course_id, &metadata, math.active_goal.as_ref().map(|g| g.0.as_str()), &title).await?;
    Ok(ok())
}

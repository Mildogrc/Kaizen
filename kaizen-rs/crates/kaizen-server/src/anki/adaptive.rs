//! Adaptive Japanese new-card budget service: finalize evidence days, compute
//! one decision per Anki day, and apply it to Anki through an isolated preset
//! per selected deck (never modifying shared presets or scheduling).

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use kaizen_core::adaptive_budget::{
    self as budget, AdaptiveBudgetSettings, AdaptiveEvidenceDay, AdaptiveReviewLog, BudgetInput, DeckCapacity, EvidenceInput,
};
use kaizen_core::settings::{self as core_settings, AdaptiveAnkiConfiguration};
use serde::Serialize;
use serde_json::{Value, json};

use super::{Anki, nested_deck_fallback};
use crate::auth::User;
use crate::crypto::new_id;
use crate::db::json_strings;
use crate::state::App;

#[derive(sqlx::FromRow, Clone)]
struct Mapping {
    id: String,
    deck_name: String,
    last_synced_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckState {
    pub mapping_id: String,
    pub original_config_id: String,
    pub managed_config_id: String,
    pub managed_config_name: String,
}

pub async fn needs_daily_decision(app: &App, user: &User) -> anyhow::Result<bool> {
    let config = core_settings::adaptive_anki(&user.settings);
    if !config.enabled {
        return Ok(false);
    }
    let selected: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM anki_deck_mappings m JOIN courses c ON c.id = m.course_id
         WHERE m.user_id = $1 AND m.adaptive_new_cards AND c.slug = 'japanese'",
    )
    .bind(&user.id)
    .fetch_one(&app.db)
    .await?;
    if selected == 0 {
        return Ok(false);
    }
    let day = budget::anki_day_key(Utc::now(), config.anki_day_start_hour, user.tz);
    let status: Option<String> = sqlx::query_scalar("SELECT apply_status FROM anki_adaptive_budget_decisions WHERE user_id = $1 AND anki_day = $2")
        .bind(&user.id)
        .bind(&day)
        .fetch_optional(&app.db)
        .await?;
    Ok(status.is_none_or(|s| s == "failed"))
}

fn managed_name(deck: &str) -> String {
    format!("Kaizen Adaptive · {deck}").chars().take(100).collect()
}

/// Restore a deck's original preset if it still uses our managed clone.
pub async fn restore_deck(app: &App, user_id: &str, deck_name: &str, state: &DeckState) -> Result<(), String> {
    let anki = Anki::new(app, user_id);
    let decks = anki.deck_names().await.map_err(|e| e.to_string())?;
    let deck = if decks.iter().any(|d| d == deck_name) {
        deck_name.to_string()
    } else {
        nested_deck_fallback(deck_name, &decks).ok_or("Anki could not find this deck.")?
    };
    let current = anki.get_deck_config(&deck).await.map_err(|e| e.to_string())?.ok_or("Anki could not find this deck.")?;
    let managed: i64 = state.managed_config_id.parse().map_err(|_| "Stored preset identifiers are invalid.")?;
    let original: i64 = state.original_config_id.parse().map_err(|_| "Stored preset identifiers are invalid.")?;
    if current.get("id").and_then(Value::as_i64) != Some(managed) {
        return Err("The deck preset changed manually, so Kaizen left it untouched.".into());
    }
    match anki.set_deck_config(&[deck], original).await {
        Ok(true) => Ok(()),
        Ok(false) => Err("Anki rejected the original preset restoration.".into()),
        Err(e) => Err(e.to_string()),
    }
}

async fn restore_states(app: &App, user: &User, keep: &[String]) -> anyhow::Result<()> {
    let states: Vec<(DeckState, String)> = sqlx::query_as::<_, (String, String, String, String, String)>(
        "SELECT s.mapping_id, s.original_config_id, s.managed_config_id, s.managed_config_name, m.deck_name
         FROM anki_adaptive_deck_states s JOIN anki_deck_mappings m ON m.id = s.mapping_id WHERE m.user_id = $1",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?
    .into_iter()
    .map(|(mapping_id, original_config_id, managed_config_id, managed_config_name, deck)| {
        (DeckState { mapping_id, original_config_id, managed_config_id, managed_config_name }, deck)
    })
    .collect();
    for (state, deck) in states.into_iter().filter(|(s, _)| !keep.contains(&s.mapping_id)) {
        match restore_deck(app, &user.id, &deck, &state).await {
            Ok(()) => {
                sqlx::query("DELETE FROM anki_adaptive_deck_states WHERE mapping_id = $1").bind(&state.mapping_id).execute(&app.db).await?;
            }
            Err(error) => {
                sqlx::query("UPDATE anki_adaptive_deck_states SET restore_pending = true, last_error = $2, updated_at = now() WHERE mapping_id = $1")
                    .bind(&state.mapping_id)
                    .bind(error)
                    .execute(&app.db)
                    .await?;
            }
        }
    }
    Ok(())
}

pub async fn reset(app: &App, user: &User) -> anyhow::Result<()> {
    let config = core_settings::adaptive_anki(&user.settings);
    let mut tx = app.db.begin().await?;
    sqlx::query("DELETE FROM anki_adaptive_evidence_days WHERE user_id = $1").bind(&user.id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM anki_adaptive_budget_decisions WHERE user_id = $1").bind(&user.id).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO anki_adaptive_budget_states (user_id, activated_at, current_budget, reliable_data_days) VALUES ($1, now(), $2, 0)
         ON CONFLICT (user_id) DO UPDATE SET activated_at = now(), current_budget = $2, reliable_data_days = 0, updated_at = now()",
    )
    .bind(&user.id)
    .bind(config.starting_budget as i32)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

fn settings_of(config: &AdaptiveAnkiConfiguration) -> AdaptiveBudgetSettings {
    AdaptiveBudgetSettings {
        starting_budget: config.starting_budget,
        maximum_budget: config.maximum_budget,
        cold_start_protection: config.cold_start_protection,
        target_review_minutes: config.target_review_minutes,
    }
}

#[derive(sqlx::FromRow)]
struct EvidenceRow {
    anki_day: String,
    review_observations: i32,
    reviewed_card_count: i32,
    reviewed_card_ids: Value,
    lapsed_card_ids: Value,
    review_minutes: Option<f64>,
    valid_time_observations: i32,
    reviews_due: Option<i32>,
    reviews_completed: i32,
    completion_rate: Option<f64>,
    retention: Option<f64>,
    reliable: bool,
    data_available: bool,
}

impl From<EvidenceRow> for AdaptiveEvidenceDay {
    fn from(r: EvidenceRow) -> Self {
        AdaptiveEvidenceDay {
            anki_day: r.anki_day,
            review_observations: r.review_observations,
            reviewed_card_count: r.reviewed_card_count,
            reviewed_card_ids: json_strings(&r.reviewed_card_ids),
            lapsed_card_ids: json_strings(&r.lapsed_card_ids),
            review_minutes: r.review_minutes,
            valid_time_observations: r.valid_time_observations,
            reviews_due: r.reviews_due,
            reviews_completed: r.reviews_completed,
            completion_rate: r.completion_rate,
            retention: r.retention,
            reliable: r.reliable,
            data_available: r.data_available,
        }
    }
}

/// Run after every successful sync (and when settings change).
pub async fn reconcile(app: &App, user: &User) -> anyhow::Result<()> {
    let settings: Value = crate::db::user_settings(&app.db, &user.id).await?;
    let config = core_settings::adaptive_anki(&settings);
    if !config.enabled {
        return restore_states(app, user, &[]).await;
    }
    let mappings: Vec<Mapping> = sqlx::query_as(
        "SELECT m.id, m.deck_name, m.last_synced_at FROM anki_deck_mappings m JOIN courses c ON c.id = m.course_id
         WHERE m.user_id = $1 AND m.adaptive_new_cards AND c.slug = 'japanese' ORDER BY m.deck_name",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let selected: Vec<String> = mappings.iter().map(|m| m.id.clone()).collect();
    restore_states(app, user, &selected).await?;
    if mappings.is_empty() {
        return Ok(());
    }
    let now = Utc::now();
    let tz = user.tz;
    let state: Option<(DateTime<Utc>, i32)> =
        sqlx::query_as("SELECT activated_at, current_budget FROM anki_adaptive_budget_states WHERE user_id = $1")
            .bind(&user.id)
            .fetch_optional(&app.db)
            .await?;
    let (activated_at, current_budget) = match state {
        Some(s) => s,
        None => {
            sqlx::query("INSERT INTO anki_adaptive_budget_states (user_id, activated_at, current_budget) VALUES ($1, $2, $3)")
                .bind(&user.id)
                .bind(now)
                .bind(config.starting_budget as i32)
                .execute(&app.db)
                .await?;
            (now, config.starting_budget as i32)
        }
    };
    let current_day = budget::anki_day_key(now, config.anki_day_start_hour, tz);
    let activation_day = budget::anki_day_key(activated_at, config.anki_day_start_hour, tz);
    let logs: Vec<AdaptiveReviewLog> = sqlx::query_as::<_, (i64, DateTime<Utc>, i32, i32, Option<i32>)>(
        "SELECT anki_card_id, reviewed_at, rating, time_ms, review_type FROM anki_review_logs
         WHERE mapping_id = ANY($1) AND reviewed_at >= $2 ORDER BY reviewed_at",
    )
    .bind(&selected)
    .bind(activated_at)
    .fetch_all(&app.db)
    .await?
    .into_iter()
    .map(|(card, reviewed_at, rating, time_ms, review_type)| AdaptiveReviewLog {
        anki_card_id: card.to_string(),
        reviewed_at,
        rating,
        time_ms: time_ms as i64,
        review_type,
    })
    .collect();
    let due_by_day: HashMap<String, i32> =
        sqlx::query_as::<_, (String, i32)>("SELECT anki_day, due_at_calculation FROM anki_adaptive_budget_decisions WHERE user_id = $1")
            .bind(&user.id)
            .fetch_all(&app.db)
            .await?
            .into_iter()
            .collect();

    // Finalize every completed Anki day since activation.
    let mut day = budget::next_day_key(&activation_day);
    while day < current_day {
        let (_, end) = budget::anki_day_bounds(&day, config.anki_day_start_hour, tz);
        let data_available = mappings.iter().all(|m| m.last_synced_at.is_some_and(|at| at >= end));
        let summary = budget::summarize_evidence_day(EvidenceInput {
            day: &day,
            day_start_hour: config.anki_day_start_hour,
            activation_day: &activation_day,
            logs: &logs,
            reviews_due: due_by_day.get(&day).copied(),
            data_available,
            current_day: &current_day,
            tz,
        });
        sqlx::query(
            "INSERT INTO anki_adaptive_evidence_days (id, user_id, anki_day, review_observations, reviewed_card_count, reviewed_card_ids, lapsed_card_ids,
               review_minutes, valid_time_observations, reviews_due, reviews_completed, completion_rate, retention, reliable, data_available)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (user_id, anki_day) DO UPDATE SET review_observations = EXCLUDED.review_observations,
               reviewed_card_count = EXCLUDED.reviewed_card_count, reviewed_card_ids = EXCLUDED.reviewed_card_ids,
               lapsed_card_ids = EXCLUDED.lapsed_card_ids, review_minutes = EXCLUDED.review_minutes,
               valid_time_observations = EXCLUDED.valid_time_observations, reviews_due = EXCLUDED.reviews_due,
               reviews_completed = EXCLUDED.reviews_completed, completion_rate = EXCLUDED.completion_rate,
               retention = EXCLUDED.retention, reliable = EXCLUDED.reliable, data_available = EXCLUDED.data_available,
               finalized_at = now(), updated_at = now()",
        )
        .bind(new_id())
        .bind(&user.id)
        .bind(&summary.anki_day)
        .bind(summary.review_observations)
        .bind(summary.reviewed_card_count)
        .bind(json!(summary.reviewed_card_ids))
        .bind(json!(summary.lapsed_card_ids))
        .bind(summary.review_minutes)
        .bind(summary.valid_time_observations)
        .bind(summary.reviews_due)
        .bind(summary.reviews_completed)
        .bind(summary.completion_rate)
        .bind(summary.retention)
        .bind(summary.reliable)
        .bind(summary.data_available)
        .execute(&app.db)
        .await?;
        day = budget::next_day_key(&day);
    }
    let evidence: Vec<AdaptiveEvidenceDay> = sqlx::query_as::<_, EvidenceRow>(
        "SELECT anki_day, review_observations, reviewed_card_count, reviewed_card_ids, lapsed_card_ids, review_minutes, valid_time_observations,
           reviews_due, reviews_completed, completion_rate, retention, reliable, data_available
         FROM anki_adaptive_evidence_days WHERE user_id = $1 ORDER BY anki_day DESC",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?
    .into_iter()
    .map(Into::into)
    .collect();
    let reliable_days = evidence.iter().filter(|d| d.reliable).count() as i32;
    sqlx::query("UPDATE anki_adaptive_budget_states SET reliable_data_days = $2, updated_at = now() WHERE user_id = $1")
        .bind(&user.id)
        .bind(reliable_days)
        .execute(&app.db)
        .await?;

    // One decision per Anki day.
    let existing: Option<(String, i32, String, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT id, final_budget, apply_status, last_apply_at FROM anki_adaptive_budget_decisions WHERE user_id = $1 AND anki_day = $2",
    )
    .bind(&user.id)
    .bind(&current_day)
    .fetch_optional(&app.db)
    .await?;
    let (decision_id, final_budget, apply_status, last_apply_at) = match existing {
        Some(d) => d,
        None => {
            let (start, end) = budget::anki_day_bounds(&current_day, config.anki_day_start_hour, tz);
            let due: Vec<(i64, Option<DateTime<Utc>>)> = sqlx::query_as(
                "SELECT anki_card_id, due_at FROM anki_card_snapshots WHERE mapping_id = ANY($1) AND due_at <= $2
                 AND state IN ('LEARNING', 'YOUNG', 'MATURE')",
            )
            .bind(&selected)
            .bind(end)
            .fetch_all(&app.db)
            .await?;
            let mut due_ids: std::collections::HashSet<String> = due.iter().map(|(id, _)| id.to_string()).collect();
            for log in logs.iter().filter(|l| l.reviewed_at >= start && l.reviewed_at < end && matches!(l.review_type, Some(1) | Some(2))) {
                due_ids.insert(log.anki_card_id.clone());
            }
            let overdue = due.iter().filter(|(_, at)| at.is_some_and(|at| at < start)).count() as i64;
            let decision = budget::calculate_budget(BudgetInput {
                previous_budget: current_budget as i64,
                reliable_data_days: reliable_days as i64,
                evidence: &evidence,
                overdue_count: overdue,
                settings: settings_of(&config),
            });
            let id = new_id();
            sqlx::query(
                "INSERT INTO anki_adaptive_budget_decisions (id, user_id, anki_day, previous_budget, performance_target, confidence_ceiling, final_budget,
                   window_retention, retention_adjustment, median_review_minutes, review_time_adjustment, repeat_lapse_rate, lapse_adjustment,
                   completion_rate, overdue_count, backlog_ratio, reliable_data_days, reliable_window_days, due_at_calculation, reasons)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                 ON CONFLICT (user_id, anki_day) DO NOTHING",
            )
            .bind(&id)
            .bind(&user.id)
            .bind(&current_day)
            .bind(decision.previous_budget as i32)
            .bind(decision.performance_target as i32)
            .bind(decision.confidence_ceiling as i32)
            .bind(decision.final_budget as i32)
            .bind(decision.window_retention)
            .bind(decision.retention_adjustment as i32)
            .bind(decision.median_review_minutes)
            .bind(decision.review_time_adjustment as i32)
            .bind(decision.repeat_lapse_rate)
            .bind(decision.lapse_adjustment as i32)
            .bind(decision.completion_rate)
            .bind(overdue as i32)
            .bind(decision.backlog_ratio)
            .bind(reliable_days)
            .bind(decision.reliable_window_days as i32)
            .bind(due_ids.len() as i32)
            .bind(json!(decision.reasons))
            .execute(&app.db)
            .await?;
            sqlx::query("UPDATE anki_adaptive_budget_states SET current_budget = $2, updated_at = now() WHERE user_id = $1")
                .bind(&user.id)
                .bind(decision.final_budget as i32)
                .execute(&app.db)
                .await?;
            (id, decision.final_budget as i32, "pending".to_string(), None)
        }
    };
    if !budget::application_is_claimable(&apply_status, last_apply_at, now) {
        return Ok(());
    }
    let claimed = sqlx::query(
        "UPDATE anki_adaptive_budget_decisions SET apply_status = 'applying', last_apply_at = now()
         WHERE id = $1 AND (apply_status IN ('pending', 'failed') OR (apply_status = 'applying' AND (last_apply_at IS NULL OR last_apply_at <= $2)))",
    )
    .bind(&decision_id)
    .bind(now - Duration::minutes(5))
    .execute(&app.db)
    .await?;
    if claimed.rows_affected() == 0 {
        return Ok(());
    }
    let results = apply(app, user, final_budget as i64, &mappings).await;
    for result in &results {
        if let Some(state) = &result.state {
            sqlx::query(
                "INSERT INTO anki_adaptive_deck_states (id, mapping_id, original_config_id, managed_config_id, managed_config_name, last_applied_budget, last_applied_at, last_error)
                 VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END, $8)
                 ON CONFLICT (mapping_id) DO UPDATE SET original_config_id = EXCLUDED.original_config_id, managed_config_id = EXCLUDED.managed_config_id,
                   managed_config_name = EXCLUDED.managed_config_name,
                   last_applied_budget = CASE WHEN $7 THEN EXCLUDED.last_applied_budget ELSE anki_adaptive_deck_states.last_applied_budget END,
                   last_applied_at = CASE WHEN $7 THEN now() ELSE anki_adaptive_deck_states.last_applied_at END,
                   restore_pending = false, last_error = $8, updated_at = now()",
            )
            .bind(new_id())
            .bind(&result.mapping_id)
            .bind(&state.original_config_id)
            .bind(&state.managed_config_id)
            .bind(&state.managed_config_name)
            .bind(result.ok.then_some(result.budget as i32))
            .bind(result.ok)
            .bind(&result.error)
            .execute(&app.db)
            .await?;
        }
    }
    let failures: Vec<String> =
        results.iter().filter(|r| !r.ok).map(|r| format!("{}: {}", r.deck_name, r.error.clone().unwrap_or_default())).collect();
    sqlx::query(
        "UPDATE anki_adaptive_budget_decisions SET allocation = $2, apply_status = $3, apply_error = $4, last_apply_at = now() WHERE id = $1",
    )
    .bind(&decision_id)
    .bind(json!(results.iter().map(|r| json!({
        "mappingId": r.mapping_id, "deckName": r.deck_name, "availableNew": r.available_new, "budget": r.budget, "ok": r.ok, "error": r.error,
    })).collect::<Vec<_>>()))
    .bind(if failures.is_empty() { "applied" } else { "failed" })
    .bind((!failures.is_empty()).then(|| failures.join(" ")))
    .execute(&app.db)
    .await?;
    Ok(())
}

struct ApplyResult {
    mapping_id: String,
    deck_name: String,
    available_new: i64,
    budget: i64,
    ok: bool,
    error: Option<String>,
    state: Option<DeckState>,
}

async fn apply(app: &App, user: &User, total: i64, mappings: &[Mapping]) -> Vec<ApplyResult> {
    let anki = Anki::new(app, &user.id);
    let fail = |m: &Mapping, error: String| ApplyResult {
        mapping_id: m.id.clone(),
        deck_name: m.deck_name.clone(),
        available_new: 0,
        budget: 0,
        ok: false,
        error: Some(error),
        state: None,
    };
    let decks = match anki.deck_names().await {
        Ok(d) => d,
        Err(e) => return mappings.iter().map(|m| fail(m, e.to_string())).collect(),
    };
    let states: HashMap<String, DeckState> = sqlx::query_as::<_, DeckState>(
        "SELECT mapping_id, original_config_id, managed_config_id, managed_config_name FROM anki_adaptive_deck_states WHERE mapping_id = ANY($1)",
    )
    .bind(mappings.iter().map(|m| m.id.clone()).collect::<Vec<_>>())
    .fetch_all(&app.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|s| (s.mapping_id.clone(), s))
    .collect();

    let mut capacities = Vec::new();
    let mut resolved: HashMap<String, Result<String, String>> = HashMap::new();
    for m in mappings {
        let deck = if decks.iter().any(|d| d == &m.deck_name) { Some(m.deck_name.clone()) } else { nested_deck_fallback(&m.deck_name, &decks) };
        let (available, deck_result) = match deck {
            None => (0, Err("Anki could not find this deck.".to_string())),
            Some(deck) => match anki.new_card_count(&deck).await {
                Ok(n) => (n as i64, Ok(deck)),
                Err(e) => (0, Err(e.to_string())),
            },
        };
        capacities.push(DeckCapacity { mapping_id: m.id.clone(), deck_name: m.deck_name.clone(), available_new: available });
        resolved.insert(m.id.clone(), deck_result);
    }
    let allocation = budget::allocate_budget(total, &capacities);
    let mut results = Vec::new();
    for m in mappings {
        let assigned = allocation.iter().find(|a| a.mapping_id == m.id).map_or(0, |a| a.budget);
        let available = capacities.iter().find(|c| c.mapping_id == m.id).map_or(0, |c| c.available_new);
        let deck = match resolved.remove(&m.id) {
            Some(Ok(deck)) => deck,
            Some(Err(error)) => {
                results.push(fail(m, error));
                continue;
            }
            None => {
                results.push(fail(m, "Unknown deck.".into()));
                continue;
            }
        };
        let base = ApplyResult {
            mapping_id: m.id.clone(),
            deck_name: m.deck_name.clone(),
            available_new: available,
            budget: assigned,
            ok: false,
            error: None,
            state: states.get(&m.id).cloned(),
        };
        results.push(apply_deck(&anki, &deck, &m.deck_name, base).await);
    }
    results
}

async fn apply_deck(anki: &Anki<'_>, deck: &str, mapped_name: &str, mut result: ApplyResult) -> ApplyResult {
    let fail = |mut r: ApplyResult, error: &str| {
        r.error = Some(error.to_string());
        r.ok = false;
        r
    };
    let Ok(Some(mut config)) = anki.get_deck_config(deck).await else {
        return fail(result, "Anki could not find this deck or its preset.");
    };
    match result.state.clone() {
        None => {
            let original = config.get("id").and_then(Value::as_i64).unwrap_or_default();
            let name = managed_name(mapped_name);
            let Ok(Some(cloned)) = anki.clone_deck_config(&name, original).await else {
                return fail(result, "Anki could not create an isolated adaptive preset.");
            };
            if !matches!(anki.set_deck_config(&[deck.to_string()], cloned).await, Ok(true)) {
                return fail(result, "Anki could not assign the isolated adaptive preset.");
            }
            result.state = Some(DeckState {
                mapping_id: result.mapping_id.clone(),
                original_config_id: original.to_string(),
                managed_config_id: cloned.to_string(),
                managed_config_name: name,
            });
            match anki.get_deck_config(deck).await {
                Ok(Some(c)) if c.get("id").and_then(Value::as_i64) == Some(cloned) => config = c,
                _ => return fail(result, "The adaptive preset assignment could not be verified."),
            }
        }
        Some(state) => {
            let expected: Option<i64> = state.managed_config_id.parse().ok();
            if expected.is_none() || config.get("id").and_then(Value::as_i64) != expected {
                return fail(result, "This deck now uses a different preset. Kaizen did not overwrite it.");
            }
        }
    }
    config["new"]["perDay"] = json!(result.budget);
    match anki.save_deck_config(&config).await {
        Ok(true) => {
            result.ok = true;
            result
        }
        Ok(false) => fail(result, "Anki rejected the adaptive new-card limit."),
        Err(e) => fail(result, &e.to_string()),
    }
}

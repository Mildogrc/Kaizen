//! Pull mapped decks from AnkiConnect into Postgres snapshots. Cards are
//! upserted (and pruned when removed from the deck); review logs append
//! incrementally keyed on Anki's revlog id. Anki scheduling is never changed.

use chrono::{DateTime, Duration, TimeZone, Utc};
use kaizen_core::anki_analytics::CardState;
use kaizen_core::anki_html::strip_anki_html;
use serde::Serialize;
use serde_json::{Value, json};

use super::{Anki, AnkiError, CardInfo, escape, nested_deck_fallback};
use crate::auth::User;
use crate::crypto::new_id;
use crate::state::App;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub ok: bool,
    pub error: Option<String>,
    pub decks_synced: i32,
    pub cards_synced: i32,
    pub reviews_added: i32,
}

fn state_for(card: &CardInfo) -> CardState {
    match card.queue {
        -1 => CardState::Suspended,
        -2 | -3 => CardState::Buried,
        0 => CardState::New,
        1 | 3 => CardState::Learning,
        _ if card.interval >= 21 => CardState::Mature,
        _ => CardState::Young,
    }
}

/// Meaningful field texts in template order (skips empty and pure-numeric).
fn field_texts(card: &CardInfo) -> Vec<String> {
    let Some(fields) = card.fields.as_object() else { return vec![] };
    let mut ordered: Vec<(i64, String)> = fields
        .values()
        .map(|f| (f.get("order").and_then(Value::as_i64).unwrap_or(0), strip_anki_html(f.get("value").and_then(Value::as_str).unwrap_or(""))))
        .collect();
    ordered.sort_by_key(|(order, _)| *order);
    ordered.into_iter().map(|(_, v)| v).filter(|v| !v.is_empty() && !v.chars().all(|c| c.is_ascii_digit())).collect()
}

/// Readable front/back; falls back to note fields for audio-only templates.
fn card_text(card: &CardInfo) -> (String, String) {
    let mut front = strip_anki_html(&card.question);
    let mut back = strip_anki_html(&card.answer);
    let fields = field_texts(card);
    if front.is_empty() {
        front = fields.first().cloned().unwrap_or_else(|| "(audio-only card)".into());
    }
    if let Some(rest) = back.strip_prefix(&front) {
        back = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '·' || c == '—' || c == '-').to_string();
    }
    if back.is_empty() {
        back = fields.iter().skip(1).take(3).cloned().collect::<Vec<_>>().join(" — ");
    }
    (front.chars().take(500).collect(), back.chars().take(1000).collect())
}

/// Review-queue `due` is a day number relative to collection creation, which
/// AnkiConnect doesn't expose; probe a card with a known relative due date.
async fn probe_today_day_number(anki: &Anki<'_>) -> Result<Option<i64>, AnkiError> {
    for rel in [0, -1, 1, -3, 3, -7, 7, -30, 30] {
        let ids = anki.find_cards(&format!("prop:due={rel} -is:learn")).await?;
        let Some(first) = ids.first() else { continue };
        if let Some(info) = anki.cards_info(&[*first]).await?.first()
            && info.queue == 2
        {
            return Ok(Some(info.due - rel));
        }
    }
    Ok(None)
}

fn due_at(card: &CardInfo, today_day: Option<i64>, today_start: DateTime<Utc>) -> Option<DateTime<Utc>> {
    match state_for(card) {
        CardState::New | CardState::Suspended | CardState::Buried => None,
        _ if card.queue == 1 => Some(if card.due > 1_000_000_000 { Utc.timestamp_opt(card.due, 0).single()? } else { today_start }),
        _ => today_day.map(|today| today_start + Duration::days(card.due - today)),
    }
}

pub async fn sync(app: &App, user: &User) -> SyncSummary {
    let run_id = new_id();
    let _ = sqlx::query("INSERT INTO anki_sync_runs (id, user_id) VALUES ($1, $2)").bind(&run_id).bind(&user.id).execute(&app.db).await;
    let mut summary = SyncSummary { ok: true, ..Default::default() };
    match sync_inner(app, user, &mut summary).await {
        Ok(()) => {
            let _ = sqlx::query(
                "UPDATE anki_sync_runs SET finished_at = now(), status = 'ok', decks_synced = $2, cards_synced = $3, reviews_added = $4 WHERE id = $1",
            )
            .bind(&run_id)
            .bind(summary.decks_synced)
            .bind(summary.cards_synced)
            .bind(summary.reviews_added)
            .execute(&app.db)
            .await;
            // The mature-card set may have shifted: keep known words and the
            // adaptive budget in step (failures here don't fail the sync).
            if let Err(e) = crate::known_words::refresh_anki_words(app, user).await {
                tracing::warn!(error = %e, "known-word refresh after sync failed");
            }
            if let Err(e) = super::adaptive::reconcile(app, user).await {
                tracing::warn!(error = %e, "adaptive budget reconcile after sync failed");
            }
        }
        Err(error) => {
            summary.ok = false;
            summary.error = Some(error.to_string());
            let _ = sqlx::query("UPDATE anki_sync_runs SET finished_at = now(), status = 'error', error = $2 WHERE id = $1")
                .bind(&run_id)
                .bind(error.to_string())
                .execute(&app.db)
                .await;
        }
    }
    summary
}

#[derive(sqlx::FromRow)]
struct MappingRow {
    id: String,
    deck_name: String,
}

async fn sync_inner(app: &App, user: &User, summary: &mut SyncSummary) -> anyhow::Result<()> {
    let anki = Anki::new(app, &user.id);
    let mappings: Vec<MappingRow> = sqlx::query_as("SELECT id, deck_name FROM anki_deck_mappings WHERE user_id = $1 ORDER BY created_at")
        .bind(&user.id)
        .fetch_all(&app.db)
        .await?;
    if mappings.is_empty() {
        return Ok(());
    }
    let available = anki.deck_names().await?;
    let today_day = probe_today_day_number(&anki).await?;
    let today_start = kaizen_core::time::start_of_day(Utc::now(), user.tz);

    for mapping in mappings {
        let mut deck = mapping.deck_name.clone();
        let mut ids = anki.find_cards(&format!("deck:\"{}\"", escape(&deck))).await?;
        if ids.is_empty()
            && let Some(fallback) = nested_deck_fallback(&mapping.deck_name, &available)
        {
            deck = fallback;
            ids = anki.find_cards(&format!("deck:\"{}\"", escape(&deck))).await?;
        }
        let cards = anki.cards_info(&ids).await?;
        let notes: Vec<i64> = {
            let mut n: Vec<i64> = cards.iter().map(|c| c.note).collect();
            n.sort_unstable();
            n.dedup();
            n
        };
        let tags = anki.note_tags(&notes).await?;
        let existing: i64 = sqlx::query_scalar("SELECT count(*) FROM anki_card_snapshots WHERE mapping_id = $1")
            .bind(&mapping.id)
            .fetch_one(&app.db)
            .await?;
        if cards.is_empty() && existing > 0 {
            continue;
        }

        let card_ids: Vec<i64> = cards.iter().map(|c| c.card_id).collect();
        sqlx::query("DELETE FROM anki_card_snapshots WHERE mapping_id = $1 AND NOT (anki_card_id = ANY($2))")
            .bind(&mapping.id)
            .bind(&card_ids)
            .execute(&app.db)
            .await?;
        for chunk in cards.chunks(500) {
            let rows: Vec<Value> = chunk
                .iter()
                .map(|card| {
                    let (front, back) = card_text(card);
                    let leech = tags.get(&card.note).is_some_and(|t| t.iter().any(|t| t == "leech")) || card.lapses >= 8;
                    json!({
                        "id": new_id(), "cardId": card.card_id, "front": front, "back": back, "state": state_for(card).as_str(),
                        "interval": card.interval.max(0), "ease": if card.factor > 0 { card.factor as f64 / 1000.0 } else { 2.5 },
                        "dueAt": due_at(card, today_day, today_start), "reps": card.reps, "lapses": card.lapses, "leech": leech,
                        "tags": tags.get(&card.note).cloned().unwrap_or_default(),
                    })
                })
                .collect();
            sqlx::query(
                "INSERT INTO anki_card_snapshots (id, user_id, mapping_id, anki_card_id, front, back, state, interval_days, ease, due_at, reps, lapses, is_leech, tags, synced_at)
                 SELECT x->>'id', $1, $2, (x->>'cardId')::bigint, x->>'front', x->>'back', x->>'state', (x->>'interval')::int,
                   (x->>'ease')::float8, (x->>'dueAt')::timestamptz, (x->>'reps')::int, (x->>'lapses')::int, (x->>'leech')::boolean,
                   ARRAY(SELECT jsonb_array_elements_text(x->'tags')), now()
                 FROM jsonb_array_elements($3::jsonb) x
                 ON CONFLICT (user_id, anki_card_id) DO UPDATE SET mapping_id = EXCLUDED.mapping_id, front = EXCLUDED.front, back = EXCLUDED.back,
                   state = EXCLUDED.state, interval_days = EXCLUDED.interval_days, ease = EXCLUDED.ease, due_at = EXCLUDED.due_at,
                   reps = EXCLUDED.reps, lapses = EXCLUDED.lapses, is_leech = EXCLUDED.is_leech, tags = EXCLUDED.tags, synced_at = now()",
            )
            .bind(&user.id)
            .bind(&mapping.id)
            .bind(Value::Array(rows))
            .execute(&app.db)
            .await?;
        }
        summary.cards_synced += cards.len() as i32;

        let latest: Option<i64> = sqlx::query_scalar("SELECT max(anki_review_id) FROM anki_review_logs WHERE mapping_id = $1")
            .bind(&mapping.id)
            .fetch_one(&app.db)
            .await?;
        let reviews = anki.card_reviews(&deck, latest.unwrap_or(0)).await?;
        for chunk in reviews.chunks(2000) {
            let rows: Vec<Value> = chunk
                .iter()
                .filter(|r| r.len() >= 8)
                .map(|r| {
                    json!({
                        "id": new_id(), "reviewId": r[0], "cardId": r[1], "rating": r[3],
                        "after": r[4].max(0), "before": r[5].max(0), "time": r[7], "type": r.get(8),
                    })
                })
                .collect();
            let inserted = sqlx::query(
                "INSERT INTO anki_review_logs (id, user_id, mapping_id, anki_review_id, anki_card_id, reviewed_at, rating, interval_after_days, interval_before_days, time_ms, review_type)
                 SELECT x->>'id', $1, $2, (x->>'reviewId')::bigint, (x->>'cardId')::bigint, to_timestamp((x->>'reviewId')::bigint / 1000.0),
                   (x->>'rating')::int, (x->>'after')::int, (x->>'before')::int, (x->>'time')::int, (x->>'type')::int
                 FROM jsonb_array_elements($3::jsonb) x
                 ON CONFLICT (user_id, anki_review_id, anki_card_id) DO NOTHING",
            )
            .bind(&user.id)
            .bind(&mapping.id)
            .bind(Value::Array(rows))
            .execute(&app.db)
            .await?;
            summary.reviews_added += inserted.rows_affected() as i32;
        }
        sqlx::query("UPDATE anki_deck_mappings SET last_synced_at = now() WHERE id = $1").bind(&mapping.id).execute(&app.db).await?;
        summary.decks_synced += 1;
    }
    Ok(())
}

/// Sync at most hourly when a page asks, unless today's adaptive budget
/// decision is still missing. Silent when Anki is closed or nothing is mapped.
pub async fn maybe_auto_sync(app: &App, user: &User) {
    let last_ok: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT started_at FROM anki_sync_runs WHERE user_id = $1 AND status = 'ok' ORDER BY started_at DESC LIMIT 1",
    )
    .bind(&user.id)
    .fetch_optional(&app.db)
    .await
    .ok()
    .flatten();
    let recent = last_ok.is_some_and(|at| Utc::now() - at < Duration::hours(1));
    let needs_decision = super::adaptive::needs_daily_decision(app, user).await.unwrap_or(false);
    if recent && !needs_decision {
        return;
    }
    let mapped: i64 = sqlx::query_scalar("SELECT count(*) FROM anki_deck_mappings WHERE user_id = $1")
        .bind(&user.id)
        .fetch_one(&app.db)
        .await
        .unwrap_or(0);
    if mapped > 0 {
        sync(app, user).await;
    }
}

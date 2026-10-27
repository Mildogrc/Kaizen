//! Known-word service: Migaku imports, mature-Anki-card extraction, and
//! recomputation of union bounds, daily stats, and vocab goal progress.

use std::collections::{HashMap, HashSet};

use kaizen_core::known_words::{UnionEntry, parse_migaku_export, union_bounds};
use kaizen_core::lemmatize::{NormalizedWord, normalize_word};
use serde::Serialize;
use serde_json::{Value, json};

use crate::auth::User;
use crate::crypto::new_id;
use crate::state::App;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigakuSummary {
    pub parsed: usize,
    pub filtered_out: usize,
    pub added: u64,
    pub duplicates: u64,
    pub unparseable: usize,
}

/// Normalize off the async runtime (Japanese tokenization is CPU-bound).
async fn normalize_all(language: &'static str, words: Vec<String>) -> Vec<Option<NormalizedWord>> {
    tokio::task::spawn_blocking(move || words.iter().map(|w| normalize_word(language, w)).collect())
        .await
        .unwrap_or_default()
}

fn lang(language: &str) -> &'static str {
    if language == "zh" { "zh" } else { "ja" }
}

async fn insert_words(app: &App, user: &User, language: &str, source: &str, detail: Option<&str>, words: &[NormalizedWord]) -> anyhow::Result<u64> {
    let mut added = 0;
    for chunk in words.chunks(1000) {
        let rows: Vec<Value> = chunk
            .iter()
            .map(|w| json!({ "id": new_id(), "surface": w.surface, "lemma": w.lemma, "reading": w.reading, "strict": w.strict_key, "loose": w.loose_key }))
            .collect();
        let result = sqlx::query(
            "INSERT INTO known_words (id, user_id, language, surface, lemma, reading, strict_key, loose_key, source, source_detail)
             SELECT x->>'id', $1, $2, x->>'surface', x->>'lemma', x->>'reading', x->>'strict', x->>'loose', $3, $4
             FROM jsonb_array_elements($5::jsonb) x
             ON CONFLICT (user_id, language, source, strict_key) DO NOTHING",
        )
        .bind(&user.id)
        .bind(language)
        .bind(source)
        .bind(detail)
        .bind(Value::Array(rows))
        .execute(&app.db)
        .await?;
        added += result.rows_affected();
    }
    Ok(added)
}

pub async fn import_migaku(app: &App, user: &User, language: &str, text: &str, include_learning: bool) -> anyhow::Result<MigakuSummary> {
    let language = lang(language);
    let parsed = parse_migaku_export(text, include_learning, Some(language));
    let normalized = normalize_all(language, parsed.words.iter().map(|w| w.word.clone()).collect()).await;
    let mut unparseable = 0;
    let mut unique: Vec<NormalizedWord> = Vec::new();
    let mut seen = HashSet::new();
    for word in normalized {
        match word {
            Some(w) if seen.insert(w.strict_key.clone()) => unique.push(w),
            Some(_) => {}
            None => unparseable += 1,
        }
    }
    let label = format!("migaku import {}", kaizen_core::time::day_key(chrono::Utc::now(), user.tz));
    let added = insert_words(app, user, language, "migaku", Some(&label), &unique).await?;
    recompute_stats(app, user).await?;
    Ok(MigakuSummary {
        parsed: parsed.words.len(),
        filtered_out: parsed.filtered_out,
        added,
        duplicates: unique.len() as u64 - added,
        unparseable,
    })
}

pub async fn add_manual(app: &App, user: &User, language: &str, surface: &str) -> anyhow::Result<bool> {
    let language = lang(language);
    let Some(word) = normalize_all(language, vec![surface.to_string()]).await.into_iter().next().flatten() else {
        return Ok(false);
    };
    let added = insert_words(app, user, language, "manual", None, &[word]).await?;
    recompute_stats(app, user).await?;
    Ok(added > 0)
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnkiWordsSummary {
    pub scanned: usize,
    pub added: u64,
    pub removed: u64,
    pub unparseable: usize,
}

/// Mature cards from word-counting deck mappings become known words; cards
/// that fell out of maturity are pruned so the count tracks Anki truthfully.
pub async fn refresh_anki_words(app: &App, user: &User) -> anyhow::Result<AnkiWordsSummary> {
    let mappings: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT m.id, m.deck_name, c.tab FROM anki_deck_mappings m JOIN courses c ON c.id = m.course_id
         WHERE m.user_id = $1 AND m.counts_known_words AND c.tab IN ('JAPANESE', 'CHINESE')",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let mut summary = AnkiWordsSummary::default();
    let mut current: HashMap<&'static str, HashSet<String>> = HashMap::from([("ja", HashSet::new()), ("zh", HashSet::new())]);
    for (mapping_id, deck_name, tab) in mappings {
        let language: &'static str = if tab == "CHINESE" { "zh" } else { "ja" };
        let fronts: Vec<String> =
            sqlx::query_scalar("SELECT front FROM anki_card_snapshots WHERE mapping_id = $1 AND state = 'MATURE'")
                .bind(&mapping_id)
                .fetch_all(&app.db)
                .await?;
        summary.scanned += fronts.len();
        let mut fresh = Vec::new();
        for word in normalize_all(language, fronts).await {
            match word {
                Some(w) => {
                    if current.get_mut(language).expect("language").insert(w.strict_key.clone()) {
                        fresh.push(w);
                    }
                }
                None => summary.unparseable += 1,
            }
        }
        summary.added += insert_words(app, user, language, "anki", Some(&deck_name), &fresh).await?;
    }
    for (language, keys) in &current {
        let keys: Vec<String> = keys.iter().cloned().collect();
        let removed = sqlx::query("DELETE FROM known_words WHERE user_id = $1 AND language = $2 AND source = 'anki' AND NOT (strict_key = ANY($3))")
            .bind(&user.id)
            .bind(language)
            .bind(&keys)
            .execute(&app.db)
            .await?;
        summary.removed += removed.rows_affected();
    }
    recompute_stats(app, user).await?;
    Ok(summary)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageStats {
    pub language: &'static str,
    pub lower: usize,
    pub upper: usize,
    pub by_source: HashMap<String, usize>,
    pub overlap: usize,
}

pub async fn bounds(app: &App, user_id: &str, language: &str) -> anyhow::Result<kaizen_core::known_words::UnionBounds> {
    let rows: Vec<(String, String, Option<String>, String)> =
        sqlx::query_as("SELECT strict_key, loose_key, reading, source FROM known_words WHERE user_id = $1 AND language = $2")
            .bind(user_id)
            .bind(language)
            .fetch_all(&app.db)
            .await?;
    let entries: Vec<UnionEntry> = rows
        .into_iter()
        .map(|(strict_key, loose_key, reading, source)| UnionEntry { strict_key, loose_key, reading, source })
        .collect();
    Ok(union_bounds(&entries))
}

/// Recompute union bounds, snapshot today's stat, and move vocab goals.
pub async fn recompute_stats(app: &App, user: &User) -> anyhow::Result<Vec<LanguageStats>> {
    let today = kaizen_core::time::local_date(chrono::Utc::now(), user.tz);
    let mut out = Vec::new();
    for (language, tab) in [("ja", "JAPANESE"), ("zh", "CHINESE")] {
        let b = bounds(app, &user.id, language).await?;
        let count = |source: &str| *b.by_source.get(source).unwrap_or(&0) as i32;
        sqlx::query(
            "INSERT INTO known_word_stats (id, user_id, date, language, lower_bound, upper_bound, migaku_count, anki_count, manual_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (user_id, date, language) DO UPDATE SET lower_bound = EXCLUDED.lower_bound, upper_bound = EXCLUDED.upper_bound,
               migaku_count = EXCLUDED.migaku_count, anki_count = EXCLUDED.anki_count, manual_count = EXCLUDED.manual_count",
        )
        .bind(new_id())
        .bind(&user.id)
        .bind(today)
        .bind(language)
        .bind(b.lower as i32)
        .bind(b.upper as i32)
        .bind(count("migaku"))
        .bind(count("anki"))
        .bind(count("manual"))
        .execute(&app.db)
        .await?;

        // Vocab goals and word milestones track the conservative bound.
        if let Some(course_id) = sqlx::query_scalar::<_, String>("SELECT id FROM courses WHERE user_id = $1 AND tab = $2 LIMIT 1")
            .bind(&user.id)
            .bind(tab)
            .fetch_optional(&app.db)
            .await?
        {
            let lower = b.lower as i32;
            let completed = sqlx::query(
                "UPDATE course_goals SET current_value = $2, status = 'COMPLETED', updated_at = now()
                 WHERE course_id = $1 AND goal_type = 'vocab_count' AND status = 'ACTIVE' AND target_value <= $2",
            )
            .bind(&course_id)
            .bind(lower)
            .execute(&app.db)
            .await?
            .rows_affected();
            sqlx::query(
                "UPDATE course_goals SET current_value = $2, updated_at = now()
                 WHERE course_id = $1 AND goal_type = 'vocab_count' AND status = 'ACTIVE' AND (target_value IS NULL OR target_value > $2)",
            )
            .bind(&course_id)
            .bind(lower)
            .execute(&app.db)
            .await?;
            sqlx::query(
                "UPDATE course_milestones SET completed_at = now()
                 WHERE course_id = $1 AND metric = 'words' AND target_value <= $2 AND completed_at IS NULL",
            )
            .bind(&course_id)
            .bind(lower)
            .execute(&app.db)
            .await?;
            if completed > 0 {
                sqlx::query(
                    "UPDATE course_goals SET status = 'ACTIVE', updated_at = now() WHERE id = (
                       SELECT id FROM course_goals WHERE course_id = $1 AND status = 'PLANNED' ORDER BY created_at LIMIT 1)",
                )
                .bind(&course_id)
                .execute(&app.db)
                .await?;
            }
        }
        out.push(LanguageStats { language, lower: b.lower, upper: b.upper, by_source: b.by_source, overlap: b.overlap });
    }
    Ok(out)
}

/// Lazy daily recompute (when no stat exists for today).
pub async fn maybe_recompute(app: &App, user: &User) {
    let today = kaizen_core::time::local_date(chrono::Utc::now(), user.tz);
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM known_word_stats WHERE user_id = $1 AND date = $2)")
        .bind(&user.id)
        .bind(today)
        .fetch_one(&app.db)
        .await
        .unwrap_or(true);
    if !exists && let Err(e) = recompute_stats(app, user).await {
        tracing::warn!(error = %e, "known-word recompute failed");
    }
}

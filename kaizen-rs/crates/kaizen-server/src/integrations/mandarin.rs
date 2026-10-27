//! Mandarin Blueprint: the 88-level catalog (CSV + Traverse), the Chisho
//! dictionary cache, and pushing a completed level's cards to Anki.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use anyhow::{Context, bail};
use futures::future::join_all;
use kaizen_core::mandarin::{self, DictionaryEntry};
use kaizen_core::settings as core_settings;
use serde::Serialize;
use serde_json::{Value, json};

use crate::anki::Anki;
use crate::auth::User;
use crate::crypto::new_id;
use crate::state::App;

async fn fetch_traverse_level(app: &App, level: i64) -> anyhow::Result<mandarin::TraverseLevel> {
    let response = app
        .http
        .post(mandarin::TRAVERSE_PROGRESS_ENDPOINT)
        .json(&json!({ "data": { "level": level.to_string() } }))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .with_context(|| format!("Traverse level {level}"))?;
    if !response.status().is_success() {
        bail!("Traverse level {level} failed with {}.", response.status().as_u16());
    }
    let body: Value = response.json().await?;
    mandarin::parse_traverse_level(&body).map_err(|e| anyhow::anyhow!("Traverse level {level}: {e}"))
}

/// Load (or refresh) the global 88-level catalog. Run once per instance:
/// `kaizen import-mandarin --csv MandarinBluePrint.csv`.
pub async fn import_catalog(app: &App, csv: &str) -> anyhow::Result<String> {
    let rows = mandarin::parse_blueprint_csv(csv);
    if rows.len() as i64 != mandarin::LEVELS {
        bail!("Expected {} CSV levels, found {}.", mandarin::LEVELS, rows.len());
    }
    let mut progress: HashMap<i64, mandarin::TraverseLevel> = HashMap::new();
    for batch in rows.chunks(6) {
        let results = join_all(batch.iter().map(|row| fetch_traverse_level(app, row.level))).await;
        for (row, result) in batch.iter().zip(results) {
            progress.insert(row.level, result?);
        }
    }
    let mut tx = app.db.begin().await?;
    for row in &rows {
        let traverse = &progress[&row.level];
        sqlx::query(
            "INSERT INTO mandarin_blueprint_levels (level, phase, reported_new_character_count, reported_total_characters,
               reported_new_word_count, reported_total_words, characters, words, source_stats)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (level) DO UPDATE SET phase = EXCLUDED.phase, reported_new_character_count = EXCLUDED.reported_new_character_count,
               reported_total_characters = EXCLUDED.reported_total_characters, reported_new_word_count = EXCLUDED.reported_new_word_count,
               reported_total_words = EXCLUDED.reported_total_words, characters = EXCLUDED.characters, words = EXCLUDED.words,
               source_stats = EXCLUDED.source_stats, updated_at = now()",
        )
        .bind(row.level as i32)
        .bind(row.phase.map(|p| p as i32))
        .bind(row.new_characters as i32)
        .bind(row.total_characters as i32)
        .bind(row.new_words as i32)
        .bind(row.total_words as i32)
        .bind(json!(traverse.characters))
        .bind(json!(traverse.words))
        .bind(json!({
            "csvCharacters": row.characters, "weeks": row.weeks,
            "traverseTotalWords": traverse.total_words, "traverseTotalCharacters": traverse.total_characters,
        }))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    let last = progress.get(&mandarin::LEVELS);
    Ok(format!(
        "Imported {} Mandarin Blueprint levels ({} words, {} characters).",
        rows.len(),
        last.map_or(0, |l| l.total_words),
        last.map_or(0, |l| l.total_characters)
    ))
}

async fn lookup_chisho(app: &App, surface: &str) -> DictionaryEntry {
    let empty = || DictionaryEntry {
        surface: surface.to_string(),
        traditional: None,
        pinyin: vec![],
        definitions: vec![],
        audio_urls: vec![],
        source_url: mandarin::chisho_url(surface),
    };
    let response = app.http.get(mandarin::chisho_url(surface)).timeout(Duration::from_secs(20)).send().await;
    match response {
        Ok(r) if r.status().is_success() => match r.text().await {
            Ok(html) => mandarin::parse_chisho_html(surface, &html),
            Err(_) => empty(),
        },
        _ => empty(),
    }
}

fn level_entries(characters: &Value, words: &Value) -> Vec<(String, &'static str)> {
    crate::db::json_strings(characters)
        .into_iter()
        .map(|s| (s, "CHARACTER"))
        .chain(crate::db::json_strings(words).into_iter().map(|s| (s, "WORD")))
        .collect()
}

/// Cache dictionary data for every character and word in a level.
async fn enrich_level(app: &App, entries: &[(String, &'static str)]) -> anyhow::Result<()> {
    let surfaces: Vec<String> = entries.iter().map(|e| e.0.clone()).collect();
    let existing: HashSet<(String, String)> =
        sqlx::query_as::<_, (String, String)>("SELECT surface, kind FROM mandarin_dictionary_entries WHERE surface = ANY($1)")
            .bind(&surfaces)
            .fetch_all(&app.db)
            .await?
            .into_iter()
            .collect();
    let mut missing: Vec<String> = entries
        .iter()
        .filter(|(s, k)| !existing.contains(&(s.clone(), k.to_string())))
        .map(|(s, _)| s.clone())
        .collect();
    missing.sort();
    missing.dedup();
    for (index, batch) in missing.chunks(4).enumerate() {
        if index > 0 {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        let lookups = join_all(batch.iter().map(|s| lookup_chisho(app, s))).await;
        for lookup in lookups {
            for (_, kind) in entries.iter().filter(|(s, _)| *s == lookup.surface) {
                sqlx::query(
                    "INSERT INTO mandarin_dictionary_entries (id, surface, kind, traditional, pinyin, definitions, audio_urls, source_url)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (surface, kind) DO UPDATE SET traditional = EXCLUDED.traditional, pinyin = EXCLUDED.pinyin,
                       definitions = EXCLUDED.definitions, audio_urls = EXCLUDED.audio_urls, source_url = EXCLUDED.source_url, fetched_at = now()",
                )
                .bind(new_id())
                .bind(&lookup.surface)
                .bind(*kind)
                .bind(&lookup.traditional)
                .bind(json!(lookup.pinyin))
                .bind(json!(lookup.definitions))
                .bind(json!(lookup.audio_urls))
                .bind(&lookup.source_url)
                .execute(&app.db)
                .await?;
            }
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushSummary {
    pub requested: usize,
    pub added: usize,
    pub skipped: usize,
}

/// Enrich a level and add its character/word notes to Anki (duplicates skipped).
pub async fn push_level(app: &App, user: &User, level: i64) -> Result<PushSummary, String> {
    let fail = |e: anyhow::Error| format!("{e:#}");
    let row: Option<(Value, Value)> = sqlx::query_as("SELECT characters, words FROM mandarin_blueprint_levels WHERE level = $1")
        .bind(level as i32)
        .fetch_optional(&app.db)
        .await
        .map_err(|e| fail(e.into()))?;
    let (characters, words) = row.ok_or("Import the Mandarin Blueprint catalog first.")?;
    let chinese = crate::db::course_id(&app.db, &user.id, "chinese")
        .await
        .map_err(|e| fail(e.into()))?
        .ok_or("The Chinese course is not initialized.")?;
    let entries = level_entries(&characters, &words);
    enrich_level(app, &entries).await.map_err(fail)?;
    let surfaces: Vec<String> = entries.iter().map(|e| e.0.clone()).collect();
    let cached: HashMap<(String, String), DictionaryEntry> = sqlx::query_as::<_, (String, String, Option<String>, Value, Value, Value, String)>(
        "SELECT surface, kind, traditional, pinyin, definitions, audio_urls, source_url FROM mandarin_dictionary_entries WHERE surface = ANY($1)",
    )
    .bind(&surfaces)
    .fetch_all(&app.db)
    .await
    .map_err(|e| fail(e.into()))?
    .into_iter()
    .map(|(surface, kind, traditional, pinyin, definitions, audio, source_url)| {
        let entry = DictionaryEntry {
            surface: surface.clone(),
            traditional,
            pinyin: crate::db::json_strings(&pinyin),
            definitions: crate::db::json_strings(&definitions),
            audio_urls: crate::db::json_strings(&audio),
            source_url,
        };
        ((kind, surface), entry)
    })
    .collect();

    let config = core_settings::mandarin_blueprint(&user.settings);
    let anki = Anki::new(app, &user.id);
    let anki_error = |e: crate::anki::AnkiError| e.to_string();
    for deck in [&config.character_deck_name, &config.reversed_character_deck_name, &config.word_deck_name] {
        anki.create_deck(deck).await.map_err(anki_error)?;
    }
    let models: HashSet<String> = anki.model_names().await.map_err(anki_error)?.into_iter().collect();
    for model in mandarin::anki_models() {
        let name = model.get("modelName").and_then(Value::as_str).unwrap_or_default().to_string();
        if !models.contains(&name) {
            anki.create_model(&model).await.map_err(anki_error)?;
        }
    }
    let notes: Vec<Value> = entries
        .iter()
        .flat_map(|(surface, kind)| {
            let entry = cached.get(&(kind.to_string(), surface.clone())).cloned().unwrap_or_else(|| DictionaryEntry {
                surface: surface.clone(),
                traditional: None,
                pinyin: vec![],
                definitions: vec![],
                audio_urls: vec![],
                source_url: mandarin::chisho_url(surface),
            });
            if *kind == "CHARACTER" {
                mandarin::character_notes(&entry, &config, level).to_vec()
            } else {
                vec![mandarin::word_note(&entry, &config, level)]
            }
        })
        .collect();
    // Filter duplicates first: newer AnkiConnect versions fail the whole
    // addNotes call when any note is a duplicate.
    let accepted = anki.can_add_notes(&notes).await.map_err(anki_error)?;
    let fresh: Vec<Value> = notes.iter().zip(&accepted).filter(|(_, ok)| **ok).map(|(n, _)| n.clone()).collect();
    let results = if fresh.is_empty() { vec![] } else { anki.add_notes(&fresh).await.map_err(anki_error)? };
    for (deck, counts) in [
        (&config.character_deck_name, false),
        (&config.reversed_character_deck_name, false),
        (&config.word_deck_name, true),
    ] {
        sqlx::query(
            "INSERT INTO anki_deck_mappings (id, user_id, deck_name, course_id, counts_known_words) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, deck_name) DO UPDATE SET course_id = EXCLUDED.course_id, counts_known_words = EXCLUDED.counts_known_words",
        )
        .bind(new_id())
        .bind(&user.id)
        .bind(deck)
        .bind(&chinese)
        .bind(counts)
        .execute(&app.db)
        .await
        .map_err(|e| fail(e.into()))?;
    }
    let added = results.iter().filter(|r| r.is_some()).count();
    Ok(PushSummary { requested: notes.len(), added, skipped: notes.len() - added })
}

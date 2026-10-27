//! Kanji Repair: one focused RTK intervention per day from Anki evidence.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use axum::Json;
use axum::extract::State;
use chrono::{DateTime, Duration, Utc};
use kaizen_core::anki_analytics::{LogRow, SnapshotRow};
use kaizen_core::kanji_repair::{self as kr, Candidate, EvidenceCard, KanjiExtract, RepairState, ScoreInput};
use kaizen_core::settings::{self as core_settings, KanjiRepairConfiguration};
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::{anki_logs, anki_snapshots, ok};
use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

/// The bundled RTK extract, parsed once.
static EXTRACT: LazyLock<KanjiExtract> = LazyLock::new(|| match serde_json::from_str::<Value>(kaizen_core::seed::KANJI_EXTRACT_JSON) {
    Ok(value) => kr::parse_kanji_extract(&value),
    Err(e) => KanjiExtract { entries: vec![], warnings: vec![], error: Some(format!("The RTK kanji extract could not be read: {e}")) },
});

struct Dashboard {
    config: KanjiRepairConfiguration,
    candidates: Vec<Candidate>,
    target: Option<Candidate>,
    repairs_today: usize,
    direct_decks: Vec<String>,
    vocabulary_decks: Vec<String>,
    last_synced_at: Option<DateTime<Utc>>,
}

fn matching_kanji(snapshot: &SnapshotRow, known: &HashSet<&str>, direct: bool) -> Vec<String> {
    let front: Vec<String> = kr::extract_kanji_characters(&snapshot.front).into_iter().filter(|k| known.contains(k.as_str())).collect();
    if !direct || front.len() == 1 {
        return front;
    }
    let back: Vec<String> = kr::extract_kanji_characters(&snapshot.back).into_iter().filter(|k| known.contains(k.as_str())).collect();
    if back.len() == 1 { back } else { vec![] }
}

fn evidence_cards(
    snapshots: &[SnapshotRow],
    logs_by_card: &HashMap<String, Vec<LogRow>>,
    mapping_ids: &HashSet<&str>,
    known: &HashSet<&str>,
    direct: bool,
) -> Vec<EvidenceCard> {
    snapshots
        .iter()
        .filter(|s| s.mapping_id.as_deref().is_some_and(|m| mapping_ids.contains(m)))
        .filter_map(|s| {
            let kanji = matching_kanji(s, known, direct);
            (!kanji.is_empty()).then(|| EvidenceCard {
                anki_card_id: s.anki_card_id.clone(),
                label: s.front.clone(),
                kanji,
                interval_days: s.interval_days as f64,
                ease: s.ease,
                lapses: s.lapses as i64,
                logs: logs_by_card.get(&s.anki_card_id).cloned().unwrap_or_default(),
            })
        })
        .collect()
}

async fn dashboard(app: &App, user: &User, now: DateTime<Utc>) -> ApiResult<Dashboard> {
    let config = core_settings::kanji_repair(&user.settings);
    let mut out = Dashboard {
        config,
        candidates: vec![],
        target: None,
        repairs_today: 0,
        direct_decks: vec![],
        vocabulary_decks: vec![],
        last_synced_at: None,
    };
    if EXTRACT.error.is_some() || EXTRACT.entries.is_empty() {
        return Ok(out);
    }
    let mappings: Vec<(String, String, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT m.id, m.deck_name, m.last_synced_at FROM anki_deck_mappings m JOIN courses c ON c.id = m.course_id
         WHERE m.user_id = $1 AND c.slug = 'japanese'",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    let (direct, vocabulary): (Vec<_>, Vec<_>) = mappings.iter().partition(|m| kr::is_direct_kanji_deck_name(&m.1));
    out.direct_decks = direct.iter().map(|m| m.1.clone()).collect();
    out.vocabulary_decks = vocabulary.iter().map(|m| m.1.clone()).collect();
    out.last_synced_at = mappings.iter().filter_map(|m| m.2).max();

    let ids: Vec<String> = mappings.iter().map(|m| m.0.clone()).collect();
    let snapshots = anki_snapshots(app, &ids).await?;
    let mut logs_by_card: HashMap<String, Vec<LogRow>> = HashMap::new();
    for log in anki_logs(app, &ids).await? {
        logs_by_card.entry(log.anki_card_id.clone()).or_default().push(log);
    }
    let known: HashSet<&str> = EXTRACT.entries.iter().map(|e| e.kanji.as_str()).collect();
    let direct_ids: HashSet<&str> = direct.iter().map(|m| m.0.as_str()).collect();
    let vocabulary_ids: HashSet<&str> = vocabulary.iter().map(|m| m.0.as_str()).collect();
    let direct_cards = evidence_cards(&snapshots, &logs_by_card, &direct_ids, &known, true);
    let vocabulary_cards = if config.use_vocabulary_performance {
        evidence_cards(&snapshots, &logs_by_card, &vocabulary_ids, &known, false)
    } else {
        vec![]
    };
    let states: Vec<RepairState> = sqlx::query_as::<_, (String, DateTime<Utc>, DateTime<Utc>, i32, f64)>(
        "SELECT kanji, last_repaired_at, cooldown_until, repair_count, last_repair_score FROM kanji_repair_states WHERE user_id = $1",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?
    .into_iter()
    .map(|(kanji, last_repaired_at, cooldown_until, repair_count, last_repair_score)| RepairState {
        kanji,
        last_repaired_at,
        cooldown_until,
        repair_count: repair_count as i64,
        last_repair_score,
    })
    .collect();
    let mut scoring = kr::DEFAULTS;
    scoring.cooldown_days = config.cooldown_days;
    out.candidates = kr::score_candidates(ScoreInput {
        entries: &EXTRACT.entries,
        direct_cards: &direct_cards,
        vocabulary_cards: &vocabulary_cards,
        repair_states: &states,
        use_vocabulary_performance: config.use_vocabulary_performance,
        now,
        config: scoring,
    });
    let (start, end) = kaizen_core::time::day_bounds(now, user.tz);
    out.repairs_today = states.iter().filter(|s| s.last_repaired_at >= start && s.last_repaired_at < end).count();
    if out.repairs_today < kr::DEFAULTS.daily_repair_limit {
        out.target = kr::select_target(&out.candidates).cloned();
    }
    Ok(out)
}

/// A prompt the learner can send to the AI to rebuild a failing mnemonic.
fn mnemonic_prompt(candidate: &Candidate) -> String {
    let entry = &candidate.entry;
    let keyword = entry.keyword.as_deref().unwrap_or("(keyword unavailable)");
    let frame = entry.rtk_number.map(|n| format!(" (RTK frame #{n})")).unwrap_or_default();
    format!(
        "I keep failing the Remembering the Kanji card for {kanji}{frame}, keyword \"{keyword}\". \
In my recent reviews I pressed Again {again} times and Hard {hard} times out of {reviews}, with {lapses} lapses.\n\n\
Help me repair it:\n\
1. Break {kanji} into its RTK primitives (use Heisig's primitive names) and say which part is most likely confusing me.\n\
2. Give me two vivid, concrete mnemonic stories that tie those primitives to the keyword \"{keyword}\". Keep each under 50 words.\n\
3. Name one similar-looking kanji I might confuse it with and a one-line way to tell them apart.\n\
4. End with a quick self-test: ask me to write it from the keyword.",
        kanji = entry.kanji,
        again = candidate.direct.again,
        hard = candidate.direct.hard,
        reviews = candidate.direct.reviews,
        lapses = candidate.direct.lapses,
    )
}

pub async fn page(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let now = Utc::now();
    let d = dashboard(&app, &user, now).await?;
    let ranked: Vec<&Candidate> = d.candidates.iter().filter(|c| c.direct.reviews > 0 || c.vocabulary.available).take(20).collect();
    Ok(Json(json!({
        "config": d.config,
        "source": { "entries": EXTRACT.entries.len(), "warnings": EXTRACT.warnings.iter().take(50).collect::<Vec<_>>(), "error": EXTRACT.error },
        "dailyLimit": kr::DEFAULTS.daily_repair_limit,
        "repairsToday": d.repairs_today,
        "dailyComplete": d.repairs_today >= kr::DEFAULTS.daily_repair_limit,
        "directDecks": d.direct_decks,
        "vocabularyDecks": d.vocabulary_decks,
        "lastSyncedAt": d.last_synced_at,
        "target": d.target.as_ref().map(|t| json!({ "candidate": t, "mnemonicPrompt": mnemonic_prompt(t) })),
        "ranked": ranked,
    })))
}

#[derive(Deserialize)]
pub struct CompleteBody {
    kanji: String,
}

pub async fn complete(State(app): State<App>, user: User, Json(body): Json<CompleteBody>) -> ApiResult<Json<Value>> {
    let kanji = body.kanji.trim();
    if kanji.chars().count() != 1 || kr::extract_kanji_characters(kanji).len() != 1 {
        return Err(ApiError::bad("Choose a single kanji."));
    }
    let now = Utc::now();
    let d = dashboard(&app, &user, now).await?;
    let Some(target) = d.target.filter(|t| t.entry.kanji == kanji) else {
        return Err(ApiError::Conflict("That kanji is no longer today's repair target. Reload the page.".into()));
    };
    let cooldown_until = now + Duration::days(d.config.cooldown_days);
    sqlx::query(
        "INSERT INTO kanji_repair_states (id, user_id, kanji, last_repaired_at, cooldown_until, repair_count, last_repair_score, performance_at_repair)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
         ON CONFLICT (user_id, kanji) DO UPDATE SET last_repaired_at = EXCLUDED.last_repaired_at, cooldown_until = EXCLUDED.cooldown_until,
           repair_count = kanji_repair_states.repair_count + 1, last_repair_score = EXCLUDED.last_repair_score,
           performance_at_repair = EXCLUDED.performance_at_repair, updated_at = now()",
    )
    .bind(new_id())
    .bind(&user.id)
    .bind(kanji)
    .bind(now)
    .bind(cooldown_until)
    .bind(target.score)
    .bind(kr::performance_snapshot(&target, now))
    .execute(&app.db)
    .await?;
    Ok(ok())
}

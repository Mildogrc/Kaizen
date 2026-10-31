//! Analytics over Anki card snapshots and review logs.

use std::collections::{BTreeSet, HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

use crate::time::{date_key, day_key, local_date, start_of_day, streak_from_dates};
use crate::util::{js_round, to_fixed};

const MATURE_DAYS: i32 = 21;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CardState {
    New,
    Learning,
    Young,
    Mature,
    Suspended,
    Buried,
}

impl CardState {
    pub fn as_str(self) -> &'static str {
        match self {
            CardState::New => "NEW",
            CardState::Learning => "LEARNING",
            CardState::Young => "YOUNG",
            CardState::Mature => "MATURE",
            CardState::Suspended => "SUSPENDED",
            CardState::Buried => "BURIED",
        }
    }

    pub fn parse(value: &str) -> CardState {
        match value {
            "LEARNING" => CardState::Learning,
            "YOUNG" => CardState::Young,
            "MATURE" => CardState::Mature,
            "SUSPENDED" => CardState::Suspended,
            "BURIED" => CardState::Buried,
            _ => CardState::New,
        }
    }

    pub fn is_scheduled(self) -> bool {
        matches!(self, CardState::Learning | CardState::Young | CardState::Mature)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRow {
    pub anki_card_id: String,
    /// deck mapping this card belongs to
    pub mapping_id: Option<String>,
    pub front: String,
    pub back: String,
    pub state: CardState,
    pub interval_days: i32,
    pub ease: f64,
    pub due_at: Option<DateTime<Utc>>,
    pub reps: i32,
    pub lapses: i32,
    pub is_leech: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRow {
    pub anki_card_id: String,
    pub reviewed_at: DateTime<Utc>,
    /// 1=again 2=hard 3=good 4=easy
    pub rating: i32,
    pub interval_before_days: i32,
    pub interval_after_days: i32,
    pub time_ms: i64,
}

// ------------------------------------------------------------------ Activity

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayActivity {
    pub date: String,
    pub reviews: u32,
    pub minutes: i64,
}

/// Reviews per calendar day for the trailing `days` window (inclusive of today).
pub fn reviews_per_day(logs: &[LogRow], days: usize, now: DateTime<Utc>, tz: Tz) -> Vec<DayActivity> {
    let mut by_day: HashMap<chrono::NaiveDate, (u32, i64)> = HashMap::new();
    for log in logs {
        let entry = by_day.entry(local_date(log.reviewed_at, tz)).or_default();
        entry.0 += 1;
        entry.1 += log.time_ms;
    }
    crate::time::trailing_dates(now, tz, days)
        .into_iter()
        .map(|date| {
            let (reviews, ms) = by_day.get(&date).copied().unwrap_or_default();
            DayActivity { date: date_key(date), reviews, minutes: js_round(ms as f64 / 60_000.0) as i64 }
        })
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Streaks {
    pub current: u32,
    pub best: u32,
}

/// Current streak (today counts if reviewed; else from yesterday) and best streak.
pub fn streaks(logs: &[LogRow], now: DateTime<Utc>, tz: Tz) -> Streaks {
    let dates: BTreeSet<_> = logs.iter().map(|l| local_date(l.reviewed_at, tz)).collect();
    let (current, best) = streak_from_dates(&dates, local_date(now, tz));
    Streaks { current, best }
}

// ----------------------------------------------------------------- Retention

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionStats {
    pub overall: Option<f64>,
    pub young: Option<f64>,
    pub mature: Option<f64>,
    pub lapses: usize,
    pub review_count: usize,
}

/// Pass rate (rating > 1) over review-stage answers (interval ≥ 1 day before).
pub fn retention(logs: &[LogRow]) -> RetentionStats {
    let review: Vec<&LogRow> = logs.iter().filter(|l| l.interval_before_days >= 1).collect();
    let split = |subset: &[&LogRow]| {
        if subset.is_empty() {
            None
        } else {
            Some(subset.iter().filter(|l| l.rating > 1).count() as f64 / subset.len() as f64)
        }
    };
    let young: Vec<&LogRow> = review.iter().copied().filter(|l| l.interval_before_days < MATURE_DAYS).collect();
    let mature: Vec<&LogRow> = review.iter().copied().filter(|l| l.interval_before_days >= MATURE_DAYS).collect();
    RetentionStats {
        overall: split(&review),
        young: split(&young),
        mature: split(&mature),
        lapses: review.iter().filter(|l| l.rating == 1).count(),
        review_count: review.len(),
    }
}

// ------------------------------------------------------------------ Forecast

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ForecastDay {
    pub date: String,
    pub due: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Forecast {
    pub overdue: u32,
    pub days: Vec<ForecastDay>,
}

/// Cards due per day for the next `days` days, plus the overdue backlog.
pub fn forecast(snapshots: &[SnapshotRow], days: usize, now: DateTime<Utc>, tz: Tz) -> Forecast {
    let today = start_of_day(now, tz);
    let mut overdue = 0u32;
    let mut buckets: HashMap<chrono::NaiveDate, u32> = HashMap::new();
    for s in snapshots {
        let (Some(due), true) = (s.due_at, s.state.is_scheduled()) else { continue };
        if due < today {
            overdue += 1;
        } else {
            *buckets.entry(local_date(due, tz)).or_default() += 1;
        }
    }
    let first = local_date(now, tz);
    let mut out: Vec<ForecastDay> = (0..days)
        .map(|i| {
            let date = first + Duration::days(i as i64);
            ForecastDay { date: date_key(date), due: buckets.get(&date).copied().unwrap_or(0) }
        })
        .collect();
    // Overdue cards land on today in practice.
    if let Some(first) = out.first_mut() {
        first.due += overdue;
    }
    Forecast { overdue, days: out }
}

// -------------------------------------------------------------------- Health

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LabelCount {
    pub label: String,
    pub count: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStats {
    pub states: HashMap<&'static str, u32>,
    pub ease_histogram: Vec<LabelCount>,
    pub interval_buckets: Vec<LabelCount>,
}

pub fn state_counts(snapshots: &[SnapshotRow]) -> HashMap<&'static str, u32> {
    let mut states: HashMap<&'static str, u32> =
        ["NEW", "LEARNING", "YOUNG", "MATURE", "SUSPENDED", "BURIED"].into_iter().map(|k| (k, 0)).collect();
    for s in snapshots {
        *states.entry(s.state.as_str()).or_default() += 1;
    }
    states
}

pub fn health(snapshots: &[SnapshotRow]) -> HealthStats {
    let ease_bounds = [1.3, 1.7, 2.1, 2.5, 2.9];
    let graded: Vec<&SnapshotRow> =
        snapshots.iter().filter(|s| matches!(s.state, CardState::Young | CardState::Mature)).collect();
    let ease_histogram = ease_bounds
        .iter()
        .enumerate()
        .map(|(i, lo)| {
            let hi = ease_bounds.get(i + 1).copied().unwrap_or(f64::INFINITY);
            let label = if hi.is_infinite() {
                format!("{}+", to_fixed(*lo, 1))
            } else {
                format!("{}–{}", to_fixed(*lo, 1), to_fixed(hi, 1))
            };
            LabelCount { label, count: graded.iter().filter(|s| s.ease >= *lo && s.ease < hi).count() as u32 }
        })
        .collect();
    let interval_bounds: [(&str, i32, i32); 5] =
        [("<1w", 1, 7), ("1w–1m", 7, 30), ("1–3m", 30, 90), ("3m–1y", 90, 365), ("1y+", 365, i32::MAX)];
    let interval_buckets = interval_bounds
        .iter()
        .map(|(label, lo, hi)| LabelCount {
            label: (*label).to_string(),
            count: snapshots
                .iter()
                .filter(|s| s.interval_days >= 1 && s.interval_days >= *lo && s.interval_days < *hi)
                .count() as u32,
        })
        .collect();
    HealthStats { states: state_counts(snapshots), ease_histogram, interval_buckets }
}

// --------------------------------------------------------------- Projections

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Projection {
    pub label: String,
    pub detail: String,
    /// YYYY-MM-DD, None = not estimable
    pub date: Option<String>,
    /// "low" | "ok"
    pub confidence: &'static str,
}

#[derive(Clone, Debug)]
pub struct ProjectionGoal {
    pub title: String,
    pub target_value: i64,
    pub current_value: Option<i64>,
}

const PACE_WINDOW_DAYS: i64 = 30;
const MIN_ACTIVE_DAYS: usize = 7;

struct Pace {
    per_day: f64,
    active_days: usize,
}

fn pace(events: &[DateTime<Utc>], now: DateTime<Utc>, tz: Tz) -> Pace {
    let cutoff = start_of_day(now, tz) - Duration::days(PACE_WINDOW_DAYS);
    let recent: Vec<&DateTime<Utc>> = events.iter().filter(|d| **d >= cutoff).collect();
    let active_days = recent.iter().map(|d| local_date(**d, tz)).collect::<HashSet<_>>().len();
    Pace { per_day: recent.len() as f64 / PACE_WINDOW_DAYS as f64, active_days }
}

fn project_date(remaining: i64, per_day: f64, now: DateTime<Utc>, tz: Tz) -> Option<String> {
    if per_day <= 0.0 || remaining <= 0 {
        return if remaining <= 0 { Some(day_key(now, tz)) } else { None };
    }
    let days = (remaining as f64 / per_day).ceil() as i64;
    Some(date_key(local_date(now, tz) + Duration::days(days)))
}

/// Forward-looking estimates from recent pace: intro pace = first-ever reviews
/// per day; maturation pace = young→mature crossings per day.
pub fn projections(
    snapshots: &[SnapshotRow],
    logs: &[LogRow],
    goal: Option<&ProjectionGoal>,
    now: DateTime<Utc>,
    tz: Tz,
) -> Vec<Projection> {
    let mut out = Vec::new();

    let mut sorted: Vec<&LogRow> = logs.iter().collect();
    sorted.sort_by_key(|l| l.reviewed_at);
    let mut first_seen: HashMap<&str, DateTime<Utc>> = HashMap::new();
    for log in sorted {
        first_seen.entry(log.anki_card_id.as_str()).or_insert(log.reviewed_at);
    }
    let intro_events: Vec<DateTime<Utc>> = first_seen.into_values().collect();
    let intro = pace(&intro_events, now, tz);
    let new_remaining = snapshots.iter().filter(|s| s.state == CardState::New).count() as i64;
    out.push(Projection {
        label: "All new cards introduced".into(),
        detail: format!(
            "{new_remaining} new cards left at ~{}/day (last {PACE_WINDOW_DAYS}d)",
            to_fixed(intro.per_day, 1)
        ),
        date: project_date(new_remaining, intro.per_day, now, tz),
        confidence: if intro.active_days >= MIN_ACTIVE_DAYS { "ok" } else { "low" },
    });

    let matured: Vec<DateTime<Utc>> = logs
        .iter()
        .filter(|l| l.interval_before_days < MATURE_DAYS && l.interval_after_days >= MATURE_DAYS)
        .map(|l| l.reviewed_at)
        .collect();
    let mature_pace = pace(&matured, now, tz);
    let mature_count = snapshots.iter().filter(|s| s.state == CardState::Mature).count() as i64;
    let immature = snapshots
        .iter()
        .filter(|s| !matches!(s.state, CardState::Mature | CardState::Suspended | CardState::Buried))
        .count() as i64;
    let mature_confidence = if mature_pace.active_days >= MIN_ACTIVE_DAYS { "ok" } else { "low" };
    out.push(Projection {
        label: "Whole deck mature".into(),
        detail: format!("{immature} cards not yet mature at ~{} maturing/day", to_fixed(mature_pace.per_day, 1)),
        date: project_date(immature, mature_pace.per_day, now, tz),
        confidence: mature_confidence,
    });

    if let Some(goal) = goal.filter(|g| g.target_value > 0) {
        let current = goal.current_value.unwrap_or(mature_count);
        let remaining = goal.target_value - current;
        out.push(Projection {
            label: format!("Goal: {}", goal.title),
            detail: format!(
                "{} to go (counting mature cards) at ~{}/day",
                remaining.max(0),
                to_fixed(mature_pace.per_day, 1)
            ),
            date: project_date(remaining, mature_pace.per_day, now, tz),
            confidence: mature_confidence,
        });
    }
    out
}

// ------------------------------------------------------------------- Leeches

/// Leech cards, most lapses first.
pub fn leeches(snapshots: &[SnapshotRow]) -> Vec<SnapshotRow> {
    let mut out: Vec<SnapshotRow> = snapshots.iter().filter(|s| s.is_leech).cloned().collect();
    out.sort_by_key(|c| std::cmp::Reverse(c.lapses));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn tz() -> Tz {
        chrono_tz::America::Los_Angeles
    }
    fn now() -> DateTime<Utc> {
        tz().with_ymd_and_hms(2026, 7, 16, 15, 0, 0).unwrap().with_timezone(&Utc)
    }
    fn at(days_ago: i64) -> DateTime<Utc> {
        now() - Duration::days(days_ago)
    }
    fn log(card: &str, reviewed_at: DateTime<Utc>) -> LogRow {
        LogRow {
            anki_card_id: card.into(),
            reviewed_at,
            rating: 3,
            interval_before_days: 10,
            interval_after_days: 25,
            time_ms: 6000,
        }
    }
    fn snap(state: CardState, due_at: Option<DateTime<Utc>>) -> SnapshotRow {
        SnapshotRow {
            anki_card_id: "1".into(),
            mapping_id: None,
            front: "你好".into(),
            back: "nǐ hǎo — hello".into(),
            state,
            interval_days: 10,
            ease: 2.5,
            due_at,
            reps: 3,
            lapses: 0,
            is_leech: false,
        }
    }

    #[test]
    fn reviews_per_day_zero_fills() {
        let logs = vec![log("1", at(0)), log("1", at(0)), log("1", at(2))];
        let series = reviews_per_day(&logs, 4, now(), tz());
        assert_eq!(series.len(), 4);
        assert_eq!(series[3].reviews, 2);
        assert_eq!(series[2].reviews, 0);
        assert_eq!(series[1].reviews, 1);
        assert_eq!(series[3].minutes, 0);
    }

    #[test]
    fn streak_rules() {
        let logs: Vec<_> = [1, 2, 3].iter().map(|d| log("1", at(*d))).collect();
        assert_eq!(streaks(&logs, now(), tz()).current, 3);
        let logs: Vec<_> = [0, 1, 3, 4, 5, 6].iter().map(|d| log("1", at(*d))).collect();
        assert_eq!(streaks(&logs, now(), tz()), Streaks { current: 2, best: 4 });
        assert_eq!(streaks(&[log("1", at(5))], now(), tz()).current, 0);
    }

    #[test]
    fn retention_splits_young_and_mature() {
        let mk = |before: i32, rating: i32| LogRow { interval_before_days: before, rating, ..log("1", now()) };
        let r = retention(&[mk(0, 1), mk(5, 3), mk(5, 1), mk(30, 3), mk(40, 4)]);
        assert_eq!(r.review_count, 4);
        assert!((r.young.unwrap() - 0.5).abs() < 1e-9);
        assert_eq!(r.mature, Some(1.0));
        assert!((r.overall.unwrap() - 0.75).abs() < 1e-9);
        assert_eq!(r.lapses, 1);
        assert_eq!(retention(&[]).overall, None);
    }

    #[test]
    fn forecast_rolls_overdue_into_today() {
        let day = Duration::days(1);
        let snaps = vec![
            snap(CardState::Young, Some(at(3))),
            snap(CardState::Young, Some(now())),
            snap(CardState::Young, Some(now() + day)),
            snap(CardState::Young, Some(now() + day)),
            snap(CardState::New, None),
            snap(CardState::Suspended, Some(now())),
        ];
        let f = forecast(&snaps, 3, now(), tz());
        assert_eq!(f.overdue, 1);
        assert_eq!(f.days[0].due, 2);
        assert_eq!(f.days[1].due, 2);
        assert_eq!(f.days[2].due, 0);
    }

    #[test]
    fn health_counts_and_buckets() {
        let snaps = vec![
            SnapshotRow { interval_days: 0, ..snap(CardState::New, None) },
            SnapshotRow { interval_days: 400, ease: 2.8, ..snap(CardState::Mature, None) },
            SnapshotRow { interval_days: 10, ease: 1.4, ..snap(CardState::Young, None) },
        ];
        let h = health(&snaps);
        assert_eq!(h.states["NEW"], 1);
        assert_eq!(h.states["MATURE"], 1);
        assert_eq!(h.interval_buckets.iter().find(|b| b.label == "1y+").unwrap().count, 1);
        assert_eq!(h.interval_buckets.iter().find(|b| b.label == "1w–1m").unwrap().count, 1);
        assert_eq!(h.ease_histogram.iter().find(|b| b.label == "1.3–1.7").unwrap().count, 1);
    }

    #[test]
    fn projections_from_pace() {
        let mut logs = Vec::new();
        for d in 0..10 {
            logs.push(LogRow { interval_before_days: 0, ..log(&format!("a{d}"), at(d)) });
            logs.push(LogRow { interval_before_days: 0, ..log(&format!("b{d}"), at(d)) });
        }
        let snaps: Vec<_> = (0..20)
            .map(|i| SnapshotRow { anki_card_id: format!("new{i}"), ..snap(CardState::New, None) })
            .collect();
        let p = projections(&snaps, &logs, None, now(), tz());
        assert_eq!(p[0].date.as_deref(), Some("2026-08-15"));
        assert_eq!(p[0].confidence, "ok");

        let sparse = projections(&[snap(CardState::New, None)], &[], None, now(), tz());
        assert_eq!(sparse[0].confidence, "low");
        assert_eq!(sparse[0].date, None);

        let logs: Vec<_> = (0..15)
            .map(|d| LogRow { interval_before_days: 15, interval_after_days: 30, ..log(&format!("m{d}"), at(d)) })
            .collect();
        let goal = ProjectionGoal { title: "Reach 500 words".into(), target_value: 500, current_value: Some(485) };
        let p = projections(&[], &logs, Some(&goal), now(), tz());
        let g = p.iter().find(|p| p.label.starts_with("Goal")).unwrap();
        assert_eq!(g.date.as_deref(), Some("2026-08-15"));
    }
}

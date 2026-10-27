//! Adaptive Japanese Anki new-card budget: evidence extraction per Anki day and
//! the conservative controller (see docs in the original repo,
//! `docs/adaptive_anki_card_budget.md`).

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

use crate::time::{date_key, local_to_utc, parse_date_key};
use crate::util::{median, to_fixed};

pub mod defaults {
    pub const ENABLED: bool = false;
    pub const STARTING_BUDGET: i64 = 10;
    pub const MAXIMUM_BUDGET: i64 = 40;
    pub const COLD_START_PROTECTION: bool = true;
    pub const TARGET_REVIEW_MINUTES: i64 = 60;
    pub const ANKI_DAY_START_HOUR: i64 = 4;
}

pub mod controller {
    pub const EVIDENCE_WINDOW_DAYS: usize = 7;
    pub const MINIMUM_REVIEW_OBSERVATIONS: usize = 20;
    pub const MINIMUM_VALID_TIME_RATIO: f64 = 0.8;
    pub const MINIMUM_COMPLETION_DAYS_FOR_INCREASE: usize = 3;
    pub const COMPLETION_INCREASE_THRESHOLD: f64 = 0.95;
    pub const CONFIDENCE_STEP_DAYS: i64 = 7;
    pub const CONFIDENCE_STEP_CARDS: i64 = 2;
    pub const MAXIMUM_VALID_REVIEW_TIME_MS: i64 = 120_000;
    pub const MODERATE_BACKLOG_MINIMUM: f64 = 10.0;
    pub const SERIOUS_BACKLOG_MINIMUM: f64 = 20.0;
}

#[derive(Clone, Debug)]
pub struct AdaptiveReviewLog {
    pub anki_card_id: String,
    pub reviewed_at: DateTime<Utc>,
    pub rating: i32,
    pub time_ms: i64,
    pub review_type: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveEvidenceDay {
    pub anki_day: String,
    pub review_observations: i32,
    pub reviewed_card_count: i32,
    pub reviewed_card_ids: Vec<String>,
    pub lapsed_card_ids: Vec<String>,
    pub review_minutes: Option<f64>,
    pub valid_time_observations: i32,
    pub reviews_due: Option<i32>,
    pub reviews_completed: i32,
    pub completion_rate: Option<f64>,
    pub retention: Option<f64>,
    pub reliable: bool,
    pub data_available: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct AdaptiveBudgetSettings {
    pub starting_budget: i64,
    pub maximum_budget: i64,
    pub cold_start_protection: bool,
    pub target_review_minutes: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveBudgetDecision {
    pub previous_budget: i64,
    pub performance_target: i64,
    pub confidence_ceiling: i64,
    pub final_budget: i64,
    pub window_retention: Option<f64>,
    pub retention_adjustment: i64,
    pub median_review_minutes: Option<f64>,
    pub review_time_adjustment: i64,
    pub repeat_lapse_rate: Option<f64>,
    pub lapse_adjustment: i64,
    pub completion_rate: Option<f64>,
    pub backlog_ratio: Option<f64>,
    pub reliable_window_days: i64,
    pub reasons: Vec<String>,
}

/// Whether a decision's Anki application may be (re)claimed by this request.
pub fn application_is_claimable(status: &str, last_apply_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    let stale_after = Duration::minutes(5);
    status == "pending"
        || status == "failed"
        || (status == "applying" && last_apply_at.is_none_or(|at| now - at >= stale_after))
}

/// Local calendar date after shifting back by the Anki day-start hour.
pub fn anki_day_key(date: DateTime<Utc>, day_start_hour: i64, tz: Tz) -> String {
    let shifted = date.with_timezone(&tz).naive_local() - Duration::hours(day_start_hour);
    date_key(shifted.date())
}

/// `[start, end)` of an Anki day: local `dayStartHour:00` plus 24 hours.
pub fn anki_day_bounds(day: &str, day_start_hour: i64, tz: Tz) -> (DateTime<Utc>, DateTime<Utc>) {
    let date = parse_date_key(day).unwrap_or(NaiveDate::MIN);
    let start_time = NaiveTime::from_hms_opt(day_start_hour.clamp(0, 23) as u32, 0, 0).unwrap_or(NaiveTime::MIN);
    let start = local_to_utc(date.and_time(start_time), tz);
    (start, start + Duration::days(1))
}

pub fn next_day_key(day: &str) -> String {
    let date = parse_date_key(day).unwrap_or(NaiveDate::MIN);
    date_key(date + Duration::days(1))
}

pub struct EvidenceInput<'a> {
    pub day: &'a str,
    pub day_start_hour: i64,
    pub activation_day: &'a str,
    pub logs: &'a [AdaptiveReviewLog],
    pub reviews_due: Option<i32>,
    pub data_available: bool,
    pub current_day: &'a str,
    pub tz: Tz,
}

pub fn summarize_evidence_day(input: EvidenceInput<'_>) -> AdaptiveEvidenceDay {
    let (start, end) = anki_day_bounds(input.day, input.day_start_hour, input.tz);
    let mut logs: Vec<&AdaptiveReviewLog> =
        input.logs.iter().filter(|log| log.reviewed_at >= start && log.reviewed_at < end).collect();
    logs.sort_by_key(|log| log.reviewed_at);

    fn valid_time(log: &AdaptiveReviewLog) -> bool {
        log.time_ms > 0 && log.time_ms <= controller::MAXIMUM_VALID_REVIEW_TIME_MS
    }

    // True retention: the first review-card attempt per card per day.
    let mut seen = HashSet::new();
    let observations: Vec<&AdaptiveReviewLog> = logs
        .iter()
        .copied()
        .filter(|log| log.review_type == Some(1) && seen.insert(log.anki_card_id.as_str()))
        .collect();
    let valid_observation_times = observations.iter().filter(|log| valid_time(log)).count();
    let valid_times: Vec<&&AdaptiveReviewLog> = logs.iter().filter(|log| valid_time(log)).collect();
    let completed_ids: HashSet<&str> = logs
        .iter()
        .filter(|log| matches!(log.review_type, Some(1) | Some(2)))
        .map(|log| log.anki_card_id.as_str())
        .collect();
    let mut reviewed_card_ids: Vec<String> = Vec::new();
    let mut reviewed_seen = HashSet::new();
    for log in &observations {
        if reviewed_seen.insert(log.anki_card_id.as_str()) {
            reviewed_card_ids.push(log.anki_card_id.clone());
        }
    }
    let failures: Vec<&&AdaptiveReviewLog> = observations.iter().filter(|log| log.rating == 1).collect();
    let retention = if observations.is_empty() {
        None
    } else {
        Some((observations.len() - failures.len()) as f64 / observations.len() as f64)
    };
    let completion_rate = match input.reviews_due {
        None => None,
        Some(0) => Some(1.0),
        Some(due) => Some((completed_ids.len() as f64 / due as f64).min(1.0)),
    };
    let reliable = input.data_available
        && input.day != input.activation_day
        && input.day < input.current_day
        && observations.len() >= controller::MINIMUM_REVIEW_OBSERVATIONS
        && valid_observation_times as f64 / observations.len() as f64 >= controller::MINIMUM_VALID_TIME_RATIO;

    AdaptiveEvidenceDay {
        anki_day: input.day.to_string(),
        review_observations: observations.len() as i32,
        reviewed_card_count: reviewed_card_ids.len() as i32,
        reviewed_card_ids,
        lapsed_card_ids: failures.iter().map(|log| log.anki_card_id.clone()).collect(),
        review_minutes: if valid_times.is_empty() {
            None
        } else {
            Some(valid_times.iter().map(|log| log.time_ms).sum::<i64>() as f64 / 60_000.0)
        },
        valid_time_observations: valid_observation_times as i32,
        reviews_due: input.reviews_due,
        reviews_completed: completed_ids.len() as i32,
        completion_rate,
        retention,
        reliable,
        data_available: input.data_available,
    }
}

pub struct BudgetInput<'a> {
    pub previous_budget: i64,
    pub reliable_data_days: i64,
    pub evidence: &'a [AdaptiveEvidenceDay],
    pub overdue_count: i64,
    pub settings: AdaptiveBudgetSettings,
}

pub fn calculate_budget(input: BudgetInput<'_>) -> AdaptiveBudgetDecision {
    let mut recent: Vec<&AdaptiveEvidenceDay> = input.evidence.iter().filter(|day| day.reliable).collect();
    recent.sort_by(|a, b| b.anki_day.cmp(&a.anki_day));
    recent.truncate(controller::EVIDENCE_WINDOW_DAYS);

    let observation_total: i64 = recent.iter().map(|day| day.review_observations as i64).sum();
    let retained_total: f64 =
        recent.iter().map(|day| day.retention.unwrap_or(0.0) * day.review_observations as f64).sum();
    let window_retention = if observation_total > 0 { Some(retained_total / observation_total as f64) } else { None };
    let retention_adjustment = match window_retention {
        None => 0,
        Some(r) if r >= 0.94 => 3,
        Some(r) if r >= 0.91 => 2,
        Some(r) if r >= 0.87 => 0,
        Some(r) if r >= 0.82 => -3,
        Some(_) => -6,
    };
    let minutes: Vec<f64> = recent.iter().filter_map(|day| day.review_minutes).collect();
    let median_review_minutes = median(&minutes);
    let target = input.settings.target_review_minutes as f64;
    let review_time_adjustment = match median_review_minutes {
        None => 0,
        Some(m) if m < target * 0.5 => 2,
        Some(m) if m <= target => 0,
        Some(m) if m <= target * 1.5 => -2,
        Some(_) => -5,
    };
    let mut lapse_days_by_card: HashMap<&str, i64> = HashMap::new();
    let mut reviewed_cards: HashSet<&str> = HashSet::new();
    for day in &recent {
        for card in &day.reviewed_card_ids {
            reviewed_cards.insert(card);
        }
        let lapsed: HashSet<&str> = day.lapsed_card_ids.iter().map(String::as_str).collect();
        for card in lapsed {
            *lapse_days_by_card.entry(card).or_default() += 1;
        }
    }
    let repeated_lapsers = lapse_days_by_card.values().filter(|days| **days >= 2).count();
    let repeat_lapse_rate =
        if reviewed_cards.is_empty() { None } else { Some(repeated_lapsers as f64 / reviewed_cards.len() as f64) };
    let lapse_adjustment = match repeat_lapse_rate {
        None => 0,
        Some(r) if r < 0.1 => 0,
        Some(r) if r < 0.15 => -2,
        Some(r) if r < 0.2 => -4,
        Some(_) => -7,
    };
    let completion_days: Vec<&&AdaptiveEvidenceDay> = recent.iter().filter(|day| day.reviews_due.is_some()).collect();
    let due_total: i64 = completion_days.iter().map(|day| day.reviews_due.unwrap_or(0) as i64).sum();
    let completed_total: i64 = completion_days.iter().map(|day| day.reviews_completed as i64).sum();
    let completion_rate = if completion_days.is_empty() {
        None
    } else if due_total == 0 {
        Some(1.0)
    } else {
        Some((completed_total as f64 / due_total as f64).min(1.0))
    };
    let performance_target = (input.previous_budget + retention_adjustment + review_time_adjustment + lapse_adjustment)
        .max(0)
        .min(input.settings.maximum_budget);
    let confidence_ceiling = if input.settings.cold_start_protection {
        input.settings.maximum_budget.min(
            input.settings.starting_budget
                + controller::CONFIDENCE_STEP_CARDS * (input.reliable_data_days / controller::CONFIDENCE_STEP_DAYS),
        )
    } else {
        input.settings.maximum_budget
    };
    let mut reasons = Vec::new();
    let mut final_budget = if performance_target > input.previous_budget {
        performance_target.min(confidence_ceiling)
    } else {
        performance_target
    };
    if performance_target > input.previous_budget
        && (completion_days.len() < controller::MINIMUM_COMPLETION_DAYS_FOR_INCREASE
            || completion_rate.is_none_or(|rate| rate < controller::COMPLETION_INCREASE_THRESHOLD))
    {
        final_budget = final_budget.min(input.previous_budget);
        reasons.push("Increase blocked until at least three reliable days have 95% review completion.".to_string());
    }
    if performance_target > confidence_ceiling {
        reasons.push(format!("Cold-start ceiling limited the budget to {confidence_ceiling}."));
    }
    let counts: Vec<f64> = recent.iter().map(|day| day.reviewed_card_count as f64).collect();
    let normal_workload = median(&counts).unwrap_or(0.0);
    let moderate_threshold = controller::MODERATE_BACKLOG_MINIMUM.max(normal_workload);
    let serious_threshold = controller::SERIOUS_BACKLOG_MINIMUM.max(normal_workload * 2.0);
    let backlog_ratio = if normal_workload > 0.0 { Some(input.overdue_count as f64 / normal_workload) } else { None };
    let overdue = input.overdue_count as f64;
    if overdue >= serious_threshold {
        final_budget = 0;
        reasons.push("A serious overdue-review backlog paused new cards.".to_string());
    } else if overdue >= moderate_threshold {
        final_budget = final_budget.min(input.previous_budget.div_euclid(2));
        reasons.push("An overdue-review backlog halved the new-card budget.".to_string());
    }
    if let Some(r) = window_retention {
        reasons.push(format!("Recent true retention was {}%.", to_fixed(r * 100.0, 1)));
    }
    if let Some(m) = median_review_minutes {
        reasons.push(format!("Median daily review time was {} minutes.", to_fixed(m, 1)));
    }
    if recent.is_empty() {
        reasons.push("No reliable post-activation evidence yet; the starting budget remains conservative.".to_string());
    }

    AdaptiveBudgetDecision {
        previous_budget: input.previous_budget,
        performance_target,
        confidence_ceiling,
        final_budget,
        window_retention,
        retention_adjustment,
        median_review_minutes,
        review_time_adjustment,
        repeat_lapse_rate,
        lapse_adjustment,
        completion_rate,
        backlog_ratio,
        reliable_window_days: recent.len() as i64,
        reasons,
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckCapacity {
    pub mapping_id: String,
    pub deck_name: String,
    pub available_new: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckAllocation {
    pub mapping_id: String,
    pub deck_name: String,
    pub available_new: i64,
    pub budget: i64,
}

/// Distribute the daily budget proportionally to each deck's available new
/// cards, using deterministic largest-remainder rounding.
pub fn allocate_budget(budget: i64, decks: &[DeckCapacity]) -> Vec<DeckAllocation> {
    let clean: Vec<DeckCapacity> =
        decks.iter().map(|deck| DeckCapacity { available_new: deck.available_new.max(0), ..deck.clone() }).collect();
    let available: i64 = clean.iter().map(|deck| deck.available_new).sum();
    let total = budget.max(0).min(available);
    if total == 0 || available == 0 {
        return clean
            .into_iter()
            .map(|deck| DeckAllocation {
                mapping_id: deck.mapping_id,
                deck_name: deck.deck_name,
                available_new: deck.available_new,
                budget: 0,
            })
            .collect();
    }
    let mut shares: Vec<(DeckAllocation, f64)> = clean
        .into_iter()
        .map(|deck| {
            let exact = total as f64 * deck.available_new as f64 / available as f64;
            let base = (exact.floor() as i64).min(deck.available_new);
            let remainder = exact - base as f64;
            (
                DeckAllocation {
                    mapping_id: deck.mapping_id,
                    deck_name: deck.deck_name,
                    available_new: deck.available_new,
                    budget: base,
                },
                remainder,
            )
        })
        .collect();
    let mut remaining = total - shares.iter().map(|(deck, _)| deck.budget).sum::<i64>();
    let mut order: Vec<usize> = (0..shares.len()).collect();
    order.sort_by(|a, b| {
        shares[*b]
            .1
            .partial_cmp(&shares[*a].1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| shares[*a].0.mapping_id.cmp(&shares[*b].0.mapping_id))
    });
    for index in order {
        if remaining == 0 {
            break;
        }
        let deck = &mut shares[index].0;
        if deck.budget < deck.available_new {
            deck.budget += 1;
            remaining -= 1;
        }
    }
    shares.into_iter().map(|(deck, _)| deck).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    const SETTINGS: AdaptiveBudgetSettings =
        AdaptiveBudgetSettings { starting_budget: 10, maximum_budget: 40, cold_start_protection: true, target_review_minutes: 60 };

    fn tz() -> Tz {
        chrono_tz::America::New_York
    }
    fn local(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        tz().with_ymd_and_hms(y, m, d, h, min, 0).unwrap().with_timezone(&Utc)
    }
    fn day(index: usize) -> AdaptiveEvidenceDay {
        AdaptiveEvidenceDay {
            anki_day: format!("2026-09-{:02}", index + 1),
            review_observations: 25,
            reviewed_card_count: 25,
            reviewed_card_ids: (0..25).map(|c| format!("card-{index}-{c}")).collect(),
            lapsed_card_ids: vec![],
            review_minutes: Some(20.0),
            valid_time_observations: 25,
            reviews_due: Some(25),
            reviews_completed: 25,
            completion_rate: Some(1.0),
            retention: Some(0.96),
            reliable: true,
            data_available: true,
        }
    }
    fn budget(previous: i64, reliable_days: i64, evidence: &[AdaptiveEvidenceDay], overdue: i64, settings: AdaptiveBudgetSettings) -> AdaptiveBudgetDecision {
        calculate_budget(BudgetInput { previous_budget: previous, reliable_data_days: reliable_days, evidence, overdue_count: overdue, settings })
    }

    #[test]
    fn anki_day_boundaries_and_activation_day() {
        assert_eq!(anki_day_key(local(2026, 9, 23, 3, 59), 4, tz()), "2026-09-22");
        assert_eq!(anki_day_key(local(2026, 9, 23, 4, 0), 4, tz()), "2026-09-23");
        let logs: Vec<_> = (0..20)
            .map(|i| AdaptiveReviewLog { anki_card_id: i.to_string(), reviewed_at: local(2026, 9, 23, 5, i), rating: 3, time_ms: 2000, review_type: Some(1) })
            .collect();
        let e = summarize_evidence_day(EvidenceInput {
            day: "2026-09-23", day_start_hour: 4, activation_day: "2026-09-23", logs: &logs,
            reviews_due: Some(20), data_available: true, current_day: "2026-09-24", tz: tz(),
        });
        assert_eq!(e.review_observations, 20);
        assert!(!e.reliable);
        assert_eq!(e.retention, Some(1.0));
    }

    #[test]
    fn first_review_attempt_only() {
        let mut logs = Vec::new();
        for i in 0..20u32 {
            logs.push(AdaptiveReviewLog { anki_card_id: i.to_string(), reviewed_at: local(2026, 9, 22, 5, i), rating: if i == 0 { 1 } else { 3 }, time_ms: 2000, review_type: Some(1) });
            logs.push(AdaptiveReviewLog { anki_card_id: i.to_string(), reviewed_at: local(2026, 9, 22, 6, i), rating: 3, time_ms: 2000, review_type: Some(2) });
        }
        let e = summarize_evidence_day(EvidenceInput {
            day: "2026-09-22", day_start_hour: 4, activation_day: "2026-09-21", logs: &logs,
            reviews_due: Some(20), data_available: true, current_day: "2026-09-23", tz: tz(),
        });
        assert_eq!(e.retention, Some(0.95));
        assert!(e.reliable);
    }

    #[test]
    fn controller_rules() {
        assert_eq!(budget(10, 0, &[], 0, SETTINGS).final_budget, 10);
        let seven: Vec<_> = (0..7).map(day).collect();
        let ramped = budget(10, 7, &seven, 0, SETTINGS);
        assert_eq!(ramped.confidence_ceiling, 12);
        assert_eq!(ramped.final_budget, 12);

        let poor: Vec<_> = (0..3).map(|i| AdaptiveEvidenceDay { retention: Some(0.75), review_minutes: Some(100.0), ..day(i) }).collect();
        let r = budget(10, 3, &poor, 0, SETTINGS);
        assert_eq!(r.performance_target, 0);
        assert_eq!(r.final_budget, 0);

        let r = budget(10, 7, &[day(1), day(2)], 0, SETTINGS);
        assert_eq!(r.final_budget, 10);
        assert!(r.reasons.join(" ").contains("Increase blocked"));

        assert_eq!(budget(12, 7, &seven, 50, SETTINGS).final_budget, 0);

        let missing = budget(10, 0, &[AdaptiveEvidenceDay { reliable: false, data_available: false, ..day(1) }], 0, SETTINGS);
        assert_eq!((missing.reliable_window_days, missing.final_budget, missing.confidence_ceiling), (0, 10, 10));

        let open = AdaptiveBudgetSettings { cold_start_protection: false, ..SETTINGS };
        assert_eq!(budget(39, 100, &seven, 0, open).final_budget, 40);
        let terrible: Vec<_> = (0..7).map(|i| AdaptiveEvidenceDay { retention: Some(0.5), review_minutes: Some(200.0), ..day(i) }).collect();
        assert_eq!(budget(2, 100, &terrible, 0, SETTINGS).final_budget, 0);

        let skipped: Vec<_> = (0..7).map(|i| AdaptiveEvidenceDay { reviews_due: Some(25), reviews_completed: 20, completion_rate: Some(0.8), ..day(i) }).collect();
        let r = budget(10, 7, &skipped, 0, SETTINGS);
        assert_eq!(r.final_budget, 10);
        assert_eq!(r.completion_rate, Some(0.8));
    }

    #[test]
    fn claims() {
        let now = Utc.with_ymd_and_hms(2026, 9, 23, 16, 0, 0).unwrap();
        assert!(application_is_claimable("pending", None, now));
        assert!(!application_is_claimable("applied", Some(now), now));
        assert!(!application_is_claimable("applying", Some(now), now));
        assert!(application_is_claimable("applying", Some(now - Duration::minutes(6)), now));
    }

    #[test]
    fn allocation() {
        let decks = vec![
            DeckCapacity { mapping_id: "a".into(), deck_name: "A".into(), available_new: 20 },
            DeckCapacity { mapping_id: "b".into(), deck_name: "B".into(), available_new: 5 },
        ];
        let out = allocate_budget(10, &decks);
        assert_eq!(out.iter().map(|d| d.budget).collect::<Vec<_>>(), vec![8, 2]);
        let one = vec![DeckCapacity { mapping_id: "a".into(), deck_name: "A".into(), available_new: 3 }];
        assert_eq!(allocate_budget(40, &one)[0].budget, 3);
    }
}

//! Meditation consistency analytics.

use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use chrono_tz::Tz;
use serde::Serialize;

use crate::time::{date_key, local_date, month_short, start_of_week};

#[derive(Clone, Debug)]
pub struct Session {
    pub date: DateTime<Utc>,
    pub duration_min: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HeatDay {
    pub date: String,
    pub reviews: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Point {
    pub label: String,
    pub value: i64,
    pub tooltip: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeditationAnalytics {
    pub total_days: usize,
    pub total_minutes: i64,
    pub average_minutes: Option<f64>,
    pub current_streak: u32,
    pub best_streak: u32,
    pub days_last30: i64,
    pub consistency_last30: f64,
    pub days_this_week: usize,
    pub activity365: Vec<HeatDay>,
    pub minutes_trend: Vec<Point>,
    pub monthly_days: Vec<Point>,
}

pub fn analyze(sessions: &[Session], default_minutes: i64, now: DateTime<Utc>, tz: Tz) -> MeditationAnalytics {
    let mut minutes_by_day: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    for s in sessions {
        let minutes = s.duration_min.filter(|m| *m > 0).unwrap_or(default_minutes);
        let entry = minutes_by_day.entry(local_date(s.date, tz)).or_insert(0);
        *entry = (*entry).max(minutes);
    }
    let days: std::collections::BTreeSet<NaiveDate> = minutes_by_day.keys().copied().collect();
    let today = local_date(now, tz);
    let (current_streak, best_streak) = crate::time::streak_from_dates(&days, today);

    let activity365: Vec<HeatDay> = (0..365)
        .rev()
        .map(|offset| {
            let date = today - Duration::days(offset);
            HeatDay { date: date_key(date), reviews: i64::from(minutes_by_day.contains_key(&date)) }
        })
        .collect();
    let days_last30: i64 = activity365.iter().rev().take(30).map(|d| d.reviews).sum();
    let week_start = start_of_week(now, tz);
    let days_this_week = days.iter().filter(|d| **d >= week_start && **d <= today).count();

    let monthly_days = (0..12)
        .rev()
        .map(|offset| {
            let total_months = today.year() * 12 + today.month0() as i32 - offset;
            let (year, month) = (total_months.div_euclid(12), total_months.rem_euclid(12) as u32 + 1);
            let value = days.iter().filter(|d| d.year() == year && d.month() == month).count() as i64;
            let label = month_short(month).to_string();
            Point { tooltip: format!("{label} {year}: {value} meditation days"), label, value }
        })
        .collect();
    let total_minutes: i64 = minutes_by_day.values().sum();
    let recent: Vec<(&NaiveDate, &i64)> = minutes_by_day.iter().rev().take(30).collect();
    MeditationAnalytics {
        total_days: days.len(),
        total_minutes,
        average_minutes: (!days.is_empty()).then(|| total_minutes as f64 / days.len() as f64),
        current_streak,
        best_streak,
        days_last30,
        consistency_last30: days_last30 as f64 / 30.0,
        days_this_week,
        activity365,
        minutes_trend: recent
            .into_iter()
            .rev()
            .map(|(date, minutes)| {
                let key = date_key(*date);
                Point { label: key[5..].to_string(), value: *minutes, tooltip: format!("{key}: {minutes} minutes") }
            })
            .collect(),
        monthly_days,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn streaks_and_consistency() {
        let tz = chrono_tz::America::Chicago;
        let now = tz.with_ymd_and_hms(2026, 10, 23, 9, 0, 0).unwrap().with_timezone(&Utc);
        let sessions: Vec<Session> = [0, 1, 2, 5]
            .iter()
            .map(|d| Session { date: now - Duration::days(*d), duration_min: if *d == 5 { None } else { Some(15) } })
            .collect();
        let a = analyze(&sessions, 10, now, tz);
        assert_eq!(a.total_days, 4);
        assert_eq!(a.current_streak, 3);
        assert_eq!(a.best_streak, 3);
        assert_eq!(a.total_minutes, 55);
        assert_eq!(a.days_last30, 4);
        assert_eq!(a.activity365.len(), 365);
        assert_eq!(a.monthly_days.last().unwrap().label, "Oct");
    }
}

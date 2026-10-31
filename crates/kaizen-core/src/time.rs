//! Calendar helpers in the user's timezone. The original app used the server's
//! local clock (`setHours(0,0,0,0)`); in the cloud the server runs in UTC, so
//! every "today", streak, and Anki-day calculation takes an explicit `Tz`.

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc, Weekday};
use chrono_tz::Tz;

pub const DAY_MS: i64 = 86_400_000;

/// Parse an IANA timezone name, defaulting to UTC.
pub fn parse_tz(name: &str) -> Tz {
    name.parse::<Tz>().unwrap_or(Tz::UTC)
}

/// Local calendar date of an instant.
pub fn local_date(t: DateTime<Utc>, tz: Tz) -> NaiveDate {
    t.with_timezone(&tz).date_naive()
}

/// `YYYY-MM-DD` of the local date.
pub fn day_key(t: DateTime<Utc>, tz: Tz) -> String {
    date_key(local_date(t, tz))
}

pub fn date_key(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn parse_date_key(key: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(key, "%Y-%m-%d").ok()
}

/// Convert a local wall-clock time to an instant, resolving DST gaps forward
/// and overlaps to the earlier instant.
pub fn local_to_utc(naive: NaiveDateTime, tz: Tz) -> DateTime<Utc> {
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(t) => t.with_timezone(&Utc),
        LocalResult::Ambiguous(earliest, _) => earliest.with_timezone(&Utc),
        LocalResult::None => tz
            .from_local_datetime(&(naive + Duration::hours(1)))
            .earliest()
            .map(|t| t.with_timezone(&Utc))
            .unwrap_or_else(|| Utc.from_utc_datetime(&naive)),
    }
}

/// Local midnight starting the given date.
pub fn start_of_date(d: NaiveDate, tz: Tz) -> DateTime<Utc> {
    local_to_utc(d.and_time(NaiveTime::MIN), tz)
}

/// Local midnight starting the day containing `t`.
pub fn start_of_day(t: DateTime<Utc>, tz: Tz) -> DateTime<Utc> {
    start_of_date(local_date(t, tz), tz)
}

/// `[start, end)` of the local day containing `t`.
pub fn day_bounds(t: DateTime<Utc>, tz: Tz) -> (DateTime<Utc>, DateTime<Utc>) {
    let date = local_date(t, tz);
    (start_of_date(date, tz), start_of_date(date + Duration::days(1), tz))
}

/// Last instant of the local day containing `t` (`setHours(23,59,59,999)`).
pub fn end_of_day(t: DateTime<Utc>, tz: Tz) -> DateTime<Utc> {
    day_bounds(t, tz).1 - Duration::milliseconds(1)
}

/// Monday of the local week containing `t`.
pub fn start_of_week(t: DateTime<Utc>, tz: Tz) -> NaiveDate {
    let date = local_date(t, tz);
    date - Duration::days(date.weekday().num_days_from_monday() as i64)
}

pub fn weekday(t: DateTime<Utc>, tz: Tz) -> Weekday {
    t.with_timezone(&tz).weekday()
}

/// Whole days between two dates (`right - left`).
pub fn days_between(left: NaiveDate, right: NaiveDate) -> i64 {
    (right - left).num_days()
}

/// Inclusive trailing window of `days` dates ending at the local date of `now`.
pub fn trailing_dates(now: DateTime<Utc>, tz: Tz, days: usize) -> Vec<NaiveDate> {
    let today = local_date(now, tz);
    (0..days)
        .rev()
        .map(|offset| today - Duration::days(offset as i64))
        .collect()
}

/// Current and best run of consecutive dates. "Current" counts today when
/// present, otherwise starts from yesterday (the shared streak convention).
pub fn streak_from_dates(dates: &std::collections::BTreeSet<NaiveDate>, today: NaiveDate) -> (u32, u32) {
    let mut current = 0u32;
    let mut cursor = today;
    if !dates.contains(&cursor) {
        cursor -= Duration::days(1);
    }
    while dates.contains(&cursor) {
        current += 1;
        cursor -= Duration::days(1);
    }
    let mut best = 0u32;
    let mut run = 0u32;
    let mut prev: Option<NaiveDate> = None;
    for date in dates {
        run = match prev {
            Some(p) if days_between(p, *date) == 1 => run + 1,
            _ => 1,
        };
        best = best.max(run);
        prev = Some(*date);
    }
    (current, best)
}

/// Short English month label (`toLocaleString('en', { month: 'short' })`).
pub fn month_short(month: u32) -> &'static str {
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    MONTHS[((month.max(1) - 1) % 12) as usize]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_keys_follow_the_user_timezone() {
        let t = Utc.with_ymd_and_hms(2026, 7, 1, 2, 0, 0).unwrap();
        assert_eq!(day_key(t, Tz::UTC), "2026-07-01");
        assert_eq!(day_key(t, chrono_tz::America::Los_Angeles), "2026-06-30");
        assert_eq!(day_key(t, chrono_tz::Asia::Tokyo), "2026-07-01");
    }

    #[test]
    fn streaks_count_today_or_yesterday() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 10).unwrap();
        let dates: std::collections::BTreeSet<_> = [8, 9, 3, 4, 5, 6]
            .iter()
            .map(|d| NaiveDate::from_ymd_opt(2026, 7, *d).unwrap())
            .collect();
        assert_eq!(streak_from_dates(&dates, today), (2, 4));
    }
}

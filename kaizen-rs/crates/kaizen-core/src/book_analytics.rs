//! Book reading analytics.

use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use chrono_tz::Tz;

use crate::meditation::HeatDay;
use crate::time::{date_key, local_date};

/// Pages read per local day for the trailing 365 days.
pub fn reading_activity(sessions: &[(DateTime<Utc>, i64)], now: DateTime<Utc>, tz: Tz) -> Vec<HeatDay> {
    let mut pages: HashMap<NaiveDate, i64> = HashMap::new();
    for (read_at, pages_read) in sessions {
        *pages.entry(local_date(*read_at, tz)).or_default() += (*pages_read).max(0);
    }
    let today = local_date(now, tz);
    (0..365)
        .rev()
        .map(|offset| {
            let date = today - Duration::days(offset);
            HeatDay { date: date_key(date), reviews: pages.get(&date).copied().unwrap_or(0) }
        })
        .collect()
}

/// End page for a new session: explicit page, else previous end + pages read,
/// bounded by the book length; start page derived from it.
pub fn session_pages(pages_read: i64, supplied_end_page: Option<i64>, previous_end_page: Option<i64>, page_count: Option<i64>) -> (i64, i64) {
    let end = match supplied_end_page {
        Some(p) if p > 0 => p,
        _ => previous_end_page.unwrap_or(0) + pages_read,
    };
    let bounded = page_count.map_or(end, |count| end.min(count));
    ((bounded - pages_read + 1).max(1), bounded)
}

pub fn format_minutes(total: i64) -> String {
    if total < 60 { format!("{total}m") } else { format!("{}h {}m", total / 60, total % 60) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_and_formatting() {
        assert_eq!(session_pages(10, None, Some(40), Some(300)), (41, 50));
        assert_eq!(session_pages(10, Some(120), Some(40), Some(100)), (91, 100));
        assert_eq!(session_pages(10, None, None, None), (1, 10));
        assert_eq!(format_minutes(45), "45m");
        assert_eq!(format_minutes(125), "2h 5m");
    }
}

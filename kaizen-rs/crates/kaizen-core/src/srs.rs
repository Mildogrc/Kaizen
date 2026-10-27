//! SM-2-style spaced repetition scheduler. Works on top of review-record
//! fields and honors ease/interval imported from Anki.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::util::js_round;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Rating {
    Again,
    Hard,
    Good,
    Easy,
}

impl Rating {
    pub const ALL: [Rating; 4] = [Rating::Again, Rating::Hard, Rating::Good, Rating::Easy];

    pub fn as_str(self) -> &'static str {
        match self {
            Rating::Again => "AGAIN",
            Rating::Hard => "HARD",
            Rating::Good => "GOOD",
            Rating::Easy => "EASY",
        }
    }

    pub fn parse(value: &str) -> Option<Rating> {
        match value {
            "AGAIN" => Some(Rating::Again),
            "HARD" => Some(Rating::Hard),
            "GOOD" => Some(Rating::Good),
            "EASY" => Some(Rating::Easy),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Maturity {
    New,
    Learning,
    Young,
    Mature,
}

impl Maturity {
    pub fn as_str(self) -> &'static str {
        match self {
            Maturity::New => "NEW",
            Maturity::Learning => "LEARNING",
            Maturity::Young => "YOUNG",
            Maturity::Mature => "MATURE",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SrsState {
    /// 2.5 default, floor 1.3
    pub ease: f64,
    /// 0 while learning
    pub interval_days: f64,
    pub repetitions: i32,
    pub lapse_count: i32,
    pub is_leech: bool,
}

impl Default for SrsState {
    fn default() -> Self {
        SrsState { ease: 2.5, interval_days: 0.0, repetitions: 0, lapse_count: 0, is_leech: false }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SrsResult {
    pub state: SrsState,
    pub due_at: DateTime<Utc>,
    pub maturity: Maturity,
}

const MIN_EASE: f64 = 1.3;
const LEECH_LAPSES: i32 = 8;
const LEARN_AGAIN_MINUTES: i64 = 10;
const GRADUATE_DAYS: f64 = 1.0;
const EASY_GRADUATE_DAYS: f64 = 4.0;
pub const MATURE_DAYS: f64 = 21.0;

fn maturity_for(interval_days: f64) -> Maturity {
    if interval_days >= MATURE_DAYS {
        Maturity::Mature
    } else if interval_days >= 1.0 {
        Maturity::Young
    } else {
        Maturity::Learning
    }
}

fn add_days(now: DateTime<Utc>, days: f64) -> DateTime<Utc> {
    now + Duration::milliseconds((days * 86_400_000.0) as i64)
}

/// Apply a rating to the current state, returning the next state.
pub fn rate(state: SrsState, rating: Rating, now: DateTime<Utc>) -> SrsResult {
    let mut s = state;
    let learning = s.interval_days < 1.0;
    let relearn = now + Duration::minutes(LEARN_AGAIN_MINUTES);

    match rating {
        Rating::Again => {
            // Lapse if the card had graduated; relearn in 10 minutes.
            if !learning {
                s.lapse_count += 1;
            }
            s.repetitions = 0;
            s.ease = (s.ease - 0.2).max(MIN_EASE);
            s.interval_days = 0.0;
            s.is_leech = s.is_leech || s.lapse_count >= LEECH_LAPSES;
            SrsResult { state: s, due_at: relearn, maturity: Maturity::Learning }
        }
        Rating::Hard => {
            s.ease = (s.ease - 0.15).max(MIN_EASE);
            s.repetitions += 1;
            if learning {
                return SrsResult { state: s, due_at: relearn, maturity: Maturity::Learning };
            }
            s.interval_days = js_round(s.interval_days * 1.2).max(1.0);
            SrsResult { state: s, due_at: add_days(now, s.interval_days), maturity: maturity_for(s.interval_days) }
        }
        Rating::Good => {
            s.repetitions += 1;
            if learning {
                // Two learning steps: 10 minutes, then graduate to 1 day.
                if s.repetitions < 2 {
                    return SrsResult { state: s, due_at: relearn, maturity: Maturity::Learning };
                }
                s.interval_days = GRADUATE_DAYS;
            } else {
                s.interval_days = (s.interval_days + 1.0).max(js_round(s.interval_days * s.ease));
            }
            SrsResult { state: s, due_at: add_days(now, s.interval_days), maturity: maturity_for(s.interval_days) }
        }
        Rating::Easy => {
            s.repetitions += 1;
            s.ease += 0.15;
            s.interval_days = if learning {
                EASY_GRADUATE_DAYS
            } else {
                (s.interval_days + 1.0).max(js_round(s.interval_days * s.ease * 1.3))
            };
            SrsResult { state: s, due_at: add_days(now, s.interval_days), maturity: maturity_for(s.interval_days) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 16, 12, 0, 0).unwrap()
    }
    const NEW_CARD: SrsState = SrsState { ease: 2.5, interval_days: 0.0, repetitions: 0, lapse_count: 0, is_leech: false };
    const REVIEW_CARD: SrsState = SrsState { ease: 2.5, interval_days: 10.0, repetitions: 5, lapse_count: 0, is_leech: false };
    fn minutes(d: DateTime<Utc>) -> i64 {
        (d - now()).num_minutes()
    }
    fn days(d: DateTime<Utc>) -> i64 {
        (d - now()).num_days()
    }

    #[test]
    fn new_card_good_goes_through_a_learning_step_then_graduates() {
        let step1 = rate(NEW_CARD, Rating::Good, now());
        assert_eq!(step1.maturity, Maturity::Learning);
        assert_eq!(minutes(step1.due_at), 10);
        let step2 = rate(step1.state, Rating::Good, now());
        assert_eq!(step2.state.interval_days, 1.0);
        assert_eq!(step2.maturity, Maturity::Young);
        assert_eq!(days(step2.due_at), 1);
    }

    #[test]
    fn new_card_easy_graduates_at_four_days() {
        let r = rate(NEW_CARD, Rating::Easy, now());
        assert_eq!(r.state.interval_days, 4.0);
        assert!((r.state.ease - 2.65).abs() < 1e-9);
    }

    #[test]
    fn review_good_multiplies_by_ease() {
        let r = rate(REVIEW_CARD, Rating::Good, now());
        assert_eq!(r.state.interval_days, 25.0);
        assert_eq!(r.maturity, Maturity::Mature);
        assert_eq!(days(r.due_at), 25);
    }

    #[test]
    fn review_hard_grows_slowly() {
        let r = rate(REVIEW_CARD, Rating::Hard, now());
        assert_eq!(r.state.interval_days, 12.0);
        assert!((r.state.ease - 2.35).abs() < 1e-9);
        assert_eq!(r.maturity, Maturity::Young);
    }

    #[test]
    fn review_again_lapses() {
        let r = rate(REVIEW_CARD, Rating::Again, now());
        assert_eq!(r.state.lapse_count, 1);
        assert_eq!(r.state.repetitions, 0);
        assert_eq!(r.state.interval_days, 0.0);
        assert!((r.state.ease - 2.3).abs() < 1e-9);
        assert_eq!(r.maturity, Maturity::Learning);
        assert_eq!(minutes(r.due_at), 10);
        assert_eq!(rate(NEW_CARD, Rating::Again, now()).state.lapse_count, 0);
    }

    #[test]
    fn ease_floor_and_leeches() {
        let mut s = SrsState { ease: 1.35, ..REVIEW_CARD };
        s = rate(s, Rating::Again, now()).state;
        assert_eq!(s.ease, 1.3);
        s = rate(SrsState { interval_days: 5.0, ..s }, Rating::Hard, now()).state;
        assert_eq!(s.ease, 1.3);
        let grown = rate(SrsState { ease: 1.3, interval_days: 2.0, ..REVIEW_CARD }, Rating::Good, now());
        assert!(grown.state.interval_days > 2.0);
        let leech = rate(SrsState { lapse_count: 7, ..REVIEW_CARD }, Rating::Again, now());
        assert_eq!(leech.state.lapse_count, 8);
        assert!(leech.state.is_leech);
    }

    #[test]
    fn honors_imported_anki_intervals() {
        let imported = SrsState { ease: 2.65, interval_days: 659.0, repetitions: 5, lapse_count: 0, is_leech: false };
        let r = rate(imported, Rating::Good, now());
        assert_eq!(r.state.interval_days, js_round(659.0 * 2.65));
        assert_eq!(r.maturity, Maturity::Mature);
    }
}

//! NATO phonetic-alphabet recall trainer: session stats, adaptive intervals,
//! weak-letter word selection, and the weekend skill rotation.

use chrono::{DateTime, Duration, Utc, Weekday};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CODE_WORDS: [(char, &str); 26] = [
    ('A', "Alfa"), ('B', "Bravo"), ('C', "Charlie"), ('D', "Delta"), ('E', "Echo"), ('F', "Foxtrot"),
    ('G', "Golf"), ('H', "Hotel"), ('I', "India"), ('J', "Juliett"), ('K', "Kilo"), ('L', "Lima"),
    ('M', "Mike"), ('N', "November"), ('O', "Oscar"), ('P', "Papa"), ('Q', "Quebec"), ('R', "Romeo"),
    ('S', "Sierra"), ('T', "Tango"), ('U', "Uniform"), ('V', "Victor"), ('W', "Whiskey"),
    ('X', "X-ray"), ('Y', "Yankee"), ('Z', "Zulu"),
];

const TRAINING_WORDS: [&str; 26] = [
    "JACKDAW", "FJORD", "QUIZ", "VEXING", "WHISKEY", "ZEPHYR", "BOXCAR", "JUMBLE", "PYTHON", "GALAXY", "VECTOR",
    "BRONZE", "FLIGHT", "SQUAD", "KITTEN", "MANGO", "CIPHER", "DYNAMIC", "QUARTZ", "FOXHOUND", "BLUEJAY", "NETWORK",
    "COMPASS", "JIGSAW", "VORTEX", "BACKFLIP",
];

pub fn code_word(letter: char) -> Option<&'static str> {
    CODE_WORDS.iter().find(|(l, _)| *l == letter).map(|(_, w)| *w)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub letter: String,
    pub expected: String,
    pub typed: String,
    pub correct: bool,
    pub time_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    pub word: String,
    pub attempts: Vec<Attempt>,
    pub accuracy: f64,
    pub average_recall_ms: f64,
    pub total_time_ms: i64,
    pub next_interval_days: i64,
}

pub fn interval_days(accuracy: f64, average_recall_ms: f64) -> i64 {
    if accuracy < 0.85 || average_recall_ms > 3_000.0 {
        7
    } else if accuracy < 0.95 || average_recall_ms > 1_800.0 {
        14
    } else {
        28
    }
}

/// Build stats for a submitted session: answers are re-graded server-side.
pub fn grade_session(word: &str, typed: &[(String, i64)]) -> Result<SessionStats, String> {
    let word = word.to_uppercase();
    if !(3..=12).contains(&word.len()) || !word.chars().all(|c| c.is_ascii_uppercase()) || typed.len() != word.len() {
        return Err("Invalid NATO session.".into());
    }
    let attempts: Vec<Attempt> = word
        .chars()
        .zip(typed)
        .map(|(letter, (answer, time_ms))| {
            let expected = code_word(letter).unwrap_or_default().to_string();
            let answer = answer.trim().to_string();
            Attempt {
                letter: letter.to_string(),
                correct: answer.to_lowercase() == expected.to_lowercase(),
                expected,
                typed: answer,
                time_ms: (*time_ms).clamp(50, 120_000),
            }
        })
        .collect();
    Ok(stats_from_attempts(word, attempts))
}

fn stats_from_attempts(word: String, attempts: Vec<Attempt>) -> SessionStats {
    let correct = attempts.iter().filter(|a| a.correct).count();
    let total_time_ms: i64 = attempts.iter().map(|a| a.time_ms).sum();
    let accuracy = correct as f64 / attempts.len().max(1) as f64;
    let average_recall_ms = total_time_ms as f64 / attempts.len().max(1) as f64;
    SessionStats { next_interval_days: interval_days(accuracy, average_recall_ms), word, attempts, accuracy, average_recall_ms, total_time_ms }
}

/// Re-derive stats from a stored session JSON, tolerating legacy shapes.
pub fn parse_session_stats(value: &Value) -> Option<SessionStats> {
    let word = value.get("word")?.as_str()?.to_uppercase();
    let attempts: Vec<Attempt> = value
        .get("attempts")?
        .as_array()?
        .iter()
        .filter_map(|a| {
            let letter = a.get("letter").and_then(Value::as_str).unwrap_or("").to_uppercase();
            let expected = code_word(letter.chars().next()?).filter(|_| letter.len() == 1)?;
            Some(Attempt {
                letter,
                expected: expected.to_string(),
                typed: a.get("typed").and_then(Value::as_str).unwrap_or("").to_string(),
                correct: a.get("correct").and_then(Value::as_bool).unwrap_or(false),
                time_ms: a.get("timeMs").and_then(crate::util::json_number).unwrap_or(0.0).max(0.0) as i64,
            })
        })
        .collect();
    if attempts.is_empty() {
        return None;
    }
    Some(stats_from_attempts(word, attempts))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LetterMetric {
    pub letter: String,
    pub attempts: usize,
    pub correct: usize,
    pub accuracy: f64,
    pub average_ms: f64,
    pub last_seen_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NatoAnalytics {
    pub sessions: usize,
    pub total_attempts: usize,
    pub accuracy: Option<f64>,
    pub average_recall_ms: Option<f64>,
    pub metrics: Vec<LetterMetric>,
    pub last_session_at: Option<DateTime<Utc>>,
    pub next_due_at: Option<DateTime<Utc>>,
}

pub fn analyze_sessions(sessions: &[(DateTime<Utc>, Value)]) -> (NatoAnalytics, Vec<(DateTime<Utc>, SessionStats)>) {
    let parsed: Vec<(DateTime<Utc>, SessionStats)> =
        sessions.iter().filter_map(|(date, stats)| parse_session_stats(stats).map(|s| (*date, s))).collect();
    let mut metrics: Vec<LetterMetric> = CODE_WORDS
        .iter()
        .map(|(l, _)| LetterMetric { letter: l.to_string(), attempts: 0, correct: 0, accuracy: 0.0, average_ms: 0.0, last_seen_at: None })
        .collect();
    for (date, stats) in &parsed {
        for attempt in &stats.attempts {
            let Some(metric) = metrics.iter_mut().find(|m| m.letter == attempt.letter) else { continue };
            metric.average_ms = (metric.average_ms * metric.attempts as f64 + attempt.time_ms as f64) / (metric.attempts + 1) as f64;
            metric.attempts += 1;
            if attempt.correct {
                metric.correct += 1;
            }
            metric.accuracy = metric.correct as f64 / metric.attempts as f64;
            if metric.last_seen_at.is_none_or(|seen| *date > seen) {
                metric.last_seen_at = Some(*date);
            }
        }
    }
    let total_attempts: usize = parsed.iter().map(|(_, s)| s.attempts.len()).sum();
    let correct: usize = parsed.iter().map(|(_, s)| s.attempts.iter().filter(|a| a.correct).count()).sum();
    let total_time: i64 = parsed.iter().map(|(_, s)| s.total_time_ms).sum();
    let last = parsed.last();
    let analytics = NatoAnalytics {
        sessions: parsed.len(),
        total_attempts,
        accuracy: (total_attempts > 0).then(|| correct as f64 / total_attempts as f64),
        average_recall_ms: (total_attempts > 0).then(|| total_time as f64 / total_attempts as f64),
        metrics,
        last_session_at: last.map(|(d, _)| *d),
        next_due_at: last.map(|(d, s)| *d + Duration::days(s.next_interval_days)),
    };
    (analytics, parsed)
}

fn weakness(metric: Option<&LetterMetric>) -> f64 {
    match metric {
        Some(m) if m.attempts > 0 => m.average_ms + (1.0 - m.accuracy) * 5_000.0,
        _ => 4_000.0,
    }
}

/// One of the five words whose letters are weakest, rotated by `seed`.
pub fn select_word(metrics: &[LetterMetric], seed: usize) -> &'static str {
    let mut scored: Vec<(usize, f64, &str)> = TRAINING_WORDS
        .iter()
        .enumerate()
        .map(|(index, word)| {
            let total: f64 = word
                .chars()
                .map(|c| weakness(metrics.iter().find(|m| m.letter.starts_with(c))))
                .sum();
            (index, total / word.len() as f64, *word)
        })
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    let top = &scored[..scored.len().min(5)];
    top[seed % top.len()].2
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WeekendSkill {
    /// geoguessr | nato | typing
    pub key: &'static str,
    pub title: &'static str,
    pub detail: &'static str,
    pub href: &'static str,
}

/// Saturday: GeoGuessr (+ NATO when due). Sunday: typing when NATO wasn't due.
pub fn weekend_skills(now: DateTime<Utc>, tz: Tz, next_nato_due_at: Option<DateTime<Utc>>) -> Vec<WeekendSkill> {
    let nato_due = next_nato_due_at.is_none_or(|due| due <= now);
    match crate::time::weekday(now, tz) {
        Weekday::Sat => {
            let mut skills = vec![WeekendSkill {
                key: "geoguessr",
                title: "GeoGuessr",
                detail: "Saturday weekly practice and analytics",
                href: "https://www.geoguessr.com/analytics",
            }];
            if nato_due {
                skills.push(WeekendSkill {
                    key: "nato",
                    title: "NATO recall",
                    detail: "Adaptive Saturday session for slow or missed letters",
                    href: "/nato",
                });
            }
            skills
        }
        Weekday::Sun if !nato_due => vec![WeekendSkill {
            key: "typing",
            title: "Typing practice",
            detail: "NATO was not due Saturday · practice on Monkeytype",
            href: "https://monkeytype.com/",
        }],
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn grading_and_intervals() {
        let typed: Vec<(String, i64)> = vec![("alfa".into(), 900), ("Bravo".into(), 1000), ("x".into(), 2000)];
        let stats = grade_session("abc", &typed).unwrap();
        assert_eq!(stats.word, "ABC");
        assert!(stats.attempts[0].correct && stats.attempts[1].correct && !stats.attempts[2].correct);
        assert_eq!(stats.next_interval_days, 7);
        assert_eq!(interval_days(0.9, 1000.0), 14);
        assert_eq!(interval_days(1.0, 1000.0), 28);
        assert!(grade_session("ab", &typed[..2]).is_err());
    }

    #[test]
    fn weak_letters_choose_words() {
        let mut metrics: Vec<LetterMetric> = CODE_WORDS
            .iter()
            .map(|(l, _)| LetterMetric { letter: l.to_string(), attempts: 3, correct: 3, accuracy: 1.0, average_ms: 500.0, last_seen_at: None })
            .collect();
        metrics.iter_mut().find(|m| m.letter == "Q").unwrap().average_ms = 9_000.0;
        let word = select_word(&metrics, 0);
        assert!(word.contains('Q'), "{word}");
    }

    #[test]
    fn weekend_rotation() {
        let tz = chrono_tz::America::Los_Angeles;
        let saturday = tz.with_ymd_and_hms(2026, 10, 24, 10, 0, 0).unwrap().with_timezone(&Utc);
        assert_eq!(weekend_skills(saturday, tz, None).len(), 2);
        let sunday = saturday + Duration::days(1);
        assert_eq!(weekend_skills(sunday, tz, Some(sunday + Duration::days(3)))[0].key, "typing");
        assert!(weekend_skills(sunday, tz, None).is_empty());
    }
}

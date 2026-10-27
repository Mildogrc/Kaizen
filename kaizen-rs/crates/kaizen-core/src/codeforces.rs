//! Codeforces profile parsing and analytics.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use chrono::{DateTime, Duration, NaiveDate, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

use crate::meditation::{HeatDay, Point};
use crate::time::{date_key, day_key, local_date};
use crate::util::js_round;

pub fn parse_handle(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter a Codeforces profile URL or handle.".into());
    }
    let mut handle = trimmed.to_string();
    if trimmed.to_lowercase().starts_with("http://") || trimmed.to_lowercase().starts_with("https://") {
        let url = url::Url::parse(trimmed).map_err(|_| "That is not a valid URL.".to_string())?;
        let host = url.host_str().unwrap_or("").to_lowercase();
        let host = host.strip_prefix("www.").unwrap_or(&host);
        if host != "codeforces.com" && host != "mirror.codeforces.com" {
            return Err("Use a codeforces.com profile URL.".into());
        }
        let path = url.path();
        let segments: Vec<&str> = path.trim_end_matches('/').split('/').collect();
        match segments.as_slice() {
            ["", profile, name] if profile.eq_ignore_ascii_case("profile") && !name.is_empty() => {
                handle = percent_decode(name);
            }
            _ => return Err("Use a URL like https://codeforces.com/profile/tourist.".into()),
        }
    }
    let valid = (3..=24).contains(&handle.chars().count())
        && handle.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-');
    if !valid {
        return Err("The Codeforces handle format is invalid.".into());
    }
    Ok(handle)
}

fn percent_decode(s: &str) -> String {
    url::form_urlencoded::parse(format!("x={s}").as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| s.to_string())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub contest_id: Option<i64>,
    pub problemset_name: Option<String>,
    pub index: String,
    pub name: String,
    pub rating: Option<i64>,
    pub tags: Vec<String>,
}

pub fn problem_key(p: &Problem) -> String {
    let contest = p
        .contest_id
        .map(|c| c.to_string())
        .or_else(|| p.problemset_name.clone())
        .unwrap_or_else(|| "unknown".into());
    format!("{contest}:{}", p.index)
}

#[derive(Clone, Debug)]
pub struct Submission {
    pub submitted_at: DateTime<Utc>,
    pub verdict: Option<String>,
    pub problem: Problem,
}

#[derive(Clone, Debug)]
pub struct RatingChange {
    pub contest_name: String,
    pub contest_rank: i64,
    pub old_rating: i64,
    pub new_rating: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingBucket {
    pub rating: String,
    pub attempted: usize,
    pub solved: usize,
    pub success_pct: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TagStat {
    pub tag: String,
    pub solved: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analytics {
    pub attempted: usize,
    pub solved: usize,
    pub solve_rate: f64,
    pub rated_solved: usize,
    pub average_solved_rating: Option<i64>,
    pub max_solved_rating: Option<i64>,
    pub rating_buckets: Vec<RatingBucket>,
    pub tag_stats: Vec<TagStat>,
    pub heatmap: Vec<HeatDay>,
    pub rating_trend: Vec<Point>,
    pub contests: usize,
    pub average_contest_rank: Option<i64>,
    pub best_contest_rank: Option<i64>,
    pub recent_solved: Vec<RecentSolve>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentSolve {
    pub key: String,
    pub index: String,
    pub name: String,
    pub rating: Option<i64>,
    pub date: String,
}

pub fn analyze(submissions: &[Submission], rating_changes: &[RatingChange], now: DateTime<Utc>, tz: Tz) -> Analytics {
    let mut chronological: Vec<&Submission> = submissions.iter().collect();
    chronological.sort_by_key(|s| s.submitted_at);
    let mut attempted: BTreeMap<String, &Problem> = BTreeMap::new();
    let mut solved: BTreeMap<String, (&Problem, DateTime<Utc>)> = BTreeMap::new();
    for s in &chronological {
        let key = problem_key(&s.problem);
        attempted.insert(key.clone(), &s.problem);
        if s.verdict.as_deref() == Some("OK") && !solved.contains_key(&key) {
            solved.insert(key, (&s.problem, s.submitted_at));
        }
    }

    let mut attempted_by_rating: BTreeMap<i64, BTreeSet<&str>> = BTreeMap::new();
    for (key, problem) in &attempted {
        if let Some(r) = problem.rating {
            attempted_by_rating.entry(r).or_default().insert(key);
        }
    }
    let mut solved_by_rating: BTreeMap<i64, BTreeSet<&str>> = BTreeMap::new();
    for (key, (problem, _)) in &solved {
        if let Some(r) = problem.rating {
            solved_by_rating.entry(r).or_default().insert(key);
        }
    }
    let ratings: BTreeSet<i64> = attempted_by_rating.keys().chain(solved_by_rating.keys()).copied().collect();
    let rating_buckets = ratings
        .into_iter()
        .map(|rating| {
            let a = attempted_by_rating.get(&rating).map_or(0, BTreeSet::len);
            let s = solved_by_rating.get(&rating).map_or(0, BTreeSet::len);
            RatingBucket {
                rating: rating.to_string(),
                attempted: a,
                solved: s,
                success_pct: if a == 0 { 0 } else { js_round(s as f64 / a as f64 * 100.0) as i64 },
            }
        })
        .collect();

    let solved_ratings: Vec<i64> = solved.values().filter_map(|(p, _)| p.rating).collect();
    let mut tag_counts: HashMap<&str, usize> = HashMap::new();
    for (problem, _) in solved.values() {
        for tag in &problem.tags {
            *tag_counts.entry(tag).or_default() += 1;
        }
    }
    let mut tag_stats: Vec<TagStat> = tag_counts.into_iter().map(|(tag, solved)| TagStat { tag: tag.into(), solved }).collect();
    tag_stats.sort_by(|a, b| b.solved.cmp(&a.solved).then_with(|| a.tag.cmp(&b.tag)));
    tag_stats.truncate(12);

    let mut heat: HashMap<NaiveDate, i64> = HashMap::new();
    for (_, at) in solved.values() {
        *heat.entry(local_date(*at, tz)).or_default() += 1;
    }
    let today = local_date(now, tz);
    let heatmap = (0..365)
        .rev()
        .map(|offset| {
            let date = today - Duration::days(offset);
            HeatDay { date: date_key(date), reviews: heat.get(&date).copied().unwrap_or(0) }
        })
        .collect();

    let mut changes: Vec<&RatingChange> = rating_changes.iter().collect();
    changes.sort_by_key(|c| c.updated_at);
    let rating_trend = changes
        .iter()
        .map(|c| {
            let delta = c.new_rating - c.old_rating;
            Point {
                label: day_key(c.updated_at, tz),
                value: c.new_rating,
                tooltip: format!(
                    "{}: {} ({}{delta}), rank {}",
                    c.contest_name,
                    c.new_rating,
                    if delta >= 0 { "+" } else { "" },
                    c.contest_rank
                ),
            }
        })
        .collect();

    let mut recent: Vec<RecentSolve> = Vec::new();
    let mut seen = BTreeSet::new();
    for s in chronological.iter().rev() {
        if s.verdict.as_deref() != Some("OK") {
            continue;
        }
        let key = problem_key(&s.problem);
        if seen.insert(key.clone()) {
            recent.push(RecentSolve {
                key,
                index: s.problem.index.clone(),
                name: s.problem.name.clone(),
                rating: s.problem.rating,
                date: day_key(s.submitted_at, tz),
            });
        }
        if recent.len() >= 12 {
            break;
        }
    }

    Analytics {
        attempted: attempted.len(),
        solved: solved.len(),
        solve_rate: if attempted.is_empty() { 0.0 } else { solved.len() as f64 / attempted.len() as f64 },
        rated_solved: solved_ratings.len(),
        average_solved_rating: (!solved_ratings.is_empty())
            .then(|| js_round(solved_ratings.iter().sum::<i64>() as f64 / solved_ratings.len() as f64) as i64),
        max_solved_rating: solved_ratings.iter().max().copied(),
        rating_buckets,
        tag_stats,
        heatmap,
        rating_trend,
        contests: changes.len(),
        average_contest_rank: (!changes.is_empty())
            .then(|| js_round(changes.iter().map(|c| c.contest_rank).sum::<i64>() as f64 / changes.len() as f64) as i64),
        best_contest_rank: changes.iter().map(|c| c.contest_rank).min(),
        recent_solved: recent,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn handles() {
        assert_eq!(parse_handle("https://codeforces.com/profile/tourist").unwrap(), "tourist");
        assert_eq!(parse_handle("https://www.codeforces.com/profile/Um_nik/").unwrap(), "Um_nik");
        assert_eq!(parse_handle("jiangly").unwrap(), "jiangly");
        assert!(parse_handle("https://example.com/profile/x").is_err());
        assert!(parse_handle("https://codeforces.com/contest/1").is_err());
        assert!(parse_handle("ab").is_err());
    }

    #[test]
    fn solves_count_once_and_bucket_by_rating() {
        let now = Utc.with_ymd_and_hms(2026, 10, 1, 12, 0, 0).unwrap();
        let p = |index: &str, rating: i64| Problem { contest_id: Some(1), problemset_name: None, index: index.into(), name: index.into(), rating: Some(rating), tags: vec!["dp".into()] };
        let subs = vec![
            Submission { submitted_at: now - Duration::days(3), verdict: Some("WRONG_ANSWER".into()), problem: p("A", 800) },
            Submission { submitted_at: now - Duration::days(2), verdict: Some("OK".into()), problem: p("A", 800) },
            Submission { submitted_at: now - Duration::days(1), verdict: Some("OK".into()), problem: p("A", 800) },
            Submission { submitted_at: now, verdict: Some("WRONG_ANSWER".into()), problem: p("B", 1200) },
        ];
        let a = analyze(&subs, &[], now, Tz::UTC);
        assert_eq!((a.attempted, a.solved), (2, 1));
        assert_eq!(a.rating_buckets.len(), 2);
        assert_eq!(a.rating_buckets[0].success_pct, 100);
        assert_eq!(a.tag_stats[0], TagStat { tag: "dp".into(), solved: 1 });
        assert_eq!(a.heatmap.iter().map(|d| d.reviews).sum::<i64>(), 1);
        assert_eq!(a.recent_solved.len(), 1);
    }
}

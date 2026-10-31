//! Concepts: Anki tag mapping, source ranges and progress, coverage, card
//! memory, prerequisite cycle checks, and the neighbourhood drawn on a
//! concept page.

use std::collections::{HashMap, HashSet, VecDeque};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::anki_analytics::{LogRow, retention};
use crate::util::{js_round_i64, slugify};

pub const TAG_PREFIX: &str = "concept::";

/// Display order on a concept page.
pub const ROLES: [&str; 4] = ["INTUITION", "LECTURE", "RIGOROUS", "PRACTICE"];
pub const STATUSES: [&str; 3] = ["LINKED", "SUGGESTED", "DISMISSED"];

pub fn is_role(value: &str) -> bool {
    ROLES.contains(&value)
}

/// `concept::<subject>::<slug>`, the Anki tag that ties cards to a concept.
pub fn tag(subject: &str, slug: &str) -> String {
    format!("{TAG_PREFIX}{subject}::{slug}")
}

/// Subject and slug from a concept tag, lowercased. Deeper levels
/// (`concept::linalg::eigenvalues::geometric`) count toward their concept.
pub fn parse_tag(tag: &str) -> Option<(String, String)> {
    let lower = tag.trim().to_lowercase();
    let rest = lower.strip_prefix(TAG_PREFIX)?;
    let mut parts = rest.split("::");
    let subject = parts.next().filter(|s| !s.is_empty())?;
    let slug = parts.next().filter(|s| !s.is_empty())?;
    Some((subject.to_string(), slug.to_string()))
}

/// A slug safe inside an Anki tag (no spaces or `::`), or None if nothing is left.
pub fn clean_slug(input: &str) -> Option<String> {
    Some(slugify(input)).filter(|s| !s.is_empty())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceKind {
    Video,
    Book,
    Link,
}

fn clock(seconds: i64) -> String {
    let s = seconds.max(0);
    let (h, m, sec) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 { format!("{h}:{m:02}:{sec:02}") } else { format!("{m}:{sec:02}") }
}

/// "2:10–9:30" for a video, "pp. 133–140" for a book.
pub fn format_range(kind: SourceKind, start: Option<i64>, end: Option<i64>) -> Option<String> {
    match kind {
        SourceKind::Video => match (start, end) {
            (Some(a), Some(b)) => Some(format!("{}–{}", clock(a), clock(b))),
            (Some(a), None) => Some(format!("from {}", clock(a))),
            (None, Some(b)) => Some(format!("to {}", clock(b))),
            (None, None) => None,
        },
        SourceKind::Book => match (start, end) {
            (Some(a), Some(b)) if a == b => Some(format!("p. {a}")),
            (Some(a), Some(b)) => Some(format!("pp. {a}–{b}")),
            (Some(a), None) => Some(format!("from p. {a}")),
            (None, Some(b)) => Some(format!("to p. {b}")),
            (None, None) => None,
        },
        SourceKind::Link => None,
    }
}

/// How far through a stretch [start, end] the learner is, given how far they
/// have got overall (seconds watched, or the furthest page read).
fn through(reached: i64, start: Option<i64>, end: i64) -> f64 {
    let start = start.unwrap_or(0).min(end);
    if reached >= end {
        1.0
    } else if reached <= start || end == start {
        0.0
    } else {
        (reached - start) as f64 / (end - start) as f64
    }
}

/// Progress through a linked stretch of video, 0–1.
pub fn video_progress(start: Option<i64>, end: Option<i64>, duration: Option<i64>, watched: i64, completed: bool) -> f64 {
    if completed {
        return 1.0;
    }
    match end.or(duration).filter(|e| *e > 0) {
        Some(e) => through(watched, start, e),
        None => 0.0,
    }
}

/// Progress through a linked page range of a book, 0–1.
pub fn book_progress(start: Option<i64>, end: Option<i64>, current_page: Option<i64>, page_count: Option<i64>, finished: bool) -> f64 {
    if finished {
        return 1.0;
    }
    let reached = current_page.unwrap_or(0);
    match end.or(page_count).filter(|e| *e > 0) {
        Some(e) => through(reached, start, e),
        None => 0.0,
    }
}

/// Hand-tracked progress (problem set 4 of 12), 0–1.
pub fn manual_progress(done: Option<i64>, total: Option<i64>) -> f64 {
    match (done, total) {
        (Some(d), Some(t)) if t > 0 => (d as f64 / t as f64).clamp(0.0, 1.0),
        _ => 0.0,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Coverage {
    /// Finished at least one linked source.
    Covered,
    /// Partway through one.
    Started,
    NotCovered,
}

impl Coverage {
    pub fn as_str(self) -> &'static str {
        match self {
            Coverage::Covered => "COVERED",
            Coverage::Started => "STARTED",
            Coverage::NotCovered => "NOT_COVERED",
        }
    }
}

/// Coverage from the progress of each linked (not suggested) source.
pub fn coverage(progress: &[f64]) -> Coverage {
    if progress.iter().any(|p| *p >= 1.0) {
        Coverage::Covered
    } else if progress.iter().any(|p| *p > 0.0) {
        Coverage::Started
    } else {
        Coverage::NotCovered
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardMemory {
    pub cards: usize,
    /// Pass rate on review answers in the last 30 days, as a percentage.
    pub remembering_pct: Option<i64>,
    /// The same for the 30 days before that, to say "down from 88%".
    pub previous_pct: Option<i64>,
    pub reviews_30d: usize,
    /// Answers marked Again in the last 7 days.
    pub missed_7d: usize,
    pub next_due: Option<DateTime<Utc>>,
    /// Worth a rewatch of the concept's intuition source before reviewing.
    pub weak: bool,
}

/// Recent memory of the cards tagged with a concept. `due` holds each card's
/// next due time (None for new or suspended cards).
pub fn card_memory(cards: usize, due: &[Option<DateTime<Utc>>], logs: &[LogRow], now: DateTime<Utc>) -> CardMemory {
    let window = |from: i64, to: i64| -> Vec<LogRow> {
        logs.iter()
            .filter(|l| l.reviewed_at > now - Duration::days(to) && l.reviewed_at <= now - Duration::days(from))
            .cloned()
            .collect()
    };
    let recent = retention(&window(0, 30));
    let previous = retention(&window(30, 60));
    let missed_7d = logs.iter().filter(|l| l.reviewed_at > now - Duration::days(7) && l.rating == 1).count();
    let remembering_pct = recent.overall.map(|r| js_round_i64(r * 100.0));
    let weak = missed_7d >= 3 || (recent.review_count >= 10 && remembering_pct.is_some_and(|p| p < 80));
    CardMemory {
        cards,
        remembering_pct,
        previous_pct: previous.overall.map(|r| js_round_i64(r * 100.0)),
        reviews_30d: recent.review_count,
        missed_7d,
        next_due: due.iter().flatten().min().copied(),
        weak,
    }
}

/// Prerequisite edges as (from, to): `from` must be learned before `to`.
fn adjacency(edges: &[(String, String)], forward: bool) -> HashMap<&str, Vec<&str>> {
    let mut map: HashMap<&str, Vec<&str>> = HashMap::new();
    for (from, to) in edges {
        let (a, b) = if forward { (from.as_str(), to.as_str()) } else { (to.as_str(), from.as_str()) };
        map.entry(a).or_default().push(b);
    }
    map
}

fn reach<'a>(start: &'a str, next: &HashMap<&'a str, Vec<&'a str>>, max_depth: usize) -> HashMap<&'a str, usize> {
    let mut depth: HashMap<&str, usize> = HashMap::from([(start, 0)]);
    let mut queue = VecDeque::from([start]);
    while let Some(id) = queue.pop_front() {
        let d = depth[id];
        if d == max_depth {
            continue;
        }
        for n in next.get(id).into_iter().flatten() {
            if !depth.contains_key(n) {
                depth.insert(n, d + 1);
                queue.push_back(n);
            }
        }
    }
    depth
}

/// Whether adding `from → to` would make the prerequisite graph cyclic.
pub fn would_cycle(edges: &[(String, String)], from: &str, to: &str) -> bool {
    from == to || reach(to, &adjacency(edges, true), usize::MAX).contains_key(from)
}

/// The concept, its prerequisites up to `up` steps back, and what it leads to
/// up to `down` steps on: the map on a concept page.
pub fn neighbourhood(center: &str, edges: &[(String, String)], up: usize, down: usize) -> HashSet<String> {
    let mut ids: HashSet<String> = reach(center, &adjacency(edges, false), up).into_keys().map(str::to_string).collect();
    ids.extend(reach(center, &adjacency(edges, true), down).into_keys().map(str::to_string));
    ids
}

/// A starter concept map for a common subject, bundled in `seed/concepts/`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterMap {
    pub key: String,
    pub subject: String,
    pub title: String,
    pub description: String,
    /// Slug of the math roadmap course these concepts belong to.
    pub roadmap_node: Option<String>,
    pub concepts: Vec<StarterConcept>,
    /// [prerequisite, concept] slug pairs.
    pub edges: Vec<(String, String)>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct StarterConcept {
    pub slug: String,
    pub title: String,
    pub summary: Option<String>,
}

pub fn starter_maps() -> Vec<StarterMap> {
    crate::seed::STARTER_CONCEPT_MAPS.iter().map(|json| serde_json::from_str(json).expect("bundled starter map is valid")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(from: &str, to: &str) -> (String, String) {
        (from.into(), to.into())
    }

    #[test]
    fn tags_round_trip() {
        assert_eq!(tag("linalg", "eigenvalues"), "concept::linalg::eigenvalues");
        assert_eq!(parse_tag("Concept::LinAlg::Eigenvalues"), Some(("linalg".into(), "eigenvalues".into())));
        assert_eq!(parse_tag("concept::linalg::eigenvalues::geometric"), Some(("linalg".into(), "eigenvalues".into())));
        assert_eq!(parse_tag("concept::linalg"), None);
        assert_eq!(parse_tag("leech"), None);
        assert_eq!(clean_slug("Null space & rank"), Some("null-space-rank".into()));
        assert_eq!(clean_slug("固有値"), None);
    }

    #[test]
    fn ranges_read_like_the_source() {
        assert_eq!(format_range(SourceKind::Video, Some(130), Some(570)).as_deref(), Some("2:10–9:30"));
        assert_eq!(format_range(SourceKind::Video, Some(3725), None).as_deref(), Some("from 1:02:05"));
        assert_eq!(format_range(SourceKind::Book, Some(133), Some(140)).as_deref(), Some("pp. 133–140"));
        assert_eq!(format_range(SourceKind::Book, Some(12), Some(12)).as_deref(), Some("p. 12"));
        assert_eq!(format_range(SourceKind::Link, Some(1), Some(2)), None);
    }

    #[test]
    fn progress_counts_only_the_linked_stretch() {
        assert_eq!(video_progress(Some(130), Some(570), Some(1000), 100, false), 0.0);
        assert_eq!(video_progress(Some(130), Some(570), Some(1000), 350, false), 0.5);
        assert_eq!(video_progress(Some(130), Some(570), Some(1000), 600, false), 1.0);
        assert_eq!(video_progress(None, None, Some(1000), 250, false), 0.25);
        assert_eq!(video_progress(None, None, None, 250, true), 1.0);
        assert_eq!(book_progress(Some(133), Some(140), Some(140), Some(300), false), 1.0);
        assert_eq!(book_progress(Some(133), Some(140), Some(90), Some(300), false), 0.0);
        assert_eq!(book_progress(None, None, Some(150), Some(300), false), 0.5);
        assert_eq!(manual_progress(Some(4), Some(12)), 1.0 / 3.0);
        assert_eq!(coverage(&[0.0, 1.0]), Coverage::Covered);
        assert_eq!(coverage(&[0.2]), Coverage::Started);
        assert_eq!(coverage(&[]), Coverage::NotCovered);
    }

    #[test]
    fn memory_compares_this_month_to_last() {
        let now = Utc::now();
        let log = |days: i64, rating: i32| LogRow {
            anki_card_id: "1".into(),
            reviewed_at: now - Duration::days(days),
            rating,
            interval_before_days: 5,
            interval_after_days: 10,
            time_ms: 4000,
        };
        let mut logs: Vec<LogRow> = (0..7).map(|_| log(2, 3)).collect();
        logs.extend((0..3).map(|_| log(1, 1)));
        logs.extend((0..8).map(|_| log(40, 3)));
        logs.push(log(40, 1));
        let due = [Some(now + Duration::days(3)), None, Some(now + Duration::days(1))];
        let m = card_memory(3, &due, &logs, now);
        assert_eq!(m.remembering_pct, Some(70));
        assert_eq!(m.previous_pct, Some(89));
        assert_eq!(m.missed_7d, 3);
        assert!(m.weak);
        assert_eq!(m.next_due, Some(now + Duration::days(1)));
    }

    #[test]
    fn cycles_and_neighbourhood() {
        let edges = vec![e("vectors", "maps"), e("maps", "eigen"), e("det", "eigen"), e("eigen", "diag"), e("diag", "markov")];
        assert!(would_cycle(&edges, "eigen", "vectors"));
        assert!(would_cycle(&edges, "eigen", "eigen"));
        assert!(!would_cycle(&edges, "vectors", "det"));
        let near = neighbourhood("eigen", &edges, 1, 1);
        let mut near: Vec<&str> = near.iter().map(String::as_str).collect();
        near.sort();
        assert_eq!(near, vec!["det", "diag", "eigen", "maps"]);
        assert_eq!(neighbourhood("eigen", &edges, 2, 2).len(), 6);
    }

    #[test]
    fn starter_maps_are_valid_dags() {
        for map in starter_maps() {
            let slugs: HashSet<&str> = map.concepts.iter().map(|c| c.slug.as_str()).collect();
            assert_eq!(slugs.len(), map.concepts.len(), "{}: duplicate slug", map.key);
            assert!(map.concepts.iter().all(|c| clean_slug(&c.slug).as_deref() == Some(c.slug.as_str())), "{}: slug not clean", map.key);
            let mut seen: Vec<(String, String)> = Vec::new();
            for (from, to) in &map.edges {
                assert!(slugs.contains(from.as_str()) && slugs.contains(to.as_str()), "{}: unknown edge {from} → {to}", map.key);
                assert!(!would_cycle(&seen, from, to), "{}: cycle at {from} → {to}", map.key);
                seen.push((from.clone(), to.clone()));
            }
        }
    }
}

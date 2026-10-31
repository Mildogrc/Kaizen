//! Math course goal metadata: which roadmap targets are long-term goals and
//! which one is current. Stored in `courses.metadata`.

use serde_json::{Map, Value};

#[derive(Clone, Debug)]
pub struct MathTarget {
    pub slug: String,
    pub title: String,
    pub is_target: bool,
}

fn root(metadata: &Value) -> Map<String, Value> {
    metadata.as_object().cloned().unwrap_or_default()
}

/// Saved long-term target slugs (deduplicated, existing only), else every
/// roadmap node flagged as a target.
pub fn long_term_target_slugs(metadata: &Value, targets: &[MathTarget]) -> Vec<String> {
    let available: std::collections::HashSet<&str> = targets.iter().map(|t| t.slug.as_str()).collect();
    let mut saved: Vec<String> = Vec::new();
    if let Some(Value::Array(slugs)) = metadata.get("longTermTargetSlugs") {
        for slug in slugs.iter().filter_map(Value::as_str) {
            if available.contains(slug) && !saved.iter().any(|s| s == slug) {
                saved.push(slug.to_string());
            }
        }
    }
    if !saved.is_empty() {
        return saved;
    }
    targets.iter().filter(|t| t.is_target).map(|t| t.slug.clone()).collect()
}

/// Saved current target, else a match on the active goal title, else Iwasawa
/// Theory, else the first target.
pub fn current_target_slug(metadata: &Value, targets: &[MathTarget], active_goal_title: Option<&str>) -> Option<String> {
    if let Some(saved) = metadata.get("currentTargetSlug").and_then(Value::as_str)
        && targets.iter().any(|t| t.slug == saved)
    {
        return Some(saved.to_string());
    }
    if let Some(title) = active_goal_title {
        let lower = title.to_lowercase();
        if let Some(t) = targets.iter().find(|t| lower.contains(&t.title.to_lowercase())) {
            return Some(t.slug.clone());
        }
    }
    targets
        .iter()
        .find(|t| t.slug == "iwasawa-theory")
        .or_else(|| targets.first())
        .map(|t| t.slug.clone())
}

pub fn with_target(metadata: &Value, current_target_slug: &str) -> Value {
    let mut map = root(metadata);
    map.insert("currentTargetSlug".into(), Value::String(current_target_slug.into()));
    Value::Object(map)
}

pub fn with_long_term_targets(metadata: &Value, slugs: &[String]) -> Value {
    let mut map = root(metadata);
    let mut unique: Vec<String> = Vec::new();
    for slug in slugs {
        if !unique.contains(slug) {
            unique.push(slug.clone());
        }
    }
    map.insert("longTermTargetSlugs".into(), Value::Array(unique.into_iter().map(Value::String).collect()));
    Value::Object(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn targets() -> Vec<MathTarget> {
        vec![
            MathTarget { slug: "qft".into(), title: "Quantum Field Theory".into(), is_target: true },
            MathTarget { slug: "iwasawa-theory".into(), title: "Iwasawa Theory".into(), is_target: true },
            MathTarget { slug: "real-analysis".into(), title: "Real Analysis".into(), is_target: false },
        ]
    }

    #[test]
    fn falls_back_to_flagged_targets_and_iwasawa() {
        assert_eq!(long_term_target_slugs(&json!({}), &targets()), vec!["qft", "iwasawa-theory"]);
        assert_eq!(current_target_slug(&json!({}), &targets(), None).as_deref(), Some("iwasawa-theory"));
        assert_eq!(current_target_slug(&json!({}), &targets(), Some("Path to Quantum Field Theory")).as_deref(), Some("qft"));
        let meta = with_long_term_targets(&json!({"x": 1}), &["real-analysis".into(), "real-analysis".into()]);
        assert_eq!(long_term_target_slugs(&meta, &targets()), vec!["real-analysis"]);
        assert_eq!(with_target(&meta, "qft")["currentTargetSlug"], "qft");
    }
}

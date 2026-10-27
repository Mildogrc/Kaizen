//! Goal and milestone progress helpers.

/// Progress within a level band (e.g. JLPT N4 words between the N5 and N4 targets).
pub fn level_band_progress_percent(current: i64, target: Option<i64>, previous_target: Option<i64>) -> f64 {
    let previous = previous_target.unwrap_or(0);
    let Some(target) = target.filter(|t| *t > previous) else { return 0.0 };
    let within = (current - previous).max(0) as f64;
    (within / (target - previous) as f64 * 100.0).min(100.0)
}

#[derive(Clone, Debug)]
pub struct VocabGoal {
    pub target_value: Option<i64>,
    pub status: String,
}

pub fn has_completed_active_vocab_goal(goals: &[VocabGoal], known_word_lower_bound: i64) -> bool {
    goals
        .iter()
        .any(|g| g.status == "ACTIVE" && g.target_value.is_some_and(|t| t <= known_word_lower_bound))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_bands() {
        assert_eq!(level_band_progress_percent(1150, Some(1500), Some(800)), 50.0);
        assert_eq!(level_band_progress_percent(700, Some(1500), Some(800)), 0.0);
        assert_eq!(level_band_progress_percent(5000, Some(1500), Some(800)), 100.0);
        assert_eq!(level_band_progress_percent(10, None, None), 0.0);
        assert_eq!(level_band_progress_percent(10, Some(5), Some(8)), 0.0);
    }

    #[test]
    fn vocab_goal_completion() {
        let goals = vec![VocabGoal { target_value: Some(500), status: "ACTIVE".into() }];
        assert!(has_completed_active_vocab_goal(&goals, 500));
        assert!(!has_completed_active_vocab_goal(&goals, 499));
    }
}

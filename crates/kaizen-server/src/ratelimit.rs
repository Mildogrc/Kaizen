//! Small in-memory fixed-window rate limiter (one server instance).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::http::HeaderMap;

#[derive(Default)]
pub struct RateLimiter {
    windows: Mutex<HashMap<String, (Instant, u32)>>,
}

impl RateLimiter {
    /// Count one hit for `key`; false once `limit` hits land inside `window`.
    pub fn allow(&self, key: &str, limit: u32, window: Duration) -> bool {
        let now = Instant::now();
        let mut windows = self.windows.lock().expect("rate limiter lock");
        if windows.len() > 50_000 {
            windows.retain(|_, (start, _)| now.duration_since(*start) < Duration::from_secs(3600));
        }
        let entry = windows.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= limit
    }
}

/// Client address as reported by Cloudflare (the only way in when hosted),
/// falling back to the first X-Forwarded-For hop.
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
        .or_else(|| headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()))
        .map(|s| s.trim().chars().take(64).collect())
        .unwrap_or_else(|| "unknown".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_within_window_and_resets() {
        let limiter = RateLimiter::default();
        let window = Duration::from_millis(50);
        assert!((0..3).all(|_| limiter.allow("a", 3, window)));
        assert!(!limiter.allow("a", 3, window));
        assert!(limiter.allow("b", 3, window));
        std::thread::sleep(Duration::from_millis(60));
        assert!(limiter.allow("a", 3, window));
    }
}

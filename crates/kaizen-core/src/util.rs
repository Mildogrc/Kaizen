//! Small numeric/formatting helpers that reproduce the JavaScript semantics the
//! original app relied on (Math.round, toFixed, toLocaleString).

/// `Math.round`: rounds half toward +∞ (unlike `f64::round`, which rounds half
/// away from zero).
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// `Math.round` returning an integer.
pub fn js_round_i64(x: f64) -> i64 {
    js_round(x) as i64
}

/// `Number.prototype.toFixed(digits)` for display (half rounds up).
pub fn to_fixed(x: f64, digits: usize) -> String {
    let m = 10f64.powi(digits as i32);
    let rounded = (x * m + 0.5).floor() / m;
    format!("{rounded:.digits$}")
}

/// `Number.prototype.toLocaleString('en-US')` for integers: `12,345`.
pub fn thousands(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if n < 0 {
        out.push('-');
    }
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

pub fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// `Number(value)` coerced from JSON, rounded and bounded; falls back when the
/// value is not a finite number (mirrors the settings parsers).
pub fn bounded_number(value: Option<&serde_json::Value>, fallback: i64, min: i64, max: i64) -> i64 {
    let number = value.and_then(json_number);
    match number {
        // Math.min(max, Math.max(min, Math.round(n))) — never panics like clamp.
        Some(n) if n.is_finite() => (js_round(n) as i64).max(min).min(max),
        _ => fallback,
    }
}

/// JavaScript `Number(x)` for JSON scalars: numbers, numeric strings, booleans.
pub fn json_number(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                Some(0.0)
            } else {
                t.parse::<f64>().ok()
            }
        }
        serde_json::Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        serde_json::Value::Null => Some(0.0),
        _ => None,
    }
}

/// Lowercase, collapse non-alphanumerics to `-`, trim dashes.
pub fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in input.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// JavaScript `String.prototype.length` (UTF-16 code units).
pub fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

pub fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let middle = sorted.len() / 2;
    Some(if sorted.len().is_multiple_of(2) {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    })
}

/// 32-bit FNV-1a over UTF-16 code units (the original's `stableHash`).
pub fn fnv1a_utf16(value: &str) -> u32 {
    let mut hash: u32 = 2_166_136_261;
    for unit in value.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    hash
}

/// 32-bit FNV-1a over Unicode scalar values (`for (const ch of str)` +
/// `codePointAt`).
pub fn fnv1a_codepoints(value: &str) -> u32 {
    let mut hash: u32 = 2_166_136_261;
    for ch in value.chars() {
        hash ^= ch as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_matches_javascript() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(to_fixed(0.25, 1), "0.3");
        assert_eq!(to_fixed(1.005, 2), "1.00");
        assert_eq!(to_fixed(12.0, 1), "12.0");
    }

    #[test]
    fn thousands_separators() {
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(1000), "1,000");
        assert_eq!(thousands(1234567), "1,234,567");
        assert_eq!(thousands(-4500), "-4,500");
    }

    #[test]
    fn slugs() {
        assert_eq!(slugify("  Korean Vocabulary! "), "korean-vocabulary");
        assert_eq!(slugify("JLPT N5 / Grammar"), "jlpt-n5-grammar");
    }
}

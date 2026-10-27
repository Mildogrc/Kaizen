//! Turns Anki's rendered card HTML into readable plain text. Card templates
//! embed `<style>` blocks whose CSS would survive naive tag-stripping, so
//! style/script/head content goes first, then tags, sounds, and entities.

use std::sync::LazyLock;

use regex::Regex;

static STYLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<style[\s\S]*?</style>").unwrap());
static SCRIPT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<script[\s\S]*?</script>").unwrap());
static HEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<head[\s\S]*?</head>").unwrap());
static COMMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<!--[\s\S]*?-->").unwrap());
static SOUND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[sound:[^\]]*\]").unwrap());
static PLAY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[anki:play:[^\]]*\]").unwrap());
static BR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<br\s*/?>").unwrap());
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static TRAILING_DOTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\s·\s)+$").unwrap());

pub fn strip_anki_html(html: &str) -> String {
    let s = STYLE.replace_all(html, " ");
    let s = SCRIPT.replace_all(&s, " ");
    let s = HEAD.replace_all(&s, " ");
    let s = COMMENT.replace_all(&s, " ");
    let s = SOUND.replace_all(&s, " ");
    let s = PLAY.replace_all(&s, " ");
    let s = BR.replace_all(&s, " · ");
    let s = TAG.replace_all(&s, " ");
    let s = s
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    let s = SPACE.replace_all(&s, " ");
    let s = TRAILING_DOTS.replace_all(&s, "");
    s.trim().to_string()
}

/// Escape text for safe inclusion in Anki note HTML.
pub fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_styles_sounds_and_entities() {
        let html = "<style>.card{color:red}</style><div>食べる<br>to eat</div>[sound:a.mp3]&nbsp;&amp;";
        assert_eq!(strip_anki_html(html), "食べる · to eat &");
    }
}

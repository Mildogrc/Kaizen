//! YouTube playlist parsing (Data API payloads and public playlist pages) and
//! watch-progress math.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

static PLAYLIST_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_-]{10,80}$").unwrap());
static VIDEO_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_-]{6,20}$").unwrap());
static ISO_DURATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$").unwrap());
static CLOCK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+(?::[0-5]\d){1,2}$").unwrap());

pub fn is_video_id(value: &str) -> bool {
    VIDEO_ID.is_match(value)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub video_id: String,
    pub position: i64,
    pub title: String,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub published_at: Option<String>,
    pub duration_seconds: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistMetadata {
    pub playlist_id: String,
    pub source_url: String,
    pub title: String,
    pub description: Option<String>,
    pub channel_title: Option<String>,
    pub thumbnail_url: Option<String>,
    pub total_items: i64,
    /// youtube-api | youtube-page
    pub source: &'static str,
    pub items: Vec<Video>,
}

/// Seconds from a number, "123", "1:02:03", or ISO-8601 "PT1H2M3S".
pub fn parse_duration(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64().filter(|v| *v > 0),
        Value::String(s) => parse_duration_str(s),
        _ => None,
    }
}

pub fn parse_duration_str(text: &str) -> Option<i64> {
    let t = text.trim();
    if !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()) {
        return t.parse::<i64>().ok().filter(|v| *v > 0);
    }
    if CLOCK.is_match(t) {
        let seconds = t.split(':').filter_map(|p| p.parse::<i64>().ok()).fold(0, |acc, part| acc * 60 + part);
        return (seconds > 0).then_some(seconds);
    }
    let caps = ISO_DURATION.captures(t)?;
    let part = |i: usize| caps.get(i).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
    let seconds = part(1) * 86_400 + part(2) * 3_600 + part(3) * 60 + part(4);
    (seconds > 0).then_some(seconds)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Runtime {
    pub label: String,
    pub hint: String,
}

pub fn runtime(durations: &[Option<i64>], total_items: i64) -> Runtime {
    let known: Vec<i64> = durations.iter().filter_map(|d| d.filter(|v| *v > 0)).collect();
    let seconds: i64 = known.iter().sum();
    let missing = total_items.max(durations.len() as i64) - known.len() as i64;
    if known.is_empty() {
        return Runtime { label: "Unavailable".into(), hint: "Refresh lectures to look up video lengths.".into() };
    }
    let minutes = crate::util::js_round(seconds as f64 / 60.0) as i64;
    let formatted = if minutes >= 60 {
        format!("{}h {}m", minutes / 60, minutes % 60)
    } else if minutes > 0 {
        format!("{minutes}m")
    } else {
        format!("{seconds}s")
    };
    Runtime {
        label: format!("{formatted}{}", if missing > 0 { "+" } else { "" }),
        hint: if missing > 0 {
            format!(
                "{missing} {} no duration available; shown time is a minimum.",
                if missing == 1 { "video has" } else { "videos have" }
            )
        } else {
            "At normal playback speed".into()
        },
    }
}

pub fn parse_playlist_id(input: &str) -> Result<String, String> {
    let value = input.trim();
    if PLAYLIST_ID.is_match(value) {
        return Ok(value.to_string());
    }
    let url = url::Url::parse(value).map_err(|_| "Paste a valid YouTube playlist URL.".to_string())?;
    let host = url.host_str().unwrap_or("").to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    if !["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].contains(&host) {
        return Err("The URL must be from YouTube.".into());
    }
    let list = url.query_pairs().find(|(k, _)| k == "list").map(|(_, v)| v.trim().to_string()).unwrap_or_default();
    if !PLAYLIST_ID.is_match(&list) {
        return Err("That URL does not contain a valid YouTube playlist ID.".into());
    }
    Ok(list)
}

pub fn playlist_url(playlist_id: &str) -> String {
    format!("https://www.youtube.com/playlist?list={}", urlencode(playlist_id))
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Largest thumbnail from a `{default:{url,width},…}` map or array.
pub fn best_thumbnail(thumbnails: &Value) -> Option<String> {
    let candidates: Vec<&Value> = match thumbnails {
        Value::Object(map) => map.values().collect(),
        Value::Array(items) => items.iter().collect(),
        _ => return None,
    };
    candidates
        .into_iter()
        .filter(|v| v.get("url").and_then(Value::as_str).is_some())
        .max_by_key(|v| v.get("width").and_then(Value::as_i64).unwrap_or(0))
        .and_then(|v| v.get("url").and_then(Value::as_str).map(str::to_string))
}

/// Brace-balanced JSON object following `marker` in an HTML page.
pub fn extract_json_object(source: &str, marker: &str) -> Option<Value> {
    let marker_index = source.find(marker)?;
    let rest = &source[marker_index + marker.len()..];
    let start = rest.find('{')?;
    let bytes = rest.as_bytes();
    let (mut depth, mut in_string, mut escaped) = (0i32, false, false);
    for (index, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return serde_json::from_str(&rest[start..=index]).ok();
                }
            }
            _ => {}
        }
    }
    None
}

fn text_value(value: Option<&Value>) -> String {
    let Some(value) = value else { return String::new() };
    if let Some(s) = value.get("simpleText").and_then(Value::as_str) {
        return s.to_string();
    }
    value
        .get("runs")
        .and_then(Value::as_array)
        .map(|runs| runs.iter().filter_map(|r| r.get("text").and_then(Value::as_str)).collect::<String>())
        .unwrap_or_default()
}

/// Every object found under `key` anywhere in the tree (depth-first).
fn find_renderers<'a>(root: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match root {
        Value::Array(items) => items.iter().for_each(|v| find_renderers(v, key, out)),
        Value::Object(map) => {
            if let Some(found) = map.get(key).filter(|v| v.is_object()) {
                out.push(found);
            }
            map.values().for_each(|v| find_renderers(v, key, out));
        }
        _ => {}
    }
}

fn renderers<'a>(root: &'a Value, key: &str) -> Vec<&'a Value> {
    let mut out = Vec::new();
    find_renderers(root, key, &mut out);
    out
}

fn thumbnail_from_renderer(value: Option<&Value>) -> Option<String> {
    let value = value?;
    let thumbs = value.get("thumbnails").or_else(|| value.get("sources"))?;
    best_thumbnail(thumbs)
}

fn usable_title(title: &str) -> bool {
    !title.is_empty() && title != "Deleted video" && title != "Private video"
}

pub fn parse_playlist_videos(data: &Value, playlist_id: &str) -> Vec<Video> {
    let mut by_key: BTreeMap<(i64, String), Video> = BTreeMap::new();
    for (fallback, r) in renderers(data, "playlistVideoRenderer").into_iter().enumerate() {
        let video_id = r.get("videoId").and_then(Value::as_str).unwrap_or("");
        let title = text_value(r.get("title")).trim().to_string();
        if !VIDEO_ID.is_match(video_id) || !usable_title(&title) {
            continue;
        }
        let index = text_value(r.get("index")).trim().parse::<i64>().ok();
        let position = index.map_or(fallback as i64, |i| (i - 1).max(0));
        let duration = r
            .get("lengthSeconds")
            .and_then(parse_duration)
            .or_else(|| parse_duration_str(&text_value(r.get("lengthText"))));
        by_key.insert(
            (position, video_id.into()),
            Video {
                video_id: video_id.into(),
                position,
                title,
                description: None,
                thumbnail_url: thumbnail_from_renderer(r.get("thumbnail")),
                published_at: None,
                duration_seconds: duration,
            },
        );
    }
    for (fallback, r) in renderers(data, "lockupViewModel").into_iter().enumerate() {
        let content_id = r.get("contentId").and_then(Value::as_str).unwrap_or("");
        if r.get("contentType").and_then(Value::as_str) != Some("LOCKUP_CONTENT_TYPE_VIDEO") || !VIDEO_ID.is_match(content_id) {
            continue;
        }
        let title = r
            .pointer("/metadata/lockupMetadataViewModel/title/content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if !usable_title(&title) {
            continue;
        }
        let endpoint = r.pointer("/rendererContext/commandContext/onTap/innertubeCommand/watchEndpoint");
        if endpoint.and_then(|e| e.get("playlistId")).and_then(Value::as_str) != Some(playlist_id) {
            continue;
        }
        let position = endpoint.and_then(|e| e.get("index")).and_then(Value::as_i64).unwrap_or(fallback as i64);
        let duration = r
            .get("contentImage")
            .map(|img| renderers(img, "thumbnailBadgeViewModel"))
            .unwrap_or_default()
            .into_iter()
            .find_map(|badge| badge.get("text").and_then(parse_duration));
        by_key.insert(
            (position, content_id.into()),
            Video {
                video_id: content_id.into(),
                position,
                title,
                description: None,
                thumbnail_url: thumbnail_from_renderer(r.pointer("/contentImage/thumbnailViewModel/image")),
                published_at: None,
                duration_seconds: duration,
            },
        );
    }
    by_key.into_values().collect()
}

/// Continuation token for the next page of a playlist listing.
pub fn playlist_continuation(data: &Value, playlist_id: &str) -> Option<String> {
    let mut containers = Vec::new();
    for key in ["playlistVideoListRenderer", "itemSectionRenderer", "appendContinuationItemsAction", "reloadContinuationItemsCommand"] {
        containers.extend(renderers(data, key));
    }
    let container = containers.into_iter().find(|c| !parse_playlist_videos(c, playlist_id).is_empty())?;
    renderers(container, "continuationCommand")
        .into_iter()
        .find_map(|c| c.get("token").and_then(Value::as_str).map(str::to_string))
}

pub fn parse_playlist_page(html: &str, playlist_id: &str) -> Result<PlaylistMetadata, String> {
    let initial = extract_json_object(html, "ytInitialData")
        .ok_or("YouTube did not return readable playlist details. Add YOUTUBE_API_KEY for reliable imports.")?;
    let metadata = renderers(&initial, "playlistMetadataRenderer").into_iter().next();
    let items = parse_playlist_videos(&initial, playlist_id);
    let title = metadata.and_then(|m| m.get("title")).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let description = metadata.and_then(|m| m.get("description")).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let sidebar = renderers(&initial, "playlistVideoThumbnailRenderer")
        .into_iter()
        .find_map(|r| thumbnail_from_renderer(r.get("thumbnail")));
    let owner = renderers(&initial, "videoOwnerRenderer").into_iter().next();
    if title.is_empty() && items.is_empty() {
        return Err("YouTube could not find a public playlist at that URL.".into());
    }
    let channel = text_value(owner.and_then(|o| o.get("title"))).trim().to_string();
    Ok(PlaylistMetadata {
        playlist_id: playlist_id.into(),
        source_url: playlist_url(playlist_id),
        title: if title.is_empty() { "YouTube playlist".into() } else { title },
        description: (!description.is_empty()).then_some(description),
        channel_title: (!channel.is_empty()).then_some(channel),
        thumbnail_url: sidebar.or_else(|| items.first().and_then(|i| i.thumbnail_url.clone())),
        total_items: items.len() as i64,
        source: "youtube-page",
        items,
    })
}

pub fn embed_url(playlist_id: &str, video_id: Option<&str>, position: Option<i64>, seconds: Option<i64>) -> String {
    let mut query = vec![
        format!("list={}", urlencode(playlist_id)),
        "enablejsapi=1".into(),
        "playsinline=1".into(),
        "rel=0".into(),
    ];
    if let Some(p) = position {
        query.push(format!("index={}", p.max(0)));
    }
    if let Some(s) = seconds.filter(|s| *s > 0) {
        query.push(format!("start={s}"));
    }
    match video_id.filter(|v| VIDEO_ID.is_match(v)) {
        Some(v) => format!("https://www.youtube.com/embed/{v}?{}", query.join("&")),
        None => format!("https://www.youtube.com/embed/videoseries?{}", query.join("&")),
    }
}

/// Two-colour pairings for course covers: (name, background, ink). Each pair
/// keeps the ink readable on the background.
pub const PAIRINGS: [(&str, &str, &str); 12] = [
    ("Midnight and saffron", "#14213D", "#FCA311"),
    ("Forest and mint", "#1B4332", "#D8F3DC"),
    ("Oxblood and cream", "#5B1A1A", "#F6E7CB"),
    ("Ink and coral", "#1D1E2C", "#FF7F6A"),
    ("Teal and sand", "#0F4C5C", "#F2E2C4"),
    ("Plum and peach", "#3C1642", "#FFC09F"),
    ("Cobalt and ivory", "#1F3FBF", "#FAF3E0"),
    ("Charcoal and lime", "#222222", "#C6F432"),
    ("Mustard and ink", "#E9B44C", "#1B1B3A"),
    ("Blush and wine", "#F7CAD0", "#6A040F"),
    ("Sky and navy", "#BDE0FE", "#0B2545"),
    ("Paper and black", "#F4F1EA", "#111111"),
];

/// A stable pairing for a course until the learner picks another.
pub fn default_pairing(seed: &str) -> usize {
    seed.bytes().fold(7usize, |h, b| h.wrapping_mul(31).wrapping_add(b as usize)) % PAIRINGS.len()
}

pub fn pairing(index: usize) -> (&'static str, &'static str, &'static str) {
    PAIRINGS[index % PAIRINGS.len()]
}

static BRACKETS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\([^)]*\)|\[[^\]]*\]").unwrap());
static COURSE_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:[A-Z]{2,5}\s+)?\d+(?:\.\d+)+[A-Z]?\s+").unwrap());
static TERM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(?:spring|summer|fall|autumn|winter)?\s*\d{4}\b").unwrap());
const LEADING: [&str; 6] = ["lectures on ", "lecture series on ", "a course on ", "course on ", "lectures in ", "the "];
const TRAILING: [&str; 9] = [" learning path", " full course", " lecture series", " lectures", " course", " playlist", " series", " tutorial", " class"];
const SMALL_WORDS: [&str; 8] = ["and", "of", "in", "on", "the", "for", "to", "a"];

/// The plainest name a person would give a course ("Lectures on Random
/// Matrices" → "Random Matrices"), used when no AI is connected.
pub fn simple_name(title: &str) -> String {
    let mut name = BRACKETS.replace_all(title, " ").to_string();
    for sep in [" - ", " – ", " — ", " | ", ", "] {
        if let Some((head, _)) = name.split_once(sep) {
            name = head.to_string();
        }
    }
    name = COURSE_CODE.replace(name.trim(), "").to_string();
    name = TERM.replace_all(&name, " ").to_string();
    name = name.trim_matches(|c: char| c.is_whitespace() || ".:;,-".contains(c)).to_string();
    let lower = name.to_lowercase();
    if let Some(prefix) = LEADING.iter().find(|p| lower.starts_with(**p)) {
        name = name[prefix.len()..].to_string();
    }
    loop {
        let lower = name.to_lowercase();
        match TRAILING.iter().find(|t| lower.ends_with(**t) && lower.len() > t.len()) {
            Some(t) => name.truncate(name.len() - t.len()),
            None => break,
        }
    }
    let words: Vec<String> = name
        .split_whitespace()
        .enumerate()
        .map(|(i, w)| {
            let lower = w.to_lowercase();
            if i > 0 && SMALL_WORDS.contains(&lower.as_str()) {
                lower
            } else if w.chars().all(|c| !c.is_uppercase()) {
                let mut chars = w.chars();
                chars.next().map_or_else(String::new, |f| f.to_uppercase().collect::<String>() + chars.as_str())
            } else {
                w.to_string()
            }
        })
        .collect();
    let out = words.join(" ");
    if out.is_empty() { title.trim().to_string() } else { out }
}

/// Clean an AI-suggested name: one line, no quotes or numbering, short.
pub fn tidy_name(raw: &str) -> Option<String> {
    let line = raw.lines().map(str::trim).find(|l| !l.is_empty())?;
    let line = line.trim_start_matches(|c: char| c.is_ascii_digit() || ".)-• ".contains(c));
    let cleaned: String = line.trim_matches(|c: char| "\"'“”‘’*`. ".contains(c)).chars().take(40).collect();
    (!cleaned.is_empty()).then(|| cleaned.trim().to_string())
}

/// The prompt for an image model: the course's simple name, set large, in
/// exactly two colours.
pub fn build_image_prompt(name: &str, pairing_index: usize, title: &str) -> String {
    let (pair, background, ink) = pairing(pairing_index);
    [
        "Design a 16:9 cover image for a course.".to_string(),
        format!("Write the words “{name}” large, in a clean bold sans-serif, and spell them exactly. No other text."),
        format!("Use exactly two flat colours, {pair}: background {background}, everything else {ink}. No gradients, shadows, or third colour."),
        format!("Add at most one simple shape or motif that hints at the subject ({title}). Keep it minimal, like a book cover."),
    ]
    .join("\n")
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// Break a name into at most three lines of roughly `width` characters.
fn wrap(name: &str, width: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for word in name.split_whitespace() {
        match lines.last_mut() {
            Some(line) if line.chars().count() + 1 + word.chars().count() <= width => {
                line.push(' ');
                line.push_str(word);
            }
            _ => lines.push(word.to_string()),
        }
    }
    if lines.len() > 3 {
        let rest = lines.split_off(2).join(" ");
        lines.push(rest);
    }
    lines
}

/// A simple cover: the name in one colour on a panel of the other.
pub fn simple_cover_svg(name: &str, pairing_index: usize) -> String {
    let (_, background, ink) = pairing(pairing_index);
    let longest = name.split_whitespace().map(|w| w.chars().count()).max().unwrap_or(1);
    let width = if name.chars().count() <= 14 { 14 } else { 16.max(longest) };
    let lines = wrap(name, width);
    let widest = lines.iter().map(|l| l.chars().count()).max().unwrap_or(1) as f64;
    let size = (1100.0 / (widest * 0.6)).clamp(64.0, 140.0).floor();
    let line_height = size * 1.08;
    let bottom = 720.0 - 96.0;
    let text: String = lines
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let y = bottom - (lines.len() - 1 - i) as f64 * line_height;
            format!(r#"<text x="88" y="{y:.0}">{}</text>"#, xml_escape(line))
        })
        .collect();
    let rule_y = bottom - (lines.len() as f64 - 1.0) * line_height - size - 36.0;
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="{background}"/><rect x="88" y="{rule_y:.0}" width="96" height="12" fill="{ink}"/><g fill="{ink}" font-family="Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-weight="700" font-size="{size}" letter-spacing="-1">{text}</g></svg>"#
    )
}

// ---------------------------------------------------------------- Progress

#[derive(Clone, Debug)]
pub struct WatchItem {
    pub position: i64,
    pub duration_seconds: Option<i64>,
    pub watched_seconds: i64,
    pub completed: bool,
}

pub fn format_watch_time(seconds: i64) -> String {
    let s = seconds.max(0);
    let (h, m, r) = (s / 3600, (s % 3600) / 60, s % 60);
    format!("{}{m}m {r}s", if h > 0 { format!("{h}h ") } else { String::new() })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchProgress {
    pub watched_seconds: i64,
    pub total_seconds: Option<i64>,
    pub percentage: Option<f64>,
    pub percentage_label: String,
    pub time_label: String,
}

pub fn playlist_progress(items: &[WatchItem], total_items: i64, resume: Option<(i64, i64)>) -> WatchProgress {
    let (mut watched, mut total, mut known) = (0i64, 0i64, 0i64);
    for item in items {
        let resume_seconds = match resume {
            Some((position, seconds)) if position == item.position => seconds,
            _ => 0,
        };
        let saved = item.watched_seconds.max(resume_seconds).max(0);
        match item.duration_seconds.filter(|d| *d > 0) {
            Some(duration) => {
                total += duration;
                known += 1;
                watched += if item.completed { duration } else { saved.min(duration) };
            }
            None => watched += saved,
        }
    }
    let has_total = known == total_items.max(items.len() as i64) && total > 0;
    let percentage = has_total.then(|| (watched as f64 / total as f64 * 100.0).min(100.0));
    let percentage_label = match percentage {
        None => "—".to_string(),
        Some(p) if p > 0.0 && p < 0.01 => "<0.01%".into(),
        Some(p) => {
            let floored = (p * 100.0).floor() / 100.0;
            format!("{}%", trim_float(floored))
        }
    };
    WatchProgress {
        watched_seconds: watched,
        total_seconds: has_total.then_some(total),
        percentage,
        percentage_label,
        time_label: format!(
            "{} / {}",
            format_watch_time(watched),
            if has_total { format_watch_time(total) } else { "duration unavailable".into() }
        ),
    }
}

/// JavaScript-style number → string (no trailing ".0").
fn trim_float(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        let s = format!("{v:.2}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackUpdate {
    pub watched_seconds: i64,
    pub current_seconds: i64,
    pub completed: bool,
}

pub fn playback_update(item: &WatchItem, seconds: f64, ended: bool) -> PlaybackUpdate {
    let duration = item.duration_seconds.filter(|d| *d > 0);
    let position = (seconds.max(0.0).floor() as i64).min(duration.unwrap_or(i64::MAX));
    let completed = item.completed || ended || duration.is_some_and(|d| position >= d);
    let watched_candidate = if completed && duration.is_some() { duration.unwrap_or(0) } else { position };
    PlaybackUpdate {
        watched_seconds: item.watched_seconds.max(watched_candidate).min(duration.unwrap_or(i64::MAX)),
        current_seconds: if ended { 0 } else { position },
        completed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn simple_names() {
        assert_eq!(simple_name("Lectures on Random Matrices"), "Random Matrices");
        assert_eq!(simple_name("Quant Trading Learning Path"), "Quant Trading");
        assert_eq!(simple_name("Distributed Systems (www.distributedsystemscourse.com)"), "Distributed Systems");
        assert_eq!(simple_name("Quantum Mechanics & Quantum Computation - Umesh Vazirani"), "Quantum Mechanics & Quantum Computation");
        assert_eq!(
            simple_name("MIT 18.065 Matrix Methods in Data Analysis, Signal Processing, and Machine Learning, Spring 2018"),
            "Matrix Methods in Data Analysis"
        );
        assert_eq!(simple_name("Differential equations"), "Differential Equations");
        assert_eq!(simple_name("Division algebras and the standard model."), "Division Algebras and the Standard Model");
        assert_eq!(tidy_name("1. \"Random Matrix Theory\"\n"), Some("Random Matrix Theory".into()));
        assert_eq!(tidy_name("  "), None);
    }

    #[test]
    fn covers_use_two_colours_and_escape_text() {
        let svg = simple_cover_svg("Rock & <Roll>", 0);
        assert!(svg.contains("Rock &amp; &lt;Roll&gt;"));
        assert!(svg.contains("#14213D") && svg.contains("#FCA311"));
        assert_eq!(wrap("Quantum Computing Jobs", 16), vec!["Quantum", "Computing Jobs"]);
        let prompt = build_image_prompt("Random Matrix Theory", 1, "Lectures on Random Matrices");
        assert!(prompt.contains("“Random Matrix Theory”") && prompt.contains("#1B4332") && prompt.contains("#D8F3DC"));
        assert!(default_pairing("abc") < PAIRINGS.len());
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration(&json!("PT1H2M3S")), Some(3723));
        assert_eq!(parse_duration(&json!("12:05")), Some(725));
        assert_eq!(parse_duration(&json!("1:00:00")), Some(3600));
        assert_eq!(parse_duration(&json!(90)), Some(90));
        assert_eq!(parse_duration(&json!("P0D")), None);
        assert_eq!(parse_duration(&json!("abc")), None);
    }

    #[test]
    fn playlist_ids() {
        assert_eq!(parse_playlist_id("https://www.youtube.com/playlist?list=PLUl4u3cNGP61Oq3tWYp6V_F-5jb5L2iHb").unwrap(), "PLUl4u3cNGP61Oq3tWYp6V_F-5jb5L2iHb");
        assert_eq!(parse_playlist_id("PLUl4u3cNGP61Oq3tWYp6V_F-5jb5L2iHb").unwrap(), "PLUl4u3cNGP61Oq3tWYp6V_F-5jb5L2iHb");
        assert!(parse_playlist_id("https://vimeo.com/playlist?list=PLUl4u3cNGP61Oq3tWYp6V").is_err());
        assert!(parse_playlist_id("https://www.youtube.com/watch?v=abc").is_err());
    }

    #[test]
    fn progress_math() {
        let items = vec![
            WatchItem { position: 0, duration_seconds: Some(600), watched_seconds: 0, completed: true },
            WatchItem { position: 1, duration_seconds: Some(600), watched_seconds: 120, completed: false },
        ];
        let p = playlist_progress(&items, 2, Some((1, 300)));
        assert_eq!(p.watched_seconds, 900);
        assert_eq!(p.percentage_label, "75%");
        assert_eq!(p.time_label, "15m 0s / 20m 0s");
        let unknown = playlist_progress(&[WatchItem { position: 0, duration_seconds: None, watched_seconds: 5, completed: false }], 1, None);
        assert_eq!(unknown.percentage_label, "—");
        let item = WatchItem { position: 1, duration_seconds: Some(600), watched_seconds: 120, completed: false };
        assert_eq!(playback_update(&item, 700.4, false), PlaybackUpdate { watched_seconds: 600, current_seconds: 600, completed: true });
        assert_eq!(playback_update(&item, 30.0, true).current_seconds, 0);
    }

    #[test]
    fn page_parsing() {
        let html = r#"<script>var ytInitialData = {"metadata":{"playlistMetadataRenderer":{"title":"Linear Algebra","description":"MIT 18.06"}},"contents":{"playlistVideoListRenderer":{"contents":[{"playlistVideoRenderer":{"videoId":"ZK3O402wf1c","title":{"runs":[{"text":"Lecture 1"}]},"index":{"simpleText":"1"},"lengthSeconds":"2389","thumbnail":{"thumbnails":[{"url":"a.jpg","width":120},{"url":"b.jpg","width":480}]}}},{"playlistVideoRenderer":{"videoId":"QVKj3LADCnA","title":{"simpleText":"Lecture 2 {braces}"},"index":{"simpleText":"2"},"lengthText":{"simpleText":"39:49"}}}]}}};</script>"#;
        let meta = parse_playlist_page(html, "PLE7DDD91010BC51F8").unwrap();
        assert_eq!(meta.title, "Linear Algebra");
        assert_eq!(meta.items.len(), 2);
        assert_eq!(meta.items[0].duration_seconds, Some(2389));
        assert_eq!(meta.items[1].duration_seconds, Some(2389));
        assert_eq!(meta.items[0].thumbnail_url.as_deref(), Some("b.jpg"));
        assert_eq!(meta.thumbnail_url.as_deref(), Some("b.jpg"));
    }
}

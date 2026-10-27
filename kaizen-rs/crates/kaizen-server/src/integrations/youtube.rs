//! YouTube playlist metadata: the Data API when `YOUTUBE_API_KEY` is set,
//! otherwise the public playlist page plus innertube continuations.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Duration;

use kaizen_core::youtube::{self as yt, PlaylistMetadata, Video};
use serde_json::{Value, json};

use crate::state::App;

pub async fn fetch_metadata(app: &App, input: &str) -> Result<PlaylistMetadata, String> {
    let playlist_id = yt::parse_playlist_id(input)?;
    match &app.config.youtube_api_key {
        Some(key) => from_api(app, &playlist_id, key).await,
        None => from_page(app, &playlist_id).await,
    }
}

async fn get_json(app: &App, url: &str, query: &[(&str, &str)], what: &str) -> Result<Value, String> {
    let response = app
        .http
        .get(url)
        .query(query)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("YouTube {what} request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("YouTube {what} request failed ({}).", response.status().as_u16()));
    }
    response.json().await.map_err(|_| format!("YouTube returned an unreadable {what} response."))
}

fn text(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

async fn from_api(app: &App, playlist_id: &str, key: &str) -> Result<PlaylistMetadata, String> {
    let playlist = get_json(
        app,
        "https://www.googleapis.com/youtube/v3/playlists",
        &[("part", "snippet,contentDetails"), ("id", playlist_id), ("key", key)],
        "metadata",
    )
    .await?;
    let first = playlist.get("items").and_then(|i| i.get(0)).cloned().unwrap_or(Value::Null);
    let snippet = first.get("snippet").cloned().unwrap_or(Value::Null);
    let title = text(snippet.get("title")).ok_or("YouTube could not find that public playlist.")?;

    let mut items: Vec<Video> = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut query = vec![("part", "snippet,contentDetails"), ("playlistId", playlist_id), ("maxResults", "50"), ("key", key)];
        if let Some(token) = page_token.as_deref() {
            query.push(("pageToken", token));
        }
        let page = get_json(app, "https://www.googleapis.com/youtube/v3/playlistItems", &query, "lecture").await?;
        for item in page.get("items").and_then(Value::as_array).into_iter().flatten() {
            let snippet = item.get("snippet").cloned().unwrap_or(Value::Null);
            let details = item.get("contentDetails").cloned().unwrap_or(Value::Null);
            let video_id = text(details.get("videoId"))
                .or_else(|| text(snippet.get("resourceId").and_then(|r| r.get("videoId"))))
                .unwrap_or_default();
            let title = text(snippet.get("title")).unwrap_or_default();
            if !yt::is_video_id(&video_id) || title.is_empty() || title == "Deleted video" || title == "Private video" {
                continue;
            }
            items.push(Video {
                video_id,
                position: snippet.get("position").and_then(Value::as_i64).unwrap_or(items.len() as i64),
                title,
                description: text(snippet.get("description")),
                thumbnail_url: yt::best_thumbnail(snippet.get("thumbnails").unwrap_or(&Value::Null)),
                published_at: text(details.get("videoPublishedAt")).or_else(|| text(snippet.get("publishedAt"))),
                duration_seconds: None,
            });
        }
        page_token = text(page.get("nextPageToken"));
        if page_token.is_none() {
            break;
        }
    }

    let ids: Vec<String> = items.iter().map(|i| i.video_id.clone()).collect::<HashSet<_>>().into_iter().collect();
    let mut durations: HashMap<String, Option<i64>> = HashMap::new();
    for chunk in ids.chunks(50) {
        let joined = chunk.join(",");
        let page = get_json(
            app,
            "https://www.googleapis.com/youtube/v3/videos",
            &[("part", "contentDetails"), ("id", &joined), ("key", key)],
            "duration",
        )
        .await?;
        for video in page.get("items").and_then(Value::as_array).into_iter().flatten() {
            if let Some(id) = video.get("id").and_then(Value::as_str) {
                durations.insert(id.to_string(), video.get("contentDetails").and_then(|d| d.get("duration")).and_then(yt::parse_duration));
            }
        }
    }
    for item in &mut items {
        item.duration_seconds = durations.get(&item.video_id).copied().flatten();
    }
    let total = first.get("contentDetails").and_then(|d| d.get("itemCount")).and_then(Value::as_i64).unwrap_or(items.len() as i64);
    Ok(PlaylistMetadata {
        playlist_id: playlist_id.to_string(),
        source_url: yt::playlist_url(playlist_id),
        title,
        description: text(snippet.get("description")),
        channel_title: text(snippet.get("channelTitle")),
        thumbnail_url: yt::best_thumbnail(snippet.get("thumbnails").unwrap_or(&Value::Null))
            .or_else(|| items.first().and_then(|i| i.thumbnail_url.clone())),
        total_items: total,
        source: "youtube-api",
        items,
    })
}

async fn from_page(app: &App, playlist_id: &str) -> Result<PlaylistMetadata, String> {
    let html = app
        .http
        .get(format!("{}&hl=en", yt::playlist_url(playlist_id)))
        .header("User-Agent", "Mozilla/5.0 (compatible; Kaizen/1.0)")
        .header("Accept-Language", "en")
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("YouTube playlist request failed: {e}"))?;
    if !html.status().is_success() {
        return Err(format!("YouTube playlist request failed ({}).", html.status().as_u16()));
    }
    let html = html.text().await.map_err(|e| e.to_string())?;
    let mut metadata = yt::parse_playlist_page(&html, playlist_id)?;
    let initial = yt::extract_json_object(&html, "ytInitialData").unwrap_or(Value::Null);
    let mut continuation = yt::playlist_continuation(&initial, playlist_id);
    let context = yt::extract_json_object(&html, "\"INNERTUBE_CONTEXT\":");
    let client = context.as_ref().and_then(|c| c.get("client"));
    let client_name = client.and_then(|c| c.get("clientName")).and_then(Value::as_str);
    let client_version = client.and_then(|c| c.get("clientVersion")).and_then(Value::as_str);
    let mut by_position: BTreeMap<i64, Video> = metadata.items.drain(..).map(|v| (v.position, v)).collect();
    let mut seen: HashSet<String> = HashSet::new();
    while let Some(token) = continuation {
        let (Some(name), Some(version)) = (client_name, client_version) else {
            return Err("YouTube returned an incomplete playlist. Add YOUTUBE_API_KEY and retry to retrieve all lectures.".into());
        };
        if !seen.insert(token.clone()) || seen.len() > 500 {
            return Err("YouTube did not finish listing this playlist. Please retry the import.".into());
        }
        let response = app
            .http
            .post("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false")
            .json(&json!({ "context": { "client": { "clientName": name, "clientVersion": version, "hl": "en" } }, "continuation": token }))
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("YouTube could not load all lectures: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("YouTube could not load all lectures ({}). Please retry.", response.status().as_u16()));
        }
        let data: Value = response.json().await.map_err(|e| e.to_string())?;
        let next = yt::parse_playlist_videos(&data, playlist_id);
        if next.is_empty() {
            return Err("YouTube returned an unreadable lecture page. Please retry or configure YOUTUBE_API_KEY.".into());
        }
        for video in next {
            by_position.insert(video.position, video);
        }
        continuation = yt::playlist_continuation(&data, playlist_id);
    }
    metadata.items = by_position.into_values().collect();
    metadata.total_items = metadata.items.len() as i64;
    Ok(metadata)
}

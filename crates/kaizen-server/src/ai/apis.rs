//! API-key providers over raw HTTP streaming (Anthropic Messages API and the
//! Gemini API; OpenAI's Responses API lives in `chatgpt`).

use futures::StreamExt;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::{AiError, AiEvent, ChatMessage, sse_lines};
use crate::state::App;

pub const DEFAULT_CLAUDE_MODEL: &str = "claude-opus-5-5";
pub const DEFAULT_OPENAI_MODEL: &str = "gpt-6.1-sol";
pub const DEFAULT_GEMINI_MODEL: &str = "gemini-pro-latest";
const ANTHROPIC_VERSION: &str = "2026-10-21";

/// Models that accept `fallbacks: "default"` (server-side refusal fallback).
fn supports_default_fallback(model: &str) -> bool {
    matches!(model, "claude-opus-5-5" | "claude-opus-5" | "claude-sonnet-5-5" | "claude-fable-5-1" | "claude-fable-5")
}

fn supports_effort(model: &str) -> bool {
    ["claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7"]
        .iter()
        .any(|prefix| model.starts_with(prefix))
}

pub async fn stream_anthropic(
    app: &App,
    key: &str,
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    tx: &mpsc::Sender<AiEvent>,
) -> Result<String, AiError> {
    let model = if model.is_empty() { DEFAULT_CLAUDE_MODEL } else { model };
    let mut body = json!({
        "model": model,
        "max_tokens": 64000,
        "stream": true,
        "system": system,
        "messages": messages.iter().map(|m| json!({ "role": m.role, "content": m.content })).collect::<Vec<_>>(),
    });
    if supports_effort(model) {
        body["output_config"] = json!({ "effort": "medium" });
    }
    let mut request = app
        .http
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION);
    if supports_default_fallback(model) {
        body["fallbacks"] = json!("default");
        request = request.header("anthropic-beta", "server-side-fallback-2026-07-01");
    }
    let _ = tx.send(AiEvent::Status("connecting".into())).await;
    let response = request.json(&body).send().await.map_err(|e| AiError::Provider(format!("Could not reach Anthropic: {e}")))?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
            .unwrap_or(text);
        return Err(match status {
            401 | 403 => AiError::NotConnected("Anthropic rejected the API key. Update it under Settings → AI.".into()),
            429 => AiError::UsageLimit(format!("Anthropic rate limit reached: {message}")),
            529 => AiError::Provider("Claude is temporarily overloaded. Try again in a moment.".into()),
            _ => AiError::Provider(format!("Anthropic error {status}: {}", message.chars().take(300).collect::<String>())),
        });
    }
    let mut full = String::new();
    let mut stop_reason: Option<String> = None;
    let mut events = sse_lines(response.bytes_stream().boxed());
    while let Some(event) = events.next().await {
        let (_, data) = event.map_err(|e| AiError::Provider(e.to_string()))?;
        let Ok(value) = serde_json::from_str::<Value>(&data) else { continue };
        match value.get("type").and_then(Value::as_str) {
            Some("content_block_start") => {
                let kind = value.pointer("/content_block/type").and_then(Value::as_str).unwrap_or("");
                let _ = tx.send(AiEvent::Status(if kind == "thinking" { "thinking" } else { "writing" }.into())).await;
            }
            Some("content_block_delta") => {
                if value.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta")
                    && let Some(text) = value.pointer("/delta/text").and_then(Value::as_str)
                {
                    full.push_str(text);
                    let _ = tx.send(AiEvent::Delta(text.to_string())).await;
                }
            }
            Some("message_delta") => {
                if let Some(reason) = value.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    stop_reason = Some(reason.to_string());
                }
            }
            Some("message_stop") => break,
            Some("error") => {
                let message = value.pointer("/error/message").and_then(Value::as_str).unwrap_or("Anthropic stream error.");
                return Err(AiError::Provider(message.to_string()));
            }
            _ => {}
        }
    }
    match stop_reason.as_deref() {
        Some("refusal") => Err(AiError::Provider("Claude declined this request. Try rephrasing it.".into())),
        Some("max_tokens") if !full.is_empty() => Ok(format!("{full}\n\n_(The reply hit the length limit.)_")),
        _ if full.is_empty() => Err(AiError::Provider("Claude returned an empty response.".into())),
        _ => Ok(full),
    }
}

pub async fn stream_gemini(
    app: &App,
    key: &str,
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    tx: &mpsc::Sender<AiEvent>,
) -> Result<String, AiError> {
    let model = if model.is_empty() { DEFAULT_GEMINI_MODEL } else { model };
    let contents: Vec<Value> = messages
        .iter()
        .map(|m| json!({ "role": if m.role == "assistant" { "model" } else { "user" }, "parts": [{ "text": m.content }] }))
        .collect();
    let body = json!({ "contents": contents, "systemInstruction": { "parts": [{ "text": system }] } });
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse");
    let _ = tx.send(AiEvent::Status("connecting".into())).await;
    let response = app
        .http
        .post(url)
        .header("x-goog-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Provider(format!("Could not reach Gemini: {e}")))?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
            .unwrap_or(text);
        return Err(match status {
            400 | 401 | 403 if message.to_lowercase().contains("api key") => {
                AiError::NotConnected("Gemini rejected the API key. Update it under Settings → AI.".into())
            }
            429 => AiError::UsageLimit(format!("Gemini quota reached: {message}")),
            _ => AiError::Provider(format!("Gemini error {status}: {}", message.chars().take(300).collect::<String>())),
        });
    }
    let mut full = String::new();
    let mut events = sse_lines(response.bytes_stream().boxed());
    while let Some(event) = events.next().await {
        let (_, data) = event.map_err(|e| AiError::Provider(e.to_string()))?;
        let Ok(value) = serde_json::from_str::<Value>(&data) else { continue };
        if let Some(parts) = value.pointer("/candidates/0/content/parts").and_then(Value::as_array) {
            for part in parts {
                if part.get("thought").and_then(Value::as_bool) == Some(true) {
                    let _ = tx.send(AiEvent::Status("thinking".into())).await;
                    continue;
                }
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    full.push_str(text);
                    let _ = tx.send(AiEvent::Delta(text.to_string())).await;
                }
            }
        }
    }
    if full.is_empty() { Err(AiError::Provider("Gemini returned an empty response.".into())) } else { Ok(full) }
}

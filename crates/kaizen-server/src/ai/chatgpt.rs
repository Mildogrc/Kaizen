//! ChatGPT plan access through "Sign in with ChatGPT" tokens: storage,
//! rotation-safe refresh, model listing, and streamed Responses API calls.

use chrono::{DateTime, Duration, Utc};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::{AiError, AiEvent, ChatMessage, sse_lines};
use crate::auth::oauth::{OPENAI_RESOURCE, OPENAI_TOKEN_URL};
use crate::error::ApiResult;
use crate::secrets::{self, OPENAI_CHATGPT};
use crate::state::App;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatGptTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub client_id: String,
    pub scopes: Vec<String>,
}

pub async fn store_tokens(app: &App, user_id: &str, tokens: &ChatGptTokens, email: Option<&str>) -> ApiResult<()> {
    let metadata = json!({ "email": email, "connectedAt": Utc::now(), "expiresAt": tokens.expires_at, "scopes": tokens.scopes });
    secrets::put(app, user_id, OPENAI_CHATGPT, tokens, metadata).await
}

#[derive(Deserialize)]
struct RefreshResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: Option<String>,
}

/// A valid access token, refreshing (and rotating) when it is about to expire.
pub async fn access_token(app: &App, user_id: &str) -> Result<String, AiError> {
    let lock = app.refresh_lock(user_id).await;
    let _guard = lock.lock().await;
    let Some((mut tokens, metadata)) = secrets::get::<ChatGptTokens>(app, user_id, OPENAI_CHATGPT).await.map_err(AiError::internal)? else {
        return Err(AiError::NotConnected("Connect your ChatGPT plan under Settings → AI first.".into()));
    };
    if tokens.expires_at - Utc::now() > Duration::seconds(90) {
        return Ok(tokens.access_token);
    }
    let response = app
        .http
        .post(OPENAI_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("client_id", tokens.client_id.as_str()),
            ("resource", OPENAI_RESOURCE),
        ])
        .send()
        .await
        .map_err(|e| AiError::Provider(format!("Could not reach OpenAI to refresh the ChatGPT session: {e}")))?;
    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        tracing::warn!(body = %body.chars().take(300).collect::<String>(), "ChatGPT refresh failed");
        if body.contains("invalid_grant") || body.contains("refresh_token") || body.contains("token_expired") {
            let _ = secrets::delete(app, user_id, OPENAI_CHATGPT).await;
            return Err(AiError::NotConnected("Your ChatGPT session expired. Reconnect it under Settings → AI.".into()));
        }
        return Err(AiError::Provider("OpenAI refused to refresh the ChatGPT session. Try again shortly.".into()));
    }
    let refreshed: RefreshResponse = response.json().await.map_err(|e| AiError::Provider(e.to_string()))?;
    tokens.access_token = refreshed.access_token;
    if let Some(r) = refreshed.refresh_token {
        tokens.refresh_token = r;
    }
    if refreshed.id_token.is_some() {
        tokens.id_token = refreshed.id_token;
    }
    if let Some(scope) = refreshed.scope {
        tokens.scopes = scope.split_whitespace().map(str::to_string).collect();
    }
    tokens.expires_at = Utc::now() + Duration::seconds(refreshed.expires_in.unwrap_or(3600));
    let email = metadata.get("email").and_then(Value::as_str).map(str::to_string);
    store_tokens(app, user_id, &tokens, email.as_deref()).await.map_err(AiError::internal)?;
    Ok(tokens.access_token)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub name: String,
}

/// Models the signed-in ChatGPT account may use (`GET /v1/models`, `visibility == "list"`).
pub async fn list_models(app: &App, user_id: &str) -> Result<Vec<ModelOption>, AiError> {
    let token = access_token(app, user_id).await?;
    let body: Value = app
        .http
        .get("https://api.openai.com/v1/models")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AiError::Provider(e.to_string()))?
        .json()
        .await
        .map_err(|e| AiError::Provider(e.to_string()))?;
    let list = body.get("models").or_else(|| body.get("data")).and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(list
        .iter()
        .filter(|m| m.get("visibility").and_then(Value::as_str).is_none_or(|v| v == "list"))
        .filter_map(|m| {
            let id = m.get("slug").or_else(|| m.get("id")).and_then(Value::as_str)?.to_string();
            let name = m.get("display_name").and_then(Value::as_str).unwrap_or(&id).to_string();
            Some(ModelOption { id, name })
        })
        .collect())
}

/// Stream a Responses API call (shared by plan tokens and API keys).
pub async fn stream_responses(
    app: &App,
    bearer: &str,
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    plan: bool,
    tx: &mpsc::Sender<AiEvent>,
) -> Result<String, AiError> {
    let input: Vec<Value> = messages.iter().map(|m| json!({ "role": m.role, "content": m.content })).collect();
    let mut body = json!({ "model": model, "input": input, "instructions": system, "stream": true });
    if plan {
        body["store"] = Value::Bool(false);
    }
    let response = app
        .http
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(bearer)
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Provider(format!("Could not reach OpenAI: {e}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(openai_error(status.as_u16(), &text));
    }
    let mut full = String::new();
    let mut lines = sse_lines(response.bytes_stream().boxed());
    while let Some(event) = lines.next().await {
        let (name, data) = event.map_err(|e| AiError::Provider(e.to_string()))?;
        let Ok(value) = serde_json::from_str::<Value>(&data) else { continue };
        let kind = value.get("type").and_then(Value::as_str).or(name.as_deref()).unwrap_or("");
        match kind {
            "response.output_text.delta" => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    full.push_str(delta);
                    let _ = tx.send(AiEvent::Delta(delta.to_string())).await;
                }
            }
            "response.reasoning_summary_text.delta" | "response.reasoning.delta" => {
                let _ = tx.send(AiEvent::Status("thinking".into())).await;
            }
            "response.completed" => return Ok(full),
            "response.incomplete" => {
                return if full.is_empty() { Err(AiError::Provider("The response ended early.".into())) } else { Ok(full) };
            }
            "response.failed" | "error" => {
                let code = value
                    .pointer("/response/error/code")
                    .or_else(|| value.pointer("/error/code"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let message = value
                    .pointer("/response/error/message")
                    .or_else(|| value.pointer("/error/message"))
                    .or_else(|| value.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("OpenAI could not complete the request.");
                return Err(openai_failure(code, message));
            }
            _ => {}
        }
    }
    if full.is_empty() { Err(AiError::Provider("The stream ended before a response arrived.".into())) } else { Ok(full) }
}

fn openai_failure(code: &str, message: &str) -> AiError {
    match code {
        "subscription_sharing_usage_limit_exceeded" => AiError::UsageLimit(
            "Your ChatGPT plan's usage limit for connected apps is reached. Check ChatGPT → Settings → Usage, or switch providers in Settings → AI."
                .into(),
        ),
        "subscription_sharing_usage_unavailable" => {
            AiError::Provider("ChatGPT couldn't confirm your plan's usage right now. Try again in a minute.".into())
        }
        _ => AiError::Provider(message.to_string()),
    }
}

fn openai_error(status: u16, body: &str) -> AiError {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let code = value.pointer("/error/code").and_then(Value::as_str).unwrap_or("");
    let message = value.pointer("/error/message").and_then(Value::as_str).unwrap_or(body);
    match status {
        401 => AiError::NotConnected("OpenAI rejected the credentials. Reconnect under Settings → AI.".into()),
        429 => openai_failure(if code.is_empty() { "rate_limited" } else { code }, "OpenAI rate limit reached. Try again shortly."),
        _ => openai_failure(code, &format!("OpenAI error {status}: {}", message.chars().take(300).collect::<String>())),
    }
}

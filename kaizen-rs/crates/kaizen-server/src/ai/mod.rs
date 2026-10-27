//! AI gateway. Every "ask the AI" in Kaizen goes through `POST /api/ai/chat`,
//! which streams Server-Sent Events while the provider generates.
//!
//! Providers and how they authenticate:
//! * Claude — subscription: the official `claude` CLI signed in to the user's
//!   Pro/Max plan; api: Anthropic Messages API key.
//! * OpenAI — subscription: "Sign in with ChatGPT" plan tokens (or the
//!   official `codex` CLI signed in with ChatGPT); api: OpenAI API key.
//! * Gemini — subscription: the official Antigravity `agy` CLI signed in with
//!   Google; api: Gemini API key.
//!
//! Machine-level CLI logins and instance API keys belong to the instance
//! owner, so only the owner may use them (a hosted multi-user deployment
//! must not run other people's requests on the owner's plan).

pub mod apis;
pub mod chatgpt;
pub mod cli;
pub mod turns;

use std::time::{Duration, Instant};

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::response::sse::{KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures::stream::BoxStream;
use futures::StreamExt;
use kaizen_core::settings::{self as core_settings, AiConfiguration};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::secrets;
use crate::state::App;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    /// user | assistant
    pub role: String,
    pub content: String,
}

#[derive(Debug)]
pub enum AiEvent {
    /// Coarse progress for the loading animation: connecting | thinking | writing.
    Status(String),
    Delta(String),
}

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("{0}")]
    NotConnected(String),
    #[error("{0}")]
    UsageLimit(String),
    #[error("{0}")]
    Provider(String),
    #[error("{0}")]
    Internal(String),
    #[error("Stopped.")]
    Cancelled,
}

impl AiError {
    pub fn internal(e: impl std::fmt::Display) -> AiError {
        AiError::Internal(e.to_string())
    }
    fn code(&self) -> &'static str {
        match self {
            AiError::NotConnected(_) => "not_connected",
            AiError::UsageLimit(_) => "usage_limit",
            AiError::Provider(_) => "provider_error",
            AiError::Internal(_) => "internal",
            AiError::Cancelled => "cancelled",
        }
    }
}

/// Resolved provider route for a request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    ClaudeCli,
    ClaudeApi,
    ChatGptPlan,
    CodexCli,
    OpenAiApi,
    AgyCli,
    GeminiApi,
}

impl Route {
    pub fn label(&self) -> &'static str {
        match self {
            Route::ClaudeCli => "Claude (your plan, via Claude Code)",
            Route::ClaudeApi => "Claude API",
            Route::ChatGptPlan => "ChatGPT (your plan)",
            Route::CodexCli => "ChatGPT (your plan, via Codex)",
            Route::OpenAiApi => "OpenAI API",
            Route::AgyCli => "Gemini (your plan, via Antigravity)",
            Route::GeminiApi => "Gemini API",
        }
    }
    pub fn provider(&self) -> &'static str {
        match self {
            Route::ClaudeCli | Route::ClaudeApi => "claude",
            Route::ChatGptPlan | Route::CodexCli | Route::OpenAiApi => "openai",
            Route::AgyCli | Route::GeminiApi => "gemini",
        }
    }
}

pub const BASE_SYSTEM_PROMPT: &str = "You are the study assistant inside Kaizen, a personal long-term learning app (languages, math, books, skills). \
Answer in Markdown. Be accurate, concrete, and encouraging without padding. When the request asks for an exact output format \
(for example a numbered rating list or raw JSON), follow it exactly.";

async fn api_key(app: &App, user: &User, provider: &str) -> Result<Option<String>, AiError> {
    if let Some((key, _)) = secrets::get::<String>(app, &user.id, &secrets::api_key_kind(provider)).await.map_err(AiError::internal)? {
        return Ok(Some(key));
    }
    if !user.is_owner {
        return Ok(None);
    }
    Ok(match provider {
        "claude" => app.config.anthropic_api_key.clone(),
        "openai" => app.config.openai_api_key.clone(),
        "gemini" => app.config.gemini_api_key.clone(),
        _ => None,
    })
}

/// Pick the concrete route for the user's configuration.
/// Claude Code / Antigravity CLI subscriptions are switched off for now (the
/// settings parser already maps them to API-key mode); flip to re-enable.
const CLI_PLAN_SUBSCRIPTIONS: bool = false;

pub async fn resolve_route(app: &App, user: &User, config: &AiConfiguration) -> Result<Route, AiError> {
    let unavailable = |name: &str| {
        AiError::NotConnected(format!(
            "{name} subscriptions can't be connected to Kaizen. Use your ChatGPT plan, or add a {name} API key under Settings → AI."
        ))
    };
    let owner_only = || {
        AiError::NotConnected(
            "Subscription CLIs on this server belong to its owner. Add your own API key under Settings → AI.".into(),
        )
    };
    match (config.provider.as_str(), config.mode.as_str()) {
        ("claude", "subscription") => {
            if !CLI_PLAN_SUBSCRIPTIONS {
                return Err(unavailable("Claude"));
            }
            if !user.is_owner {
                return Err(owner_only());
            }
            cli::find(app, cli::Tool::Claude).ok_or_else(|| AiError::NotConnected(cli::Tool::Claude.missing_message()))?;
            Ok(Route::ClaudeCli)
        }
        ("openai", "subscription") => {
            if secrets::metadata(app, &user.id, secrets::OPENAI_CHATGPT).await.map_err(AiError::internal)?.is_some() {
                return Ok(Route::ChatGptPlan);
            }
            if user.is_owner && cli::find(app, cli::Tool::Codex).is_some() {
                return Ok(Route::CodexCli);
            }
            Err(AiError::NotConnected(
                "Connect your ChatGPT plan under Settings → AI (Sign in with ChatGPT), or install the Codex CLI.".into(),
            ))
        }
        ("gemini", "subscription") => {
            if !CLI_PLAN_SUBSCRIPTIONS {
                return Err(unavailable("Gemini"));
            }
            if !user.is_owner {
                return Err(owner_only());
            }
            cli::find(app, cli::Tool::Agy).ok_or_else(|| AiError::NotConnected(cli::Tool::Agy.missing_message()))?;
            Ok(Route::AgyCli)
        }
        (provider, _) => {
            let missing = || AiError::NotConnected(format!("Add your {} API key under Settings → AI.", provider_name(provider)));
            api_key(app, user, provider).await?.ok_or_else(missing)?;
            Ok(match provider {
                "openai" => Route::OpenAiApi,
                "gemini" => Route::GeminiApi,
                _ => Route::ClaudeApi,
            })
        }
    }
}

pub fn provider_name(provider: &str) -> &'static str {
    match provider {
        "openai" => "OpenAI",
        "gemini" => "Gemini",
        _ => "Anthropic",
    }
}

/// Run one completion over the transcript, streaming events into `tx`.
pub async fn complete(
    app: &App,
    user: &User,
    route: &Route,
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    tx: &mpsc::Sender<AiEvent>,
) -> Result<String, AiError> {
    match route {
        Route::ClaudeCli => cli::run_claude(app, model, system, messages, tx).await,
        Route::CodexCli => cli::run_codex(app, model, system, messages, tx).await,
        Route::AgyCli => cli::run_agy(app, model, system, messages, tx).await,
        Route::ChatGptPlan => {
            let token = chatgpt::access_token(app, &user.id).await?;
            let model = if model.is_empty() { default_chatgpt_model(app, &user.id).await } else { model.to_string() };
            chatgpt::stream_responses(app, &token, &model, system, messages, true, tx).await
        }
        Route::OpenAiApi => {
            let key = api_key(app, user, "openai").await?.unwrap_or_default();
            let model = if model.is_empty() { apis::DEFAULT_OPENAI_MODEL } else { model };
            chatgpt::stream_responses(app, &key, model, system, messages, false, tx).await
        }
        Route::ClaudeApi => {
            let key = api_key(app, user, "claude").await?.unwrap_or_default();
            apis::stream_anthropic(app, &key, model, system, messages, tx).await
        }
        Route::GeminiApi => {
            let key = api_key(app, user, "gemini").await?.unwrap_or_default();
            apis::stream_gemini(app, &key, model, system, messages, tx).await
        }
    }
}

async fn default_chatgpt_model(app: &App, user_id: &str) -> String {
    chatgpt::list_models(app, user_id)
        .await
        .ok()
        .and_then(|models| models.into_iter().next())
        .map(|m| m.id)
        .unwrap_or_else(|| apis::DEFAULT_OPENAI_MODEL.to_string())
}

/// Compose a transcript into one prompt for CLIs that take a single input.
pub fn transcript_prompt(system: Option<&str>, messages: &[ChatMessage]) -> String {
    let mut out = String::new();
    if let Some(system) = system.filter(|s| !s.is_empty()) {
        out.push_str("<instructions>\n");
        out.push_str(system);
        out.push_str("\n</instructions>\n\n");
    }
    if messages.len() == 1 {
        out.push_str(&messages[0].content);
        return out;
    }
    out.push_str("This is an ongoing conversation. Reply as the Assistant to the latest User message only.\n\n");
    for m in messages {
        out.push_str(if m.role == "assistant" { "### Assistant\n" } else { "### User\n" });
        out.push_str(m.content.trim());
        out.push_str("\n\n");
    }
    out.push_str("### Assistant\n");
    out
}

// ------------------------------------------------------------------- SSE

/// Parse a byte stream of Server-Sent Events into (event, data) pairs.
pub fn sse_lines(mut stream: BoxStream<'static, reqwest::Result<Bytes>>) -> BoxStream<'static, Result<(Option<String>, String), String>> {
    Box::pin(async_stream::stream! {
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => { yield Err(e.to_string()); return; }
            };
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            if buffer.contains('\r') {
                buffer = buffer.replace("\r\n", "\n");
            }
            while let Some(end) = buffer.find("\n\n") {
                let block: String = buffer.drain(..end + 2).collect();
                let mut event = None;
                let mut data = Vec::new();
                for line in block.lines() {
                    if let Some(v) = line.strip_prefix("event:") {
                        event = Some(v.trim().to_string());
                    } else if let Some(v) = line.strip_prefix("data:") {
                        data.push(v.strip_prefix(' ').unwrap_or(v).to_string());
                    }
                }
                if !data.is_empty() {
                    yield Ok((event, data.join("\n")));
                }
            }
        }
    })
}

// --------------------------------------------------------------- Endpoints

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    conversation_id: Option<String>,
    /// grammar-lesson | grammar-tutor | leech-plan | schema-import | reading-passage | kanji-mnemonic | general | ...
    context_kind: String,
    context_ref: Option<String>,
    title: Option<String>,
    message: String,
}

#[derive(sqlx::FromRow)]
struct ConversationRow {
    id: String,
    context_kind: String,
    context_ref: Option<String>,
}

pub async fn chat(State(app): State<App>, user: User, Json(req): Json<ChatRequest>) -> ApiResult<Response> {
    let message = req.message.trim().to_string();
    if message.is_empty() {
        return Err(ApiError::bad("Write a message first."));
    }
    if message.len() > 400_000 {
        return Err(ApiError::bad("That message is too long (400 KB max)."));
    }
    let config = core_settings::ai(&user.settings);
    // Nothing is stored or started unless an AI is actually connected.
    if let Err(error) = resolve_route(&app, &user, &config).await {
        return Err(ApiError::bad(error.to_string()));
    }

    // Find or create the conversation, then append the user's message.
    let conversation: ConversationRow = match &req.conversation_id {
        Some(id) => sqlx::query_as("SELECT id, context_kind, context_ref FROM ai_conversations WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(&user.id)
            .fetch_optional(&app.db)
            .await?
            .ok_or_else(|| ApiError::not_found("Conversation"))?,
        None => {
            let id = new_id();
            let title = req.title.clone().unwrap_or_else(|| message.lines().next().unwrap_or("Chat").chars().take(80).collect());
            sqlx::query(
                "INSERT INTO ai_conversations (id, user_id, title, context_kind, context_ref, provider, model) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(&id)
            .bind(&user.id)
            .bind(title)
            .bind(&req.context_kind)
            .bind(&req.context_ref)
            .bind(&config.provider)
            .bind(&config.model)
            .execute(&app.db)
            .await?;
            ConversationRow { id, context_kind: req.context_kind.clone(), context_ref: req.context_ref.clone() }
        }
    };
    let Some(turn) = app.turns.begin(&conversation.id, &user.id) else {
        return Err(ApiError::Conflict("The AI is still answering in this conversation. Wait for it or press Stop.".into()));
    };
    let user_message_id = new_id();
    sqlx::query("INSERT INTO ai_messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)")
        .bind(&user_message_id)
        .bind(&conversation.id)
        .bind(&message)
        .execute(&app.db)
        .await?;
    let transcript: Vec<ChatMessage> = sqlx::query_as::<_, (String, String)>(
        "SELECT role, content FROM ai_messages WHERE conversation_id = $1 AND error IS NULL ORDER BY created_at, id",
    )
    .bind(&conversation.id)
    .fetch_all(&app.db)
    .await?
    .into_iter()
    .map(|(role, content)| ChatMessage { role, content })
    .collect();

    // The reply runs on its own task: closing the panel or the tab only
    // detaches this viewer; the answer is still generated and saved.
    let stream = turns::watch(turn.clone(), conversation.id.clone(), false);
    tokio::spawn(run_turn(app.clone(), user, config, conversation, transcript, turn));
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))).into_response())
}

/// Re-attach to a reply that is still being generated (204 when idle).
pub async fn stream_turn(State(app): State<App>, user: User, Path(id): Path<String>) -> Response {
    match app.turns.get(&id, &user.id) {
        Some(turn) => Sse::new(turns::watch(turn, id, true)).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))).into_response(),
        None => axum::http::StatusCode::NO_CONTENT.into_response(),
    }
}

/// Stop a running reply (the partial text is kept).
pub async fn stop_turn(State(app): State<App>, user: User, Path(id): Path<String>) -> Json<Value> {
    if let Some(turn) = app.turns.get(&id, &user.id) {
        turn.cancel.cancel();
    }
    Json(json!({ "ok": true }))
}

async fn run_turn(
    app: App,
    user: User,
    config: AiConfiguration,
    conversation: ConversationRow,
    transcript: Vec<ChatMessage>,
    turn: std::sync::Arc<turns::Turn>,
) {
    let started = Instant::now();
    let route = match resolve_route(&app, &user, &config).await {
        Ok(route) => route,
        Err(error) => {
            app.turns.finish(&conversation.id);
            turn.publish("error", json!({ "message": error.to_string(), "code": error.code() }));
            return;
        }
    };
    turn.publish("start", json!({ "provider": route.provider(), "label": route.label(), "model": config.model }));

    // Provider events flow through a channel; Stop cancels the provider
    // (killing CLI subprocesses) promptly.
    let (tx, mut rx) = mpsc::channel::<AiEvent>(256);
    let app_for_provider = app.clone();
    let user_for_provider = user.clone();
    let route_for_provider = route.clone();
    let model = config.model.clone();
    let mut provider = tokio::spawn(async move {
        complete(&app_for_provider, &user_for_provider, &route_for_provider, &model, BASE_SYSTEM_PROMPT, &transcript, &tx).await
    });
    let mut partial = String::new();
    let mut first_token: Option<Duration> = None;
    let result = loop {
        tokio::select! {
            event = rx.recv() => match event {
                Some(AiEvent::Delta(text)) => {
                    if first_token.is_none() { first_token = Some(started.elapsed()); }
                    partial.push_str(&text);
                    turn.publish("delta", json!({ "text": text }));
                }
                Some(AiEvent::Status(status)) => {
                    turn.publish("status", json!({ "status": status }));
                }
                None => break match (&mut provider).await {
                    Ok(result) => result,
                    Err(_) => Err(AiError::Cancelled),
                },
            },
            _ = turn.cancel.cancelled() => {
                provider.abort();
                break Err(AiError::Cancelled);
            }
        }
    };
    let duration_ms = started.elapsed().as_millis() as i32;
    match result {
        Ok(text) => {
            let text = if text.trim().is_empty() { partial } else { text };
            let id = new_id();
            let _ = sqlx::query(
                "INSERT INTO ai_messages (id, conversation_id, role, content, provider, model, duration_ms) VALUES ($1, $2, 'assistant', $3, $4, $5, $6)",
            )
            .bind(&id)
            .bind(&conversation.id)
            .bind(&text)
            .bind(route.provider())
            .bind(&config.model)
            .bind(duration_ms)
            .execute(&app.db)
            .await;
            let _ = sqlx::query("UPDATE ai_conversations SET updated_at = now() WHERE id = $1").bind(&conversation.id).execute(&app.db).await;
            let extras = context_extras(&app, &user, &conversation, &text).await;
            // Saved before the turn ends, so a viewer arriving now reads it from the database.
            app.turns.finish(&conversation.id);
            turn.publish(
                "done",
                json!({
                    "messageId": id, "text": text, "durationMs": duration_ms,
                    "firstTokenMs": first_token.map(|d| d.as_millis() as u64), "extras": extras,
                }),
            );
        }
        Err(error) => {
            if !partial.trim().is_empty() {
                let _ = sqlx::query(
                    "INSERT INTO ai_messages (id, conversation_id, role, content, provider, model, duration_ms, error) VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7)",
                )
                .bind(new_id())
                .bind(&conversation.id)
                .bind(&partial)
                .bind(route.provider())
                .bind(&config.model)
                .bind(duration_ms)
                .bind(error.to_string())
                .execute(&app.db)
                .await;
            }
            if !matches!(error, AiError::Cancelled) {
                tracing::warn!(route = ?route, error = %error, "ai request failed");
            }
            app.turns.finish(&conversation.id);
            turn.publish("error", json!({ "message": error.to_string(), "code": error.code() }));
        }
    }
}

/// Structured results the UI can act on after a reply finishes.
async fn context_extras(app: &App, user: &User, conversation: &ConversationRow, text: &str) -> Value {
    match conversation.context_kind.as_str() {
        "grammar-lesson" => {
            let Some(lesson_id) = &conversation.context_ref else { return Value::Null };
            let ids: Option<Value> = sqlx::query_scalar("SELECT grammar_item_ids FROM grammar_lessons WHERE id = $1 AND user_id = $2")
                .bind(lesson_id)
                .bind(&user.id)
                .fetch_optional(&app.db)
                .await
                .ok()
                .flatten();
            let expected = ids.as_ref().and_then(Value::as_array).map_or(0, Vec::len);
            match kaizen_core::grammar::parse_final_ratings(text, expected) {
                Some(ratings) => json!({ "ratings": ratings }),
                None => Value::Null,
            }
        }
        "schema-import" | "reading-passage" => match kaizen_core::schema::extract_json(text) {
            Some(json) => json!({ "json": json }),
            None => Value::Null,
        },
        _ => Value::Null,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationQuery {
    context_kind: Option<String>,
    context_ref: Option<String>,
}

/// Latest conversation for a context (so tutoring sessions survive reloads).
pub async fn find_conversation(State(app): State<App>, user: User, Query(q): Query<ConversationQuery>) -> ApiResult<Json<Value>> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, title FROM ai_conversations WHERE user_id = $1 AND context_kind = $2 AND context_ref IS NOT DISTINCT FROM $3
         ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(&user.id)
    .bind(q.context_kind.unwrap_or_else(|| "general".into()))
    .bind(q.context_ref)
    .fetch_optional(&app.db)
    .await?;
    let Some((id, title)) = row else { return Ok(Json(json!({ "conversation": null }))) };
    Ok(Json(json!({ "conversation": conversation_json(&app, &user, &id, &title).await? })))
}

async fn conversation_json(app: &App, user: &User, id: &str, title: &str) -> ApiResult<Value> {
    let messages: Vec<(String, String, String, Option<String>, Option<i32>)> = sqlx::query_as(
        "SELECT id, role, content, error, duration_ms FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at, id",
    )
    .bind(id)
    .fetch_all(&app.db)
    .await?;
    let running = app.turns.get(id, &user.id).is_some();
    // Structured results of the latest finished reply (e.g. lesson ratings),
    // so a reopened lesson can re-apply them.
    let extras = match messages.last() {
        Some((_, role, content, None, _)) if role == "assistant" && !running => {
            let row: Option<ConversationRow> =
                sqlx::query_as("SELECT id, context_kind, context_ref FROM ai_conversations WHERE id = $1").bind(id).fetch_optional(&app.db).await?;
            match row {
                Some(row) => context_extras(app, user, &row, content).await,
                None => Value::Null,
            }
        }
        _ => Value::Null,
    };
    Ok(json!({
        "id": id,
        "title": title,
        "running": running,
        "extras": extras,
        "messages": messages.into_iter().map(|(id, role, content, error, duration)| json!({
            "id": id, "role": role, "content": content, "error": error, "durationMs": duration,
        })).collect::<Vec<_>>(),
    }))
}

pub async fn get_conversation(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let title: String = sqlx::query_scalar("SELECT title FROM ai_conversations WHERE id = $1 AND user_id = $2")
        .bind(&id)
        .bind(&user.id)
        .fetch_optional(&app.db)
        .await?
        .ok_or_else(|| ApiError::not_found("Conversation"))?;
    Ok(Json(conversation_json(&app, &user, &id, &title).await?))
}

pub async fn delete_conversation(State(app): State<App>, user: User, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2").bind(&id).bind(&user.id).execute(&app.db).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn list_conversations(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, title, context_kind, updated_at FROM ai_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    Ok(Json(json!({
        "conversations": rows.into_iter().map(|(id, title, kind, updated)| json!({ "id": id, "title": title, "contextKind": kind, "updatedAt": updated })).collect::<Vec<_>>(),
    })))
}

/// Connection status for every provider/mode, for Settings → AI.
pub async fn status(app: &App, user: &User) -> ApiResult<Value> {
    let config = core_settings::ai(&user.settings);
    let chatgpt = secrets::metadata(app, &user.id, secrets::OPENAI_CHATGPT).await?;
    let mut keys = serde_json::Map::new();
    for provider in core_settings::AI_PROVIDERS {
        let own = secrets::metadata(app, &user.id, &secrets::api_key_kind(provider)).await?.is_some();
        let instance = user.is_owner
            && match provider {
                "claude" => app.config.anthropic_api_key.is_some(),
                "openai" => app.config.openai_api_key.is_some(),
                _ => app.config.gemini_api_key.is_some(),
            };
        keys.insert(provider.to_string(), json!({ "saved": own, "instance": instance }));
    }
    let cli_status = |tool: cli::Tool| {
        let path = cli::find(app, tool);
        json!({ "installed": path.is_some(), "path": path.map(|p| p.display().to_string()), "loginCommand": tool.login_command(), "installCommand": tool.install_command() })
    };
    let resolved = resolve_route(app, user, &config).await;
    Ok(json!({
        "config": config,
        "subscriptionProviders": core_settings::SUBSCRIPTION_PROVIDERS,
        "isOwner": user.is_owner,
        "route": resolved.as_ref().ok().map(|r| json!({ "label": r.label(), "provider": r.provider() })),
        "routeError": resolved.err().map(|e| e.to_string()),
        "chatgpt": chatgpt,
        "chatgptSignIn": crate::auth::oauth::chatgpt_available(app),
        "apiKeys": keys,
        "clis": { "claude": cli_status(cli::Tool::Claude), "codex": cli_status(cli::Tool::Codex), "agy": cli_status(cli::Tool::Agy) },
    }))
}

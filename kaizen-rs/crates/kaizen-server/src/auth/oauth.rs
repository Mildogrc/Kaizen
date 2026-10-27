//! OAuth 2.0 authorization-code + PKCE sign-in.
//!
//! * Google — standard OpenID Connect (identity only).
//! * OpenAI — "Sign in with ChatGPT". On a loopback install it registers
//!   dynamically as a local personal app and also grants plan usage
//!   (`chatgpt.tokens.use.direct`), which the AI gateway uses to run requests
//!   on the user's ChatGPT plan. Hosted deployments need an issued client id.
//! * Anthropic does not offer third-party sign-in; Claude is connected through
//!   the official `claude` CLI instead (see `ai`).

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{MaybeUser, User, create_session, destroy_session, email_allowed, set_cookie_headers};
use crate::ai::chatgpt::{ChatGptTokens, store_tokens};
use crate::crypto::{new_id, pkce_challenge, random_token};
use crate::db::{kv_get, kv_set, safe_return_to};
use crate::error::{ApiError, ApiResult};
use crate::state::App;

pub const OPENAI_DYNAMIC_CLIENT: &str = "dynamic_agent_client";
pub const OPENAI_RESOURCE: &str = "https://api.openai.com/v1";
const OPENAI_SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

struct ProviderSpec {
    id: &'static str,
    name: &'static str,
    authorize_url: &'static str,
    token_url: &'static str,
    jwks_url: &'static str,
    issuers: &'static [&'static str],
}

const GOOGLE: ProviderSpec = ProviderSpec {
    id: "google",
    name: "Google",
    authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
    token_url: "https://oauth2.googleapis.com/token",
    jwks_url: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: &["https://accounts.google.com", "accounts.google.com"],
};

pub const OPENAI_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";

const OPENAI: ProviderSpec = ProviderSpec {
    id: "openai",
    name: "ChatGPT",
    authorize_url: "https://auth.openai.com/api/accounts/authorize",
    token_url: OPENAI_TOKEN_URL,
    jwks_url: "https://auth.openai.com/.well-known/jwks.json",
    issuers: &["https://auth.openai.com"],
};

fn spec(id: &str) -> Option<&'static ProviderSpec> {
    match id {
        "google" => Some(&GOOGLE),
        "openai" => Some(&OPENAI),
        _ => None,
    }
}

pub fn routes() -> Router<App> {
    Router::new()
        .route("/providers", get(providers))
        .route("/{provider}/start", get(start))
        .route("/callback", get(callback))
        .route("/logout", post(logout))
}

/// The OpenAI loopback flow requires `http://127.0.0.1:<port>/auth/callback`.
fn openai_redirect_uri(app: &App) -> Option<String> {
    let url = &app.config.public_url;
    match url.host_str() {
        _ if app.config.openai_client_id.is_some() => Some(app.config.oauth_redirect_uri()),
        Some("127.0.0.1") | Some("localhost") => {
            Some(format!("http://127.0.0.1:{}/auth/callback", url.port_or_known_default().unwrap_or(80)))
        }
        _ => None,
    }
}

/// Whether "Sign in with ChatGPT" (and its plan connection) works on this install.
pub fn chatgpt_available(app: &App) -> bool {
    availability(app, "openai").0
}

fn availability(app: &App, provider: &str) -> (bool, Option<&'static str>) {
    match provider {
        "google" if app.config.google.is_some() => (true, None),
        "google" => (false, Some("Set AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET to enable Google sign-in.")),
        "openai" if openai_redirect_uri(app).is_some() => (true, None),
        "openai" => (false, Some("Sign in with ChatGPT for hosted apps needs an OpenAI-issued client id (AUTH_OPENAI_CLIENT_ID).")),
        _ => (false, None),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderInfo {
    id: &'static str,
    name: &'static str,
    available: bool,
    reason: Option<&'static str>,
}

async fn providers(State(app): State<App>) -> Json<Value> {
    // ChatGPT first: signing in with it also connects the plan for AI.
    let list: Vec<ProviderInfo> = [&OPENAI, &GOOGLE]
        .iter()
        .map(|p| {
            let (available, reason) = availability(&app, p.id);
            ProviderInfo { id: p.id, name: p.name, available, reason }
        })
        .collect();
    Json(json!({
        "providers": list,
        "claude": {
            "available": false,
            "reason": "Anthropic doesn’t offer “Sign in with Claude” for third-party apps. You can still use Claude for AI with an Anthropic API key under Settings → AI.",
        },
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartQuery {
    return_to: Option<String>,
    /// login (default) | connect (link to the signed-in account)
    purpose: Option<String>,
}

async fn openai_host_id(app: &App) -> ApiResult<String> {
    if let Some(id) = kv_get(&app.db, "openai_host_id").await? {
        return Ok(id);
    }
    let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
    kv_set(&app.db, "openai_host_id", &id).await?;
    Ok(id)
}

async fn openai_client_id(app: &App) -> ApiResult<String> {
    if let Some(id) = &app.config.openai_client_id {
        return Ok(id.clone());
    }
    Ok(kv_get(&app.db, "openai_client_id").await?.unwrap_or_else(|| OPENAI_DYNAMIC_CLIENT.to_string()))
}

async fn start(
    State(app): State<App>,
    axum::extract::Path(provider): axum::extract::Path<String>,
    Query(query): Query<StartQuery>,
    MaybeUser(current): MaybeUser,
) -> ApiResult<Response> {
    let spec = spec(&provider).ok_or_else(|| ApiError::not_found("Sign-in provider"))?;
    let (available, reason) = availability(&app, spec.id);
    if !available {
        return Err(ApiError::bad(reason.unwrap_or("This sign-in provider is not configured.")));
    }
    let purpose = if query.purpose.as_deref() == Some("connect") { "connect" } else { "login" };
    let connect_user = match purpose {
        "connect" => Some(current.ok_or(ApiError::Unauthorized)?.id),
        _ => None,
    };
    let state = random_token();
    let verifier = random_token();
    let nonce = random_token();
    let (client_id, redirect_uri, mut params) = match spec.id {
        "google" => {
            let client = app.config.google.as_ref().expect("checked availability");
            let redirect_uri = app.config.oauth_redirect_uri();
            (client.client_id.clone(), redirect_uri, vec![("scope", "openid email profile".to_string()), ("prompt", "select_account".into())])
        }
        _ => {
            let client_id = openai_client_id(&app).await?;
            let redirect_uri = openai_redirect_uri(&app).expect("checked availability");
            let mut params = vec![
                ("scope", OPENAI_SCOPE.to_string()),
                ("resource", OPENAI_RESOURCE.to_string()),
                ("ext_agent_host_id", openai_host_id(&app).await?),
            ];
            if client_id == OPENAI_DYNAMIC_CLIENT {
                params.push(("agent_name_hint", "Kaizen".into()));
            }
            (client_id, redirect_uri, params)
        }
    };
    params.extend([
        ("response_type", "code".to_string()),
        ("client_id", client_id.clone()),
        ("redirect_uri", redirect_uri.clone()),
        ("state", state.clone()),
        ("nonce", nonce.clone()),
        ("code_challenge", pkce_challenge(&verifier)),
        ("code_challenge_method", "S256".into()),
    ]);
    sqlx::query(
        "INSERT INTO oauth_states (state, provider, purpose, user_id, pkce_verifier, nonce, redirect_uri, return_to, client_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(&state)
    .bind(spec.id)
    .bind(purpose)
    .bind(connect_user)
    .bind(&verifier)
    .bind(&nonce)
    .bind(&redirect_uri)
    .bind(safe_return_to(query.return_to.as_deref()))
    .bind(&client_id)
    .execute(&app.db)
    .await?;
    let mut url = url::Url::parse(spec.authorize_url).expect("valid authorize url");
    url.query_pairs_mut().extend_pairs(params.iter().map(|(k, v)| (*k, v.as_str())));
    Ok(Redirect::to(url.as_str()).into_response())
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    client_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct StateRow {
    provider: String,
    purpose: String,
    user_id: Option<String>,
    pkce_verifier: String,
    nonce: String,
    redirect_uri: String,
    return_to: Option<String>,
    client_id: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
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

fn login_error(message: &str) -> Response {
    let mut url = String::from("/login?error=");
    url.push_str(&url::form_urlencoded::byte_serialize(message.as_bytes()).collect::<String>());
    Redirect::to(&url).into_response()
}

async fn callback(State(app): State<App>, headers: HeaderMap, Query(query): Query<CallbackQuery>) -> Response {
    match finish_callback(&app, &headers, query).await {
        Ok(response) => response,
        Err(ApiError::BadRequest(message)) | Err(ApiError::Forbidden(message)) => login_error(&message),
        Err(other) => {
            tracing::warn!(error = %other, "oauth callback failed");
            login_error("Sign-in failed. Please try again.")
        }
    }
}

async fn finish_callback(app: &App, headers: &HeaderMap, query: CallbackQuery) -> ApiResult<Response> {
    let state_value = query.state.ok_or_else(|| ApiError::bad("The sign-in response is missing its state."))?;
    let row: Option<StateRow> = sqlx::query_as(
        "DELETE FROM oauth_states WHERE state = $1 AND created_at > now() - interval '15 minutes'
         RETURNING provider, purpose, user_id, pkce_verifier, nonce, redirect_uri, return_to, client_id",
    )
    .bind(&state_value)
    .fetch_optional(&app.db)
    .await?;
    let row = row.ok_or_else(|| ApiError::bad("This sign-in link expired. Please start again."))?;
    if let Some(error) = query.error {
        let detail = query.error_description.unwrap_or_default();
        return Err(ApiError::bad(if error == "access_denied" {
            "Sign-in was cancelled.".to_string()
        } else {
            format!("Sign-in failed: {error} {detail}").trim().to_string()
        }));
    }
    let code = query.code.ok_or_else(|| ApiError::bad("The sign-in response is missing its code."))?;
    let spec = spec(&row.provider).ok_or_else(|| ApiError::bad("Unknown sign-in provider."))?;

    // OpenAI issues a client id on first (dynamic) registration.
    let pending_client = row.client_id.clone().unwrap_or_default();
    let client_id = if spec.id == "openai" {
        match (pending_client.as_str(), query.client_id.as_deref()) {
            (OPENAI_DYNAMIC_CLIENT, Some(issued)) if issued != OPENAI_DYNAMIC_CLIENT => {
                kv_set(&app.db, "openai_client_id", issued).await?;
                issued.to_string()
            }
            (OPENAI_DYNAMIC_CLIENT, _) => return Err(ApiError::bad("ChatGPT did not finish registering Kaizen. Please try again.")),
            (pending, Some(returned)) if returned != pending => {
                return Err(ApiError::bad("The sign-in response came from a different app registration."));
            }
            (pending, _) => pending.to_string(),
        }
    } else {
        pending_client
    };

    let mut form: Vec<(&str, String)> = vec![
        ("grant_type", "authorization_code".into()),
        ("code", code),
        ("redirect_uri", row.redirect_uri.clone()),
        ("code_verifier", row.pkce_verifier.clone()),
        ("client_id", client_id.clone()),
    ];
    if spec.id == "google"
        && let Some(secret) = app.config.google.as_ref().and_then(|g| g.client_secret.clone())
    {
        form.push(("client_secret", secret));
    }
    if spec.id == "openai" {
        form.push(("resource", OPENAI_RESOURCE.into()));
    }
    let response = app.http.post(spec.token_url).form(&form).send().await.map_err(anyhow::Error::from)?;
    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        tracing::warn!(provider = spec.id, body = %body.chars().take(500).collect::<String>(), "token exchange failed");
        return Err(ApiError::bad("The sign-in code could not be exchanged. Please try again."));
    }
    let tokens: TokenResponse = response.json().await.map_err(anyhow::Error::from)?;
    let id_token = tokens.id_token.clone().ok_or_else(|| ApiError::bad("The provider did not return an identity token."))?;
    let claims = app.jwks.validate(&id_token, spec.jwks_url, spec.issuers, &client_id, &row.nonce).await?;
    let email = claims.email.clone().map(|e| e.trim().to_lowercase()).filter(|e| e.contains('@'));
    if spec.id == "google" && !claims.email_is_verified() {
        return Err(ApiError::bad("Your Google email address is not verified."));
    }

    let user_id = match (row.purpose.as_str(), row.user_id.clone()) {
        ("connect", Some(user_id)) => {
            link_identity(app, &user_id, spec.id, &claims.sub, email.as_deref()).await?;
            user_id
        }
        _ => {
            let email = email.clone().ok_or_else(|| ApiError::bad("The provider did not share an email address."))?;
            resolve_user(app, spec.id, &claims.sub, &email, claims.name.as_deref(), claims.picture.as_deref()).await?
        }
    };

    if spec.id == "openai" {
        let scopes: Vec<String> = tokens.scope.clone().unwrap_or_default().split_whitespace().map(str::to_string).collect();
        if scopes.iter().any(|s| s == "chatgpt.tokens.use.direct") && tokens.refresh_token.is_some() {
            let stored = ChatGptTokens {
                access_token: tokens.access_token.clone(),
                refresh_token: tokens.refresh_token.clone().unwrap_or_default(),
                id_token: Some(id_token.clone()),
                expires_at: Utc::now() + Duration::seconds(tokens.expires_in.unwrap_or(3600)),
                client_id: client_id.clone(),
                scopes,
            };
            store_tokens(app, &user_id, &stored, email.as_deref()).await?;
            // Someone who hasn't picked an AI yet gets the plan they just signed in with.
            let settings = crate::db::user_settings(&app.db, &user_id).await?;
            if settings.get("ai").is_none() {
                crate::db::set_settings_section(&app.db, &user_id, "ai", &json!({ "provider": "openai", "mode": "subscription", "model": "" })).await?;
            }
        }
    }

    let destination = row.return_to.clone().unwrap_or_else(|| if row.purpose == "connect" { "/settings".into() } else { "/".into() });
    if row.purpose == "connect" {
        return Ok(Redirect::to(&destination).into_response());
    }
    let token = create_session(app, &user_id, headers).await?;
    Ok((set_cookie_headers(app, Some(&token)), Redirect::to(&destination)).into_response())
}

async fn link_identity(app: &App, user_id: &str, provider: &str, subject: &str, email: Option<&str>) -> ApiResult<()> {
    let existing: Option<String> = sqlx::query_scalar("SELECT user_id FROM identities WHERE provider = $1 AND subject = $2")
        .bind(provider)
        .bind(subject)
        .fetch_optional(&app.db)
        .await?;
    match existing {
        Some(owner) if owner != user_id => Err(ApiError::Conflict("That account is already linked to another Kaizen user.".into())),
        Some(_) => {
            sqlx::query("UPDATE identities SET last_login_at = now(), email = COALESCE($3, email) WHERE provider = $1 AND subject = $2")
                .bind(provider)
                .bind(subject)
                .bind(email)
                .execute(&app.db)
                .await?;
            Ok(())
        }
        None => {
            sqlx::query("INSERT INTO identities (id, user_id, provider, subject, email) VALUES ($1, $2, $3, $4, $5)")
                .bind(new_id())
                .bind(user_id)
                .bind(provider)
                .bind(subject)
                .bind(email)
                .execute(&app.db)
                .await?;
            Ok(())
        }
    }
}

/// Identity → user; else link by email; else create (and seed) a new account.
async fn resolve_user(app: &App, provider: &str, subject: &str, email: &str, name: Option<&str>, picture: Option<&str>) -> ApiResult<String> {
    if let Some(user_id) = sqlx::query_scalar::<_, String>("SELECT user_id FROM identities WHERE provider = $1 AND subject = $2")
        .bind(provider)
        .bind(subject)
        .fetch_optional(&app.db)
        .await?
    {
        sqlx::query("UPDATE identities SET last_login_at = now() WHERE provider = $1 AND subject = $2")
            .bind(provider)
            .bind(subject)
            .execute(&app.db)
            .await?;
        return Ok(user_id);
    }
    if !email_allowed(app, email) {
        return Err(ApiError::Forbidden("This Kaizen instance is private. Ask the owner to add your email.".into()));
    }
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM users WHERE lower(email) = $1").bind(email).fetch_optional(&app.db).await?;
    let user_id = match existing {
        Some(id) => id,
        None => crate::workspace::create_user(app, email, name.unwrap_or(email.split('@').next().unwrap_or("Learner")), picture).await?,
    };
    if picture.is_some() {
        sqlx::query("UPDATE users SET avatar_url = COALESCE(avatar_url, $2) WHERE id = $1")
            .bind(&user_id)
            .bind(picture)
            .execute(&app.db)
            .await?;
    }
    link_identity(app, &user_id, provider, subject, Some(email)).await?;
    Ok(user_id)
}

async fn logout(State(app): State<App>, headers: HeaderMap) -> ApiResult<Response> {
    destroy_session(&app, &headers).await?;
    Ok((set_cookie_headers(&app, None), StatusCode::NO_CONTENT).into_response())
}

/// Used by `/api/me` to show which sign-in methods the user has linked.
pub async fn linked_providers(app: &App, user: &User) -> ApiResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT DISTINCT provider FROM identities WHERE user_id = $1")
        .bind(&user.id)
        .fetch_all(&app.db)
        .await?)
}

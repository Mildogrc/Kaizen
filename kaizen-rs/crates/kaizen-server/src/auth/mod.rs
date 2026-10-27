//! Sessions and the signed-in user extractor.
//!
//! Sessions are opaque 256-bit tokens in an `HttpOnly; SameSite=Lax` cookie;
//! only their SHA-256 is stored, so a database leak cannot be replayed.

pub mod oauth;
pub mod oidc;

use axum::extract::FromRequestParts;
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue};
use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;
use serde::Serialize;
use serde_json::Value;

use crate::crypto::{random_token, sha256_hex};
use crate::error::ApiError;
use crate::state::App;

pub const SESSION_COOKIE: &str = "kaizen_session";
const SESSION_DAYS: i64 = 30;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub timezone: String,
    pub is_owner: bool,
    #[serde(skip)]
    pub tz: Tz,
    #[serde(skip)]
    pub settings: Value,
}

#[derive(sqlx::FromRow)]
struct SessionUserRow {
    id: String,
    email: String,
    name: String,
    avatar_url: Option<String>,
    timezone: String,
    settings: Value,
    session_id: String,
    last_seen_at: DateTime<Utc>,
}

pub fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get_all(COOKIE).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';')).find_map(|pair| {
        let (k, v) = pair.trim().split_once('=')?;
        (k == name).then(|| v.to_string())
    })
}

pub fn session_cookie(app: &App, token: &str, max_age_secs: i64) -> HeaderValue {
    let secure = if app.config.secure_cookies { "; Secure" } else { "" };
    HeaderValue::from_str(&format!("{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_secs}{secure}"))
        .expect("cookie header is ASCII")
}

pub async fn load_user(app: &App, headers: &HeaderMap) -> Result<Option<User>, ApiError> {
    let Some(token) = read_cookie(headers, SESSION_COOKIE) else { return Ok(None) };
    let row: Option<SessionUserRow> = sqlx::query_as(
        "SELECT u.id, u.email, u.name, u.avatar_url, u.timezone, u.settings, s.id AS session_id, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.expires_at > now()",
    )
    .bind(sha256_hex(&token))
    .fetch_optional(&app.db)
    .await?;
    let Some(row) = row else { return Ok(None) };
    if Utc::now() - row.last_seen_at > Duration::minutes(10) {
        // Sliding expiry without a write on every request.
        let db = app.db.clone();
        let id = row.session_id.clone();
        tokio::spawn(async move {
            let _ = sqlx::query("UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1")
                .bind(id)
                .bind(SESSION_DAYS as i32)
                .execute(&db)
                .await;
        });
    }
    Ok(Some(User {
        is_owner: app.config.is_owner(&row.email),
        tz: kaizen_core::time::parse_tz(&row.timezone),
        id: row.id,
        email: row.email,
        name: row.name,
        avatar_url: row.avatar_url,
        timezone: row.timezone,
        settings: row.settings,
    }))
}

impl FromRequestParts<App> for User {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, app: &App) -> Result<Self, Self::Rejection> {
        load_user(app, &parts.headers).await?.ok_or(ApiError::Unauthorized)
    }
}

/// Optional user (for endpoints that work signed-out, like `/api/me`).
pub struct MaybeUser(pub Option<User>);

impl FromRequestParts<App> for MaybeUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, app: &App) -> Result<Self, Self::Rejection> {
        Ok(MaybeUser(load_user(app, &parts.headers).await?))
    }
}

/// Create a session row and return the raw cookie token.
pub async fn create_session(app: &App, user_id: &str, headers: &HeaderMap) -> Result<String, ApiError> {
    let token = random_token();
    let user_agent = headers.get("user-agent").and_then(|v| v.to_str().ok()).map(|s| s.chars().take(300).collect::<String>());
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string());
    sqlx::query(
        "INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)",
    )
    .bind(sha256_hex(&token))
    .bind(user_id)
    .bind(SESSION_DAYS as i32)
    .bind(user_agent)
    .bind(ip)
    .execute(&app.db)
    .await?;
    // Opportunistic cleanup of expired sessions and stale OAuth attempts.
    let db = app.db.clone();
    tokio::spawn(async move {
        let _ = sqlx::query("DELETE FROM sessions WHERE expires_at < now()").execute(&db).await;
        let _ = sqlx::query("DELETE FROM oauth_states WHERE created_at < now() - interval '1 hour'").execute(&db).await;
    });
    Ok(token)
}

pub async fn destroy_session(app: &App, headers: &HeaderMap) -> Result<(), ApiError> {
    if let Some(token) = read_cookie(headers, SESSION_COOKIE) {
        sqlx::query("DELETE FROM sessions WHERE id = $1").bind(sha256_hex(&token)).execute(&app.db).await?;
    }
    Ok(())
}

pub fn set_cookie_headers(app: &App, token: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let value = match token {
        Some(t) => session_cookie(app, t, SESSION_DAYS * 86_400),
        None => session_cookie(app, "", 0),
    };
    headers.insert(SET_COOKIE, value);
    headers
}

/// Sign-in policy: loopback installs are personal; hosted ones need the owner
/// or an allow-listed email unless `KAIZEN_OPEN_SIGNUP=1`.
pub fn email_allowed(app: &App, email: &str) -> bool {
    let email = email.to_lowercase();
    let allow: Vec<String> = std::env::var("KAIZEN_ALLOWED_EMAILS")
        .unwrap_or_default()
        .split(',')
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty())
        .collect();
    let open = std::env::var("KAIZEN_OPEN_SIGNUP").is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
    if allow.contains(&email) || app.config.owner_email.as_deref() == Some(email.as_str()) {
        return true;
    }
    allow.is_empty() && (open || app.config.is_loopback())
}

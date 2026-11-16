//! Free AI for verified Augusta University (Medical College of Georgia)
//! students.
//!
//! A student proves they own an `@augusta.edu` address with a six-digit code
//! sent by email. Verified students whose own AI isn't connected get
//! `Route::StudentFree`: the instance's Anthropic key with a small model, a
//! per-reply token ceiling, a short-window rate limit, and a monthly spending
//! cap. Every request is metered in `student_ai_usage` (millionths of a
//! dollar); the row is written before the request starts so parallel requests
//! count toward the limits.

use axum::Json;
use axum::extract::State;
use chrono::{Datelike, Duration, NaiveDate, TimeZone, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::ai::{AiError, AiEvent, ChatMessage, apis};
use crate::auth::User;
use crate::crypto::{new_id, random_bytes, sha256_hex};
use crate::error::{ApiError, ApiResult};
use crate::state::App;

/// Only addresses at exactly this domain qualify.
pub const SCHOOL_DOMAIN: &str = "augusta.edu";
pub const SCHOOL_NAME: &str = "Augusta University (Medical College of Georgia)";

const CODE_MINUTES: i64 = 15;
const MAX_ATTEMPTS: i32 = 5;
const RESEND_SECONDS: i64 = 60;
const SENDS_PER_DAY: i32 = 5;

/// Free replies are capped per reply and per window, on top of the monthly cap.
const MAX_OUTPUT_TOKENS: u32 = 8_000;
const MAX_TRANSCRIPT_CHARS: usize = 250_000;
const WINDOW_MINUTES: i64 = 10;
const REQUESTS_PER_WINDOW: i64 = 40;

// ------------------------------------------------------------ eligibility

/// Free AI needs the instance Anthropic key (the owner pays for it).
pub fn available(app: &App) -> bool {
    app.config.anthropic_api_key.is_some()
}

/// Lowercased address if it is a plain `local@augusta.edu` mailbox.
pub fn school_email(input: &str) -> Option<String> {
    let email = input.trim().to_lowercase();
    let (local, domain) = email.split_once('@')?;
    let local_ok = !local.is_empty()
        && local.len() <= 64
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && local.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'));
    (local_ok && domain == SCHOOL_DOMAIN).then_some(email)
}

fn code_hash(app: &App, user_id: &str, code: &str) -> String {
    // Keyed with the instance secret so a database copy alone can't be
    // brute-forced back to live codes.
    sha256_hex(&format!("{}:{user_id}:{code}", hex::encode(app.config.secret_key)))
}

fn new_code() -> String {
    format!("{:06}", u32::from_le_bytes(random_bytes::<4>()) % 1_000_000)
}

fn month_start() -> chrono::DateTime<Utc> {
    let now = Utc::now();
    Utc.with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0).single().expect("first of month exists")
}

fn next_month_start() -> NaiveDate {
    let now = Utc::now();
    let (y, m) = if now.month() == 12 { (now.year() + 1, 1) } else { (now.year(), now.month() + 1) };
    NaiveDate::from_ymd_opt(y, m, 1).expect("first of month exists")
}

/// Millionths of a dollar for one request, at the model's list price.
/// Unknown models are charged at Sonnet rates so the cap stays conservative.
pub fn cost_micros(model: &str, input_tokens: u64, output_tokens: u64) -> i64 {
    // (input, output) in micro-dollars per token = dollars per million tokens.
    let (input, output) = match model {
        m if m.starts_with("claude-haiku-5") => (0.10, 0.50),
        m if m.starts_with("claude-sonnet-5") => (2.0, 10.0),
        _ => (4.0, 20.0),
    };
    (input_tokens as f64 * input + output_tokens as f64 * output).ceil() as i64
}

pub async fn month_spend(app: &App, user_id: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(SUM(cost_micros), 0)::BIGINT FROM student_ai_usage WHERE user_id = $1 AND created_at >= $2")
        .bind(user_id)
        .bind(month_start())
        .fetch_one(&app.db)
        .await
}

fn cap_message(app: &App) -> String {
    format!(
        "You've used this month's free AI (${:.2}). It resets on {}. You can keep going by adding your own API key under Settings → AI.",
        app.config.student_ai_monthly_micros as f64 / 1_000_000.0,
        next_month_start().format("%B %-d"),
    )
}

/// Refuse when the monthly cap is used up (called while resolving the route,
/// so nothing is stored for a request that can't run).
pub async fn check_cap(app: &App, user_id: &str) -> Result<(), AiError> {
    let spent = month_spend(app, user_id).await.map_err(AiError::internal)?;
    if spent >= app.config.student_ai_monthly_micros {
        return Err(AiError::UsageLimit(cap_message(app)));
    }
    Ok(())
}

// ---------------------------------------------------------------- metering

/// Run one free completion on the instance key, metering its cost.
pub async fn complete(app: &App, user: &User, system: &str, messages: &[ChatMessage], tx: &mpsc::Sender<AiEvent>) -> Result<String, AiError> {
    let key = app
        .config
        .anthropic_api_key
        .clone()
        .ok_or_else(|| AiError::NotConnected("Free AI isn't available right now. Add your own API key under Settings → AI.".into()))?;
    let chars: usize = system.len() + messages.iter().map(|m| m.content.len()).sum::<usize>();
    if chars > MAX_TRANSCRIPT_CHARS {
        return Err(AiError::UsageLimit("This conversation is too long for free AI. Start a new conversation to keep going.".into()));
    }
    check_cap(app, &user.id).await?;
    let recent: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM student_ai_usage WHERE user_id = $1 AND created_at > now() - make_interval(mins => $2)")
        .bind(&user.id)
        .bind(WINDOW_MINUTES as i32)
        .fetch_one(&app.db)
        .await
        .map_err(AiError::internal)?;
    if recent >= REQUESTS_PER_WINDOW {
        return Err(AiError::UsageLimit("You're sending free AI requests very quickly. Wait a few minutes and try again.".into()));
    }

    let model = app.config.student_ai_model.clone();
    let id = new_id();
    // Charge the input up front (≈4 chars per token); the real figure replaces it.
    let estimate = cost_micros(&model, (chars / 3) as u64, 0);
    sqlx::query("INSERT INTO student_ai_usage (id, user_id, model, cost_micros) VALUES ($1, $2, $3, $4)")
        .bind(&id)
        .bind(&user.id)
        .bind(&model)
        .bind(estimate)
        .execute(&app.db)
        .await
        .map_err(AiError::internal)?;

    // Forward provider events and record usage on a separate task, so a
    // reply that is stopped (and its future aborted) is still metered.
    let (inner_tx, mut inner_rx) = mpsc::channel::<AiEvent>(256);
    let outer = tx.clone();
    let meter_app = app.clone();
    let meter_model = model.clone();
    let meter = tokio::spawn(async move {
        let (mut input, mut output, mut text_chars) = (0u64, 0u64, 0usize);
        while let Some(event) = inner_rx.recv().await {
            match event {
                AiEvent::Usage { input_tokens, output_tokens } => {
                    input = input.max(input_tokens);
                    output = output.max(output_tokens);
                }
                AiEvent::Delta(text) => {
                    text_chars += text.len();
                    let _ = outer.send(AiEvent::Delta(text)).await;
                }
                other => {
                    let _ = outer.send(other).await;
                }
            }
        }
        // A stopped reply never reports its output tokens: estimate them.
        let output = output.max((text_chars / 3) as u64);
        let input = if input == 0 { (chars / 3) as u64 } else { input };
        let cost = cost_micros(&meter_model, input, output);
        let _ = sqlx::query("UPDATE student_ai_usage SET input_tokens = $2, output_tokens = $3, cost_micros = $4 WHERE id = $1")
            .bind(&id)
            .bind(input as i64)
            .bind(output as i64)
            .bind(cost)
            .execute(&meter_app.db)
            .await;
    });
    let options = apis::AnthropicOptions { max_tokens: MAX_OUTPUT_TOKENS, effort: "low", fallback: false };
    let result = apis::stream_anthropic(app, &key, &model, system, messages, options, &inner_tx).await;
    drop(inner_tx);
    let _ = meter.await;
    result.map_err(|error| match error {
        // The instance key is the owner's problem, not the student's.
        AiError::NotConnected(_) => AiError::Provider("Free AI is temporarily unavailable. Try again later.".into()),
        other => other,
    })
}

// ------------------------------------------------------------------- email

/// Send a plain transactional email through Cloudflare Email Service.
async fn send_email(app: &App, to: &str, subject: &str, text: &str) -> Result<(), ApiError> {
    if let Some(gateway) = &app.config.email_gateway {
        let response = app
            .http
            .post(gateway)
            .json(&json!({ "to": to, "subject": subject, "text": text }))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("email gateway request failed: {e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::error!(%status, body = %body.chars().take(300).collect::<String>(), "email gateway send failed");
            return Err(ApiError::Unavailable("We couldn't send the email. Try again in a few minutes.".into()));
        }
        return Ok(());
    }
    let Some(email) = &app.config.email else {
        if app.config.is_loopback() {
            // Local development without email: show the message in the log.
            tracing::info!(to, subject, body = text, "email (not sent: Cloudflare email is not configured)");
            return Ok(());
        }
        return Err(ApiError::Unavailable("Email isn't set up on this server yet.".into()));
    };
    let url = format!("https://api.cloudflare.com/client/v4/accounts/{}/email/sending/send", email.account_id);
    let response = app
        .http
        .post(url)
        .bearer_auth(&email.api_token)
        .json(&json!({ "to": to, "from": email.from, "subject": subject, "text": text }))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("email request failed: {e}"))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() || body.get("success").and_then(Value::as_bool) != Some(true) {
        let errors = body.get("errors").cloned().unwrap_or(Value::Null).to_string();
        tracing::error!(%status, errors, "email send failed");
        return Err(ApiError::Unavailable("We couldn't send the email. Try again in a few minutes.".into()));
    }
    let bounced = body.pointer("/result/permanent_bounces").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
    if bounced {
        return Err(ApiError::bad("That address bounced. Check it and try again."));
    }
    Ok(())
}

// --------------------------------------------------------------- endpoints

#[derive(sqlx::FromRow)]
struct VerificationRow {
    email: String,
    code_hash: Option<String>,
    code_expires: Option<chrono::DateTime<Utc>>,
    attempts: i32,
    sends_today: i32,
    sends_day: Option<NaiveDate>,
    last_sent_at: Option<chrono::DateTime<Utc>>,
    verified_at: Option<chrono::DateTime<Utc>>,
}

async fn load(app: &App, user_id: &str) -> Result<Option<VerificationRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT email, code_hash, code_expires, attempts, sends_today, sends_day, last_sent_at, verified_at
         FROM student_verifications WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&app.db)
    .await
}

pub async fn status_json(app: &App, user_id: &str) -> ApiResult<Value> {
    let row = load(app, user_id).await?;
    let verified = row.as_ref().is_some_and(|r| r.verified_at.is_some());
    let pending = row.as_ref().filter(|r| r.verified_at.is_none() && r.code_expires.is_some_and(|t| t > Utc::now()));
    let spent = if verified { month_spend(app, user_id).await? } else { 0 };
    Ok(json!({
        "available": available(app),
        "school": SCHOOL_NAME,
        "domain": SCHOOL_DOMAIN,
        "verified": verified,
        "email": row.as_ref().filter(|r| r.verified_at.is_some()).map(|r| r.email.clone()),
        "pendingEmail": pending.map(|r| r.email.clone()),
        "spentMicros": spent,
        "capMicros": app.config.student_ai_monthly_micros,
        "resetsOn": next_month_start(),
    }))
}

pub async fn status(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    Ok(Json(status_json(&app, &user.id).await?))
}

#[derive(Deserialize)]
pub struct StartBody {
    email: String,
}

pub async fn start(State(app): State<App>, user: User, Json(body): Json<StartBody>) -> ApiResult<Json<Value>> {
    if !available(&app) {
        return Err(ApiError::Unavailable("Free AI for students isn't available right now.".into()));
    }
    let email = school_email(&body.email).ok_or_else(|| ApiError::bad(format!("Use your @{SCHOOL_DOMAIN} school email address.")))?;
    let existing = load(&app, &user.id).await?;
    if existing.as_ref().is_some_and(|r| r.verified_at.is_some()) {
        return Err(ApiError::Conflict("Your school email is already verified.".into()));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM student_verifications WHERE lower(email) = $1 AND verified_at IS NOT NULL AND user_id <> $2)",
    )
    .bind(&email)
    .bind(&user.id)
    .fetch_one(&app.db)
    .await?;
    if taken {
        return Err(ApiError::Conflict("That school email is already linked to another Kaizen account.".into()));
    }
    let now = Utc::now();
    let today = now.date_naive();
    let sends_today = match &existing {
        Some(r) if r.sends_day == Some(today) => r.sends_today,
        _ => 0,
    };
    if let Some(last) = existing.as_ref().and_then(|r| r.last_sent_at)
        && now - last < Duration::seconds(RESEND_SECONDS)
    {
        return Err(ApiError::TooManyRequests("Wait a minute before asking for another code.".into()));
    }
    if sends_today >= SENDS_PER_DAY {
        return Err(ApiError::TooManyRequests("Too many codes today. Try again tomorrow.".into()));
    }

    let code = new_code();
    sqlx::query(
        "INSERT INTO student_verifications (user_id, email, code_hash, code_expires, attempts, sends_today, sends_day, last_sent_at)
         VALUES ($1, $2, $3, $4, 0, $5, $6, now())
         ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, code_hash = EXCLUDED.code_hash,
             code_expires = EXCLUDED.code_expires, attempts = 0, sends_today = EXCLUDED.sends_today,
             sends_day = EXCLUDED.sends_day, last_sent_at = now(), updated_at = now()",
    )
    .bind(&user.id)
    .bind(&email)
    .bind(code_hash(&app, &user.id, &code))
    .bind(now + Duration::minutes(CODE_MINUTES))
    .bind(sends_today + 1)
    .bind(today)
    .execute(&app.db)
    .await?;

    let text = format!(
        "Your Kaizen verification code is {code}\n\n\
         Enter it in Kaizen under Settings → AI to turn on free AI for {SCHOOL_NAME} students. \
         It expires in {CODE_MINUTES} minutes.\n\n\
         If you didn't ask for this, you can ignore this email.\n"
    );
    send_email(&app, &email, &format!("Your Kaizen code: {code}"), &text).await?;
    Ok(Json(status_json(&app, &user.id).await?))
}

#[derive(Deserialize)]
pub struct ConfirmBody {
    code: String,
}

pub async fn confirm(State(app): State<App>, user: User, Json(body): Json<ConfirmBody>) -> ApiResult<Json<Value>> {
    let row = load(&app, &user.id).await?.ok_or_else(|| ApiError::bad("Ask for a code first."))?;
    if row.verified_at.is_some() {
        return Ok(Json(status_json(&app, &user.id).await?));
    }
    let (Some(hash), Some(expires)) = (row.code_hash.as_deref(), row.code_expires) else {
        return Err(ApiError::bad("Ask for a code first."));
    };
    if expires <= Utc::now() {
        return Err(ApiError::bad("That code expired. Ask for a new one."));
    }
    if row.attempts >= MAX_ATTEMPTS {
        return Err(ApiError::TooManyRequests("Too many wrong codes. Ask for a new one.".into()));
    }
    let code: String = body.code.chars().filter(char::is_ascii_digit).collect();
    if code.len() != 6 || code_hash(&app, &user.id, &code) != hash {
        sqlx::query("UPDATE student_verifications SET attempts = attempts + 1, updated_at = now() WHERE user_id = $1")
            .bind(&user.id)
            .execute(&app.db)
            .await?;
        let left = MAX_ATTEMPTS - row.attempts - 1;
        return Err(ApiError::bad(if left > 0 {
            format!("That code isn't right. {left} tries left.")
        } else {
            "That code isn't right. Ask for a new one.".to_string()
        }));
    }
    let verified = sqlx::query(
        "UPDATE student_verifications SET verified_at = now(), code_hash = NULL, code_expires = NULL, attempts = 0, updated_at = now()
         WHERE user_id = $1",
    )
    .bind(&user.id)
    .execute(&app.db)
    .await;
    match verified {
        Ok(_) => {}
        // The unique index: someone verified this address on another account meanwhile.
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(ApiError::Conflict("That school email is already linked to another Kaizen account.".into()));
        }
        Err(e) => return Err(e.into()),
    }
    tracing::info!(user_id = %user.id, "student email verified");
    Ok(Json(status_json(&app, &user.id).await?))
}

pub async fn remove(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM student_verifications WHERE user_id = $1").bind(&user.id).execute(&app.db).await?;
    Ok(Json(status_json(&app, &user.id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_plain_augusta_addresses() {
        assert_eq!(school_email(" Jane.Doe@Augusta.edu "), Some("jane.doe@augusta.edu".into()));
        assert_eq!(school_email("jdoe+kaizen@augusta.edu"), Some("jdoe+kaizen@augusta.edu".into()));
        assert_eq!(school_email("jdoe@gmail.com"), None);
        assert_eq!(school_email("jdoe@mail.augusta.edu"), None);
        assert_eq!(school_email("jdoe@augusta.edu.evil.com"), None);
        assert_eq!(school_email("a@b@augusta.edu"), None);
        assert_eq!(school_email("@augusta.edu"), None);
        assert_eq!(school_email(".x@augusta.edu"), None);
        assert_eq!(school_email("x y@augusta.edu"), None);
        assert_eq!(school_email("x\r\nBcc: a@b.c@augusta.edu"), None);
    }

    #[test]
    fn haiku_costs_match_list_price() {
        // $0.10 / $0.50 per million tokens.
        assert_eq!(cost_micros("claude-haiku-5-5", 1_000_000, 0), 100_000);
        assert_eq!(cost_micros("claude-haiku-5-5", 0, 1_000_000), 500_000);
        assert_eq!(cost_micros("claude-haiku-5-5", 3_000, 800), 700);
        // Unknown models fall back to the most expensive rate.
        assert_eq!(cost_micros("something-else", 1_000_000, 0), 4_000_000);
    }

    #[test]
    fn codes_are_six_digits() {
        for _ in 0..200 {
            let code = new_code();
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()));
        }
    }
}

//! Account, profile, and AI settings.

use axum::Json;
use axum::extract::{Path, State};
use kaizen_core::settings::{self as core_settings, AI_PROVIDERS};
use serde::Deserialize;
use serde_json::{Value, json};

use super::shared::ok;
use crate::anki::Anki;
use crate::auth::{MaybeUser, User, oauth};
use crate::error::{ApiError, ApiResult};
use crate::secrets;
use crate::state::App;

pub async fn get_me(State(app): State<App>, MaybeUser(user): MaybeUser) -> ApiResult<Json<Value>> {
    let Some(user) = user else { return Ok(Json(json!({ "user": null }))) };
    let linked = oauth::linked_providers(&app, &user).await?;
    let anki = Anki::new(&app, &user.id);
    let direct = anki.transport() == "direct";
    Ok(Json(json!({
        "user": user,
        "linkedProviders": linked,
        "anki": { "mode": if direct { "direct" } else { "relay" }, "connectUrl": "http://127.0.0.1:8765" },
    })))
}

#[derive(Deserialize)]
pub struct UpdateMe {
    timezone: Option<String>,
    name: Option<String>,
}

pub async fn update_me(State(app): State<App>, user: User, Json(body): Json<UpdateMe>) -> ApiResult<Json<Value>> {
    if let Some(tz) = body.timezone.as_deref() {
        if tz.parse::<chrono_tz::Tz>().is_err() {
            return Err(ApiError::bad("Unknown timezone."));
        }
        sqlx::query("UPDATE users SET timezone = $2, updated_at = now() WHERE id = $1").bind(&user.id).bind(tz).execute(&app.db).await?;
    }
    if let Some(name) = body.name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        sqlx::query("UPDATE users SET name = $2, updated_at = now() WHERE id = $1")
            .bind(&user.id)
            .bind(name.chars().take(80).collect::<String>())
            .execute(&app.db)
            .await?;
    }
    Ok(ok())
}

pub async fn ai_settings(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    Ok(Json(crate::ai::status(&app, &user).await?))
}

pub async fn update_ai(State(app): State<App>, user: User, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let config = core_settings::ai(&json!({ "ai": body }));
    crate::db::set_settings_section(&app.db, &user.id, "ai", &serde_json::to_value(&config).map_err(anyhow::Error::from)?).await?;
    Ok(Json(json!({ "config": config })))
}

#[derive(Deserialize)]
pub struct SaveKey {
    provider: String,
    key: String,
}

pub async fn save_key(State(app): State<App>, user: User, Json(body): Json<SaveKey>) -> ApiResult<Json<Value>> {
    if !AI_PROVIDERS.contains(&body.provider.as_str()) {
        return Err(ApiError::bad("Unknown AI provider."));
    }
    let key = body.key.trim();
    if key.len() < 16 || key.len() > 400 || key.chars().any(char::is_whitespace) {
        return Err(ApiError::bad("That doesn't look like an API key."));
    }
    let last4: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    secrets::put(
        &app,
        &user.id,
        &secrets::api_key_kind(&body.provider),
        &key.to_string(),
        json!({ "last4": last4, "savedAt": chrono::Utc::now() }),
    )
    .await?;
    Ok(ok())
}

pub async fn delete_key(State(app): State<App>, user: User, Path(provider): Path<String>) -> ApiResult<Json<Value>> {
    secrets::delete(&app, &user.id, &secrets::api_key_kind(&provider)).await?;
    Ok(ok())
}

pub async fn disconnect_chatgpt(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    secrets::delete(&app, &user.id, secrets::OPENAI_CHATGPT).await?;
    Ok(ok())
}

pub async fn chatgpt_models(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    match crate::ai::chatgpt::list_models(&app, &user.id).await {
        Ok(models) => Ok(Json(json!({ "models": models }))),
        Err(e) => Ok(Json(json!({ "models": [], "error": e.to_string() }))),
    }
}

//! Encrypted per-user secrets (`user_secrets`). The user id is bound in as
//! associated data so a ciphertext cannot be moved to another account.

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::error::ApiResult;
use crate::state::App;

pub const OPENAI_CHATGPT: &str = "openai_chatgpt";

pub fn api_key_kind(provider: &str) -> String {
    format!("{provider}_api_key")
}

pub async fn put<T: Serialize>(app: &App, user_id: &str, kind: &str, value: &T, metadata: Value) -> ApiResult<()> {
    let plaintext = serde_json::to_vec(value).map_err(anyhow::Error::from)?;
    let (nonce, ciphertext) = app.cipher.seal(&plaintext, user_id.as_bytes())?;
    sqlx::query(
        "INSERT INTO user_secrets (user_id, kind, nonce, ciphertext, metadata, updated_at) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (user_id, kind) DO UPDATE SET nonce = EXCLUDED.nonce, ciphertext = EXCLUDED.ciphertext,
           metadata = EXCLUDED.metadata, updated_at = now()",
    )
    .bind(user_id)
    .bind(kind)
    .bind(nonce)
    .bind(ciphertext)
    .bind(metadata)
    .execute(&app.db)
    .await?;
    Ok(())
}

pub async fn get<T: DeserializeOwned>(app: &App, user_id: &str, kind: &str) -> ApiResult<Option<(T, Value)>> {
    let row: Option<(Vec<u8>, Vec<u8>, Value)> =
        sqlx::query_as("SELECT nonce, ciphertext, metadata FROM user_secrets WHERE user_id = $1 AND kind = $2")
            .bind(user_id)
            .bind(kind)
            .fetch_optional(&app.db)
            .await?;
    let Some((nonce, ciphertext, metadata)) = row else { return Ok(None) };
    let plaintext = app.cipher.open(&nonce, &ciphertext, user_id.as_bytes())?;
    let value = serde_json::from_slice(&plaintext).map_err(anyhow::Error::from)?;
    Ok(Some((value, metadata)))
}

pub async fn metadata(app: &App, user_id: &str, kind: &str) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar("SELECT metadata FROM user_secrets WHERE user_id = $1 AND kind = $2")
        .bind(user_id)
        .bind(kind)
        .fetch_optional(&app.db)
        .await?)
}

pub async fn delete(app: &App, user_id: &str, kind: &str) -> ApiResult<()> {
    sqlx::query("DELETE FROM user_secrets WHERE user_id = $1 AND kind = $2").bind(user_id).bind(kind).execute(&app.db).await?;
    Ok(())
}

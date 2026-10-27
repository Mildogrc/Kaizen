//! Database pool, migrations, and small shared query helpers.

use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::Value;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

pub async fn connect(database_url: &str) -> Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(16)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(300))
        .connect(database_url)
        .await
        .context("connecting to PostgreSQL (check DATABASE_URL)")
}

pub async fn migrate(pool: &PgPool) -> Result<()> {
    // Never touch the original app's database (it lives next door and its
    // `.env` is one directory up); import from it with `import-legacy`.
    let prisma: Option<String> = sqlx::query_scalar("SELECT to_regclass('_prisma_migrations')::text").fetch_one(pool).await?;
    if prisma.is_some() {
        anyhow::bail!(
            "DATABASE_URL points at the original Prisma database. Create a new database for Kaizen and copy the old data with `kaizen import-legacy --from <old url>`."
        );
    }
    sqlx::migrate!("./migrations").run(pool).await.context("applying database migrations")
}

/// Instance-wide key/value (e.g. the OAuth host id).
pub async fn kv_get(pool: &PgPool, key: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT value FROM app_kv WHERE key = $1").bind(key).fetch_optional(pool).await
}

pub async fn kv_set(pool: &PgPool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn user_settings(pool: &PgPool, user_id: &str) -> Result<Value, sqlx::Error> {
    let settings: Option<Value> =
        sqlx::query_scalar("SELECT settings FROM users WHERE id = $1").bind(user_id).fetch_optional(pool).await?;
    Ok(settings.unwrap_or_else(|| Value::Object(Default::default())))
}

/// Replace one section of `users.settings` atomically.
pub async fn set_settings_section(pool: &PgPool, user_id: &str, section: &str, value: &Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE users SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ARRAY[$2::text], $3::jsonb, true), updated_at = now()
         WHERE id = $1",
    )
    .bind(user_id)
    .bind(section)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn course_id(pool: &PgPool, user_id: &str, slug: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM courses WHERE user_id = $1 AND slug = $2")
        .bind(user_id)
        .bind(slug)
        .fetch_optional(pool)
        .await
}

/// Latest known-word stat (lower, upper, migaku, anki, manual) for a language.
#[derive(Clone, Debug, Default, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordStat {
    pub lower_bound: i32,
    pub upper_bound: i32,
    pub migaku_count: i32,
    pub anki_count: i32,
    pub manual_count: i32,
}

pub async fn latest_word_stat(pool: &PgPool, user_id: &str, language: &str) -> Result<Option<WordStat>, sqlx::Error> {
    sqlx::query_as(
        "SELECT lower_bound, upper_bound, migaku_count, anki_count, manual_count FROM known_word_stats
         WHERE user_id = $1 AND language = $2 ORDER BY date DESC LIMIT 1",
    )
    .bind(user_id)
    .bind(language)
    .fetch_optional(pool)
    .await
}

pub fn json_strings(value: &Value) -> Vec<String> {
    value.as_array().map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
}

/// Relative in-app path safe to redirect to (no scheme, no `//`).
pub fn safe_return_to(value: Option<&str>) -> Option<String> {
    let v = value?.trim();
    (v.starts_with('/') && !v.starts_with("//") && !v.contains('\\')).then(|| v.to_string())
}

#[cfg(test)]
mod tests {
    use super::safe_return_to;

    #[test]
    fn return_to_is_relative_only() {
        assert_eq!(safe_return_to(Some("/settings?x=1")), Some("/settings?x=1".into()));
        assert_eq!(safe_return_to(Some("//evil.example")), None);
        assert_eq!(safe_return_to(Some("https://evil.example")), None);
        assert_eq!(safe_return_to(Some("/\\evil")), None);
        assert_eq!(safe_return_to(None), None);
    }
}

//! Shared application state handed to every request.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;
use tokio::sync::Mutex;

use crate::ai::turns::TurnRegistry;
use crate::anki::relay::RelayHub;
use crate::auth::oidc::JwksCache;
use crate::config::Config;
use crate::crypto::Cipher;

pub struct AppState {
    pub db: PgPool,
    pub config: Config,
    pub http: reqwest::Client,
    pub cipher: Cipher,
    pub relay: RelayHub,
    /// AI replies currently being generated.
    pub turns: TurnRegistry,
    pub jwks: JwksCache,
    /// Serializes OAuth refreshes per user (refresh tokens rotate).
    refresh_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

pub type App = Arc<AppState>;

impl AppState {
    pub fn new(db: PgPool, config: Config) -> anyhow::Result<App> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("Kaizen/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .pool_idle_timeout(Duration::from_secs(90))
            .build()?;
        let cipher = Cipher::new(&config.secret_key);
        Ok(Arc::new(AppState {
            db,
            http: http.clone(),
            cipher,
            relay: RelayHub::default(),
            turns: TurnRegistry::default(),
            jwks: JwksCache::new(http),
            refresh_locks: Mutex::new(HashMap::new()),
            config,
        }))
    }

    pub async fn refresh_lock(&self, user_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.refresh_locks.lock().await;
        locks.entry(user_id.to_string()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
    }
}

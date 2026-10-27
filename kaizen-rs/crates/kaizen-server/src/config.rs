//! Configuration from the environment (12-factor). A `.env` file is loaded in
//! development; in the cloud every value comes from the platform's secrets.

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};
use base64::Engine;

#[derive(Clone, Debug)]
pub struct OAuthClient {
    pub client_id: String,
    pub client_secret: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub bind: SocketAddr,
    /// Externally visible origin, e.g. `https://kaizen.example.com`.
    pub public_url: url::Url,
    pub web_dir: PathBuf,
    pub data_dir: PathBuf,
    pub secret_key: [u8; 32],
    pub secure_cookies: bool,
    /// The instance owner may use machine-level AI CLI logins and server API keys.
    pub owner_email: Option<String>,
    pub google: Option<OAuthClient>,
    /// Registered "Sign in with ChatGPT" client for hosted deployments.
    pub openai_client_id: Option<String>,
    pub anki_connect_url: String,
    /// auto | direct | relay
    pub anki_transport: String,
    pub youtube_api_key: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub openai_api_key: Option<String>,
    pub gemini_api_key: Option<String>,
    pub claude_bin: Option<PathBuf>,
    pub codex_bin: Option<PathBuf>,
    pub agy_bin: Option<PathBuf>,
    pub log_json: bool,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> Result<Config> {
        let database_url = var("DATABASE_URL").context("DATABASE_URL is required")?;
        // Cloud platforms inject PORT; bind every interface there.
        let bind: SocketAddr = match (var("KAIZEN_BIND"), var("PORT")) {
            (Some(bind), _) => bind.parse().context("KAIZEN_BIND must look like 127.0.0.1:8787")?,
            (None, Some(port)) => format!("0.0.0.0:{port}").parse().context("PORT must be a number")?,
            (None, None) => "127.0.0.1:8787".parse().expect("valid default"),
        };
        let public_url = var("KAIZEN_PUBLIC_URL")
            .unwrap_or_else(|| format!("http://127.0.0.1:{}", bind.port()))
            .parse::<url::Url>()
            .context("KAIZEN_PUBLIC_URL must be an absolute URL")?;
        let data_dir = var("KAIZEN_DATA_DIR").map(PathBuf::from).unwrap_or_else(default_data_dir);
        let loopback = matches!(public_url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("[::1]"));
        let secret_key = match var("KAIZEN_SECRET_KEY") {
            Some(encoded) => decode_key(&encoded)?,
            // Hosted containers have throwaway disks: a generated key would be
            // lost on redeploy, making every stored API key unreadable.
            None if !loopback => anyhow::bail!(
                "KAIZEN_SECRET_KEY is required when KAIZEN_PUBLIC_URL is not localhost (generate one with `openssl rand -base64 32`)"
            ),
            None => load_or_create_key(&data_dir)?,
        };
        let secure_cookies = var("KAIZEN_SECURE_COOKIES")
            .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(public_url.scheme() == "https");
        let google = var("AUTH_GOOGLE_CLIENT_ID")
            .map(|client_id| OAuthClient { client_id, client_secret: var("AUTH_GOOGLE_CLIENT_SECRET") });
        Ok(Config {
            database_url,
            bind,
            web_dir: var("KAIZEN_WEB_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("web/dist")),
            data_dir,
            secret_key,
            secure_cookies,
            owner_email: var("KAIZEN_OWNER_EMAIL").map(|e| e.to_lowercase()),
            google,
            openai_client_id: var("AUTH_OPENAI_CLIENT_ID"),
            anki_connect_url: var("ANKI_CONNECT_URL").unwrap_or_else(|| "http://127.0.0.1:8765".into()),
            anki_transport: var("ANKI_TRANSPORT").unwrap_or_else(|| "auto".into()),
            youtube_api_key: var("YOUTUBE_API_KEY"),
            anthropic_api_key: var("ANTHROPIC_API_KEY"),
            openai_api_key: var("OPENAI_API_KEY"),
            gemini_api_key: var("GEMINI_API_KEY"),
            claude_bin: var("KAIZEN_CLAUDE_BIN").map(PathBuf::from),
            codex_bin: var("KAIZEN_CODEX_BIN").map(PathBuf::from),
            agy_bin: var("KAIZEN_AGY_BIN").map(PathBuf::from),
            log_json: var("KAIZEN_LOG_FORMAT").is_some_and(|f| f == "json"),
            public_url,
        })
    }

    /// True when the app is served from this machine (127.0.0.1 / localhost).
    pub fn is_loopback(&self) -> bool {
        matches!(self.public_url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("[::1]"))
    }

    pub fn public_origin(&self) -> String {
        self.public_url.origin().ascii_serialization()
    }

    /// OAuth redirect URI shared by every provider (the `state` names the provider).
    pub fn oauth_redirect_uri(&self) -> String {
        format!("{}/auth/callback", self.public_origin())
    }

    pub fn is_owner(&self, email: &str) -> bool {
        match &self.owner_email {
            Some(owner) => owner.eq_ignore_ascii_case(email),
            // Without an explicit owner, a loopback install is a personal app.
            None => self.is_loopback(),
        }
    }
}

fn default_data_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(".config").join("kaizen"))
        .unwrap_or_else(|| PathBuf::from(".kaizen"))
}

fn decode_key(encoded: &str) -> Result<[u8; 32]> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .or_else(|_| hex::decode(encoded))
        .context("KAIZEN_SECRET_KEY must be 32 bytes, base64 or hex encoded")?;
    bytes.try_into().map_err(|_| anyhow::anyhow!("KAIZEN_SECRET_KEY must decode to exactly 32 bytes"))
}

/// Local installs keep a generated key in an owner-only file so secrets stay
/// decryptable across restarts without extra setup.
fn load_or_create_key(data_dir: &std::path::Path) -> Result<[u8; 32]> {
    let path = data_dir.join("secret.key");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        return decode_key(existing.trim());
    }
    std::fs::create_dir_all(data_dir).with_context(|| format!("creating {}", data_dir.display()))?;
    let mut key = [0u8; 32];
    getrandom::fill(&mut key).map_err(|e| anyhow::anyhow!("random key: {e}"))?;
    std::fs::write(&path, base64::engine::general_purpose::STANDARD.encode(key))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    tracing::info!(path = %path.display(), "generated a local secret key");
    Ok(key)
}

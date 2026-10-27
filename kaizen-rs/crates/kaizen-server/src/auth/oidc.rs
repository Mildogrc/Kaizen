//! OpenID Connect ID-token validation against the provider's published JWKS.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use tokio::sync::RwLock;

const JWKS_TTL: Duration = Duration::from_secs(3600);

pub struct JwksCache {
    http: reqwest::Client,
    sets: RwLock<HashMap<String, (Instant, JwkSet)>>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct IdClaims {
    pub sub: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub email_verified: Option<serde_json::Value>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub picture: Option<String>,
    #[serde(default)]
    pub nonce: Option<String>,
}

impl IdClaims {
    pub fn email_is_verified(&self) -> bool {
        match &self.email_verified {
            Some(serde_json::Value::Bool(b)) => *b,
            Some(serde_json::Value::String(s)) => s == "true",
            _ => false,
        }
    }
}

impl JwksCache {
    pub fn new(http: reqwest::Client) -> JwksCache {
        JwksCache { http, sets: RwLock::new(HashMap::new()) }
    }

    async fn fetch(&self, url: &str, force: bool) -> Result<JwkSet> {
        if !force && let Some((at, set)) = self.sets.read().await.get(url)
            && at.elapsed() < JWKS_TTL
        {
            return Ok(set.clone());
        }
        let set: JwkSet = self
            .http
            .get(url)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .context("fetching identity provider keys")?
            .error_for_status()?
            .json()
            .await
            .context("parsing identity provider keys")?;
        self.sets.write().await.insert(url.to_string(), (Instant::now(), set.clone()));
        Ok(set)
    }

    /// Verify signature, issuer, audience, expiry, and nonce; return the claims.
    pub async fn validate(&self, token: &str, jwks_url: &str, issuers: &[&str], audience: &str, nonce: &str) -> Result<IdClaims> {
        let header = decode_header(token).context("malformed ID token")?;
        let kid = header.kid.clone().ok_or_else(|| anyhow!("ID token has no key id"))?;
        let mut set = self.fetch(jwks_url, false).await?;
        if set.find(&kid).is_none() {
            // Keys rotate; refetch once before failing.
            set = self.fetch(jwks_url, true).await?;
        }
        let jwk = set.find(&kid).ok_or_else(|| anyhow!("ID token signed with an unknown key"))?;
        let key = DecodingKey::from_jwk(jwk).context("unsupported identity provider key")?;
        let mut validation = Validation::new(header.alg);
        validation.set_audience(&[audience]);
        validation.set_issuer(issuers);
        validation.leeway = 60;
        let data = decode::<IdClaims>(token, &key, &validation).context("ID token failed validation")?;
        if data.claims.nonce.as_deref() != Some(nonce) {
            bail!("ID token nonce mismatch");
        }
        Ok(data.claims)
    }
}

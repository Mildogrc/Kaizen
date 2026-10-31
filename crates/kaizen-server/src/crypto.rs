//! Randomness, hashing, and authenticated encryption for stored secrets.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{Result, anyhow};
use base64::Engine;
use sha2::{Digest, Sha256};

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("operating system randomness is available");
    bytes
}

/// URL-safe random token (256 bits).
pub fn random_token() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}

pub fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// PKCE S256 challenge for a verifier.
pub fn pkce_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[derive(Clone)]
pub struct Cipher {
    inner: Aes256Gcm,
}

impl Cipher {
    pub fn new(key: &[u8; 32]) -> Cipher {
        Cipher { inner: Aes256Gcm::new_from_slice(key).expect("32-byte key") }
    }

    /// Returns (nonce, ciphertext). `aad` binds the ciphertext to its owner.
    pub fn seal(&self, plaintext: &[u8], aad: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
        let nonce_bytes = random_bytes::<12>();
        let nonce: Nonce<_> = nonce_bytes.into();
        let ciphertext = self
            .inner
            .encrypt(&nonce, aes_gcm::aead::Payload { msg: plaintext, aad })
            .map_err(|_| anyhow!("encryption failed"))?;
        Ok((nonce_bytes.to_vec(), ciphertext))
    }

    pub fn open(&self, nonce: &[u8], ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
        let nonce_bytes: [u8; 12] = nonce.try_into().map_err(|_| anyhow!("invalid nonce"))?;
        let nonce: Nonce<_> = nonce_bytes.into();
        self.inner
            .decrypt(&nonce, aes_gcm::aead::Payload { msg: ciphertext, aad })
            .map_err(|_| anyhow!("decryption failed (was KAIZEN_SECRET_KEY changed?)"))
    }
}

/// New row id: UUIDv7 (time-ordered) as 32 hex chars.
pub fn new_id() -> String {
    uuid::Uuid::now_v7().simple().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_and_open_round_trip() {
        let cipher = Cipher::new(&[7u8; 32]);
        let (nonce, sealed) = cipher.seal(b"sk-test", b"user-1").unwrap();
        assert_eq!(cipher.open(&nonce, &sealed, b"user-1").unwrap(), b"sk-test");
        assert!(cipher.open(&nonce, &sealed, b"user-2").is_err());
    }

    #[test]
    fn pkce_matches_rfc7636_example() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}

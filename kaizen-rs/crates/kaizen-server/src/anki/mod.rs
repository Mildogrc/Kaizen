//! AnkiConnect client with a pluggable transport.
//!
//! AnkiConnect listens on the learner's own machine (127.0.0.1:8765). When
//! Kaizen runs on that machine the server calls it directly; when Kaizen runs
//! in the cloud, the open browser tab relays each call over a WebSocket
//! (`relay`), so sync and analytics logic stays server-side either way.

pub mod adaptive;
pub mod relay;
pub mod sync;

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::state::App;

#[derive(Debug, thiserror::Error)]
pub enum AnkiError {
    #[error("{0}")]
    Unavailable(String),
    #[error("AnkiConnect {action}: {message}")]
    Api { action: String, message: String },
}

const OFFLINE: &str = "Anki is not reachable. Start Anki with the AnkiConnect add-on (2055492159) installed.";

pub struct Anki<'a> {
    app: &'a App,
    user_id: String,
}

#[derive(Debug, Deserialize)]
struct Envelope {
    result: Value,
    error: Option<String>,
}

impl<'a> Anki<'a> {
    pub fn new(app: &'a App, user_id: &str) -> Anki<'a> {
        Anki { app, user_id: user_id.to_string() }
    }

    fn direct_allowed(&self) -> bool {
        match self.app.config.anki_transport.as_str() {
            "direct" => true,
            "relay" => false,
            _ => self.app.config.is_loopback(),
        }
    }

    pub fn transport(&self) -> &'static str {
        if self.direct_allowed() {
            "direct"
        } else if self.app.relay.is_connected(&self.user_id) {
            "relay"
        } else {
            "none"
        }
    }

    async fn raw(&self, action: &str, params: Value, timeout: Duration) -> Result<Value, AnkiError> {
        let payload = json!({ "action": action, "version": 6, "params": params });
        let body: Value = if self.direct_allowed() {
            let response = self
                .app
                .http
                .post(&self.app.config.anki_connect_url)
                .json(&payload)
                .timeout(timeout)
                .send()
                .await;
            match response {
                Ok(r) => r.json().await.map_err(|_| AnkiError::Unavailable(OFFLINE.into()))?,
                Err(_) if self.app.relay.is_connected(&self.user_id) => self.relay(payload, timeout).await?,
                Err(_) => return Err(AnkiError::Unavailable(OFFLINE.into())),
            }
        } else {
            self.relay(payload, timeout).await?
        };
        let envelope: Envelope = serde_json::from_value(body).map_err(|e| AnkiError::Api {
            action: action.into(),
            message: format!("unexpected response: {e}"),
        })?;
        match envelope.error {
            Some(message) => Err(AnkiError::Api { action: action.into(), message }),
            None => Ok(envelope.result),
        }
    }

    async fn relay(&self, payload: Value, timeout: Duration) -> Result<Value, AnkiError> {
        self.app.relay.call(&self.user_id, payload, timeout).await.map_err(AnkiError::Unavailable)
    }

    pub async fn invoke<T: DeserializeOwned>(&self, action: &str, params: Value) -> Result<T, AnkiError> {
        let value = self.raw(action, params, Duration::from_secs(30)).await?;
        serde_json::from_value(value).map_err(|e| AnkiError::Api { action: action.into(), message: e.to_string() })
    }

    pub async fn version(&self) -> Option<i64> {
        self.raw("version", json!({}), Duration::from_secs(4)).await.ok().and_then(|v| v.as_i64())
    }

    pub async fn deck_names(&self) -> Result<Vec<String>, AnkiError> {
        self.invoke("deckNames", json!({})).await
    }

    pub async fn find_cards(&self, query: &str) -> Result<Vec<i64>, AnkiError> {
        self.invoke("findCards", json!({ "query": query })).await
    }

    pub async fn cards_info(&self, ids: &[i64]) -> Result<Vec<CardInfo>, AnkiError> {
        let mut out = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(200) {
            let mut part: Vec<CardInfo> = self.invoke("cardsInfo", json!({ "cards": chunk })).await?;
            out.append(&mut part);
        }
        Ok(out)
    }

    pub async fn cards_fields(&self, ids: &[i64]) -> Result<Vec<Value>, AnkiError> {
        let mut out = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(200) {
            let mut part: Vec<Value> = self.invoke("cardsInfo", json!({ "cards": chunk })).await?;
            out.append(&mut part);
        }
        Ok(out)
    }

    /// Note tags by note id (leech detection).
    pub async fn note_tags(&self, note_ids: &[i64]) -> Result<std::collections::HashMap<i64, Vec<String>>, AnkiError> {
        let mut map = std::collections::HashMap::new();
        for chunk in note_ids.chunks(200) {
            let infos: Vec<Value> = self.invoke("notesInfo", json!({ "notes": chunk })).await?;
            for info in infos {
                if let Some(id) = info.get("noteId").and_then(Value::as_i64) {
                    map.insert(id, crate::db::json_strings(info.get("tags").unwrap_or(&Value::Null)));
                }
            }
        }
        Ok(map)
    }

    /// Review tuples since `start_id`: [time, card, usn, button, ivl, lastIvl, factor, duration, type].
    pub async fn card_reviews(&self, deck: &str, start_id: i64) -> Result<Vec<Vec<i64>>, AnkiError> {
        self.invoke("cardReviews", json!({ "deck": deck, "startID": start_id })).await
    }

    pub async fn get_deck_config(&self, deck: &str) -> Result<Option<Value>, AnkiError> {
        let value: Value = self.invoke("getDeckConfig", json!({ "deck": deck })).await?;
        Ok(value.is_object().then_some(value))
    }

    pub async fn save_deck_config(&self, config: &Value) -> Result<bool, AnkiError> {
        self.invoke("saveDeckConfig", json!({ "config": config })).await
    }

    pub async fn clone_deck_config(&self, name: &str, from: i64) -> Result<Option<i64>, AnkiError> {
        let value: Value = self.invoke("cloneDeckConfigId", json!({ "name": name, "cloneFrom": from })).await?;
        Ok(value.as_i64())
    }

    pub async fn set_deck_config(&self, decks: &[String], config_id: i64) -> Result<bool, AnkiError> {
        self.invoke("setDeckConfigId", json!({ "decks": decks, "configId": config_id })).await
    }

    pub async fn new_card_count(&self, deck: &str) -> Result<usize, AnkiError> {
        Ok(self.find_cards(&format!("deck:\"{}\" is:new", escape(deck))).await?.len())
    }

    pub async fn create_deck(&self, deck: &str) -> Result<i64, AnkiError> {
        self.invoke("createDeck", json!({ "deck": deck })).await
    }

    pub async fn model_names(&self) -> Result<Vec<String>, AnkiError> {
        self.invoke("modelNames", json!({})).await
    }

    pub async fn create_model(&self, model: &Value) -> Result<Value, AnkiError> {
        self.invoke("createModel", model.clone()).await
    }

    /// Which notes would be accepted (false = duplicate or invalid).
    pub async fn can_add_notes(&self, notes: &[Value]) -> Result<Vec<bool>, AnkiError> {
        let mut out = Vec::with_capacity(notes.len());
        for chunk in notes.chunks(100) {
            let mut part: Vec<bool> = self.invoke("canAddNotes", json!({ "notes": chunk })).await?;
            out.append(&mut part);
        }
        Ok(out)
    }

    pub async fn add_notes(&self, notes: &[Value]) -> Result<Vec<Option<i64>>, AnkiError> {
        let mut out = Vec::with_capacity(notes.len());
        for chunk in notes.chunks(50) {
            let mut part: Vec<Option<i64>> = self.invoke("addNotes", json!({ "notes": chunk })).await?;
            out.append(&mut part);
        }
        Ok(out)
    }

    pub async fn retrieve_media_file(&self, filename: &str) -> Result<Option<String>, AnkiError> {
        let value = self.raw("retrieveMediaFile", json!({ "filename": filename }), Duration::from_secs(30)).await?;
        Ok(value.as_str().map(str::to_string))
    }
}

pub fn escape(deck: &str) -> String {
    deck.replace('"', "\\\"")
}

/// The single unambiguous `Parent::<name>` deck when a mapping's name moved.
pub fn nested_deck_fallback(mapped: &str, available: &[String]) -> Option<String> {
    let suffix = format!("::{mapped}");
    let matches: Vec<&String> = available.iter().filter(|d| d.ends_with(&suffix)).collect();
    (matches.len() == 1).then(|| matches[0].clone())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardInfo {
    pub card_id: i64,
    #[serde(default)]
    pub question: String,
    #[serde(default)]
    pub answer: String,
    #[serde(default)]
    pub fields: Value,
    /// days (negative = seconds for sub-day learning steps)
    #[serde(default)]
    pub interval: i64,
    /// permille ease, 0 for new
    #[serde(default)]
    pub factor: i64,
    #[serde(default)]
    pub reps: i64,
    #[serde(default)]
    pub lapses: i64,
    #[serde(default)]
    pub due: i64,
    /// -3..3: buried/sched-buried/suspended/new/learning/review/day-learn
    #[serde(default)]
    pub queue: i64,
    #[serde(default)]
    pub note: i64,
}

#[cfg(test)]
mod tests {
    use super::nested_deck_fallback;

    #[test]
    fn nested_deck_fallback_requires_one_match() {
        let decks = vec!["Japanese::Core".to_string(), "Other::Core2".to_string(), "Mining".to_string()];
        assert_eq!(nested_deck_fallback("Core", &decks), Some("Japanese::Core".into()));
        assert_eq!(nested_deck_fallback("Mining", &decks), None);
        let ambiguous = vec!["A::Core".to_string(), "B::Core".to_string()];
        assert_eq!(nested_deck_fallback("Core", &ambiguous), None);
    }
}

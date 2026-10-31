//! In-flight AI replies, decoupled from the HTTP connection that started them.
//!
//! A reply keeps generating (and is saved) when the browser closes the panel,
//! navigates away, or reloads; only an explicit Stop cancels it. Any tab can
//! re-attach to a running reply: it first receives a `snapshot` (status and
//! the text so far), then the live events.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use axum::response::sse::Event;
use futures::Stream;
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::broadcast;
use tokio::sync::broadcast::error::RecvError;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: String,
    pub label: Option<String>,
    pub text: String,
    /// Unix epoch milliseconds, for the elapsed-time display.
    pub started_at: i64,
}

pub struct Turn {
    pub user_id: String,
    pub cancel: CancellationToken,
    tx: broadcast::Sender<(String, Value)>,
    snapshot: Mutex<Snapshot>,
}

impl Turn {
    /// Record an event in the snapshot and fan it out to attached viewers.
    pub fn publish(&self, name: &str, data: Value) {
        let mut snapshot = self.snapshot.lock().expect("turn snapshot lock");
        match name {
            "start" => {
                snapshot.label = data.get("label").and_then(Value::as_str).map(str::to_string);
                snapshot.status = "thinking".into();
            }
            "status" => {
                if let Some(status) = data.get("status").and_then(Value::as_str) {
                    snapshot.status = status.to_string();
                }
            }
            "delta" => {
                if let Some(text) = data.get("text").and_then(Value::as_str) {
                    snapshot.text.push_str(text);
                    snapshot.status = "writing".into();
                }
            }
            _ => {}
        }
        // Sent under the lock so a subscriber never misses or doubles an event.
        let _ = self.tx.send((name.to_string(), data));
    }

    fn subscribe(&self) -> (Snapshot, broadcast::Receiver<(String, Value)>) {
        let snapshot = self.snapshot.lock().expect("turn snapshot lock");
        (snapshot.clone(), self.tx.subscribe())
    }
}

#[derive(Default)]
pub struct TurnRegistry {
    turns: Mutex<HashMap<String, Arc<Turn>>>,
}

impl TurnRegistry {
    /// Register a new reply for a conversation; `None` if one is already running.
    pub fn begin(&self, conversation_id: &str, user_id: &str) -> Option<Arc<Turn>> {
        let mut turns = self.turns.lock().expect("turn registry lock");
        if turns.contains_key(conversation_id) {
            return None;
        }
        let (tx, _) = broadcast::channel(1024);
        let turn = Arc::new(Turn {
            user_id: user_id.to_string(),
            cancel: CancellationToken::new(),
            tx,
            snapshot: Mutex::new(Snapshot {
                status: "connecting".into(),
                started_at: chrono::Utc::now().timestamp_millis(),
                ..Snapshot::default()
            }),
        });
        turns.insert(conversation_id.to_string(), turn.clone());
        Some(turn)
    }

    pub fn finish(&self, conversation_id: &str) {
        self.turns.lock().expect("turn registry lock").remove(conversation_id);
    }

    /// The running reply for a conversation, if it belongs to this user.
    pub fn get(&self, conversation_id: &str, user_id: &str) -> Option<Arc<Turn>> {
        self.turns.lock().expect("turn registry lock").get(conversation_id).filter(|t| t.user_id == user_id).cloned()
    }
}

fn sse(name: &str, data: &Value) -> Result<Event, Infallible> {
    Ok(Event::default().event(name).data(data.to_string()))
}

/// SSE for one viewer: optionally a leading snapshot, then live events until
/// the reply finishes. Dropping the stream detaches without cancelling.
pub fn watch(turn: Arc<Turn>, conversation_id: String, with_snapshot: bool) -> impl Stream<Item = Result<Event, Infallible>> {
    let (snapshot, mut rx) = turn.subscribe();
    drop(turn);
    async_stream::stream! {
        yield sse("conversation", &json!({ "conversationId": conversation_id }));
        if with_snapshot {
            yield sse("snapshot", &serde_json::to_value(&snapshot).unwrap_or(Value::Null));
        }
        loop {
            match rx.recv().await {
                Ok((name, data)) => {
                    let last = name == "done" || name == "error";
                    yield sse(&name, &data);
                    if last { break; }
                }
                // A slow viewer fell behind: the final `done` carries the full text.
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            }
        }
    }
}

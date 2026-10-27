//! Browser relay for AnkiConnect: the SPA keeps a WebSocket open and forwards
//! each `{id, action, version, params}` to the learner's local Anki, replying
//! with `{id, result | transportError}`.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::{Mutex, RwLock, mpsc, oneshot};

use crate::auth::User;
use crate::state::App;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

struct Connection {
    id: u64,
    outgoing: mpsc::Sender<String>,
    pending: Pending,
}

#[derive(Default)]
pub struct RelayHub {
    connections: RwLock<HashMap<String, Connection>>,
    next: AtomicU64,
}

impl RelayHub {
    pub fn is_connected(&self, user_id: &str) -> bool {
        self.connections.try_read().map(|c| c.contains_key(user_id)).unwrap_or(true)
    }

    pub async fn call(&self, user_id: &str, payload: Value, timeout: Duration) -> Result<Value, String> {
        let (outgoing, pending) = {
            let connections = self.connections.read().await;
            let connection = connections.get(user_id).ok_or_else(|| {
                "Anki is not reachable from the server. Keep Kaizen open in a browser on the computer running Anki \
                 (add this site to AnkiConnect's webCorsOriginList)."
                    .to_string()
            })?;
            (connection.outgoing.clone(), connection.pending.clone())
        };
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        pending.lock().await.insert(id, tx);
        let mut message = payload;
        message["id"] = json!(id);
        if outgoing.send(message.to_string()).await.is_err() {
            pending.lock().await.remove(&id);
            return Err("The browser relay disconnected.".into());
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("The browser relay disconnected.".into()),
            Err(_) => {
                pending.lock().await.remove(&id);
                Err("Anki did not answer through the browser relay in time.".into())
            }
        }
    }
}

pub async fn websocket(State(app): State<App>, user: User, upgrade: WebSocketUpgrade) -> Response {
    upgrade.max_message_size(64 * 1024 * 1024).on_upgrade(move |socket| serve(app, user.id, socket))
}

async fn serve(app: App, user_id: String, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (outgoing, mut outgoing_rx) = mpsc::channel::<String>(64);
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let connection_id = app.relay.next.fetch_add(1, Ordering::Relaxed);
    app.relay
        .connections
        .write()
        .await
        .insert(user_id.clone(), Connection { id: connection_id, outgoing, pending: pending.clone() });
    tracing::info!(user = %user_id, "anki relay connected");

    let writer = tokio::spawn(async move {
        while let Some(text) = outgoing_rx.recv().await {
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(message)) = stream.next().await {
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
        let Some(id) = value.get("id").and_then(Value::as_u64) else { continue };
        if let Some(tx) = pending.lock().await.remove(&id) {
            let result = match value.get("transportError").and_then(Value::as_str) {
                Some(error) => Err(format!("The browser could not reach Anki: {error}")),
                None => Ok(value.get("response").cloned().unwrap_or(Value::Null)),
            };
            let _ = tx.send(result);
        }
    }
    writer.abort();
    let mut connections = app.relay.connections.write().await;
    if connections.get(&user_id).is_some_and(|c| c.id == connection_id) {
        connections.remove(&user_id);
    }
    tracing::info!(user = %user_id, "anki relay disconnected");
}

//! Official AI CLIs signed in to the user's own subscription, run as
//! sandboxed subprocesses: no tools, no project files, prompt on stdin,
//! streamed JSON events on stdout. A dropped request kills the process.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use super::{AiError, AiEvent, ChatMessage, transcript_prompt};
use crate::state::App;

const TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Claude,
    Codex,
    Agy,
}

impl Tool {
    fn binary(self) -> &'static str {
        match self {
            Tool::Claude => "claude",
            Tool::Codex => "codex",
            Tool::Agy => "agy",
        }
    }
    pub fn login_command(self) -> &'static str {
        match self {
            Tool::Claude => "claude auth login",
            Tool::Codex => "codex login",
            Tool::Agy => "agy",
        }
    }
    pub fn install_command(self) -> &'static str {
        match self {
            Tool::Claude => "curl -fsSL https://claude.ai/install.sh | bash",
            Tool::Codex => "npm install -g @openai/codex",
            Tool::Agy => "curl -fsSL https://antigravity.google/cli/install.sh | bash",
        }
    }
    pub fn missing_message(self) -> String {
        let name = match self {
            Tool::Claude => "Claude Code",
            Tool::Codex => "Codex",
            Tool::Agy => "Antigravity",
        };
        format!(
            "The {name} CLI isn't installed on this server. Install it ({}) and sign in with `{}`.",
            self.install_command(),
            self.login_command()
        )
    }
    fn override_path(self, app: &App) -> Option<PathBuf> {
        match self {
            Tool::Claude => app.config.claude_bin.clone(),
            Tool::Codex => app.config.codex_bin.clone(),
            Tool::Agy => app.config.agy_bin.clone(),
        }
    }
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// Newest version directory first (`…/claude-code/2.1.308/<hash>/claude.app/…`).
fn bundled_claude(home: &Path) -> Option<PathBuf> {
    let root = home.join("Library/Application Support/Claude/claude-code");
    let mut versions: Vec<PathBuf> = std::fs::read_dir(&root).ok()?.filter_map(|e| e.ok().map(|e| e.path())).collect();
    versions.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    versions.into_iter().find_map(|version| {
        std::fs::read_dir(&version).ok()?.filter_map(|e| e.ok()).find_map(|build| {
            let candidate = build.path().join("claude.app/Contents/MacOS/claude");
            is_executable(&candidate).then_some(candidate)
        })
    })
}

fn version_key(path: &Path) -> Vec<u64> {
    path.file_name().and_then(|n| n.to_str()).unwrap_or("").split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// Locate a CLI: explicit override, PATH, then well-known install locations.
pub fn find(app: &App, tool: Tool) -> Option<PathBuf> {
    if let Some(path) = tool.override_path(app) {
        return is_executable(&path).then_some(path);
    }
    let name = tool.binary();
    if let Some(path) = std::env::var_os("PATH")
        .and_then(|paths| std::env::split_paths(&paths).map(|dir| dir.join(name)).find(|p| is_executable(p)))
    {
        return Some(path);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let mut candidates = vec![
        home.join(".local/bin").join(name),
        home.join(".claude/local").join(name),
        home.join(".npm-global/bin").join(name),
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
    ];
    match tool {
        Tool::Codex => candidates.push(PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex")),
        Tool::Agy => candidates.push(home.join(".antigravity/bin/agy")),
        Tool::Claude => {
            if let Some(bundled) = bundled_claude(&home) {
                candidates.push(bundled);
            }
        }
    }
    candidates.into_iter().find(|p| is_executable(p))
}

/// An empty working directory so no project instructions, hooks, or MCP
/// configuration are picked up.
fn sandbox_dir(app: &App) -> PathBuf {
    let dir = app.config.data_dir.join("ai-sandbox");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Spawn with a scrubbed environment: none of the parent's AI credentials or
/// proxies leak in, so each CLI uses only its own sign-in.
fn command(app: &App, program: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.current_dir(sandbox_dir(app)).env_clear();
    for key in ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CODEX_HOME"] {
        if let Ok(value) = std::env::var(key) {
            cmd.env(key, value);
        }
    }
    cmd.env("NO_COLOR", "1").env("CI", "1");
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    cmd
}

struct Running {
    child: tokio::process::Child,
    stderr: tokio::task::JoinHandle<String>,
}

async fn spawn(mut cmd: Command, input: &str) -> Result<(Running, tokio::process::ChildStdout), AiError> {
    let mut child = cmd.spawn().map_err(|e| AiError::Provider(format!("Could not start the CLI: {e}")))?;
    let mut stdin = child.stdin.take().expect("piped stdin");
    let input = input.to_string();
    tokio::spawn(async move {
        let _ = stdin.write_all(input.as_bytes()).await;
        let _ = stdin.shutdown().await;
    });
    let mut stderr = child.stderr.take().expect("piped stderr");
    let stderr = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = (&mut stderr).take(16_384).read_to_end(&mut buf).await;
        String::from_utf8_lossy(&buf).to_string()
    });
    let stdout = child.stdout.take().expect("piped stdout");
    Ok((Running { child, stderr }, stdout))
}

fn auth_hint(tool: Tool, text: &str) -> Option<AiError> {
    let lower = text.to_lowercase();
    let auth = ["not logged in", "login", "log in", "authentication", "unauthorized", "invalid api key", "oauth", "sign in"];
    auth.iter().any(|needle| lower.contains(needle)).then(|| {
        AiError::NotConnected(format!(
            "The {} CLI isn't signed in. Run `{}` in a terminal on this machine, then try again.",
            tool.binary(),
            tool.login_command()
        ))
    })
}

fn usage_hint(text: &str) -> Option<AiError> {
    let lower = text.to_lowercase();
    (lower.contains("usage limit") || lower.contains("rate limit") || lower.contains("rate_limit") || lower.contains("quota"))
        .then(|| AiError::UsageLimit(text.lines().next().unwrap_or(text).chars().take(300).collect()))
}

async fn finish(tool: Tool, running: Running, result: Option<Result<String, String>>, partial: String) -> Result<String, AiError> {
    let Running { mut child, stderr } = running;
    let status = child.wait().await.ok();
    let stderr = stderr.await.unwrap_or_default();
    match result {
        Some(Ok(text)) => Ok(text),
        Some(Err(message)) => Err(auth_hint(tool, &message)
            .or_else(|| usage_hint(&message))
            .unwrap_or(AiError::Provider(message))),
        None if !partial.is_empty() && status.is_some_and(|s| s.success()) => Ok(partial),
        None => {
            let tail: String = stderr.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            Err(auth_hint(tool, &stderr).or_else(|| usage_hint(&stderr)).unwrap_or_else(|| {
                AiError::Provider(if tail.trim().is_empty() {
                    format!("The {} CLI exited without a response.", tool.binary())
                } else {
                    format!("The {} CLI failed: {}", tool.binary(), tail.trim())
                })
            }))
        }
    }
}

/// Claude Code headless mode with token-level partial messages.
pub async fn run_claude(app: &App, model: &str, system: &str, messages: &[ChatMessage], tx: &mpsc::Sender<AiEvent>) -> Result<String, AiError> {
    let program = find(app, Tool::Claude).ok_or_else(|| AiError::NotConnected(Tool::Claude.missing_message()))?;
    let mut cmd = command(app, &program);
    cmd.args([
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        // Skip the user's settings files (hooks, plugins, permissions): they
        // don't apply to a one-shot tutor reply and cost seconds at startup.
        // Sign-in lives in the credential store, so the plan still applies.
        "--setting-sources",
        "",
        "--max-turns",
        "1",
        "--system-prompt",
        system,
    ]);
    if !model.is_empty() {
        cmd.args(["--model", model]);
    }
    // An operator-provided long-lived token (`claude setup-token`) for headless servers.
    if let Ok(token) = std::env::var("KAIZEN_CLAUDE_OAUTH_TOKEN") {
        cmd.env("CLAUDE_CODE_OAUTH_TOKEN", token);
    }
    let _ = tx.send(AiEvent::Status("connecting".into())).await;
    let (running, stdout) = spawn(cmd, &transcript_prompt(None, messages)).await?;
    let mut lines = BufReader::new(stdout).lines();
    let mut partial = String::new();
    let mut result: Option<Result<String, String>> = None;
    let mut assistant_error: Option<String> = None;
    let read = async {
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };
            match event.get("type").and_then(Value::as_str) {
                Some("stream_event") => {
                    let inner = &event["event"];
                    match inner.get("type").and_then(Value::as_str) {
                        Some("content_block_start") => {
                            let kind = inner.pointer("/content_block/type").and_then(Value::as_str).unwrap_or("");
                            let status = if kind == "thinking" { "thinking" } else { "writing" };
                            let _ = tx.send(AiEvent::Status(status.into())).await;
                        }
                        Some("content_block_delta") => {
                            if inner.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta")
                                && let Some(text) = inner.pointer("/delta/text").and_then(Value::as_str)
                            {
                                partial.push_str(text);
                                let _ = tx.send(AiEvent::Delta(text.to_string())).await;
                            }
                        }
                        _ => {}
                    }
                }
                Some("assistant") => {
                    if let Some(error) = event.get("error").and_then(Value::as_str) {
                        assistant_error = Some(error.to_string());
                    }
                }
                Some("system") if event.get("subtype").and_then(Value::as_str) == Some("api_retry") => {
                    let _ = tx.send(AiEvent::Status("retrying".into())).await;
                }
                Some("result") => {
                    let text = event.get("result").and_then(Value::as_str).unwrap_or("").to_string();
                    let is_error = event.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                    result = Some(if is_error {
                        let detail = event
                            .get("errors")
                            .and_then(Value::as_array)
                            .map(|e| e.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("; "))
                            .filter(|s| !s.is_empty())
                            .or_else(|| assistant_error.clone())
                            .unwrap_or(text);
                        Err(if detail.is_empty() { "Claude Code reported an error.".into() } else { detail })
                    } else {
                        Ok(if text.is_empty() { partial.clone() } else { text })
                    });
                }
                _ => {}
            }
        }
    };
    if tokio::time::timeout(TIMEOUT, read).await.is_err() {
        return Err(AiError::Provider("Claude Code took longer than 10 minutes.".into()));
    }
    finish(Tool::Claude, running, result, partial).await
}

/// Codex non-interactive mode (whole-message events; the UI keeps animating).
pub async fn run_codex(app: &App, model: &str, system: &str, messages: &[ChatMessage], tx: &mpsc::Sender<AiEvent>) -> Result<String, AiError> {
    let program = find(app, Tool::Codex).ok_or_else(|| AiError::NotConnected(Tool::Codex.missing_message()))?;
    let mut cmd = command(app, &program);
    let sandbox = sandbox_dir(app);
    cmd.args(["exec", "--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "-s", "read-only", "--color", "never", "-C"])
        .arg(&sandbox);
    if !model.is_empty() {
        cmd.args(["-m", model]);
    }
    cmd.arg("-");
    let _ = tx.send(AiEvent::Status("connecting".into())).await;
    let (running, stdout) = spawn(cmd, &transcript_prompt(Some(system), messages)).await?;
    let mut lines = BufReader::new(stdout).lines();
    let mut partial = String::new();
    let mut result: Option<Result<String, String>> = None;
    let read = async {
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };
            match event.get("type").and_then(Value::as_str) {
                Some("turn.started") => {
                    let _ = tx.send(AiEvent::Status("thinking".into())).await;
                }
                Some("item.started") | Some("item.updated") => {
                    if event.pointer("/item/type").and_then(Value::as_str) == Some("reasoning") {
                        let _ = tx.send(AiEvent::Status("thinking".into())).await;
                    }
                }
                Some("item.completed") => {
                    if event.pointer("/item/type").and_then(Value::as_str) == Some("agent_message")
                        && let Some(text) = event.pointer("/item/text").and_then(Value::as_str)
                    {
                        let chunk = if partial.is_empty() { text.to_string() } else { format!("\n\n{text}") };
                        partial.push_str(&chunk);
                        let _ = tx.send(AiEvent::Status("writing".into())).await;
                        let _ = tx.send(AiEvent::Delta(chunk)).await;
                    }
                }
                Some("turn.completed") => result = Some(Ok(partial.clone())),
                Some("turn.failed") => {
                    let message = event.pointer("/error/message").and_then(Value::as_str).unwrap_or("Codex could not complete the request.");
                    result = Some(Err(message.to_string()));
                }
                Some("error") => {
                    if let Some(message) = event.get("message").and_then(Value::as_str)
                        && result.is_none()
                        && (message.to_lowercase().contains("login") || message.to_lowercase().contains("limit"))
                    {
                        result = Some(Err(message.to_string()));
                    }
                }
                _ => {}
            }
        }
    };
    if tokio::time::timeout(TIMEOUT, read).await.is_err() {
        return Err(AiError::Provider("Codex took longer than 10 minutes.".into()));
    }
    finish(Tool::Codex, running, result, partial).await
}

/// Google Antigravity CLI headless mode (Google AI Pro/Ultra plans).
pub async fn run_agy(app: &App, model: &str, system: &str, messages: &[ChatMessage], tx: &mpsc::Sender<AiEvent>) -> Result<String, AiError> {
    let program = find(app, Tool::Agy).ok_or_else(|| AiError::NotConnected(Tool::Agy.missing_message()))?;
    let mut cmd = command(app, &program);
    let prompt = transcript_prompt(Some(system), messages);
    cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json"]);
    if !model.is_empty() {
        cmd.args(["--model", model]);
    }
    let input = format!("{}\n", serde_json::json!({ "event": "user", "message": { "content": prompt } }));
    let _ = tx.send(AiEvent::Status("connecting".into())).await;
    let (running, stdout) = spawn(cmd, &input).await?;
    let mut lines = BufReader::new(stdout).lines();
    let mut partial = String::new();
    let mut result: Option<Result<String, String>> = None;
    let read = async {
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };
            match event.get("event").and_then(Value::as_str) {
                Some("step_update") => {
                    let step = &event["step_update"];
                    if step.get("step_type").and_then(Value::as_str) == Some("agent_response") {
                        if let Some(delta) = step.get("text_delta").and_then(Value::as_str).filter(|d| !d.is_empty()) {
                            partial.push_str(delta);
                            let _ = tx.send(AiEvent::Delta(delta.to_string())).await;
                        }
                    } else {
                        let _ = tx.send(AiEvent::Status("thinking".into())).await;
                    }
                }
                Some("result") => {
                    let r = &event["result"];
                    result = Some(match r.get("status").and_then(Value::as_str) {
                        Some("SUCCESS") => Ok(r.get("response").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| partial.clone())),
                        _ => Err(r.get("error").map(|e| e.as_str().map(str::to_string).unwrap_or_else(|| e.to_string())).unwrap_or_else(|| "Antigravity reported an error.".into())),
                    });
                }
                _ => {}
            }
        }
    };
    if tokio::time::timeout(TIMEOUT, read).await.is_err() {
        return Err(AiError::Provider("Antigravity took longer than 10 minutes.".into()));
    }
    finish(Tool::Agy, running, result, partial).await
}

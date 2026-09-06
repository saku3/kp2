//! Optional browser VS Code via code-server: started as a child process when installed.
//! GET /api/editor -> { available, url, workspace }; POST /api/open { file, line? }.
use crate::{AppState, util::{ApiError, home, percent_encode}};
use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::{Path, PathBuf}, sync::Arc, time::Duration};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpStream, process::{Child, Command}, sync::Mutex};

pub struct Editor {
    port: u16,
    data_dir: PathBuf,
    workspace: PathBuf,
    child: Mutex<Option<Child>>,
}

fn data_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("KP2_CODE_SERVER_DATA") {
        return PathBuf::from(d);
    }
    let base = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| home().join(".local/share"));
    // Short path on purpose: code-server's IPC socket lives here and socket paths are length-limited.
    base.join("kp2").join("code-server")
}

impl Editor {
    pub async fn start(port: u16, workspace: &Path, enabled: bool) -> Self {
        let data_dir = data_dir();
        let editor = Self { port, data_dir: data_dir.clone(), workspace: workspace.to_path_buf(), child: Mutex::new(None) };
        if !enabled {
            tracing::info!("editor:    disabled (--no-editor)");
            return editor;
        }
        let _ = std::fs::create_dir_all(&data_dir);
        let spawned = Command::new("code-server")
            .args(["--auth", "none", "--bind-addr", &format!("127.0.0.1:{port}"), "--user-data-dir"])
            .arg(&data_dir)
            .args(["--disable-telemetry", "--disable-update-check", "--disable-workspace-trust", "--disable-getting-started-override"])
            .arg(workspace)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn();
        match spawned {
            Ok(child) => {
                tracing::info!("editor:    code-server on http://127.0.0.1:{port}/ (data: {})", data_dir.display());
                *editor.child.lock().await = Some(child);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                tracing::info!("editor:    code-server not found; editor pane disabled (macOS: brew install code-server)");
            }
            Err(e) => tracing::warn!("editor:    cannot start code-server: {e}"),
        }
        editor
    }

    /// Stop the code-server child (if we started one).
    pub async fn stop(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }
    }

    /// True when code-server answers /healthz.
    pub async fn running(&self) -> bool {
        let probe = async {
            let mut s = TcpStream::connect(("127.0.0.1", self.port)).await.ok()?;
            s.write_all(b"GET /healthz HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").await.ok()?;
            let mut buf = [0u8; 64];
            let n = s.read(&mut buf).await.ok()?;
            Some(String::from_utf8_lossy(&buf[..n]).starts_with("HTTP/1.") && String::from_utf8_lossy(&buf[..n]).contains(" 200 "))
        };
        matches!(tokio::time::timeout(Duration::from_secs(1), probe).await, Ok(Some(true)))
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/?folder={}", self.port, percent_encode(&self.workspace.to_string_lossy()))
    }
}

pub async fn info(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({ "available": state.editor.running().await, "url": state.editor.url(), "workspace": state.workspace }))
}

#[derive(Deserialize)]
pub struct OpenRequest {
    file: String,
    line: Option<Value>,
}

pub async fn open(State(state): State<Arc<AppState>>, Json(req): Json<OpenRequest>) -> Result<Json<Value>, ApiError> {
    if req.file.trim().is_empty() {
        return Err(ApiError::bad("file is required"));
    }
    let line = match req.line {
        None | Some(Value::Null) => None,
        Some(Value::Number(n)) if n.as_u64().is_some_and(|v| v > 0) => n.as_u64(),
        Some(_) => return Err(ApiError::bad("line must be a positive integer")),
    };
    let full = crate::util::normalize(&state.workspace.join(req.file.trim()));
    if !full.is_file() {
        return Err(ApiError::not_found(format!("Not a file: {}", full.display())));
    }
    if !state.editor.running().await {
        return Err(ApiError(axum::http::StatusCode::SERVICE_UNAVAILABLE, "code-server is not running".into()));
    }
    let target = match line { Some(l) => format!("{}:{l}", full.display()), None => full.display().to_string() };
    let out = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new("code-server").arg("--user-data-dir").arg(&state.editor.data_dir).arg("-r").arg(&target).output(),
    )
    .await
    .map_err(|_| ApiError::internal("code-server -r timed out"))?
    .map_err(ApiError::internal)?;
    if !out.status.success() {
        return Err(ApiError::internal(String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(Json(json!({ "opened": full, "line": line })))
}

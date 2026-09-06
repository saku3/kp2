//! Markdown documents from any local folder, plus change notifications.
use crate::{AppState, events::Hub, util::{ApiError, expand, normalize}};
use axum::{Json, extract::{Query, State}, http::header, response::{IntoResponse, Response}};
use notify::{EventKind, RecursiveMode, Watcher as _};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const SKIP_DIRS: &[&str] = &["node_modules", ".git"];

#[derive(Deserialize)]
pub struct DirQuery {
    dir: Option<String>,
    name: Option<String>,
}

fn resolve_dir(state: &AppState, q: &DirQuery) -> Result<PathBuf, ApiError> {
    let dir = match q.dir.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => expand(s),
        None => state.docs_default.clone(),
    };
    if !dir.is_dir() {
        return Err(ApiError::not_found(format!("Not a directory: {}", dir.display())));
    }
    Ok(dir)
}

fn list_markdown(root: &Path, rel: &Path, out: &mut BTreeSet<String>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(root.join(rel))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        let ft = entry.file_type()?;
        let child = rel.join(&name);
        if ft.is_dir() {
            list_markdown(root, &child, out)?;
        } else if ft.is_file() && name.ends_with(".md") {
            out.insert(child.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

/// GET /api/docs?dir=<path> -> { dir, names }
pub async fn list(State(state): State<Arc<AppState>>, Query(q): Query<DirQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    let dir = resolve_dir(&state, &q)?;
    let mut names = BTreeSet::new();
    list_markdown(&dir, Path::new(""), &mut names).map_err(ApiError::internal)?;
    state.watcher.watch_docs(&dir);
    Ok(Json(json!({ "dir": dir, "names": names })))
}

/// GET /api/doc?dir=<path>&name=<relative.md> -> text/markdown
pub async fn read(State(state): State<Arc<AppState>>, Query(q): Query<DirQuery>) -> Result<Response, ApiError> {
    let dir = resolve_dir(&state, &q)?;
    let name = q.name.as_deref().unwrap_or("");
    let full = normalize(&dir.join(name));
    if !name.ends_with(".md") || name.contains('\0') || !full.starts_with(&dir) || full == dir {
        return Err(ApiError::bad("Invalid document name"));
    }
    let text = tokio::fs::read_to_string(&full).await.map_err(|_| ApiError::not_found(format!("Not found: {}", full.display())))?;
    Ok(([(header::CONTENT_TYPE, "text/markdown; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], text).into_response())
}

/// Watches document folders (recursively) and the favorites file, publishing to the event hub.
pub struct Watcher {
    inner: Mutex<notify::RecommendedWatcher>,
    watched: Arc<Mutex<HashMap<PathBuf, ()>>>,
}

impl Watcher {
    pub fn new(hub: Hub) -> notify::Result<Self> {
        let watched: Arc<Mutex<HashMap<PathBuf, ()>>> = Arc::new(Mutex::new(HashMap::new()));
        let favorites = Arc::new(Mutex::new(None::<PathBuf>));
        let (watched_cb, favorites_cb) = (watched.clone(), favorites.clone());
        let inner = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            let kind = match ev.kind {
                EventKind::Create(_) => "add",
                EventKind::Remove(_) => "unlink",
                EventKind::Modify(_) | EventKind::Any | EventKind::Other => "change",
                EventKind::Access(_) => return,
            };
            for path in &ev.paths {
                if favorites_cb.lock().unwrap().as_deref() == Some(path.as_path()) {
                    hub.send("favorites:changed", json!({}));
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                for dir in watched_cb.lock().unwrap().keys() {
                    if let Ok(rel) = path.strip_prefix(dir) {
                        hub.send("docs:changed", json!({ "dir": dir, "name": rel.to_string_lossy().replace('\\', "/"), "event": kind }));
                    }
                }
            }
        })?;
        let w = Self { inner: Mutex::new(inner), watched };
        // Stash the favorites path holder inside the closure state via a second Arc.
        FAVORITES_PATH.set(favorites).ok();
        Ok(w)
    }

    pub fn watch_docs(&self, dir: &Path) {
        let mut watched = self.watched.lock().unwrap();
        if watched.contains_key(dir) {
            return;
        }
        if let Err(e) = self.inner.lock().unwrap().watch(dir, RecursiveMode::Recursive) {
            tracing::warn!("cannot watch {}: {e}", dir.display());
            return;
        }
        watched.insert(dir.to_path_buf(), ());
    }

    pub fn watch_favorites(&self, file: &Path) {
        if let Some(holder) = FAVORITES_PATH.get() {
            *holder.lock().unwrap() = Some(file.to_path_buf());
        }
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
            if let Err(e) = self.inner.lock().unwrap().watch(parent, RecursiveMode::NonRecursive) {
                tracing::warn!("cannot watch {}: {e}", parent.display());
            }
        }
    }
}

static FAVORITES_PATH: std::sync::OnceLock<Arc<Mutex<Option<PathBuf>>>> = std::sync::OnceLock::new();

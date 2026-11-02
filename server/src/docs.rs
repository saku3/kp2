//! Markdown documents from any local folder, plus change notifications.
use crate::{
    AppState,
    events::Hub,
    util::{ApiError, expand, normalize},
};
use axum::{
    Json,
    extract::{Query, State},
    http::header,
    response::{IntoResponse, Response},
};
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
        return Err(ApiError::not_found(format!(
            "Not a directory: {}",
            dir.display()
        )));
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
pub async fn list(
    State(state): State<Arc<AppState>>,
    Query(q): Query<DirQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let dir = resolve_dir(&state, &q)?;
    let mut names = BTreeSet::new();
    list_markdown(&dir, Path::new(""), &mut names).map_err(ApiError::internal)?;
    state.watcher.watch_docs(&dir);
    Ok(Json(json!({ "dir": dir, "names": names })))
}

/// GET /api/doc?dir=<path>&name=<relative.md> -> text/markdown
pub async fn read(
    State(state): State<Arc<AppState>>,
    Query(q): Query<DirQuery>,
) -> Result<Response, ApiError> {
    let dir = resolve_dir(&state, &q)?;
    let name = q.name.as_deref().unwrap_or("");
    let full = normalize(&dir.join(name));
    if !name.ends_with(".md") || name.contains('\0') || !full.starts_with(&dir) || full == dir {
        return Err(ApiError::bad("Invalid document name"));
    }
    let text = tokio::fs::read_to_string(&full)
        .await
        .map_err(|_| ApiError::not_found(format!("Not found: {}", full.display())))?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/markdown; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        text,
    )
        .into_response())
}

/// Image types `/api/asset` serves. Only images: documents reference them with `![](...)`, and
/// limiting the endpoint to them keeps it from becoming a general file reader.
const ASSET_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico",
];

fn is_asset(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ASSET_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// GET /api/asset?dir=<path>&name=<relative image path> -> the image
///
/// Serves images referenced from documents (`![](img/foo.png)`), resolved by the client
/// relative to the document. The file must be inside the folder.
pub async fn asset(
    State(state): State<Arc<AppState>>,
    Query(q): Query<DirQuery>,
) -> Result<Response, ApiError> {
    let dir = resolve_dir(&state, &q)?;
    let name = q.name.as_deref().unwrap_or("");
    let full = normalize(&dir.join(name));
    if !is_asset(name) || name.contains('\0') || !full.starts_with(&dir) || full == dir {
        return Err(ApiError::bad("Invalid asset name"));
    }
    let data = tokio::fs::read(&full)
        .await
        .map_err(|_| ApiError::not_found(format!("Not found: {}", full.display())))?;
    let mime = mime_guess::from_path(&full).first_or_octet_stream();
    Ok((
        [
            (header::CONTENT_TYPE, mime.as_ref()),
            (header::CACHE_CONTROL, "no-cache"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            // An SVG opened directly would otherwise run its scripts on this origin.
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            ),
        ],
        data,
    )
        .into_response())
}

/// Watches document folders (recursively) and the favorites file, publishing to the event hub.
///
/// Paths are compared in canonical form: macOS FSEvents reports the real path (`/private/tmp/x`)
/// even when the folder was opened through a symlink (`/tmp/x`), while inotify reports the path
/// as it was watched. Events are published under the path the client asked for.
pub struct Watcher {
    inner: Mutex<notify::RecommendedWatcher>,
    /// Watched docs folders: path as given by the client -> canonical path.
    watched: Arc<Mutex<HashMap<PathBuf, PathBuf>>>,
    /// The favorites file as configured, and its canonical path.
    favorites: Arc<Mutex<Option<(PathBuf, PathBuf)>>>,
}

fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

impl Watcher {
    pub fn new(hub: Hub) -> notify::Result<Self> {
        let watched: Arc<Mutex<HashMap<PathBuf, PathBuf>>> = Arc::new(Mutex::new(HashMap::new()));
        let favorites: Arc<Mutex<Option<(PathBuf, PathBuf)>>> = Arc::new(Mutex::new(None));
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
                let is_favorites = favorites_cb
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|(given, canon)| path == given || path == canon);
                if is_favorites {
                    hub.send("favorites:changed", json!({}));
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                for (dir, canon) in watched_cb.lock().unwrap().iter() {
                    if let Ok(rel) = path.strip_prefix(canon).or_else(|_| path.strip_prefix(dir)) {
                        hub.send("docs:changed", json!({ "dir": dir, "name": rel.to_string_lossy().replace('\\', "/"), "event": kind }));
                    }
                }
            }
        })?;
        Ok(Self {
            inner: Mutex::new(inner),
            watched,
            favorites,
        })
    }

    pub fn watch_docs(&self, dir: &Path) {
        let mut watched = self.watched.lock().unwrap();
        if watched.contains_key(dir) {
            return;
        }
        if let Err(e) = self
            .inner
            .lock()
            .unwrap()
            .watch(dir, RecursiveMode::Recursive)
        {
            tracing::warn!("cannot watch {}: {e}", dir.display());
            return;
        }
        watched.insert(dir.to_path_buf(), canonical(dir));
    }

    pub fn watch_favorites(&self, file: &Path) {
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
            if let Err(e) = self
                .inner
                .lock()
                .unwrap()
                .watch(parent, RecursiveMode::NonRecursive)
            {
                tracing::warn!("cannot watch {}: {e}", parent.display());
            }
            // The file itself may not exist yet, so canonicalize the directory and re-append the name.
            let canon = file
                .file_name()
                .map(|n| canonical(parent).join(n))
                .unwrap_or_else(|| file.to_path_buf());
            *self.favorites.lock().unwrap() = Some((file.to_path_buf(), canon));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_asset;

    #[test]
    fn asset_extensions() {
        assert!(is_asset("img/a.png"));
        assert!(is_asset("A.JPG"));
        assert!(is_asset("diagram.svg"));
        assert!(!is_asset("notes.md"));
        assert!(!is_asset(".env"));
        assert!(!is_asset("id_rsa"));
    }
}

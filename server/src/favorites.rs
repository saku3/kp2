//! Pinned folders and documents, stored in a JSON file the user can edit by hand.
//! $KP2_CONFIG_DIR/favorites.json, else $XDG_CONFIG_HOME/kp2/favorites.json, else ~/.config/kp2/favorites.json
use crate::{AppState, util::{ApiError, expand, home}};
use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashSet, path::{Path, PathBuf}, sync::Arc};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Favorite {
    pub dir: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct File {
    #[serde(default)]
    favorites: Vec<Value>,
}

pub fn favorites_file() -> PathBuf {
    if let Some(dir) = std::env::var_os("KP2_CONFIG_DIR") {
        return PathBuf::from(dir).join("favorites.json");
    }
    let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| home().join(".config"));
    base.join("kp2").join("favorites.json")
}

/// Validate and de-duplicate raw entries. Returns None if any entry is malformed.
fn sanitize(raw: &[Value]) -> Option<Vec<Favorite>> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for item in raw {
        let obj = item.as_object()?;
        let dir = obj.get("dir")?.as_str()?.trim().to_string();
        if dir.is_empty() {
            return None;
        }
        let doc = match obj.get("doc") {
            None | Some(Value::Null) => None,
            Some(v) => {
                let s = v.as_str()?;
                if !s.ends_with(".md") || s.contains("..") { return None; }
                Some(s.to_string())
            }
        };
        let label = match obj.get("label") {
            None | Some(Value::Null) => None,
            Some(v) => v.as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        };
        let key = (expand(&dir), doc.clone().unwrap_or_default());
        if seen.insert(key) {
            out.push(Favorite { dir, doc, label });
        }
    }
    Some(out)
}

async fn read_file(file: &Path) -> Result<Vec<Favorite>, ApiError> {
    match tokio::fs::read_to_string(file).await {
        Ok(text) => {
            let parsed: File = serde_json::from_str(&text).unwrap_or_default();
            Ok(sanitize(&parsed.favorites).unwrap_or_default())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(ApiError::internal(e)),
    }
}

fn expanded(list: Vec<Favorite>) -> Vec<Favorite> {
    list.into_iter().map(|f| Favorite { dir: expand(&f.dir).to_string_lossy().into_owned(), ..f }).collect()
}

pub async fn get_all(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let list = read_file(&state.favorites_file).await?;
    Ok(Json(json!({ "path": state.favorites_file, "favorites": expanded(list) })))
}

pub async fn put_all(State(state): State<Arc<AppState>>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let raw = body.get("favorites").and_then(Value::as_array).ok_or_else(|| ApiError::bad("favorites must be [{ dir, doc?, label? }]"))?;
    let list = sanitize(raw).ok_or_else(|| ApiError::bad("favorites must be [{ dir, doc?, label? }]"))?;
    let file = &state.favorites_file;
    if let Some(parent) = file.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(ApiError::internal)?;
    }
    let tmp = file.with_extension(format!("json.{}.tmp", std::process::id()));
    let text = serde_json::to_string_pretty(&json!({ "favorites": list })).map_err(ApiError::internal)? + "\n";
    tokio::fs::write(&tmp, text).await.map_err(ApiError::internal)?;
    tokio::fs::rename(&tmp, file).await.map_err(ApiError::internal)?;
    Ok(Json(json!({ "path": file, "favorites": expanded(list) })))
}

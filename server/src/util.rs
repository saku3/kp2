use axum::{Json, http::StatusCode, response::{IntoResponse, Response}};
use serde_json::json;
use std::path::{Component, Path, PathBuf};

/// JSON `{ "error": ... }` with a status code.
pub struct ApiError(pub StatusCode, pub String);

impl ApiError {
    pub fn bad(msg: impl Into<String>) -> Self { Self(StatusCode::BAD_REQUEST, msg.into()) }
    pub fn not_found(msg: impl Into<String>) -> Self { Self(StatusCode::NOT_FOUND, msg.into()) }
    pub fn internal(err: impl std::fmt::Display) -> Self { Self(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()) }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

pub fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// Expand a leading "~" and make the path absolute and lexically normalized (no "." / "..").
pub fn expand(input: &str) -> PathBuf {
    let s = input.trim();
    let p = if s == "~" {
        home()
    } else if let Some(rest) = s.strip_prefix("~/") {
        home().join(rest)
    } else {
        PathBuf::from(s)
    };
    absolute(p)
}

pub fn absolute(p: PathBuf) -> PathBuf {
    let abs = std::path::absolute(&p).unwrap_or(p);
    normalize(&abs)
}

/// Resolve "." and ".." lexically. Returns a rooted path; ".." at the root is dropped.
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => { out.pop(); }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn percent_encode(s: &str) -> String {
    use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

//! kp2: a Markdown guide, a browser terminal and (optionally) a browser VS Code, served from one
//! local binary. Binds to 127.0.0.1 only.
//!
//! Routes
//!   GET  /token, GET /ws           terminal (ttyd wire protocol, see pty.rs)
//!   GET  /api/docs, /api/doc       markdown from any local folder (docs.rs)
//!   GET/PUT /api/favorites         pinned folders / documents (favorites.rs)
//!   GET  /api/editor, POST /api/open   code-server integration (editor.rs)
//!   GET  /api/events               server-sent events: docs:changed, favorites:changed
//!   /*                             the built frontend (../dist, embedded)
mod docs;
mod editor;
mod events;
mod favorites;
mod pty;
mod util;

use axum::{
    Router,
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use clap::Parser;
use rust_embed::RustEmbed;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};

#[derive(Parser, Debug)]
#[command(name = "kp2", about = "Markdown guide + browser terminal + editor, from one local binary")]
struct Cli {
    /// Port to listen on (always bound to 127.0.0.1).
    #[arg(long, default_value_t = 5173)]
    port: u16,
    /// Default markdown folder (any other folder can be opened from the UI).
    #[arg(long, default_value = "docs")]
    docs: PathBuf,
    /// Folder the terminal starts in and code-server opens. Defaults to the current directory.
    #[arg(long)]
    workspace: Option<PathBuf>,
    /// Do not start code-server even if it is installed.
    #[arg(long)]
    no_editor: bool,
    /// Port for code-server (bound to 127.0.0.1).
    #[arg(long, default_value_t = 7682)]
    editor_port: u16,
}

#[derive(RustEmbed)]
#[folder = "../dist/"]
struct Assets;

pub struct AppState {
    pub docs_default: PathBuf,
    pub workspace: PathBuf,
    pub favorites_file: PathBuf,
    pub editor: editor::Editor,
    pub events: events::Hub,
    pub watcher: docs::Watcher,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_target(false).compact().init();
    let cli = Cli::parse();

    let workspace = util::absolute(cli.workspace.unwrap_or_else(|| std::env::current_dir().expect("cwd")));
    let docs_default = util::absolute(cli.docs);
    let favorites_file = favorites::favorites_file();
    let events = events::Hub::new();
    let watcher = docs::Watcher::new(events.clone()).expect("file watcher");
    watcher.watch_favorites(&favorites_file);
    let editor = editor::Editor::start(cli.editor_port, &workspace, !cli.no_editor).await;

    let state = Arc::new(AppState { docs_default: docs_default.clone(), workspace: workspace.clone(), favorites_file: favorites_file.clone(), editor, events, watcher });

    let app = Router::new()
        .route("/token", get(pty::token))
        .route("/ws", get(pty::ws_handler))
        .route("/api/docs", get(docs::list))
        .route("/api/doc", get(docs::read))
        .route("/api/favorites", get(favorites::get_all).put(favorites::put_all))
        .route("/api/editor", get(editor::info))
        .route("/api/open", post(editor::open))
        .route("/api/events", get(events::sse))
        .fallback(static_handler)
        .with_state(state.clone());

    let addr = SocketAddr::from(([127, 0, 0, 1], cli.port));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap_or_else(|e| panic!("cannot bind {addr}: {e}"));
    tracing::info!("kp2 on http://{addr}/");
    tracing::info!("docs:      {}", docs_default.display());
    tracing::info!("workspace: {}", workspace.display());
    tracing::info!("favorites: {}", favorites_file.display());
    axum::serve(listener, app).with_graceful_shutdown(shutdown(state.clone())).await.expect("server");
    state.editor.stop().await;
}

/// Ctrl-C or SIGTERM ends the server; the code-server child is stopped explicitly because
/// kill_on_drop does not run when the process is killed by a signal.
async fn shutdown(state: Arc<AppState>) {
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! { _ = ctrl_c => {}, _ = term.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = ctrl_c.await;
    }
    tracing::info!("shutting down");
    state.editor.stop().await;
}

/// Serve the embedded frontend; unknown paths fall back to index.html (single page app).
async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let file = Assets::get(path).or_else(|| if path.contains('.') { None } else { Assets::get("index.html") });
    match file {
        Some(f) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], f.data).into_response()
        }
        None if path == "index.html" => (StatusCode::NOT_FOUND, "frontend not built: run `npm run build`").into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

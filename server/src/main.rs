//! kp2: a Markdown guide, a browser terminal and (optionally) a browser VS Code, served from one
//! local binary. Binds to 127.0.0.1 only.
//!
//! Routes
//!   GET  /token, GET /ws           terminal (WebSocket wire protocol, see pty.rs)
//!   GET  /api/docs, /api/doc       markdown (and its images) from any local folder (docs.rs)
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
use tokio_util::sync::CancellationToken;

#[derive(Parser, Debug)]
#[command(
    name = "kp2",
    version,
    about = "Markdown guide + browser terminal + editor, from one local binary"
)]
struct Cli {
    /// Port to listen on (always bound to 127.0.0.1).
    #[arg(long, default_value_t = 5173)]
    port: u16,
    /// Default markdown folder (any other folder can be opened from the UI).
    #[arg(long, env = "DOCS_DIR", default_value = "docs")]
    docs: PathBuf,
    /// Folder the terminal starts in and code-server opens. Defaults to the current directory.
    #[arg(long, env = "KP2_WORKSPACE")]
    workspace: Option<PathBuf>,
    /// Do not start code-server even if it is installed.
    #[arg(long)]
    no_editor: bool,
    /// Port for code-server (bound to 127.0.0.1).
    #[arg(long, default_value_t = 7682)]
    editor_port: u16,
    /// Extra origin (scheme://host[:port]) allowed to open the terminal, e.g. a reverse proxy
    /// in front of kp2. Repeat the flag or separate with commas.
    #[arg(
        long = "allowed-origin",
        env = "KP2_ALLOWED_ORIGINS",
        value_delimiter = ','
    )]
    allowed_origins: Vec<String>,
    /// URL the browser loads code-server from, e.g. `/code/` when a reverse proxy forwards that
    /// path to the editor port. Defaults to http://127.0.0.1:<editor-port>/.
    #[arg(long, env = "KP2_EDITOR_URL")]
    editor_url: Option<String>,
}

#[derive(RustEmbed)]
#[folder = "../dist/"]
struct Assets;

pub struct AppState {
    pub docs_default: PathBuf,
    pub workspace: PathBuf,
    pub allowed_origins: Vec<String>,
    pub favorites_file: PathBuf,
    pub editor: editor::Editor,
    pub events: events::Hub,
    pub watcher: docs::Watcher,
    /// Cancelled when the server is shutting down; long-lived responses (SSE) end on it so
    /// graceful shutdown does not wait for them forever.
    pub shutdown: CancellationToken,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_target(false)
        .compact()
        .init();
    let cli = Cli::parse();

    let workspace = util::absolute(
        cli.workspace
            .unwrap_or_else(|| std::env::current_dir().expect("cwd")),
    );
    let docs_default = util::absolute(cli.docs);
    let favorites_file = favorites::favorites_file();
    let events = events::Hub::new();
    let watcher = docs::Watcher::new(events.clone()).expect("file watcher");
    watcher.watch_favorites(&favorites_file);
    let editor =
        editor::Editor::start(cli.editor_port, cli.editor_url, &workspace, !cli.no_editor).await;

    let state = Arc::new(AppState {
        docs_default: docs_default.clone(),
        workspace: workspace.clone(),
        allowed_origins: cli.allowed_origins,
        favorites_file: favorites_file.clone(),
        editor,
        events,
        watcher,
        shutdown: CancellationToken::new(),
    });

    let app = Router::new()
        .route("/token", get(pty::token))
        .route("/ws", get(pty::ws_handler))
        .route("/api/docs", get(docs::list))
        .route("/api/doc", get(docs::read))
        .route(
            "/api/favorites",
            get(favorites::get_all).put(favorites::put_all),
        )
        .route("/api/editor", get(editor::info))
        .route("/api/open", post(editor::open))
        .route("/api/events", get(events::sse))
        .fallback(static_handler)
        .with_state(state.clone());

    let addr = SocketAddr::from(([127, 0, 0, 1], cli.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("cannot bind {addr}: {e}"));
    tracing::info!("kp2 on http://{addr}/");
    tracing::info!("docs:      {}", docs_default.display());
    tracing::info!("workspace: {}", workspace.display());
    tracing::info!("favorites: {}", favorites_file.display());
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown(state.clone()))
        .await
        .expect("server");
    state.editor.stop().await;
}

/// Ctrl-C or SIGTERM ends the server; the code-server child is stopped explicitly because
/// kill_on_drop does not run when the process is killed by a signal.
async fn shutdown(state: Arc<AppState>) {
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! { _ = ctrl_c => {}, _ = term.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = ctrl_c.await;
    }
    tracing::info!("shutting down");
    // End the open SSE streams: with_graceful_shutdown waits for in-flight responses, and
    // an EventSource connection would otherwise keep the process alive until the tab closes.
    state.shutdown.cancel();
    state.editor.stop().await;
}

/// Serve the embedded frontend; unknown paths fall back to index.html (single page app).
async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    // `served` is the asset actually returned, so the SPA fallback gets index.html's MIME type
    // rather than a guess from an extension-less route.
    let (served, file) = match Assets::get(path) {
        Some(f) => (path, Some(f)),
        None if !path.contains('.') => ("index.html", Assets::get("index.html")),
        None => (path, None),
    };
    match file {
        Some(f) => {
            let mime = mime_guess::from_path(served).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], f.data).into_response()
        }
        None if path == "index.html" => (
            StatusCode::NOT_FOUND,
            "frontend not built: run `npm run build`",
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

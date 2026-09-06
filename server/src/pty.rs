//! Browser terminal: a PTY per WebSocket connection, speaking ttyd's wire protocol so the
//! existing xterm.js client (src/ttyd.ts) works unchanged.
//!
//!   client -> server  first frame: text JSON {AuthToken, columns, rows}
//!                     then binary: '0'+input | '1'+JSON{columns,rows} | '2' pause | '3' resume
//!   server -> client  binary: '0'+output | '1'+title | '2'+JSON preferences
use crate::AppState;
use axum::{
    Json,
    body::Bytes,
    extract::{State, ws::{Message, WebSocket, WebSocketUpgrade}},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::Deserialize;
use serde_json::json;
use std::{io::{Read, Write}, sync::Arc};
use tokio::sync::mpsc;

pub async fn token() -> Json<serde_json::Value> {
    Json(json!({ "token": "" }))
}

/// Only pages served from this machine may drive the terminal.
fn origin_allowed(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else { return true };
    let host = origin.trim_start_matches("http://").trim_start_matches("https://");
    let host = host.split('/').next().unwrap_or("");
    let host = host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host);
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

pub async fn ws_handler(ws: WebSocketUpgrade, headers: HeaderMap, State(state): State<Arc<AppState>>) -> Response {
    if !origin_allowed(&headers) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    ws.protocols(["tty"]).on_upgrade(move |socket| async move {
        if let Err(e) = session(socket, state).await {
            tracing::warn!("terminal session ended: {e}");
        }
    })
}

#[derive(Deserialize)]
struct Hello {
    #[serde(default = "default_cols")]
    columns: u16,
    #[serde(default = "default_rows")]
    rows: u16,
}
fn default_cols() -> u16 { 80 }
fn default_rows() -> u16 { 24 }

fn shell() -> String {
    if let Ok(s) = std::env::var("SHELL")
        && std::fs::metadata(&s).map(|m| m.is_file()).unwrap_or(false)
    {
        return s;
    }
    for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        if std::path::Path::new(candidate).exists() {
            return candidate.into();
        }
    }
    "/bin/sh".into()
}

fn frame(cmd: u8, payload: &[u8]) -> Message {
    let mut v = Vec::with_capacity(payload.len() + 1);
    v.push(cmd);
    v.extend_from_slice(payload);
    Message::Binary(Bytes::from(v))
}

async fn session(mut socket: WebSocket, state: Arc<AppState>) -> anyhow::Result<()> {
    // Handshake: the first frame carries the initial size.
    let hello: Hello = match socket.recv().await {
        Some(Ok(Message::Text(t))) => serde_json::from_str(&t).unwrap_or(Hello { columns: 80, rows: 24 }),
        Some(Ok(Message::Binary(b))) => serde_json::from_slice(&b).unwrap_or(Hello { columns: 80, rows: 24 }),
        _ => return Ok(()),
    };

    let shell = shell();
    let pty = native_pty_system();
    let pair = pty.openpty(PtySize { rows: hello.rows, cols: hello.columns, pixel_width: 0, pixel_height: 0 })?;
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.cwd(&state.workspace);
    let mut child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);
    let master = pair.master;
    let mut reader = master.try_clone_reader()?;
    let mut writer = master.take_writer()?;

    // PTY output is read on a plain thread (blocking reads) and forwarded over a channel.
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(256);
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    socket.send(frame(b'1', format!("{shell} -l").as_bytes())).await?;
    socket.send(frame(b'2', b"{}")).await?;

    let mut paused = false;
    loop {
        tokio::select! {
            out = rx.recv(), if !paused => match out {
                Some(data) => socket.send(frame(b'0', &data)).await?,
                None => break, // shell exited
            },
            msg = socket.recv() => {
                let data: Vec<u8> = match msg {
                    Some(Ok(Message::Binary(b))) => b.to_vec(),
                    Some(Ok(Message::Text(t))) => t.as_bytes().to_vec(),
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                };
                match data.first() {
                    Some(b'0') => {
                        let input = data[1..].to_vec();
                        tokio::task::block_in_place(|| writer.write_all(&input).and_then(|_| writer.flush()))?;
                    }
                    Some(b'1') => {
                        if let Ok(size) = serde_json::from_slice::<Hello>(&data[1..]) {
                            master.resize(PtySize { rows: size.rows, cols: size.columns, pixel_width: 0, pixel_height: 0 })?;
                        }
                    }
                    Some(b'2') => paused = true,
                    Some(b'3') => paused = false,
                    _ => {}
                }
            }
        }
    }

    let _ = child.kill();
    tokio::task::spawn_blocking(move || {
        let _ = child.wait();
    });
    let _ = socket.send(Message::Close(None)).await;
    Ok(())
}

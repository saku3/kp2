//! Server-sent events used by the UI to refresh without polling.
use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::{Stream, StreamExt};
use std::{convert::Infallible, sync::Arc};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;

#[derive(Clone, Debug)]
pub struct Notification {
    pub event: &'static str,
    pub data: serde_json::Value,
}

#[derive(Clone)]
pub struct Hub(broadcast::Sender<Notification>);

impl Hub {
    pub fn new() -> Self {
        Self(broadcast::channel(256).0)
    }
    pub fn send(&self, event: &'static str, data: serde_json::Value) {
        let _ = self.0.send(Notification { event, data });
    }
    pub fn subscribe(&self) -> broadcast::Receiver<Notification> {
        self.0.subscribe()
    }
}

pub async fn sse(State(state): State<Arc<crate::AppState>>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(state.events.subscribe()).filter_map(|item| async move {
        match item {
            Ok(n) => Some(Ok(Event::default().event(n.event).data(n.data.to_string()))),
            Err(_lagged) => None,
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

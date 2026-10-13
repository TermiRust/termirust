//! Streaming chat over HTTP. The transport and SSE framing are shared; each [`AiProvider`]
//! only builds its request and reads its own event format.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{CancelFlag, CoreError, Result};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// A stream that sends nothing for this long is treated as dead.
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// How quickly a cancel takes effect while waiting for the next chunk.
const CANCEL_POLL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Anthropic,
    /// Any server speaking OpenAI's chat completions API: OpenAI, OpenRouter, Ollama, LM Studio…
    OpenAiCompatible,
}

impl ProviderKind {
    pub fn default_base_url(self) -> &'static str {
        match self {
            ProviderKind::Anthropic => "https://api.anthropic.com",
            ProviderKind::OpenAiCompatible => "https://api.openai.com/v1",
        }
    }

    pub fn default_model(self) -> &'static str {
        match self {
            ProviderKind::Anthropic => "claude-sonnet-5-5",
            ProviderKind::OpenAiCompatible => "gpt-4o-mini",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
    /// Optional for local servers such as Ollama.
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatRequest {
    pub system: String,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: u32,
}

/// One server-sent event, as a provider understands it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEvent {
    Text(String),
    Done,
    Ignore,
}

pub trait AiProvider: Send + Sync {
    fn request(
        &self,
        http: &reqwest::Client,
        config: &ProviderConfig,
        chat: &ChatRequest,
    ) -> reqwest::RequestBuilder;
    fn parse_event(&self, data: &str) -> Result<StreamEvent>;
}

fn endpoint(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path)
}

pub struct Anthropic;

impl AiProvider for Anthropic {
    fn request(
        &self,
        http: &reqwest::Client,
        config: &ProviderConfig,
        chat: &ChatRequest,
    ) -> reqwest::RequestBuilder {
        let builder = http
            .post(endpoint(&config.base_url, "v1/messages"))
            .header("anthropic-version", "2023-06-01")
            .json(&json!({
                "model": config.model,
                "max_tokens": chat.max_tokens,
                "system": chat.system,
                "messages": chat.messages,
                "stream": true,
            }));
        match &config.api_key {
            Some(key) => builder.header("x-api-key", key),
            None => builder,
        }
    }

    fn parse_event(&self, data: &str) -> Result<StreamEvent> {
        let event: Value = serde_json::from_str(data)
            .map_err(|e| CoreError::Ai(format!("unreadable reply: {e}")))?;
        Ok(match event["type"].as_str() {
            Some("content_block_delta") => match event["delta"]["text"].as_str() {
                Some(text) => StreamEvent::Text(text.to_owned()),
                None => StreamEvent::Ignore,
            },
            Some("message_stop") => StreamEvent::Done,
            Some("error") => {
                return Err(CoreError::Ai(
                    event["error"]["message"]
                        .as_str()
                        .unwrap_or("the provider reported an error")
                        .to_owned(),
                ));
            }
            _ => StreamEvent::Ignore,
        })
    }
}

pub struct OpenAiCompatible;

impl AiProvider for OpenAiCompatible {
    fn request(
        &self,
        http: &reqwest::Client,
        config: &ProviderConfig,
        chat: &ChatRequest,
    ) -> reqwest::RequestBuilder {
        let mut messages = vec![json!({"role": "system", "content": chat.system})];
        messages.extend(
            chat.messages
                .iter()
                .map(|m| json!({"role": m.role, "content": m.content})),
        );
        let builder = http
            .post(endpoint(&config.base_url, "chat/completions"))
            .json(&json!({
                "model": config.model,
                "max_tokens": chat.max_tokens,
                "messages": messages,
                "stream": true,
            }));
        match &config.api_key {
            Some(key) => builder.bearer_auth(key),
            None => builder,
        }
    }

    fn parse_event(&self, data: &str) -> Result<StreamEvent> {
        if data.trim() == "[DONE]" {
            return Ok(StreamEvent::Done);
        }
        let event: Value = serde_json::from_str(data)
            .map_err(|e| CoreError::Ai(format!("unreadable reply: {e}")))?;
        if let Some(message) = event["error"]["message"].as_str() {
            return Err(CoreError::Ai(message.to_owned()));
        }
        Ok(match event["choices"][0]["delta"]["content"].as_str() {
            Some(text) if !text.is_empty() => StreamEvent::Text(text.to_owned()),
            _ => StreamEvent::Ignore,
        })
    }
}

/// Splits a byte stream into SSE events, keeping incomplete ones for the next chunk.
#[derive(Debug, Default)]
struct SseBuffer {
    pending: String,
}

impl SseBuffer {
    /// Returns the `data:` payload of every complete event in `chunk`.
    fn push(&mut self, chunk: &str) -> Vec<String> {
        self.pending.push_str(&chunk.replace("\r\n", "\n"));
        let mut events = Vec::new();
        while let Some(end) = self.pending.find("\n\n") {
            let block: String = self.pending.drain(..end + 2).collect();
            let data: Vec<&str> = block
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(|d| d.strip_prefix(' ').unwrap_or(d))
                .collect();
            if !data.is_empty() {
                events.push(data.join("\n"));
            }
        }
        events
    }
}

/// Turns an HTTP failure into something the user can act on, using the provider's own message.
fn http_error(status: reqwest::StatusCode, body: &str) -> CoreError {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or(v["error"].as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| body.chars().take(200).collect());
    let hint = match status.as_u16() {
        401 | 403 => "the provider rejected the API key",
        404 => "model or URL not found",
        429 => "rate limited or out of credit",
        500..=599 => "the provider is having problems",
        _ => "request failed",
    };
    CoreError::Ai(format!("{hint} (HTTP {}): {detail}", status.as_u16()))
}

pub struct AiClient {
    http: reqwest::Client,
    config: ProviderConfig,
    provider: Box<dyn AiProvider>,
}

impl AiClient {
    pub fn new(config: ProviderConfig) -> Result<Self> {
        // ring is already built for SSH; installing it twice is harmless.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .map_err(|e| CoreError::Ai(format!("cannot create HTTP client: {e}")))?;
        let provider: Box<dyn AiProvider> = match config.kind {
            ProviderKind::Anthropic => Box::new(Anthropic),
            ProviderKind::OpenAiCompatible => Box::new(OpenAiCompatible),
        };
        Ok(Self {
            http,
            config,
            provider,
        })
    }

    /// Streams the reply through `on_text` and returns it whole.
    pub async fn stream(
        &self,
        chat: &ChatRequest,
        cancel: &CancelFlag,
        mut on_text: impl FnMut(&str) + Send,
    ) -> Result<String> {
        let started = std::time::Instant::now();
        let send = self.provider.request(&self.http, &self.config, chat).send();
        let mut response = tokio::select! {
            sent = send => sent.map_err(|e| CoreError::Ai(format!("could not reach {}: {e}", self.config.base_url)))?,
            _ = wait_for_cancel(cancel) => return Err(CoreError::Cancelled),
        };
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            tracing::warn!(kind = ?self.config.kind, model = %self.config.model, status = status.as_u16(), "AI request failed");
            return Err(http_error(status, &body));
        }

        let mut sse = SseBuffer::default();
        let mut reply = String::new();
        let mut undecoded = Vec::new();
        loop {
            let chunk = tokio::select! {
                chunk = tokio::time::timeout(IDLE_TIMEOUT, response.chunk()) => chunk
                    .map_err(|_| CoreError::Ai("the provider stopped responding".into()))?
                    .map_err(|e| CoreError::Ai(format!("connection lost: {e}")))?,
                _ = wait_for_cancel(cancel) => return Err(CoreError::Cancelled),
            };
            let Some(bytes) = chunk else { break };
            // A UTF-8 character may be split across chunks.
            undecoded.extend_from_slice(&bytes);
            let valid = match std::str::from_utf8(&undecoded) {
                Ok(text) => text.len(),
                Err(e) => e.valid_up_to(),
            };
            let text = String::from_utf8_lossy(&undecoded[..valid]).into_owned();
            undecoded.drain(..valid);
            for data in sse.push(&text) {
                match self.provider.parse_event(&data)? {
                    StreamEvent::Text(part) => {
                        on_text(&part);
                        reply.push_str(&part);
                    }
                    StreamEvent::Done => {
                        tracing::info!(kind = ?self.config.kind, model = %self.config.model, ms = started.elapsed().as_millis() as u64, "AI reply finished");
                        return Ok(reply);
                    }
                    StreamEvent::Ignore => {}
                }
            }
        }
        Ok(reply)
    }
}

async fn wait_for_cancel(cancel: &CancelFlag) {
    while !cancel.is_cancelled() {
        tokio::time::sleep(CANCEL_POLL).await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    /// A one-shot HTTP server: records the request, then plays back `chunks` with a pause between.
    async fn fake_server(
        status: &'static str,
        chunks: Vec<&'static str>,
        pause: Duration,
    ) -> (String, Arc<Mutex<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(String::new()));
        let record = seen.clone();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 16 * 1024];
            let mut request = Vec::new();
            // Read headers and the JSON body (Content-Length bounded).
            loop {
                let n = socket.read(&mut buf).await.unwrap();
                request.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&request).to_string();
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let length = text
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if request.len() >= head_end + 4 + length {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            *record.lock().unwrap() = String::from_utf8_lossy(&request).to_string();
            let head = format!(
                "HTTP/1.1 {status}\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n"
            );
            socket.write_all(head.as_bytes()).await.unwrap();
            for chunk in chunks {
                if socket.write_all(chunk.as_bytes()).await.is_err() {
                    return;
                }
                tokio::time::sleep(pause).await;
            }
        });
        (url, seen)
    }

    fn config(kind: ProviderKind, url: String, key: Option<&str>) -> ProviderConfig {
        ProviderConfig {
            kind,
            base_url: url,
            model: "test-model".into(),
            api_key: key.map(Into::into),
        }
    }

    fn chat() -> ChatRequest {
        ChatRequest {
            system: "You suggest shell commands.".into(),
            messages: vec![ChatMessage {
                role: Role::User,
                content: "list files".into(),
            }],
            max_tokens: 64,
        }
    }

    #[tokio::test]
    async fn streams_an_anthropic_reply_and_sends_the_key_header() {
        let (url, seen) = fake_server(
            "200 OK",
            vec![
                "event: message_start\ndata: {\"type\":\"message_start\"}\n\n",
                "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"ls \"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_del",
                "ta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"-la\"}}\n\n",
                "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
            ],
            Duration::from_millis(5),
        )
        .await;
        let client =
            AiClient::new(config(ProviderKind::Anthropic, url, Some("sk-ant-test"))).unwrap();
        let mut parts = Vec::new();
        let reply = client
            .stream(&chat(), &CancelFlag::default(), |p| {
                parts.push(p.to_owned())
            })
            .await
            .unwrap();
        assert_eq!(reply, "ls -la");
        assert_eq!(parts, ["ls ", "-la"]);

        let request = seen.lock().unwrap().clone();
        assert!(request.starts_with("POST /v1/messages "));
        assert!(request.contains("x-api-key: sk-ant-test"));
        assert!(request.contains("anthropic-version: 2023-06-01"));
        assert!(request.contains("\"stream\":true"));
        assert!(request.contains("\"system\":\"You suggest shell commands.\""));
    }

    #[tokio::test]
    async fn streams_an_openai_compatible_reply_with_a_bearer_token() {
        let (url, seen) = fake_server(
            "200 OK",
            vec![
                "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"du -sh *\"}}]}\r\n\r\n",
                "data: [DONE]\n\n",
            ],
            Duration::from_millis(5),
        )
        .await;
        let client = AiClient::new(config(
            ProviderKind::OpenAiCompatible,
            format!("{url}/v1/"),
            Some("sk-test"),
        ))
        .unwrap();
        let reply = client
            .stream(&chat(), &CancelFlag::default(), |_| {})
            .await
            .unwrap();
        assert_eq!(reply, "du -sh *");
        let request = seen.lock().unwrap().clone();
        assert!(request.starts_with("POST /v1/chat/completions "));
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer sk-test")
        );
        assert!(
            request.contains("{\"content\":\"You suggest shell commands.\",\"role\":\"system\"}")
        );
    }

    #[tokio::test]
    async fn local_servers_need_no_key() {
        let (url, seen) = fake_server("200 OK", vec!["data: [DONE]\n\n"], Duration::ZERO).await;
        let client = AiClient::new(config(ProviderKind::OpenAiCompatible, url, None)).unwrap();
        client
            .stream(&chat(), &CancelFlag::default(), |_| {})
            .await
            .unwrap();
        assert!(
            !seen
                .lock()
                .unwrap()
                .to_ascii_lowercase()
                .contains("authorization")
        );
    }

    #[tokio::test]
    async fn explains_a_rejected_key_and_rate_limits() {
        let (url, _) = fake_server(
            "401 Unauthorized",
            vec![
                "{\"error\":{\"type\":\"authentication_error\",\"message\":\"invalid x-api-key\"}}",
            ],
            Duration::ZERO,
        )
        .await;
        let client = AiClient::new(config(ProviderKind::Anthropic, url, Some("bad"))).unwrap();
        let err = client
            .stream(&chat(), &CancelFlag::default(), |_| {})
            .await
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "AI: the provider rejected the API key (HTTP 401): invalid x-api-key"
        );

        let (url, _) = fake_server(
            "429 Too Many Requests",
            vec!["{\"error\":{\"message\":\"quota exceeded\"}}"],
            Duration::ZERO,
        )
        .await;
        let client = AiClient::new(config(ProviderKind::OpenAiCompatible, url, Some("k"))).unwrap();
        let err = client
            .stream(&chat(), &CancelFlag::default(), |_| {})
            .await
            .unwrap_err();
        assert!(
            err.to_string()
                .contains("rate limited or out of credit (HTTP 429): quota exceeded")
        );
    }

    #[tokio::test]
    async fn reports_an_unreachable_server() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let client = AiClient::new(config(ProviderKind::Anthropic, url.clone(), None)).unwrap();
        let err = client
            .stream(&chat(), &CancelFlag::default(), |_| {})
            .await
            .unwrap_err();
        assert!(
            err.to_string().contains(&format!("could not reach {url}")),
            "{err}"
        );
    }

    #[tokio::test]
    async fn an_error_event_mid_stream_fails_the_request() {
        let (url, _) = fake_server(
            "200 OK",
            vec!["event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n"],
            Duration::ZERO,
        )
        .await;
        let client = AiClient::new(config(ProviderKind::Anthropic, url, Some("k"))).unwrap();
        let err = client
            .stream(&chat(), &CancelFlag::default(), |_| {})
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), "AI: Overloaded");
    }

    #[tokio::test]
    async fn cancelling_stops_a_slow_stream() {
        let (url, _) = fake_server(
            "200 OK",
            vec![
                "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n",
                "data: [DONE]\n\n",
            ],
            Duration::from_secs(5),
        )
        .await;
        let client = AiClient::new(config(ProviderKind::OpenAiCompatible, url, None)).unwrap();
        let cancel = CancelFlag::default();
        let trigger = cancel.clone();
        let started = std::time::Instant::now();
        let err = client
            .stream(&chat(), &cancel, move |_| trigger.cancel())
            .await
            .unwrap_err();
        assert!(matches!(err, CoreError::Cancelled));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn sse_events_survive_chunk_boundaries_and_multi_line_data() {
        let mut sse = SseBuffer::default();
        assert!(sse.push("data: {\"a\"").is_empty());
        assert_eq!(
            sse.push(":1}\n\n: comment\n\ndata: x\ndata: y\n\n"),
            ["{\"a\":1}", "x\ny"]
        );
    }

    #[test]
    fn parses_provider_events() {
        assert_eq!(
            Anthropic.parse_event("{\"type\":\"ping\"}").unwrap(),
            StreamEvent::Ignore
        );
        assert_eq!(
            OpenAiCompatible.parse_event("[DONE]").unwrap(),
            StreamEvent::Done
        );
        assert!(
            OpenAiCompatible
                .parse_event("{\"error\":{\"message\":\"bad model\"}}")
                .is_err()
        );
        assert!(Anthropic.parse_event("not json").is_err());
    }

    #[tokio::test]
    #[ignore = "reaches api.anthropic.com over the internet"]
    async fn talks_tls_to_the_real_anthropic_api() {
        let client = AiClient::new(ProviderConfig {
            kind: ProviderKind::Anthropic,
            base_url: ProviderKind::Anthropic.default_base_url().into(),
            model: ProviderKind::Anthropic.default_model().into(),
            api_key: Some("invalid".into()),
        })
        .unwrap();
        let err = client
            .stream(&chat(), &CancelFlag::default(), |_| {})
            .await
            .unwrap_err();
        assert!(err.to_string().contains("HTTP 401"), "{err}");
    }
}

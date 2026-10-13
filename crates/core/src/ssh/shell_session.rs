use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Handle, Handler};
use russh::keys::PublicKeyOrCertificate;
use russh::{ChannelMsg, ChannelWriteHalf, Disconnect};
use tokio::sync::mpsc;

use super::host_key::{HostKeyInfo, HostKeyVerifier};
use crate::{CoreError, Result};

const TERM: &str = "xterm-256color";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtySize {
    pub cols: u32,
    pub rows: u32,
}

/// Credentials for password authentication. `Debug` never prints the password.
#[derive(Clone)]
pub struct PasswordLogin {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl std::fmt::Debug for PasswordLogin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PasswordLogin")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellEvent {
    Output(Vec<u8>),
    Closed { exit_status: Option<u32> },
}

struct ClientHandler {
    verify_host_key: HostKeyVerifier,
}

impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> std::result::Result<bool, Self::Error> {
        Ok((self.verify_host_key)(&HostKeyInfo::from_server_key(
            server_public_key,
        )))
    }
}

/// An interactive shell on a remote host, backed by one SSH connection and PTY channel.
pub struct ShellSession {
    connection: Handle<ClientHandler>,
    channel: ChannelWriteHalf<client::Msg>,
}

impl ShellSession {
    /// Connects, authenticates with a password and starts a login shell on a PTY.
    /// Output and the final close arrive on the returned receiver.
    pub async fn open_with_password(
        login: &PasswordLogin,
        size: PtySize,
        verify_host_key: HostKeyVerifier,
        connect_timeout: Duration,
    ) -> Result<(Self, mpsc::Receiver<ShellEvent>)> {
        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(30)),
            ..Default::default()
        });
        let handler = ClientHandler { verify_host_key };

        let connecting = client::connect(config, (login.host.as_str(), login.port), handler);
        let mut connection = tokio::time::timeout(connect_timeout, connecting)
            .await
            .map_err(|_| CoreError::Timeout(connect_timeout))?
            .map_err(|err| match err {
                russh::Error::UnknownKey => CoreError::HostKeyRejected,
                russh::Error::IO(io) => CoreError::Unreachable {
                    host: login.host.clone(),
                    port: login.port,
                    reason: io.to_string(),
                },
                other => CoreError::Ssh(other.to_string()),
            })?;

        let auth = connection
            .authenticate_password(login.username.clone(), login.password.clone())
            .await?;
        if !auth.success() {
            return Err(CoreError::AuthenticationFailed);
        }

        let channel = connection.channel_open_session().await?;
        channel
            .request_pty(false, TERM, size.cols, size.rows, 0, 0, &[])
            .await?;
        channel.request_shell(true).await?;

        let (mut reader, writer) = channel.split();
        let (events_tx, events_rx) = mpsc::channel(256);
        tokio::spawn(async move {
            let mut exit_status = None;
            while let Some(msg) = reader.wait().await {
                match msg {
                    ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                        if events_tx
                            .send(ShellEvent::Output(data.to_vec()))
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                    ChannelMsg::ExitStatus { exit_status: code } => exit_status = Some(code),
                    ChannelMsg::Close => break,
                    _ => {}
                }
            }
            let _ = events_tx.send(ShellEvent::Closed { exit_status }).await;
        });

        Ok((
            Self {
                connection,
                channel: writer,
            },
            events_rx,
        ))
    }

    pub async fn write(&self, input: &[u8]) -> Result<()> {
        self.channel
            .data_bytes(input.to_vec())
            .await
            .map_err(|_| CoreError::SessionClosed)
    }

    pub async fn resize(&self, size: PtySize) -> Result<()> {
        self.channel
            .window_change(size.cols, size.rows, 0, 0)
            .await
            .map_err(|_| CoreError::SessionClosed)
    }

    pub async fn close(&self) -> Result<()> {
        let _ = self.channel.eof().await;
        let _ = self.channel.close().await;
        self.connection
            .disconnect(Disconnect::ByApplication, "", "en")
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_is_never_printed_by_debug() {
        let login = PasswordLogin {
            host: "example.com".into(),
            port: 22,
            username: "deploy".into(),
            password: "hunter2".into(),
        };
        let printed = format!("{login:?}");
        assert!(printed.contains("deploy"));
        assert!(printed.contains("[REDACTED]"));
        assert!(!printed.contains("hunter2"));
    }

    #[tokio::test]
    async fn unreachable_port_is_reported_with_host_and_port() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let login = PasswordLogin {
            host: "127.0.0.1".into(),
            port,
            username: "nobody".into(),
            password: "x".into(),
        };
        let err = ShellSession::open_with_password(
            &login,
            PtySize { cols: 80, rows: 24 },
            Arc::new(|_| true),
            Duration::from_secs(5),
        )
        .await
        .err()
        .expect("connection must fail");

        match err {
            CoreError::Unreachable { host, port: p, .. } => {
                assert_eq!(host, "127.0.0.1");
                assert_eq!(p, port);
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[tokio::test]
    async fn silent_server_hits_the_connect_timeout() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let _accept = tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(10)).await;
        });

        let login = PasswordLogin {
            host: "127.0.0.1".into(),
            port,
            username: "nobody".into(),
            password: "x".into(),
        };
        let err = ShellSession::open_with_password(
            &login,
            PtySize { cols: 80, rows: 24 },
            Arc::new(|_| true),
            Duration::from_millis(200),
        )
        .await
        .err()
        .expect("connection must time out");

        assert!(matches!(err, CoreError::Timeout(d) if d == Duration::from_millis(200)));
    }
}

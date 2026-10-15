use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Handle, Handler};
use russh::keys::agent::AgentIdentity;
use russh::keys::{PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, ChannelWriteHalf, Disconnect};
use tokio::sync::mpsc;

use super::host_key::{HostKeyInfo, HostKeyVerifier};
use super::keys::load_private_key;
use super::proxy_command::{expand_proxy_command, spawn_proxy};
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

/// How to prove the user's identity to the server.
#[derive(Clone)]
pub enum LoginMethod {
    Password(String),
    PrivateKey {
        pem: String,
        passphrase: Option<String>,
    },
    /// Keys held by a running ssh-agent; `socket` overrides `SSH_AUTH_SOCK` (Unix only).
    Agent {
        socket: Option<std::path::PathBuf>,
    },
}

impl std::fmt::Debug for LoginMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoginMethod::Password(_) => f.write_str("Password([REDACTED])"),
            LoginMethod::PrivateKey { passphrase, .. } => f
                .debug_struct("PrivateKey")
                .field("pem", &"[REDACTED]")
                .field("passphrase", &passphrase.as_ref().map(|_| "[REDACTED]"))
                .finish(),
            LoginMethod::Agent { socket } => {
                f.debug_struct("Agent").field("socket", socket).finish()
            }
        }
    }
}

#[derive(Clone)]
pub struct SshLogin {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub method: LoginMethod,
    /// Seconds between keepalives; `None` means 30, `Some(0)` disables them.
    pub keepalive_secs: Option<u32>,
    /// OpenSSH `ProxyCommand` template (`%h`, `%p`, `%r`): the SSH stream runs over the
    /// command's stdin/stdout instead of a TCP connection. Ignored behind a jump host.
    pub proxy_command: Option<String>,
}

/// The proxy command may carry tokens (e.g. a Cloudflare service token), so only its presence
/// is printed.
impl std::fmt::Debug for SshLogin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SshLogin")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("method", &self.method)
            .field("keepalive_secs", &self.keepalive_secs)
            .field(
                "proxy_command",
                &self.proxy_command.as_ref().map(|_| "[set]"),
            )
            .finish()
    }
}

impl From<&PasswordLogin> for SshLogin {
    fn from(login: &PasswordLogin) -> Self {
        Self {
            host: login.host.clone(),
            port: login.port,
            username: login.username.clone(),
            method: LoginMethod::Password(login.password.clone()),
            keepalive_secs: None,
            proxy_command: None,
        }
    }
}

/// How a connection reaches its server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectRoute {
    Direct,
    /// Through an SSH jump host, named by its address.
    Jump(String),
    ProxyCommand,
}

/// Milestones of connecting, for a step-by-step display. The jump hop reports its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectStep {
    Started {
        host: String,
        port: u16,
        route: ConnectRoute,
    },
    /// A network path to the SSH server exists (TCP, tunnel or proxy command).
    Reached {
        host: String,
    },
    ServerIdentity {
        host: String,
        algorithm: String,
        fingerprint: String,
    },
    Authenticating {
        host: String,
        user: String,
        method: &'static str,
    },
    Authenticated {
        host: String,
        user: String,
    },
}

pub type ConnectObserver = Arc<dyn Fn(ConnectStep) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellEvent {
    Output(Vec<u8>),
    Closed { exit_status: Option<u32> },
}

pub(crate) struct ClientHandler {
    verify_host_key: HostKeyVerifier,
    remote_forwards: crate::forward::RemoteForwardRouter,
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

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        connected_port: u32,
        originator_address: &str,
        originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> std::result::Result<(), Self::Error> {
        // Dropping `reply` rejects connections for ports nobody asked to forward.
        if let Some(route) = self.remote_forwards.route(connected_port) {
            reply.accept().await;
            route.deliver(channel, format!("{originator_address}:{originator_port}"));
        }
        Ok(())
    }
}

/// An interactive shell on a remote host, backed by one SSH connection and PTY channel.
/// An authenticated SSH connection, possibly through a jump host. Shells, SFTP and port
/// forwards are opened on top of it.
pub struct SshConnection {
    handle: Handle<ClientHandler>,
    remote_forwards: crate::forward::RemoteForwardRouter,
    /// Kept alive while the connection tunnels through it.
    jump: Option<Handle<ClientHandler>>,
}

impl SshConnection {
    /// Connects (through `jump` when given) and authenticates.
    /// Failures on the jump hop are wrapped in [`CoreError::JumpHost`].
    pub async fn open(
        jump: Option<JumpHop<'_>>,
        login: &SshLogin,
        verify_host_key: HostKeyVerifier,
        connect_timeout: Duration,
    ) -> Result<Self> {
        Self::open_observed(jump, login, verify_host_key, connect_timeout, None).await
    }

    /// Like [`open`](Self::open), reporting each milestone to `observer`.
    pub async fn open_observed(
        jump: Option<JumpHop<'_>>,
        login: &SshLogin,
        verify_host_key: HostKeyVerifier,
        connect_timeout: Duration,
        observer: Option<ConnectObserver>,
    ) -> Result<Self> {
        let jump_name = jump.as_ref().map(|hop| hop.login.host.clone());
        let jump = match jump {
            Some(hop) => Some(
                establish(
                    hop.login,
                    hop.verify_host_key,
                    connect_timeout,
                    None,
                    Default::default(),
                    observer.clone(),
                    None,
                )
                .await
                .map_err(|e| CoreError::JumpHost(Box::new(e)))?,
            ),
            None => None,
        };
        let remote_forwards = crate::forward::RemoteForwardRouter::default();
        let handle = establish(
            login,
            verify_host_key,
            connect_timeout,
            jump.as_ref(),
            remote_forwards.clone(),
            observer,
            jump_name,
        )
        .await?;
        Ok(Self {
            handle,
            remote_forwards,
            jump,
        })
    }

    pub(crate) fn handle(&self) -> &Handle<ClientHandler> {
        &self.handle
    }

    /// True once the server or the network ended the connection.
    pub fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }

    pub(crate) fn remote_forwards(&self) -> &crate::forward::RemoteForwardRouter {
        &self.remote_forwards
    }

    pub async fn disconnect(&self) -> Result<()> {
        self.handle
            .disconnect(Disconnect::ByApplication, "", "en")
            .await?;
        if let Some(jump) = &self.jump {
            let _ = jump.disconnect(Disconnect::ByApplication, "", "en").await;
        }
        Ok(())
    }
}

pub struct ShellSession {
    connection: SshConnection,
    channel: ChannelWriteHalf<client::Msg>,
}

/// The intermediate server a session reaches its target through (OpenSSH `ProxyJump`).
pub struct JumpHop<'a> {
    pub login: &'a SshLogin,
    pub verify_host_key: HostKeyVerifier,
}

fn keepalive_interval(secs: Option<u32>) -> Option<Duration> {
    match secs {
        None => Some(Duration::from_secs(30)),
        Some(0) => None,
        Some(n) => Some(Duration::from_secs(u64::from(n))),
    }
}

/// Connects (directly or through an open jump connection) and authenticates.
#[allow(clippy::too_many_arguments)]
async fn establish(
    login: &SshLogin,
    verify_host_key: HostKeyVerifier,
    connect_timeout: Duration,
    through: Option<&Handle<ClientHandler>>,
    remote_forwards: crate::forward::RemoteForwardRouter,
    observer: Option<ConnectObserver>,
    jump_name: Option<String>,
) -> Result<Handle<ClientHandler>> {
    let report = |step: ConnectStep| {
        if let Some(observe) = &observer {
            observe(step);
        }
    };
    let route = match (&jump_name, &login.proxy_command) {
        (Some(jump), _) if through.is_some() => ConnectRoute::Jump(jump.clone()),
        (_, Some(_)) if through.is_none() => ConnectRoute::ProxyCommand,
        _ => ConnectRoute::Direct,
    };
    report(ConnectStep::Started {
        host: login.host.clone(),
        port: login.port,
        route,
    });
    // The host key check is the moment the server's identity is known.
    let verify_host_key: HostKeyVerifier = match &observer {
        Some(observe) => {
            let observe = observe.clone();
            let host = login.host.clone();
            Arc::new(move |info: &HostKeyInfo| {
                observe(ConnectStep::ServerIdentity {
                    host: host.clone(),
                    algorithm: info.algorithm.clone(),
                    fingerprint: info.fingerprint.clone(),
                });
                verify_host_key(info)
            })
        }
        None => verify_host_key,
    };
    // Fail on a bad key or passphrase before touching the network.
    let private_key = match &login.method {
        LoginMethod::PrivateKey { pem, passphrase } => {
            Some(load_private_key(pem, passphrase.as_deref())?)
        }
        _ => None,
    };
    let config = Arc::new(client::Config {
        keepalive_interval: keepalive_interval(login.keepalive_secs),
        // Three unanswered keepalives mean the network is gone: the session closes as lost.
        keepalive_max: 3,
        ..Default::default()
    });
    let handler = ClientHandler {
        verify_host_key,
        remote_forwards,
    };
    let unreachable = |reason: String| CoreError::Unreachable {
        host: login.host.clone(),
        port: login.port,
        reason,
    };
    let map_connect_error = |err: russh::Error| match err {
        russh::Error::UnknownKey => CoreError::HostKeyRejected,
        russh::Error::IO(io) => unreachable(io.to_string()),
        other => CoreError::Ssh(other.to_string()),
    };

    let connecting = async {
        match (through, login.proxy_command.as_deref()) {
            (None, Some(template)) => {
                let command =
                    expand_proxy_command(template, &login.host, login.port, &login.username);
                let (stream, stderr) = spawn_proxy(&command)?;
                report(ConnectStep::Reached {
                    host: login.host.clone(),
                });
                client::connect_stream(config, stream, handler)
                    .await
                    .map_err(|err| match err {
                        // The command exited or never spoke SSH: its stderr says why.
                        russh::Error::IO(_) | russh::Error::Disconnect => {
                            let said = stderr.text();
                            unreachable(if said.is_empty() {
                                "the proxy command closed the connection".into()
                            } else {
                                format!("the proxy command failed: {said}")
                            })
                        }
                        other => map_connect_error(other),
                    })
            }
            (None, None) => {
                let tcp = tokio::net::TcpStream::connect((login.host.as_str(), login.port))
                    .await
                    .map_err(|e| unreachable(e.to_string()))?;
                let _ = tcp.set_nodelay(true);
                report(ConnectStep::Reached {
                    host: login.host.clone(),
                });
                client::connect_stream(config, tcp, handler)
                    .await
                    .map_err(map_connect_error)
            }
            (Some(jump), _) => {
                let tunnel = jump
                    .channel_open_direct_tcpip(
                        login.host.clone(),
                        u32::from(login.port),
                        "127.0.0.1",
                        0,
                    )
                    .await
                    .map_err(|e| {
                        unreachable(format!("the jump host could not open a tunnel: {e}"))
                    })?;
                report(ConnectStep::Reached {
                    host: login.host.clone(),
                });
                client::connect_stream(config, tunnel.into_stream(), handler)
                    .await
                    .map_err(map_connect_error)
            }
        }
    };
    let mut connection = tokio::time::timeout(connect_timeout, connecting)
        .await
        .map_err(|_| CoreError::Timeout(connect_timeout))??;

    report(ConnectStep::Authenticating {
        host: login.host.clone(),
        user: login.username.clone(),
        method: match login.method {
            LoginMethod::Password(_) => "password",
            LoginMethod::PrivateKey { .. } => "key",
            LoginMethod::Agent { .. } => "agent",
        },
    });
    if !authenticate(&mut connection, login, private_key).await? {
        return Err(CoreError::AuthenticationFailed);
    }
    report(ConnectStep::Authenticated {
        host: login.host.clone(),
        user: login.username.clone(),
    });
    Ok(connection)
}

impl ShellSession {
    pub async fn open_with_password(
        login: &PasswordLogin,
        size: PtySize,
        verify_host_key: HostKeyVerifier,
        connect_timeout: Duration,
    ) -> Result<(Self, mpsc::Receiver<ShellEvent>)> {
        Self::open(
            &SshLogin::from(login),
            size,
            verify_host_key,
            connect_timeout,
        )
        .await
    }

    pub async fn open(
        login: &SshLogin,
        size: PtySize,
        verify_host_key: HostKeyVerifier,
        connect_timeout: Duration,
    ) -> Result<(Self, mpsc::Receiver<ShellEvent>)> {
        Self::open_through(None, login, size, verify_host_key, connect_timeout).await
    }

    /// Connects (through `jump` when given), authenticates and starts a login shell on a PTY.
    /// Failures on the jump hop are wrapped in [`CoreError::JumpHost`].
    /// Output and the final close arrive on the returned receiver.
    pub async fn open_through(
        jump: Option<JumpHop<'_>>,
        login: &SshLogin,
        size: PtySize,
        verify_host_key: HostKeyVerifier,
        connect_timeout: Duration,
    ) -> Result<(Self, mpsc::Receiver<ShellEvent>)> {
        let connection = SshConnection::open(jump, login, verify_host_key, connect_timeout).await?;
        Self::start(connection, size).await
    }

    /// Starts a login shell on a PTY over an already authenticated connection.
    pub async fn start(
        connection: SshConnection,
        size: PtySize,
    ) -> Result<(Self, mpsc::Receiver<ShellEvent>)> {
        let channel = connection.handle().channel_open_session().await?;
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
        self.connection.disconnect().await
    }
}

async fn authenticate(
    connection: &mut Handle<ClientHandler>,
    login: &SshLogin,
    private_key: Option<PrivateKey>,
) -> Result<bool> {
    let user = login.username.clone();
    match (&login.method, private_key) {
        (LoginMethod::Password(password), _) => Ok(connection
            .authenticate_password(user, password.clone())
            .await?
            .success()),
        (LoginMethod::PrivateKey { .. }, Some(key)) => {
            let hash = connection.best_supported_rsa_hash().await?.flatten();
            Ok(connection
                .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await?
                .success())
        }
        (LoginMethod::PrivateKey { .. }, None) => {
            Err(CoreError::InvalidData("private key was not loaded".into()))
        }
        (LoginMethod::Agent { socket }, _) => {
            authenticate_with_agent(connection, user, socket.as_deref()).await
        }
    }
}

/// Offers each agent key in turn; the first one the server accepts wins.
#[cfg(unix)]
async fn authenticate_with_agent(
    connection: &mut Handle<ClientHandler>,
    user: String,
    socket: Option<&std::path::Path>,
) -> Result<bool> {
    use russh::keys::agent::client::AgentClient;

    let mut agent = match socket {
        Some(path) => AgentClient::connect_uds(path).await,
        None => AgentClient::connect_env().await,
    }
    .map_err(|e| CoreError::AgentUnavailable(e.to_string()))?;
    try_agent_keys(connection, user, &mut agent).await
}

#[cfg(windows)]
async fn authenticate_with_agent(
    connection: &mut Handle<ClientHandler>,
    user: String,
    _socket: Option<&std::path::Path>,
) -> Result<bool> {
    use russh::keys::agent::client::AgentClient;

    let mut agent = AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent")
        .await
        .map_err(|e| CoreError::AgentUnavailable(e.to_string()))?;
    try_agent_keys(connection, user, &mut agent).await
}

async fn try_agent_keys<S>(
    connection: &mut Handle<ClientHandler>,
    user: String,
    agent: &mut russh::keys::agent::client::AgentClient<S>,
) -> Result<bool>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| CoreError::AgentUnavailable(e.to_string()))?;
    if identities.is_empty() {
        return Err(CoreError::AgentUnavailable(
            "the agent holds no keys".into(),
        ));
    }
    let hash = connection.best_supported_rsa_hash().await?.flatten();
    for identity in identities {
        let AgentIdentity::PublicKey { key, .. } = identity else {
            continue;
        };
        let accepted = connection
            .authenticate_publickey_with(user.clone(), key, hash, agent)
            .await
            .map_err(|e| CoreError::Ssh(e.to_string()))?
            .success();
        if accepted {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keepalive_defaults_to_30s_and_zero_disables_it() {
        assert_eq!(keepalive_interval(None), Some(Duration::from_secs(30)));
        assert_eq!(keepalive_interval(Some(0)), None);
        assert_eq!(keepalive_interval(Some(15)), Some(Duration::from_secs(15)));
    }

    #[test]
    fn login_method_debug_hides_secrets() {
        let password = format!("{:?}", LoginMethod::Password("hunter2".into()));
        let key = format!(
            "{:?}",
            LoginMethod::PrivateKey {
                pem: "-----BEGIN OPENSSH PRIVATE KEY-----".into(),
                passphrase: Some("pp".into())
            }
        );
        assert!(!password.contains("hunter2"));
        assert!(!key.contains("BEGIN") && !key.contains("\"pp\""));
    }

    #[tokio::test]
    async fn a_wrong_passphrase_fails_before_any_network_access() {
        let login = SshLogin {
            keepalive_secs: None,
            proxy_command: None,
            host: "203.0.113.1".into(),
            port: 22,
            username: "x".into(),
            method: LoginMethod::PrivateKey {
                pem: super::super::keys::fixtures::ED25519_ENCRYPTED.into(),
                passphrase: Some("nope".into()),
            },
        };
        let started = std::time::Instant::now();
        let result = ShellSession::open(
            &login,
            PtySize { cols: 80, rows: 24 },
            Arc::new(|_| true),
            Duration::from_secs(10),
        )
        .await;
        assert!(matches!(result.err(), Some(CoreError::WrongPassphrase)));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn an_unreachable_agent_socket_is_reported() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let login = SshLogin {
            keepalive_secs: None,
            proxy_command: None,
            host: "127.0.0.1".into(),
            port,
            username: "x".into(),
            method: LoginMethod::Agent {
                socket: Some("/nonexistent/agent.sock".into()),
            },
        };
        // The port is closed, so this fails at connect; agent errors are covered by integration tests.
        let result = ShellSession::open(
            &login,
            PtySize { cols: 80, rows: 24 },
            Arc::new(|_| true),
            Duration::from_secs(5),
        )
        .await;
        assert!(matches!(result.err(), Some(CoreError::Unreachable { .. })));
    }

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

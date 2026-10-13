//! Needs `docker compose -f docker/test-ssh.yml up -d` and OpenSSH's ssh-agent/ssh-add.
#![cfg(feature = "integration")]

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Arc;
use std::time::Duration;

use termirust_core::CoreError;
use termirust_core::ssh::{LoginMethod, PtySize, ShellEvent, ShellSession, SshLogin};

const SIZE: PtySize = PtySize { cols: 80, rows: 24 };
const TIMEOUT: Duration = Duration::from_secs(10);

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/keys")
        .join(name)
}

fn login(method: LoginMethod) -> SshLogin {
    SshLogin {
        keepalive_secs: None,
        host: "127.0.0.1".into(),
        port: std::env::var("TERMIRUST_TEST_SSH_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(2222),
        username: "termirust".into(),
        method,
    }
}

fn key(name: &str, passphrase: Option<&str>) -> LoginMethod {
    LoginMethod::PrivateKey {
        pem: std::fs::read_to_string(fixture(name)).unwrap(),
        passphrase: passphrase.map(Into::into),
    }
}

async fn assert_shell_works(method: LoginMethod) {
    let (session, mut events) =
        ShellSession::open(&login(method), SIZE, Arc::new(|_| true), TIMEOUT)
            .await
            .expect("login succeeds");
    session.write(b"echo key-$((6*7))\n").await.unwrap();
    let mut seen = String::new();
    tokio::time::timeout(TIMEOUT, async {
        while let Some(ShellEvent::Output(bytes)) = events.recv().await {
            seen.push_str(&String::from_utf8_lossy(&bytes));
            if seen.contains("key-42") {
                return;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("no echo; got {seen:?}"));
    session.close().await.unwrap();
}

#[tokio::test]
async fn logs_in_with_each_supported_key_type() {
    for name in ["ed25519", "rsa_pem", "ecdsa"] {
        assert_shell_works(key(name, None)).await;
    }
}

#[tokio::test]
async fn logs_in_with_an_encrypted_key_and_its_passphrase() {
    assert_shell_works(key("ed25519_encrypted", Some("test-passphrase"))).await;
}

#[tokio::test]
async fn an_encrypted_key_without_passphrase_is_reported() {
    let result = ShellSession::open(
        &login(key("ed25519_encrypted", None)),
        SIZE,
        Arc::new(|_| true),
        TIMEOUT,
    )
    .await;
    assert!(matches!(result.err(), Some(CoreError::PassphraseRequired)));
}

#[tokio::test]
async fn a_key_the_server_does_not_know_is_rejected() {
    let unknown = termirust_core::ssh::generate_ed25519("stranger").unwrap();
    let method = LoginMethod::PrivateKey {
        pem: unknown.private_key,
        passphrase: None,
    };
    let result = ShellSession::open(&login(method), SIZE, Arc::new(|_| true), TIMEOUT).await;
    assert!(matches!(
        result.err(),
        Some(CoreError::AuthenticationFailed)
    ));
}

/// A private ssh-agent on a temporary socket, killed on drop.
struct TestAgent {
    _dir: tempfile::TempDir,
    socket: PathBuf,
    process: Child,
}

impl TestAgent {
    fn start(keys: &[&str]) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("agent.sock");
        let process = Command::new("ssh-agent")
            .arg("-D")
            .arg("-a")
            .arg(&socket)
            .spawn()
            .expect("ssh-agent is installed");
        for _ in 0..50 {
            if socket.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        for name in keys {
            let status = Command::new("ssh-add")
                .arg(fixture(name))
                .env("SSH_AUTH_SOCK", &socket)
                .output()
                .unwrap();
            assert!(
                status.status.success(),
                "ssh-add failed: {}",
                String::from_utf8_lossy(&status.stderr)
            );
        }
        Self {
            _dir: dir,
            socket,
            process,
        }
    }
}

impl Drop for TestAgent {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}

#[tokio::test]
async fn logs_in_with_a_key_held_by_ssh_agent() {
    let agent = TestAgent::start(&["ed25519"]);
    assert_shell_works(LoginMethod::Agent {
        socket: Some(agent.socket.clone()),
    })
    .await;
}

#[tokio::test]
async fn tries_agent_keys_until_the_server_accepts_one() {
    let dir = tempfile::tempdir().unwrap();
    let stranger = termirust_core::ssh::generate_ed25519("stranger").unwrap();
    let stranger_path = dir.path().join("stranger");
    std::fs::write(&stranger_path, &stranger.private_key).unwrap();
    // ssh-add refuses private keys readable by others.
    #[cfg(unix)]
    std::fs::set_permissions(
        &stranger_path,
        std::os::unix::fs::PermissionsExt::from_mode(0o600),
    )
    .unwrap();

    let agent = TestAgent::start(&[]);
    for path in [stranger_path.as_path(), fixture("ecdsa").as_path()] {
        let out = Command::new("ssh-add")
            .arg(path)
            .env("SSH_AUTH_SOCK", &agent.socket)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    assert_shell_works(LoginMethod::Agent {
        socket: Some(agent.socket.clone()),
    })
    .await;
}

#[tokio::test]
async fn an_empty_agent_is_reported_as_unavailable() {
    let agent = TestAgent::start(&[]);
    let result = ShellSession::open(
        &login(LoginMethod::Agent {
            socket: Some(agent.socket.clone()),
        }),
        SIZE,
        Arc::new(|_| true),
        TIMEOUT,
    )
    .await;
    assert!(matches!(result.err(), Some(CoreError::AgentUnavailable(m)) if m.contains("no keys")));
}

#[tokio::test]
async fn a_missing_agent_socket_is_reported_as_unavailable() {
    let method = LoginMethod::Agent {
        socket: Some("/nonexistent/termirust-agent.sock".into()),
    };
    let result = ShellSession::open(&login(method), SIZE, Arc::new(|_| true), TIMEOUT).await;
    assert!(matches!(result.err(), Some(CoreError::AgentUnavailable(_))));
}

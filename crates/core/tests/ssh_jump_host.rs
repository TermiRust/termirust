//! Needs `docker compose -f docker/test-ssh.yml up -d`: `ssh-target` is reachable only through
//! `ssh-password` (published on 127.0.0.1:2222), like a server on a private network.
#![cfg(feature = "integration")]

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use termirust_core::CoreError;
use termirust_core::ssh::{
    HostKeyInfo, JumpHop, LoginMethod, PtySize, ShellEvent, ShellSession, SshLogin,
};

const SIZE: PtySize = PtySize { cols: 80, rows: 24 };
const TIMEOUT: Duration = Duration::from_secs(10);

fn jump_login(method: LoginMethod) -> SshLogin {
    SshLogin {
        host: "127.0.0.1".into(),
        port: 2222,
        username: "termirust".into(),
        method,
    }
}

fn jump_key() -> LoginMethod {
    let pem = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/keys/ed25519"),
    )
    .unwrap();
    LoginMethod::PrivateKey {
        pem,
        passphrase: None,
    }
}

fn target(host: &str) -> SshLogin {
    SshLogin {
        host: host.into(),
        port: 2222,
        username: "target".into(),
        method: LoginMethod::Password("target-test".into()),
    }
}

fn accept_all() -> Arc<dyn Fn(&HostKeyInfo) -> bool + Send + Sync> {
    Arc::new(|_| true)
}

#[tokio::test]
async fn reaches_a_private_server_through_the_jump_host() {
    let jump = jump_login(jump_key());
    let (session, mut events) = ShellSession::open_through(
        Some(JumpHop {
            login: &jump,
            verify_host_key: accept_all(),
        }),
        &target("ssh-target"),
        SIZE,
        accept_all(),
        TIMEOUT,
    )
    .await
    .expect("connects through the jump host");

    session.write(b"echo \"on-$(hostname)\"\n").await.unwrap();
    let mut seen = String::new();
    tokio::time::timeout(TIMEOUT, async {
        while let Some(ShellEvent::Output(bytes)) = events.recv().await {
            seen.push_str(&String::from_utf8_lossy(&bytes));
            if seen.contains("on-ssh-target") {
                return;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("did not land on ssh-target; got {seen:?}"));
    session.close().await.unwrap();
}

#[tokio::test]
async fn each_hop_verifies_its_own_host_key() {
    let seen: Arc<Mutex<Vec<String>>> = Arc::default();
    let record = |label: &'static str| {
        let seen = seen.clone();
        Arc::new(move |key: &HostKeyInfo| {
            seen.lock()
                .unwrap()
                .push(format!("{label}:{}", key.fingerprint));
            true
        }) as Arc<dyn Fn(&HostKeyInfo) -> bool + Send + Sync>
    };
    let jump = jump_login(jump_key());
    let (session, _events) = ShellSession::open_through(
        Some(JumpHop {
            login: &jump,
            verify_host_key: record("jump"),
        }),
        &target("ssh-target"),
        SIZE,
        record("target"),
        TIMEOUT,
    )
    .await
    .unwrap();
    session.close().await.unwrap();

    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert!(seen[0].starts_with("jump:SHA256:") && seen[1].starts_with("target:SHA256:"));
    assert_ne!(
        seen[0]["jump:".len()..],
        seen[1]["target:".len()..],
        "two different servers"
    );
}

#[tokio::test]
async fn jump_host_failures_are_reported_as_jump_host_errors() {
    let wrong_password = jump_login(LoginMethod::Password("wrong".into()));
    let result = ShellSession::open_through(
        Some(JumpHop {
            login: &wrong_password,
            verify_host_key: accept_all(),
        }),
        &target("ssh-target"),
        SIZE,
        accept_all(),
        TIMEOUT,
    )
    .await;
    assert!(
        matches!(result.err(), Some(CoreError::JumpHost(inner)) if matches!(*inner, CoreError::AuthenticationFailed))
    );

    let jump = jump_login(jump_key());
    let result = ShellSession::open_through(
        Some(JumpHop {
            login: &jump,
            verify_host_key: Arc::new(|_| false),
        }),
        &target("ssh-target"),
        SIZE,
        accept_all(),
        TIMEOUT,
    )
    .await;
    assert!(
        matches!(result.err(), Some(CoreError::JumpHost(inner)) if matches!(*inner, CoreError::HostKeyRejected))
    );
}

#[tokio::test]
async fn target_failures_are_not_blamed_on_the_jump_host() {
    let jump = jump_login(jump_key());
    let result = ShellSession::open_through(
        Some(JumpHop {
            login: &jump,
            verify_host_key: accept_all(),
        }),
        &target("no-such-host.invalid"),
        SIZE,
        accept_all(),
        TIMEOUT,
    )
    .await;
    assert!(
        matches!(result.err(), Some(CoreError::Unreachable { host, .. }) if host == "no-such-host.invalid")
    );

    let rejected = ShellSession::open_through(
        Some(JumpHop {
            login: &jump,
            verify_host_key: accept_all(),
        }),
        &target("ssh-target"),
        SIZE,
        Arc::new(|_| false),
        TIMEOUT,
    )
    .await;
    assert!(matches!(rejected.err(), Some(CoreError::HostKeyRejected)));
}

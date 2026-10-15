//! Needs `docker compose -f docker/test-ssh.yml up -d`. Pauses the `ssh-target` container to
//! simulate a server vanishing from the network, so it lives in its own test binary.
#![cfg(feature = "integration")]

use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use termirust_core::ssh::{JumpHop, LoginMethod, PtySize, ShellEvent, ShellSession, SshLogin};

const CONTAINER: &str = "termirust-test-ssh-ssh-target-1";

struct Unpause;
impl Drop for Unpause {
    fn drop(&mut self) {
        let _ = Command::new("docker").args(["unpause", CONTAINER]).output();
    }
}

#[tokio::test]
async fn a_silent_server_is_reported_as_lost_after_missed_keepalives() {
    let pem = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/keys/ed25519"),
    )
    .unwrap();
    let jump = SshLogin {
        host: "127.0.0.1".into(),
        port: 2222,
        username: "termirust".into(),
        method: LoginMethod::PrivateKey {
            pem,
            passphrase: None,
        },
        keepalive_secs: Some(1),
        proxy_command: None,
    };
    let target = SshLogin {
        host: "ssh-target".into(),
        port: 2222,
        username: "target".into(),
        method: LoginMethod::Password("target-test".into()),
        keepalive_secs: Some(1),
        proxy_command: None,
    };
    let (_session, mut events) = ShellSession::open_through(
        Some(JumpHop {
            login: &jump,
            verify_host_key: Arc::new(|_| true),
        }),
        &target,
        PtySize { cols: 80, rows: 24 },
        Arc::new(|_| true),
        Duration::from_secs(10),
    )
    .await
    .expect("connects");

    let _guard = Unpause;
    let paused = Command::new("docker")
        .args(["pause", CONTAINER])
        .output()
        .unwrap();
    assert!(
        paused.status.success(),
        "{}",
        String::from_utf8_lossy(&paused.stderr)
    );
    let started = Instant::now();

    let closed = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match events.recv().await {
                Some(ShellEvent::Closed { exit_status }) => return Some(exit_status),
                Some(ShellEvent::Output(_)) => continue,
                None => return None,
            }
        }
    })
    .await
    .expect("the dead link is detected within 20s");

    assert_eq!(closed, Some(None), "a lost connection has no exit status");
    assert!(
        started.elapsed() < Duration::from_secs(15),
        "took {:?}",
        started.elapsed()
    );
}

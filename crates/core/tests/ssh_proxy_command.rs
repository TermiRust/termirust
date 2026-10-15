//! Needs `docker compose -f docker/test-ssh.yml up -d` and `nc` on PATH.
#![cfg(all(feature = "integration", unix))]

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use termirust_core::CoreError;
use termirust_core::ssh::{LoginMethod, SshConnection, SshLogin};

const TIMEOUT: Duration = Duration::from_secs(10);

/// The host name is deliberately unresolvable: only the proxy command knows where to go.
fn login(proxy_command: &str) -> SshLogin {
    let pem = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/keys/ed25519"),
    )
    .unwrap();
    SshLogin {
        host: "behind-the-tunnel.invalid".into(),
        port: 2222,
        username: "termirust".into(),
        method: LoginMethod::PrivateKey {
            pem,
            passphrase: None,
        },
        keepalive_secs: None,
        proxy_command: Some(proxy_command.into()),
    }
}

#[tokio::test]
async fn connects_through_a_proxy_command() {
    let connection =
        SshConnection::open(None, &login("nc 127.0.0.1 %p"), Arc::new(|_| true), TIMEOUT)
            .await
            .unwrap();
    let out = connection
        .exec_capture("echo via-proxy; whoami", TIMEOUT)
        .await
        .unwrap();
    assert_eq!(out, "via-proxy\ntermirust\n");
    connection.disconnect().await.unwrap();
}

#[tokio::test]
async fn explains_a_failing_proxy_command_with_its_own_message() {
    let err = SshConnection::open(
        None,
        &login("echo 'failed to connect to origin: %h' >&2; exit 1"),
        Arc::new(|_| true),
        TIMEOUT,
    )
    .await
    .err()
    .unwrap();
    match err {
        CoreError::Unreachable { reason, .. } => {
            assert!(
                reason.contains("failed to connect to origin: behind-the-tunnel.invalid"),
                "{reason}"
            );
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

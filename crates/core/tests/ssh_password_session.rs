//! Needs `docker compose -f docker/test-ssh.yml up -d`.
#![cfg(feature = "integration")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use termirust_core::CoreError;
use termirust_core::ssh::{HostKeyInfo, PasswordLogin, PtySize, ShellEvent, ShellSession};
use tokio::sync::mpsc::Receiver;

fn test_login(password: &str) -> PasswordLogin {
    PasswordLogin {
        host: "127.0.0.1".into(),
        port: std::env::var("TERMIRUST_TEST_SSH_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(2222),
        username: "termirust".into(),
        password: password.into(),
    }
}

const SIZE: PtySize = PtySize {
    cols: 100,
    rows: 30,
};
const TIMEOUT: Duration = Duration::from_secs(10);

async fn read_until(events: &mut Receiver<ShellEvent>, needle: &str) -> String {
    let mut seen = Vec::new();
    let deadline = tokio::time::Instant::now() + TIMEOUT;
    loop {
        let event = tokio::time::timeout_at(deadline, events.recv())
            .await
            .unwrap_or_else(|_| {
                panic!(
                    "timed out waiting for {needle:?}; got {:?}",
                    String::from_utf8_lossy(&seen)
                )
            });
        match event {
            Some(ShellEvent::Output(bytes)) => {
                seen.extend_from_slice(&bytes);
                let text = String::from_utf8_lossy(&seen).into_owned();
                if text.contains(needle) {
                    return text;
                }
            }
            other => panic!("session ended before {needle:?}: {other:?}"),
        }
    }
}

#[tokio::test]
async fn runs_commands_in_an_interactive_shell() {
    let (session, mut events) = ShellSession::open_with_password(
        &test_login("termirust-test"),
        SIZE,
        Arc::new(|_| true),
        TIMEOUT,
    )
    .await
    .expect("login with the right password succeeds");

    session.write(b"echo termirust-$((40+2))\n").await.unwrap();
    read_until(&mut events, "termirust-42").await;

    session.close().await.unwrap();
}

#[tokio::test]
async fn resize_reaches_the_remote_pty() {
    let (session, mut events) = ShellSession::open_with_password(
        &test_login("termirust-test"),
        SIZE,
        Arc::new(|_| true),
        TIMEOUT,
    )
    .await
    .unwrap();

    session.write(b"stty size\n").await.unwrap();
    read_until(&mut events, "30 100").await;

    session
        .resize(PtySize {
            cols: 132,
            rows: 43,
        })
        .await
        .unwrap();
    session.write(b"stty size\n").await.unwrap();
    read_until(&mut events, "43 132").await;

    session.close().await.unwrap();
}

#[tokio::test]
async fn exit_reports_the_shell_exit_status() {
    let (session, mut events) = ShellSession::open_with_password(
        &test_login("termirust-test"),
        SIZE,
        Arc::new(|_| true),
        TIMEOUT,
    )
    .await
    .unwrap();

    session.write(b"exit 3\n").await.unwrap();
    let closed = tokio::time::timeout(TIMEOUT, async {
        loop {
            if let Some(ShellEvent::Closed { exit_status }) = events.recv().await {
                return exit_status;
            }
        }
    })
    .await
    .expect("shell closes after exit");
    assert_eq!(closed, Some(3));
}

#[tokio::test]
async fn wrong_password_is_reported_as_authentication_failure() {
    let result =
        ShellSession::open_with_password(&test_login("wrong"), SIZE, Arc::new(|_| true), TIMEOUT)
            .await;
    assert!(matches!(result, Err(CoreError::AuthenticationFailed)));
}

#[tokio::test]
async fn host_key_is_offered_to_the_verifier_and_can_be_rejected() {
    let offered: Arc<Mutex<Option<HostKeyInfo>>> = Arc::default();
    let seen = offered.clone();
    let result = ShellSession::open_with_password(
        &test_login("termirust-test"),
        SIZE,
        Arc::new(move |key| {
            *seen.lock().unwrap() = Some(key.clone());
            false
        }),
        TIMEOUT,
    )
    .await;

    assert!(
        matches!(result, Err(CoreError::HostKeyRejected)),
        "got {:?}",
        result.err()
    );
    let key = offered
        .lock()
        .unwrap()
        .clone()
        .expect("verifier was called");
    assert!(key.fingerprint.starts_with("SHA256:"));
}

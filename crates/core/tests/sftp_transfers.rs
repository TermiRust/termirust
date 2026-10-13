//! Needs `docker compose -f docker/test-ssh.yml up -d`.
#![cfg(feature = "integration")]

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use termirust_core::CoreError;
use termirust_core::sftp::{CancelFlag, EntryKind, SftpClient, join_remote};
use termirust_core::ssh::{JumpHop, LoginMethod, SshConnection, SshLogin};

const TIMEOUT: Duration = Duration::from_secs(10);

fn key_login() -> SshLogin {
    let pem = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/keys/ed25519"),
    )
    .unwrap();
    SshLogin {
        host: "127.0.0.1".into(),
        port: 2222,
        username: "termirust".into(),
        method: LoginMethod::PrivateKey {
            pem,
            passphrase: None,
        },
        keepalive_secs: None,
    }
}

async fn client() -> SftpClient {
    let connection = SshConnection::open(None, &key_login(), Arc::new(|_| true), TIMEOUT)
        .await
        .unwrap();
    SftpClient::start(connection).await.unwrap()
}

fn random_bytes(len: usize) -> Vec<u8> {
    let mut data = vec![0u8; len];
    let mut seed = 0x9E37_79B9_7F4A_7C15u64;
    for b in &mut data {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        *b = seed as u8;
    }
    data
}

/// A remote scratch directory unique to one test, removed afterwards.
async fn scratch(sftp: &SftpClient, name: &str) -> String {
    let dir = join_remote(
        &sftp.home().await.unwrap(),
        &format!("termirust-test-{name}-{}", std::process::id()),
    );
    let _ = sftp.remove(&dir).await;
    sftp.create_dir(&dir).await.unwrap();
    dir
}

#[tokio::test]
async fn uploads_and_downloads_a_file_byte_for_byte() {
    let sftp = client().await;
    let dir = scratch(&sftp, "roundtrip").await;
    let local = tempfile::tempdir().unwrap();
    let data = random_bytes(5 * 1024 * 1024 + 123);
    std::fs::write(local.path().join("up.bin"), &data).unwrap();

    let remote = join_remote(&dir, "up.bin");
    let mut last = (0, 0);
    let sent = sftp
        .upload(
            &local.path().join("up.bin"),
            &remote,
            &CancelFlag::default(),
            |d, t| last = (d, t),
        )
        .await
        .unwrap();
    assert_eq!(sent, data.len() as u64);
    assert_eq!(last, (data.len() as u64, data.len() as u64));

    let listing = sftp.list(&dir).await.unwrap();
    assert_eq!(listing.len(), 1);
    assert_eq!(
        (listing[0].name.as_str(), listing[0].kind, listing[0].size),
        ("up.bin", EntryKind::File, data.len() as u64)
    );
    assert!(listing[0].modified.is_some());

    let back = local.path().join("down.bin");
    sftp.download(&remote, &back, &CancelFlag::default(), |_, _| {})
        .await
        .unwrap();
    assert!(
        std::fs::read(&back).unwrap() == data,
        "downloaded bytes differ"
    );

    sftp.remove(&dir).await.unwrap();
    sftp.close().await.unwrap();
}

#[tokio::test]
async fn manages_directories_renames_and_recursive_deletes() {
    let sftp = client().await;
    let dir = scratch(&sftp, "manage").await;
    let nested = join_remote(&dir, "a");
    sftp.create_dir(&nested).await.unwrap();
    sftp.create_dir(&join_remote(&nested, "b")).await.unwrap();
    let local = tempfile::tempdir().unwrap();
    std::fs::write(local.path().join("f.txt"), b"hello").unwrap();
    sftp.upload(
        &local.path().join("f.txt"),
        &join_remote(&nested, "f.txt"),
        &CancelFlag::default(),
        |_, _| {},
    )
    .await
    .unwrap();

    let names: Vec<_> = sftp
        .list(&nested)
        .await
        .unwrap()
        .into_iter()
        .map(|e| (e.name, e.kind))
        .collect();
    assert_eq!(
        names,
        [
            ("b".to_string(), EntryKind::Directory),
            ("f.txt".to_string(), EntryKind::File)
        ]
    );

    let renamed = join_remote(&dir, "renamed");
    sftp.rename(&nested, &renamed).await.unwrap();
    assert_eq!(sftp.kind(&renamed).await.unwrap(), EntryKind::Directory);
    assert!(sftp.kind(&nested).await.is_err());

    sftp.remove(&dir).await.unwrap();
    assert!(sftp.kind(&dir).await.is_err(), "the whole tree is gone");
    sftp.close().await.unwrap();
}

#[tokio::test]
async fn a_cancelled_download_leaves_no_partial_file() {
    let sftp = client().await;
    let dir = scratch(&sftp, "cancel").await;
    let local = tempfile::tempdir().unwrap();
    std::fs::write(local.path().join("big.bin"), random_bytes(4 * 1024 * 1024)).unwrap();
    let remote = join_remote(&dir, "big.bin");
    sftp.upload(
        &local.path().join("big.bin"),
        &remote,
        &CancelFlag::default(),
        |_, _| {},
    )
    .await
    .unwrap();

    let cancel = CancelFlag::default();
    let flag = cancel.clone();
    let target = local.path().join("partial.bin");
    let result = sftp
        .download(&remote, &target, &cancel, |done, _| {
            if done > 512 * 1024 {
                flag.cancel();
            }
        })
        .await;

    assert!(matches!(result, Err(CoreError::Cancelled)));
    assert!(!target.exists(), "partial download must be removed");
    sftp.remove(&dir).await.unwrap();
    sftp.close().await.unwrap();
}

#[tokio::test]
async fn missing_paths_are_reported() {
    let sftp = client().await;
    assert!(matches!(
        sftp.list("/definitely/not/here").await,
        Err(CoreError::Sftp(_))
    ));
    let local = tempfile::tempdir().unwrap();
    let result = sftp
        .download(
            "/definitely/not/here.txt",
            &local.path().join("x"),
            &CancelFlag::default(),
            |_, _| {},
        )
        .await;
    assert!(matches!(result, Err(CoreError::Sftp(_))));
    sftp.close().await.unwrap();
}

#[tokio::test]
async fn works_through_a_jump_host() {
    let jump = key_login();
    let target = SshLogin {
        host: "ssh-target".into(),
        port: 2222,
        username: "target".into(),
        method: LoginMethod::Password("target-test".into()),
        keepalive_secs: None,
    };
    let connection = SshConnection::open(
        Some(JumpHop {
            login: &jump,
            verify_host_key: Arc::new(|_| true),
        }),
        &target,
        Arc::new(|_| true),
        TIMEOUT,
    )
    .await
    .unwrap();
    let sftp = SftpClient::start(connection).await.unwrap();
    assert_eq!(sftp.home().await.unwrap(), "/config");
    sftp.close().await.unwrap();
}

#[tokio::test]
async fn transfers_whole_directories_both_ways_with_overall_progress() {
    let sftp = client().await;
    let dir = scratch(&sftp, "tree").await;
    let local = tempfile::tempdir().unwrap();
    let site = local.path().join("site");
    std::fs::create_dir_all(site.join("css")).unwrap();
    std::fs::write(site.join("index.html"), random_bytes(300_000)).unwrap();
    std::fs::write(site.join("css/app.css"), random_bytes(700_000)).unwrap();

    let remote = join_remote(&dir, "site");
    let mut last = None;
    let sent = sftp
        .upload_tree(&site, &remote, &CancelFlag::default(), |p| {
            last = Some(p.clone())
        })
        .await
        .unwrap();
    let last = last.unwrap();
    assert_eq!(sent, 1_000_000);
    assert_eq!(
        (last.done, last.total, last.files_done, last.files_total),
        (1_000_000, 1_000_000, 2, 2)
    );

    let back = local.path().join("back");
    sftp.download_tree(&remote, &back, &CancelFlag::default(), |_| {})
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(back.join("css/app.css")).unwrap(),
        std::fs::read(site.join("css/app.css")).unwrap()
    );
    assert_eq!(
        std::fs::read(back.join("index.html")).unwrap(),
        std::fs::read(site.join("index.html")).unwrap()
    );

    sftp.remove(&dir).await.unwrap();
    sftp.close().await.unwrap();
}

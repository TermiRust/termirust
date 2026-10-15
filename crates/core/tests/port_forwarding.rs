//! Needs `docker compose -f docker/test-ssh.yml up -d`.
#![cfg(feature = "integration")]

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use termirust_core::CoreError;
use termirust_core::forward::{start_dynamic, start_local, start_remote};
use termirust_core::ssh::{LoginMethod, SshConnection, SshLogin};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const TIMEOUT: Duration = Duration::from_secs(10);

async fn connection() -> Arc<SshConnection> {
    let pem = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/keys/ed25519"),
    )
    .unwrap();
    let login = SshLogin {
        host: "127.0.0.1".into(),
        port: 2222,
        username: "termirust".into(),
        method: LoginMethod::PrivateKey {
            pem,
            passphrase: None,
        },
        keepalive_secs: None,
        proxy_command: None,
    };
    Arc::new(
        SshConnection::open(None, &login, Arc::new(|_| true), TIMEOUT)
            .await
            .unwrap(),
    )
}

/// Reads until the SSH identification line arrives, proving the tunnel reached an sshd.
async fn read_ssh_banner(stream: &mut TcpStream) -> String {
    let mut buf = vec![0u8; 256];
    let n = tokio::time::timeout(TIMEOUT, stream.read(&mut buf))
        .await
        .expect("banner in time")
        .unwrap();
    String::from_utf8_lossy(&buf[..n]).into_owned()
}

#[tokio::test]
async fn local_forward_reaches_a_service_only_visible_inside_the_docker_network() {
    let forward = start_local(connection().await, "127.0.0.1", 0, "ssh-target", 2222)
        .await
        .unwrap();
    assert!(forward.listening_on().starts_with("127.0.0.1:"));

    let mut stream = TcpStream::connect(forward.listening_on()).await.unwrap();
    assert!(
        read_ssh_banner(&mut stream)
            .await
            .starts_with("SSH-2.0-OpenSSH")
    );
    assert_eq!(forward.stats().active, 1);

    drop(stream);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        forward.stats(),
        termirust_core::forward::ForwardStats {
            active: 0,
            total: 1
        }
    );
    forward.stop().await;
}

#[tokio::test]
async fn local_forward_on_a_busy_port_fails_clearly() {
    let taken = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = taken.local_addr().unwrap().port();
    let err = start_local(connection().await, "127.0.0.1", port, "ssh-target", 2222)
        .await
        .err()
        .unwrap();
    assert!(matches!(err, CoreError::PortForward(m) if m.contains("already in use")));
}

#[tokio::test]
async fn stopping_a_forward_closes_its_port() {
    let forward = start_local(connection().await, "127.0.0.1", 0, "ssh-target", 2222)
        .await
        .unwrap();
    let address = forward.listening_on().to_owned();
    forward.stop().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(TcpStream::connect(&address).await.is_err());
}

#[tokio::test]
async fn remote_forward_brings_server_side_connections_back_to_a_local_service() {
    // A local echo service only this machine can reach.
    let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let echo_port = echo.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = echo.accept().await {
            tokio::spawn(async move {
                let mut buf = [0u8; 64];
                while let Ok(n) = socket.read(&mut buf).await {
                    if n == 0 || socket.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
            });
        }
    });

    let ssh = connection().await;
    let remote = start_remote(ssh.clone(), "127.0.0.1", 0, "127.0.0.1", echo_port)
        .await
        .unwrap();
    let remote_port: u16 = remote
        .listening_on()
        .rsplit(':')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    assert_ne!(remote_port, 0, "the server picked a port");

    // Reach the server's listening port from the server itself through a local forward.
    let probe = start_local(ssh, "127.0.0.1", 0, "127.0.0.1", remote_port)
        .await
        .unwrap();
    let mut stream = TcpStream::connect(probe.listening_on()).await.unwrap();
    stream.write_all(b"ping through the server").await.unwrap();
    let mut answer = vec![0u8; 23];
    tokio::time::timeout(TIMEOUT, stream.read_exact(&mut answer))
        .await
        .expect("echo in time")
        .unwrap();
    assert_eq!(answer, b"ping through the server");
    assert_eq!(remote.stats().total, 1);

    drop(stream);
    probe.stop().await;
    remote.stop().await;
}

async fn socks_connect(proxy: &str, request: &[u8]) -> (TcpStream, Vec<u8>) {
    let mut stream = TcpStream::connect(proxy).await.unwrap();
    stream.write_all(&[5, 1, 0]).await.unwrap();
    let mut method = [0u8; 2];
    stream.read_exact(&mut method).await.unwrap();
    assert_eq!(method, [5, 0]);
    stream.write_all(request).await.unwrap();
    let mut reply = vec![0u8; 10];
    tokio::time::timeout(TIMEOUT, stream.read_exact(&mut reply))
        .await
        .expect("reply in time")
        .unwrap();
    (stream, reply)
}

#[tokio::test]
async fn socks5_connects_by_host_name_and_by_ipv4() {
    let proxy = start_dynamic(connection().await, "127.0.0.1", 0)
        .await
        .unwrap();

    let mut by_name = vec![5, 1, 0, 3, 10];
    by_name.extend_from_slice(b"ssh-target");
    by_name.extend_from_slice(&2222u16.to_be_bytes());
    let (mut stream, reply) = socks_connect(proxy.listening_on(), &by_name).await;
    assert_eq!(reply[1], 0, "succeeded");
    assert!(
        read_ssh_banner(&mut stream)
            .await
            .starts_with("SSH-2.0-OpenSSH")
    );

    let mut by_ip = vec![5, 1, 0, 1, 127, 0, 0, 1];
    by_ip.extend_from_slice(&2222u16.to_be_bytes());
    let (mut stream, reply) = socks_connect(proxy.listening_on(), &by_ip).await;
    assert_eq!(reply[1], 0);
    assert!(
        read_ssh_banner(&mut stream)
            .await
            .starts_with("SSH-2.0-OpenSSH")
    );
    assert_eq!(proxy.stats().total, 2);
    proxy.stop().await;
}

#[tokio::test]
async fn socks5_reports_an_unreachable_target() {
    let proxy = start_dynamic(connection().await, "127.0.0.1", 0)
        .await
        .unwrap();
    let mut request = vec![5, 1, 0, 3, 17];
    request.extend_from_slice(b"nowhere.invalid.x");
    request.extend_from_slice(&80u16.to_be_bytes());
    let (_stream, reply) = socks_connect(proxy.listening_on(), &request).await;
    assert_eq!(reply[1], 4, "host unreachable");
    proxy.stop().await;
}

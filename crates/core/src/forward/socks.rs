//! The server side of SOCKS5 CONNECT without authentication (RFC 1928), enough for browsers
//! and `curl --socks5-hostname`.

use std::net::{Ipv4Addr, Ipv6Addr};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::{CoreError, Result};

const VERSION: u8 = 5;
const NO_AUTH: u8 = 0;
const NO_ACCEPTABLE_METHOD: u8 = 0xFF;
const CONNECT: u8 = 1;

/// Reply codes sent back once the tunnel has been attempted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Reply {
    Succeeded = 0,
    GeneralFailure = 1,
    HostUnreachable = 4,
    CommandNotSupported = 7,
    AddressTypeNotSupported = 8,
}

fn protocol(msg: &str) -> CoreError {
    CoreError::PortForward(format!("SOCKS5: {msg}"))
}

/// Negotiates no-auth and reads the CONNECT target. Unsupported requests get their error reply
/// before this returns an error.
pub async fn accept<S: AsyncRead + AsyncWrite + Unpin>(stream: &mut S) -> Result<(String, u16)> {
    let io = |e: std::io::Error| protocol(&e.to_string());
    let mut head = [0u8; 2];
    stream.read_exact(&mut head).await.map_err(io)?;
    if head[0] != VERSION {
        return Err(protocol("only version 5 is supported"));
    }
    let mut methods = vec![0u8; usize::from(head[1])];
    stream.read_exact(&mut methods).await.map_err(io)?;
    if !methods.contains(&NO_AUTH) {
        stream
            .write_all(&[VERSION, NO_ACCEPTABLE_METHOD])
            .await
            .map_err(io)?;
        return Err(protocol("the client requires authentication"));
    }
    stream.write_all(&[VERSION, NO_AUTH]).await.map_err(io)?;

    let mut request = [0u8; 4];
    stream.read_exact(&mut request).await.map_err(io)?;
    if request[0] != VERSION {
        return Err(protocol("bad request version"));
    }
    let host = match request[3] {
        1 => {
            let mut ip = [0u8; 4];
            stream.read_exact(&mut ip).await.map_err(io)?;
            Ipv4Addr::from(ip).to_string()
        }
        3 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await.map_err(io)?;
            let mut name = vec![0u8; usize::from(len[0])];
            stream.read_exact(&mut name).await.map_err(io)?;
            String::from_utf8(name).map_err(|_| protocol("host name is not UTF-8"))?
        }
        4 => {
            let mut ip = [0u8; 16];
            stream.read_exact(&mut ip).await.map_err(io)?;
            Ipv6Addr::from(ip).to_string()
        }
        _ => {
            reply(stream, Reply::AddressTypeNotSupported).await?;
            return Err(protocol("unknown address type"));
        }
    };
    let mut port = [0u8; 2];
    stream.read_exact(&mut port).await.map_err(io)?;
    if request[1] != CONNECT {
        reply(stream, Reply::CommandNotSupported).await?;
        return Err(protocol("only CONNECT is supported"));
    }
    Ok((host, u16::from_be_bytes(port)))
}

/// The bound address is reported as 0.0.0.0:0; clients do not use it for CONNECT.
pub async fn reply<S: AsyncWrite + Unpin>(stream: &mut S, code: Reply) -> Result<()> {
    stream
        .write_all(&[VERSION, code as u8, 0, 1, 0, 0, 0, 0, 0, 0])
        .await
        .map_err(|e| protocol(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use tokio::io::duplex;

    use super::*;

    async fn handshake(client_bytes: Vec<u8>) -> (Result<(String, u16)>, Vec<u8>) {
        let (mut client, mut server) = duplex(1024);
        client.write_all(&client_bytes).await.unwrap();
        let result = accept(&mut server).await;
        drop(server);
        let mut answer = Vec::new();
        client.read_to_end(&mut answer).await.unwrap();
        (result, answer)
    }

    fn connect(atyp: u8, addr: &[u8], port: u16) -> Vec<u8> {
        let mut bytes = vec![5, 1, 0, 5, 1, 0, atyp];
        bytes.extend_from_slice(addr);
        bytes.extend_from_slice(&port.to_be_bytes());
        bytes
    }

    #[tokio::test]
    async fn reads_an_ipv4_target() {
        let (result, answer) = handshake(connect(1, &[10, 0, 0, 7], 5432)).await;
        assert_eq!(result.unwrap(), ("10.0.0.7".into(), 5432));
        assert_eq!(answer, [5, 0]);
    }

    #[tokio::test]
    async fn reads_a_domain_target() {
        let mut addr = vec![9];
        addr.extend_from_slice(b"db.intern");
        let (result, _) = handshake(connect(3, &addr, 443)).await;
        assert_eq!(result.unwrap(), ("db.intern".into(), 443));
    }

    #[tokio::test]
    async fn reads_an_ipv6_target() {
        let mut ip = [0u8; 16];
        ip[15] = 1;
        let (result, _) = handshake(connect(4, &ip, 22)).await;
        assert_eq!(result.unwrap(), ("::1".into(), 22));
    }

    #[tokio::test]
    async fn refuses_clients_that_insist_on_authentication() {
        let (result, answer) = handshake(vec![5, 1, 2]).await;
        assert!(matches!(result, Err(CoreError::PortForward(m)) if m.contains("authentication")));
        assert_eq!(answer, [5, 0xFF]);
    }

    #[tokio::test]
    async fn answers_unsupported_commands_and_address_types() {
        let mut bind = connect(1, &[1, 2, 3, 4], 80);
        bind[4] = 2; // BIND
        let (result, answer) = handshake(bind).await;
        assert!(result.is_err());
        assert_eq!(answer[2..4], [5, Reply::CommandNotSupported as u8]);

        let (result, answer) = handshake(vec![5, 1, 0, 5, 1, 0, 9]).await;
        assert!(result.is_err());
        assert_eq!(answer[2..4], [5, Reply::AddressTypeNotSupported as u8]);
    }

    #[tokio::test]
    async fn rejects_socks4() {
        let (result, answer) = handshake(vec![4, 1]).await;
        assert!(result.is_err());
        assert!(answer.is_empty());
    }
}

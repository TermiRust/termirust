//! Port forwarding over an [`SshConnection`]: local (`ssh -L`), remote (`ssh -R`) and
//! dynamic SOCKS5 (`ssh -D`).

mod socks;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use russh::Channel;
use russh::client::Msg;
use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::{JoinHandle, JoinSet};

use crate::ssh::SshConnection;
use crate::{CoreError, Result};

/// Live connection counts shown next to a running rule.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ForwardStats {
    pub active: u32,
    pub total: u64,
}

#[derive(Debug, Default)]
struct Counters {
    active: AtomicU32,
    total: AtomicU64,
}

impl Counters {
    fn track(self: &Arc<Self>) -> ActiveTunnel {
        self.active.fetch_add(1, Ordering::Relaxed);
        self.total.fetch_add(1, Ordering::Relaxed);
        ActiveTunnel(self.clone())
    }
}

struct ActiveTunnel(Arc<Counters>);

impl Drop for ActiveTunnel {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::Relaxed);
    }
}

type ForwardedChannel = (Channel<Msg>, String);

/// Routes channels the server opens for `tcpip-forward` requests to the forward that asked.
#[derive(Clone, Default)]
pub(crate) struct RemoteForwardRouter(
    Arc<Mutex<HashMap<u32, mpsc::UnboundedSender<ForwardedChannel>>>>,
);

pub(crate) struct RemoteRoute(mpsc::UnboundedSender<ForwardedChannel>);

impl RemoteRoute {
    pub(crate) fn deliver(&self, channel: Channel<Msg>, originator: String) {
        let _ = self.0.send((channel, originator));
    }
}

impl RemoteForwardRouter {
    pub(crate) fn route(&self, port: u32) -> Option<RemoteRoute> {
        let routes = self.0.lock().ok()?;
        routes.get(&port).cloned().map(RemoteRoute)
    }

    fn register(&self, port: u32, sender: mpsc::UnboundedSender<ForwardedChannel>) {
        if let Ok(mut routes) = self.0.lock() {
            routes.insert(port, sender);
        }
    }

    fn unregister(&self, port: u32) {
        if let Ok(mut routes) = self.0.lock() {
            routes.remove(&port);
        }
    }
}

struct RemoteListening {
    connection: Arc<SshConnection>,
    host: String,
    port: u32,
}

/// A running forward. Stopping (or dropping) it closes the listener and every open tunnel.
pub struct Forward {
    listening_on: String,
    counters: Arc<Counters>,
    task: JoinHandle<()>,
    remote: Option<RemoteListening>,
}

impl Forward {
    /// Where connections are accepted, e.g. "127.0.0.1:8080" (or the server's address for remote forwards).
    pub fn listening_on(&self) -> &str {
        &self.listening_on
    }

    pub fn stats(&self) -> ForwardStats {
        ForwardStats {
            active: self.counters.active.load(Ordering::Relaxed),
            total: self.counters.total.load(Ordering::Relaxed),
        }
    }

    /// True once the listener has died, e.g. because the SSH connection dropped.
    pub fn is_finished(&self) -> bool {
        self.task.is_finished()
    }

    pub async fn stop(mut self) {
        self.task.abort();
        if let Some(remote) = self.remote.take() {
            remote.connection.remote_forwards().unregister(remote.port);
            let _ = remote
                .connection
                .handle()
                .cancel_tcpip_forward(remote.host.clone(), remote.port)
                .await;
        }
    }
}

impl Drop for Forward {
    fn drop(&mut self) {
        self.task.abort();
        if let Some(remote) = &self.remote {
            remote.connection.remote_forwards().unregister(remote.port);
        }
    }
}

async fn bind(host: &str, port: u16) -> Result<TcpListener> {
    TcpListener::bind((host, port)).await.map_err(|e| {
        CoreError::PortForward(match e.kind() {
            std::io::ErrorKind::AddrInUse => format!("{host}:{port} is already in use"),
            std::io::ErrorKind::PermissionDenied => {
                format!(
                    "no permission to listen on {host}:{port}; ports below 1024 need admin rights"
                )
            }
            _ => format!("cannot listen on {host}:{port}: {e}"),
        })
    })
}

/// Accepts connections until aborted; aborting also drops (and so closes) every open tunnel.
fn serve<F, Fut>(listener: TcpListener, counters: Arc<Counters>, tunnel: F) -> JoinHandle<()>
where
    F: Fn(TcpStream, SocketAddr) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    tokio::spawn(async move {
        let mut tunnels = JoinSet::new();
        loop {
            tokio::select! {
                accepted = listener.accept() => match accepted {
                    Ok((socket, peer)) => {
                        let active = counters.track();
                        let work = tunnel(socket, peer);
                        tunnels.spawn(async move {
                            work.await;
                            drop(active);
                        });
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "port forward accept failed");
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                },
                Some(_) = tunnels.join_next(), if !tunnels.is_empty() => {}
            }
        }
    })
}

async fn open_channel(
    connection: &SshConnection,
    host: &str,
    port: u16,
    peer: SocketAddr,
) -> Result<Channel<Msg>> {
    connection
        .handle()
        .channel_open_direct_tcpip(
            host.to_owned(),
            u32::from(port),
            peer.ip().to_string(),
            u32::from(peer.port()),
        )
        .await
        .map_err(|e| {
            CoreError::PortForward(format!("the server could not reach {host}:{port}: {e}"))
        })
}

/// `ssh -L bind_host:bind_port:target_host:target_port`. The target is resolved by the server.
pub async fn start_local(
    connection: Arc<SshConnection>,
    bind_host: &str,
    bind_port: u16,
    target_host: &str,
    target_port: u16,
) -> Result<Forward> {
    let listener = bind(bind_host, bind_port).await?;
    let listening_on = listener
        .local_addr()
        .map(|a| a.to_string())
        .unwrap_or_default();
    let counters = Arc::new(Counters::default());
    let target_host = target_host.to_owned();
    let task = serve(listener, counters.clone(), move |mut socket, peer| {
        let connection = connection.clone();
        let target_host = target_host.clone();
        async move {
            match open_channel(&connection, &target_host, target_port, peer).await {
                Ok(channel) => {
                    let _ = copy_bidirectional(&mut socket, &mut channel.into_stream()).await;
                }
                Err(e) => tracing::warn!(error = %e, "local forward tunnel failed"),
            }
        }
    });
    Ok(Forward {
        listening_on,
        counters,
        task,
        remote: None,
    })
}

/// `ssh -D bind_host:bind_port`: a SOCKS5 proxy whose connections leave from the server.
pub async fn start_dynamic(
    connection: Arc<SshConnection>,
    bind_host: &str,
    bind_port: u16,
) -> Result<Forward> {
    let listener = bind(bind_host, bind_port).await?;
    let listening_on = listener
        .local_addr()
        .map(|a| a.to_string())
        .unwrap_or_default();
    let counters = Arc::new(Counters::default());
    let task = serve(listener, counters.clone(), move |mut socket, peer| {
        let connection = connection.clone();
        async move {
            let (host, port) = match socks::accept(&mut socket).await {
                Ok(target) => target,
                Err(e) => {
                    tracing::debug!(error = %e, "SOCKS handshake failed");
                    return;
                }
            };
            match open_channel(&connection, &host, port, peer).await {
                Ok(channel) => {
                    if socks::reply(&mut socket, socks::Reply::Succeeded)
                        .await
                        .is_ok()
                    {
                        let _ = copy_bidirectional(&mut socket, &mut channel.into_stream()).await;
                    }
                }
                Err(e) => {
                    tracing::debug!(error = %e, "SOCKS tunnel failed");
                    let code = if matches!(e, CoreError::PortForward(_)) {
                        socks::Reply::HostUnreachable
                    } else {
                        socks::Reply::GeneralFailure
                    };
                    let _ = socks::reply(&mut socket, code).await;
                }
            }
        }
    });
    Ok(Forward {
        listening_on,
        counters,
        task,
        remote: None,
    })
}

/// `ssh -R remote_host:remote_port:local_host:local_port`. Port 0 lets the server choose;
/// [`Forward::listening_on`] then reports the port it picked.
pub async fn start_remote(
    connection: Arc<SshConnection>,
    remote_host: &str,
    remote_port: u16,
    local_host: &str,
    local_port: u16,
) -> Result<Forward> {
    let granted = connection
        .handle()
        .tcpip_forward(remote_host.to_owned(), u32::from(remote_port))
        .await
        .map_err(|e| {
            CoreError::PortForward(format!(
                "the server refused to listen on {remote_host}:{remote_port}: {e}"
            ))
        })?;
    let port = if remote_port == 0 {
        granted
    } else {
        u32::from(remote_port)
    };
    let (sender, mut channels) = mpsc::unbounded_channel::<ForwardedChannel>();
    connection.remote_forwards().register(port, sender);

    let counters = Arc::new(Counters::default());
    let local_host = local_host.to_owned();
    let tracked = counters.clone();
    let task = tokio::spawn(async move {
        let mut tunnels = JoinSet::new();
        loop {
            tokio::select! {
                next = channels.recv() => {
                    let Some((channel, originator)) = next else { break };
                    let active = tracked.track();
                    let local_host = local_host.clone();
                    tunnels.spawn(async move {
                        match TcpStream::connect((local_host.as_str(), local_port)).await {
                            Ok(mut socket) => {
                                let _ = copy_bidirectional(&mut socket, &mut channel.into_stream()).await;
                            }
                            Err(e) => tracing::warn!(error = %e, %originator, "remote forward could not reach the local service"),
                        }
                        drop(active);
                    });
                }
                Some(_) = tunnels.join_next(), if !tunnels.is_empty() => {}
            }
        }
    });
    Ok(Forward {
        listening_on: format!("{remote_host}:{port}"),
        counters,
        task,
        remote: Some(RemoteListening {
            connection,
            host: remote_host.to_owned(),
            port,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_busy_port_is_reported_clearly() {
        let taken = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = taken.local_addr().unwrap().port();
        let err = bind("127.0.0.1", port).await.unwrap_err();
        assert!(
            matches!(&err, CoreError::PortForward(m) if m == &format!("127.0.0.1:{port} is already in use")),
            "{err}"
        );
    }

    #[test]
    fn counts_active_and_total_tunnels() {
        let counters = Arc::new(Counters::default());
        let a = counters.track();
        let b = counters.track();
        drop(a);
        assert_eq!(counters.active.load(Ordering::Relaxed), 1);
        assert_eq!(counters.total.load(Ordering::Relaxed), 2);
        drop(b);
        assert_eq!(counters.active.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn routes_only_registered_ports() {
        let router = RemoteForwardRouter::default();
        let (sender, _receiver) = mpsc::unbounded_channel();
        router.register(9000, sender);
        assert!(router.route(9000).is_some());
        assert!(router.route(9001).is_none());
        router.unregister(9000);
        assert!(router.route(9000).is_none());
    }
}

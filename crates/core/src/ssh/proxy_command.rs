//! OpenSSH-style `ProxyCommand`: a local command whose stdin/stdout carry the SSH stream,
//! e.g. `cloudflared access ssh --hostname %h` for hosts behind Cloudflare Tunnel.

use std::io;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, BufReader, ReadBuf};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use crate::{CoreError, Result};

/// The last lines the command printed on stderr, kept to explain a failed connection.
const STDERR_LINES: usize = 8;

/// Expands `%h` (host), `%p` (port), `%r` (user) and `%%`; other tokens are left as written.
pub fn expand_proxy_command(template: &str, host: &str, port: u16, user: &str) -> String {
    let mut out = String::with_capacity(template.len() + host.len());
    let mut chars = template.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        match chars.peek().copied() {
            Some('h') => out.push_str(host),
            Some('p') => out.push_str(&port.to_string()),
            Some('r') => out.push_str(user),
            Some('%') => out.push('%'),
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => {
                out.push('%');
                continue;
            }
        }
        chars.next();
    }
    out
}

/// The command's stdout/stdin as one byte stream; the process is killed when it is dropped.
pub struct ProxyStream {
    stdout: ChildStdout,
    stdin: ChildStdin,
    _child: Child,
}

/// What the command said on stderr, for error messages; shared with a reader task.
#[derive(Clone, Default)]
pub struct ProxyStderr(Arc<Mutex<Vec<String>>>);

impl ProxyStderr {
    pub fn text(&self) -> String {
        self.0
            .lock()
            .map(|lines| lines.join("\n"))
            .unwrap_or_default()
    }
}

/// Directories GUI apps often miss from PATH (Finder starts apps with /usr/bin:/bin only).
fn search_path() -> Option<std::ffi::OsString> {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<std::path::PathBuf> = std::env::split_paths(&current).collect();
    if cfg!(unix) {
        let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
        let extra = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        .into_iter()
        .map(std::path::PathBuf::from)
        .chain(
            home.iter()
                .flat_map(|h| [h.join(".local/bin"), h.join("bin"), h.join(".cargo/bin")]),
        );
        for dir in extra {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    std::env::join_paths(dirs).ok()
}

/// Starts the (already expanded) command through the platform shell.
pub fn spawn_proxy(command: &str) -> Result<(ProxyStream, ProxyStderr)> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    } else {
        let mut c = Command::new("/bin/sh");
        c.arg("-c").arg(command);
        c
    };
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console window flashes up for the proxy.
        cmd.creation_flags(0x0800_0000);
    }
    if let Some(path) = search_path() {
        cmd.env("PATH", path);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CoreError::InvalidData(format!("cannot start the proxy command: {e}")))?;
    let missing = || CoreError::InvalidData("the proxy command has no stdin/stdout".into());
    let stdin = child.stdin.take().ok_or_else(missing)?;
    let stdout = child.stdout.take().ok_or_else(missing)?;
    let stderr = ProxyStderr::default();
    if let Some(pipe) = child.stderr.take() {
        let sink = stderr.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(pipe).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(mut kept) = sink.0.lock() {
                    kept.push(line);
                    let excess = kept.len().saturating_sub(STDERR_LINES);
                    kept.drain(..excess);
                }
            }
        });
    }
    Ok((
        ProxyStream {
            stdout,
            stdin,
            _child: child,
        },
        stderr,
    ))
}

impl AsyncRead for ProxyStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdout).poll_read(cx, buf)
    }
}

impl AsyncWrite for ProxyStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stdin).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdin).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdin).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn expands_openssh_tokens() {
        assert_eq!(
            expand_proxy_command(
                "cloudflared access ssh --hostname %h",
                "debian.example.app",
                22,
                "deploy"
            ),
            "cloudflared access ssh --hostname debian.example.app"
        );
        assert_eq!(
            expand_proxy_command("nc %h %p", "10.0.0.5", 2222, "u"),
            "nc 10.0.0.5 2222"
        );
        assert_eq!(
            expand_proxy_command("ssh -W %h:%p %r@bastion", "db", 22, "ops"),
            "ssh -W db:22 ops@bastion"
        );
        assert_eq!(
            expand_proxy_command("echo 100%% %x %", "h", 22, "u"),
            "echo 100% %x %"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn carries_bytes_through_the_command_and_keeps_its_errors() {
        let (mut stream, stderr) = spawn_proxy("echo 'warming up' >&2; cat").unwrap();
        stream.write_all(b"SSH-2.0-test\r\n").await.unwrap();
        let mut buf = [0u8; 14];
        stream.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"SSH-2.0-test\r\n");
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(stderr.text(), "warming up");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn finds_tools_outside_a_minimal_gui_path() {
        let path = search_path().unwrap();
        let dirs: Vec<_> = std::env::split_paths(&path).collect();
        assert!(
            dirs.iter()
                .any(|d| d.ends_with("homebrew/bin") || d.ends_with("local/bin"))
        );
    }
}

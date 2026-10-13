//! Works out a host's operating system for its icon, over a separate exec channel so nothing
//! appears in the user's terminal.

use std::time::Duration;

use russh::ChannelMsg;

use super::shell_session::SshConnection;
use crate::{CoreError, Result};

/// Prints os-release when present, then the kernel name; harmless on any POSIX shell.
const PROBE: &str = "cat /etc/os-release 2>/dev/null; echo '---'; uname -s 2>/dev/null";
const MAX_OUTPUT: usize = 16 * 1024;

/// A short identifier such as "ubuntu", "debian", "alpine", "macos", "windows" or "linux".
pub fn os_from_probe(output: &str) -> Option<String> {
    let (release, kernel) = output.split_once("---").unwrap_or((output, ""));
    let field = |name: &str| {
        release.lines().find_map(|line| {
            let value = line.strip_prefix(name)?.strip_prefix('=')?;
            Some(value.trim().trim_matches('"').to_ascii_lowercase())
        })
    };
    if let Some(id) = field("ID").filter(|id| !id.is_empty()) {
        let known = match id.as_str() {
            "rhel" | "redhat" => "rhel",
            "amzn" => "amazon",
            "opensuse-leap" | "opensuse-tumbleweed" | "sles" | "opensuse" => "opensuse",
            "raspbian" => "raspbian",
            "almalinux" => "almalinux",
            "rocky" => "rocky",
            other => other,
        };
        return Some(
            known
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
                .take(32)
                .collect(),
        );
    }
    match kernel.trim().to_ascii_lowercase().as_str() {
        "darwin" => Some("macos".into()),
        "freebsd" => Some("freebsd".into()),
        "openbsd" => Some("openbsd".into()),
        "linux" => Some("linux".into()),
        k if k.starts_with("mingw") || k.starts_with("cygwin") || k.starts_with("msys") => {
            Some("windows".into())
        }
        _ => None,
    }
}

impl SshConnection {
    /// Runs one command on its own channel and returns stdout (capped), or fails on timeout.
    pub async fn exec_capture(&self, command: &str, timeout: Duration) -> Result<String> {
        let run = async {
            let mut channel = self.handle().channel_open_session().await?;
            channel.exec(true, command).await?;
            let mut output = Vec::new();
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } if output.len() < MAX_OUTPUT => {
                        output.extend_from_slice(&data)
                    }
                    ChannelMsg::Eof | ChannelMsg::Close => break,
                    _ => {}
                }
            }
            output.truncate(MAX_OUTPUT);
            Ok::<_, CoreError>(String::from_utf8_lossy(&output).into_owned())
        };
        tokio::time::timeout(timeout, run)
            .await
            .map_err(|_| CoreError::Timeout(timeout))?
    }

    /// The host's OS, or `None` when it cannot be told (e.g. a Windows shell or a locked-down account).
    pub async fn detect_os(&self) -> Option<String> {
        let output = self
            .exec_capture(PROBE, Duration::from_secs(2))
            .await
            .ok()?;
        os_from_probe(&output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_distribution_from_os_release() {
        let ubuntu =
            "NAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nID=ubuntu\nID_LIKE=debian\n---\nLinux\n";
        assert_eq!(os_from_probe(ubuntu).as_deref(), Some("ubuntu"));
        assert_eq!(
            os_from_probe("ID=\"rhel\"\n---\nLinux").as_deref(),
            Some("rhel")
        );
        assert_eq!(
            os_from_probe("ID=amzn\n---\nLinux").as_deref(),
            Some("amazon")
        );
        assert_eq!(
            os_from_probe("ID=alpine\nVERSION_ID=3.20\n---\nLinux").as_deref(),
            Some("alpine")
        );
        assert_eq!(
            os_from_probe("ID=opensuse-leap\n---\nLinux").as_deref(),
            Some("opensuse")
        );
    }

    #[test]
    fn falls_back_to_the_kernel_name() {
        assert_eq!(os_from_probe("---\nDarwin\n").as_deref(), Some("macos"));
        assert_eq!(os_from_probe("---\nFreeBSD\n").as_deref(), Some("freebsd"));
        assert_eq!(
            os_from_probe("---\nMINGW64_NT-10.0\n").as_deref(),
            Some("windows")
        );
        assert_eq!(os_from_probe("---\nLinux\n").as_deref(), Some("linux"));
        assert_eq!(os_from_probe("'cat' is not recognized").as_deref(), None);
    }

    #[test]
    fn keeps_identifiers_short_and_plain() {
        let odd = format!("ID=\"weird<script>{}\"\n---\n", "x".repeat(100));
        let id = os_from_probe(&odd).unwrap();
        assert!(
            id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
            "{id}"
        );
    }
}

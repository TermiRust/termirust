use std::path::Path;

use termirust_core::ssh::{LoginMethod, SshLogin};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::EnvFilter;

/// Keeps the background log writer alive; dropping it flushes and stops logging.
pub struct LogGuard(#[allow(dead_code)] pub WorkerGuard);

pub const LOG_FILE_PREFIX: &str = "termirust";
const KEPT_LOG_FILES: usize = 5;

/// Daily log files in `dir`, the newest five kept. `RUST_LOG` overrides the level.
pub fn init(dir: &Path) -> Result<LogGuard, String> {
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(LOG_FILE_PREFIX)
        .filename_suffix("log")
        .max_log_files(KEPT_LOG_FILES)
        .build(dir)
        .map_err(|e| e.to_string())?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let default_level = if cfg!(debug_assertions) {
        "info,termirust=debug"
    } else {
        "info"
    };
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level)),
        )
        .with_writer(writer)
        .with_ansi(false)
        .try_init()
        .map_err(|e| e.to_string())?;
    Ok(LogGuard(guard))
}

fn method_name(method: &LoginMethod) -> &'static str {
    match method {
        LoginMethod::Password(_) => "password",
        LoginMethod::PrivateKey { .. } => "key",
        LoginMethod::Agent { .. } => "agent",
    }
}

/// Records a connection attempt with enough detail to debug it and no secrets.
pub fn log_connect_attempt(host_id: &str, login: &SshLogin, through_jump: bool) {
    tracing::info!(
        host_id,
        target = %format!("{}@{}:{}", login.username, login.host, login.port),
        method = method_name(&login.method),
        through_jump,
        login = ?login,
        "connecting"
    );
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    use super::*;

    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl Write for Buffer {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn captured(f: impl FnOnce()) -> String {
        let buffer = Buffer::default();
        let sink = buffer.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(move || sink.clone())
            .with_ansi(false)
            .finish();
        tracing::subscriber::with_default(subscriber, f);
        String::from_utf8(buffer.0.lock().unwrap().clone()).unwrap()
    }

    fn login(method: LoginMethod) -> SshLogin {
        SshLogin {
            host: "10.0.0.5".into(),
            port: 22,
            username: "deploy".into(),
            method,
            keepalive_secs: None,
        }
    }

    #[test]
    fn connection_logs_never_contain_secrets() {
        let output = captured(|| {
            log_connect_attempt(
                "h1",
                &login(LoginMethod::Password("hunter2-secret".into())),
                false,
            );
            log_connect_attempt(
                "h2",
                &login(LoginMethod::PrivateKey {
                    pem: "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAprivate".into(),
                    passphrase: Some("pass-phrase-secret".into()),
                }),
                true,
            );
            log_connect_attempt("h3", &login(LoginMethod::Agent { socket: None }), false);
        });

        for secret in [
            "hunter2-secret",
            "BEGIN OPENSSH",
            "AAAAprivate",
            "pass-phrase-secret",
        ] {
            assert!(!output.contains(secret), "log leaked {secret:?}:\n{output}");
        }
        assert!(output.contains("deploy@10.0.0.5:22"));
        assert!(output.contains("method=\"password\"") || output.contains("method=password"));
        assert!(output.contains("through_jump=true"));
        assert!(output.contains("[REDACTED]"));
    }

    #[test]
    fn writes_daily_files_into_the_log_directory() {
        let dir = tempfile::tempdir().unwrap();
        let appender = RollingFileAppender::builder()
            .rotation(Rotation::DAILY)
            .filename_prefix(LOG_FILE_PREFIX)
            .filename_suffix("log")
            .max_log_files(KEPT_LOG_FILES)
            .build(dir.path())
            .unwrap();
        let (writer, guard) = tracing_appender::non_blocking(appender);
        let subscriber = tracing_subscriber::fmt()
            .with_writer(writer)
            .with_ansi(false)
            .finish();
        tracing::subscriber::with_default(subscriber, || tracing::info!("hello log"));
        drop(guard);

        let files: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(files.len(), 1);
        assert!(
            files[0].starts_with("termirust.") && files[0].ends_with(".log"),
            "{files:?}"
        );
        let content = std::fs::read_to_string(dir.path().join(&files[0])).unwrap();
        assert!(content.contains("hello log"));
    }
}

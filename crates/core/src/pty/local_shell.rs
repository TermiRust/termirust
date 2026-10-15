use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{Child, CommandBuilder, MasterPty, native_pty_system};
use tokio::sync::mpsc;

use crate::ssh::{PtySize, ShellEvent};
use crate::{CoreError, Result};

/// Which program a local terminal runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellProgram {
    /// The user's login shell (`$SHELL` on macOS/Linux, PowerShell on Windows).
    UserDefault,
    Command {
        program: String,
        args: Vec<String>,
    },
}

/// A shell running on this machine inside a pseudo-terminal.
pub struct LocalShell {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

fn pty_error(err: impl std::fmt::Display) -> CoreError {
    CoreError::LocalShell(err.to_string())
}

fn lock<T: ?Sized>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn command_for(program: &ShellProgram) -> CommandBuilder {
    let mut cmd = match program {
        ShellProgram::Command { program, args } => {
            let mut cmd = CommandBuilder::new(program);
            cmd.args(args);
            cmd
        }
        #[cfg(windows)]
        ShellProgram::UserDefault => {
            let mut cmd = CommandBuilder::new("powershell.exe");
            cmd.arg("-NoLogo");
            cmd
        }
        #[cfg(not(windows))]
        ShellProgram::UserDefault => CommandBuilder::new_default_prog(),
    };
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Termirust");
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        cmd.cwd(home);
    }
    cmd
}

impl LocalShell {
    /// Starts the shell; output and the final exit arrive on the returned receiver.
    pub fn spawn(
        program: &ShellProgram,
        size: PtySize,
    ) -> Result<(Self, mpsc::Receiver<ShellEvent>)> {
        let pair = native_pty_system()
            .openpty(portable_pty::PtySize {
                rows: size.rows as u16,
                cols: size.cols as u16,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_error)?;
        let child = pair
            .slave
            .spawn_command(command_for(program))
            .map_err(pty_error)?;
        // Dropping our copy of the slave lets the reader see EOF once the shell exits.
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(pty_error)?;
        let writer = pair.master.take_writer().map_err(pty_error)?;
        let child = Arc::new(Mutex::new(child));

        let (events_tx, events_rx) = mpsc::channel(256);
        let waiter = child.clone();
        std::thread::Builder::new()
            .name("termirust-local-pty".into())
            .spawn(move || {
                let mut buf = vec![0u8; 16 * 1024];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        // blocking_send applies backpressure: a slow UI pauses this reader.
                        Ok(n) => {
                            if events_tx
                                .blocking_send(ShellEvent::Output(buf[..n].to_vec()))
                                .is_err()
                            {
                                break;
                            }
                        }
                    }
                }
                // Poll instead of `wait()`: holding the lock while blocked would deadlock
                // `close()`, which needs it to kill a shell that has not exited.
                let exit_status = loop {
                    match lock(&waiter).try_wait() {
                        Ok(Some(status)) => break Some(status.exit_code()),
                        Ok(None) => {}
                        Err(_) => break None,
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                };
                let _ = events_tx.blocking_send(ShellEvent::Closed { exit_status });
            })
            .map_err(pty_error)?;

        Ok((
            Self {
                master: Mutex::new(pair.master),
                writer: Mutex::new(writer),
                child,
            },
            events_rx,
        ))
    }

    pub fn write(&self, input: &[u8]) -> Result<()> {
        let mut writer = lock(&self.writer);
        writer
            .write_all(input)
            .and_then(|_| writer.flush())
            .map_err(|_| CoreError::SessionClosed)
    }

    pub fn resize(&self, size: PtySize) -> Result<()> {
        lock(&self.master)
            .resize(portable_pty::PtySize {
                rows: size.rows as u16,
                cols: size.cols as u16,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_error)
    }

    /// Terminates the shell; the receiver then gets `Closed`.
    pub fn close(&self) -> Result<()> {
        match lock(&self.child).kill() {
            Ok(()) => Ok(()),
            // Already exited.
            Err(e) if e.kind() == std::io::ErrorKind::InvalidInput => Ok(()),
            Err(e) => Err(pty_error(e)),
        }
    }
}

impl Drop for LocalShell {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::time::Duration;

    use super::*;

    const SIZE: PtySize = PtySize {
        cols: 100,
        rows: 30,
    };

    fn sh() -> ShellProgram {
        ShellProgram::Command {
            program: "/bin/sh".into(),
            args: vec![],
        }
    }

    async fn read_until(events: &mut mpsc::Receiver<ShellEvent>, needle: &str) -> String {
        let mut seen = String::new();
        tokio::time::timeout(Duration::from_secs(10), async {
            while let Some(event) = events.recv().await {
                if let ShellEvent::Output(bytes) = event {
                    seen.push_str(&String::from_utf8_lossy(&bytes));
                    if seen.contains(needle) {
                        return;
                    }
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {needle:?}; got {seen:?}"));
        seen
    }

    async fn wait_closed(events: &mut mpsc::Receiver<ShellEvent>) -> Option<u32> {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                match events.recv().await {
                    Some(ShellEvent::Closed { exit_status }) => return exit_status,
                    Some(_) => continue,
                    None => panic!("channel closed without a Closed event"),
                }
            }
        })
        .await
        .expect("shell closes")
    }

    #[tokio::test]
    async fn runs_commands_and_streams_output() {
        let (shell, mut events) = LocalShell::spawn(&sh(), SIZE).unwrap();
        shell.write(b"echo local-$((20+22))\n").unwrap();
        read_until(&mut events, "local-42").await;
    }

    #[tokio::test]
    async fn exports_a_colour_capable_terminal_type() {
        let (shell, mut events) = LocalShell::spawn(&sh(), SIZE).unwrap();
        shell.write(b"echo \"[$TERM/$TERM_PROGRAM]\"\n").unwrap();
        read_until(&mut events, "[xterm-256color/Termirust]").await;
    }

    #[tokio::test]
    async fn resize_reaches_the_pty() {
        let (shell, mut events) = LocalShell::spawn(&sh(), SIZE).unwrap();
        shell.write(b"stty size\n").unwrap();
        read_until(&mut events, "30 100").await;
        shell
            .resize(PtySize {
                cols: 132,
                rows: 43,
            })
            .unwrap();
        shell.write(b"stty size\n").unwrap();
        read_until(&mut events, "43 132").await;
    }

    #[tokio::test]
    async fn reports_the_exit_status() {
        let (shell, mut events) = LocalShell::spawn(&sh(), SIZE).unwrap();
        shell.write(b"exit 3\n").unwrap();
        assert_eq!(wait_closed(&mut events).await, Some(3));
    }

    #[tokio::test]
    async fn close_terminates_the_shell() {
        let (shell, mut events) = LocalShell::spawn(&sh(), SIZE).unwrap();
        shell.close().unwrap();
        wait_closed(&mut events).await;
        assert!(shell.write(b"echo hi\n").is_err() || events.recv().await.is_none());
    }

    #[tokio::test]
    async fn closing_after_the_output_stopped_does_not_hang() {
        // The reader stops once nobody listens, then waits for the shell to exit; closing the
        // shell at that moment must still kill it instead of waiting on the same lock.
        let (shell, events) = LocalShell::spawn(&sh(), SIZE).unwrap();
        drop(events);
        shell.write(b"echo wake-the-reader\n").unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        let closed = tokio::task::spawn_blocking(move || shell.close());
        tokio::time::timeout(Duration::from_secs(5), closed)
            .await
            .expect("close() hung")
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn starts_the_users_default_shell() {
        let (shell, mut events) = LocalShell::spawn(&ShellProgram::UserDefault, SIZE).unwrap();
        shell.write(b"echo default-$((1+1))\n").unwrap();
        read_until(&mut events, "default-2").await;
    }

    #[test]
    fn a_missing_program_is_reported() {
        let missing = ShellProgram::Command {
            program: "/nonexistent/shell".into(),
            args: vec![],
        };
        assert!(matches!(
            LocalShell::spawn(&missing, SIZE),
            Err(CoreError::LocalShell(_))
        ));
    }
}

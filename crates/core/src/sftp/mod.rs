use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileType, OpenFlags};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::ssh::SshConnection;
use crate::{CoreError, Result};

const CHUNK: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    Directory,
    File,
    Symlink,
    Other,
}

/// One item in a remote directory listing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Seconds since the Unix epoch.
    pub modified: Option<i64>,
    /// Unix permission bits, e.g. 0o644.
    pub permissions: Option<u32>,
}

/// Lets a running transfer be stopped from elsewhere.
#[derive(Debug, Clone, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

fn sftp_error(err: impl std::fmt::Display) -> CoreError {
    CoreError::Sftp(err.to_string())
}

fn kind_of(file_type: FileType) -> EntryKind {
    match file_type {
        FileType::Dir => EntryKind::Directory,
        FileType::File => EntryKind::File,
        FileType::Symlink => EntryKind::Symlink,
        FileType::Other => EntryKind::Other,
    }
}

/// Joins a remote directory and a name with `/`, the separator SFTP always uses.
pub fn join_remote(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// Directories first, then names case-insensitively, like most file managers.
fn sort_entries(entries: &mut [RemoteEntry]) {
    entries.sort_by(|a, b| {
        let dir_first = (b.kind == EntryKind::Directory).cmp(&(a.kind == EntryKind::Directory));
        dir_first.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// An SFTP session over its own authenticated connection.
pub struct SftpClient {
    connection: SshConnection,
    sftp: SftpSession,
}

impl SftpClient {
    pub async fn start(connection: SshConnection) -> Result<Self> {
        let channel = connection.handle().channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(sftp_error)?;
        Ok(Self { connection, sftp })
    }

    /// The directory the server starts in (usually the user's home).
    pub async fn home(&self) -> Result<String> {
        self.sftp.canonicalize(".").await.map_err(sftp_error)
    }

    pub async fn list(&self, dir: &str) -> Result<Vec<RemoteEntry>> {
        let mut entries: Vec<RemoteEntry> = self
            .sftp
            .read_dir(dir)
            .await
            .map_err(sftp_error)?
            .filter(|e| e.file_name() != "." && e.file_name() != "..")
            .map(|e| {
                let meta = e.metadata();
                RemoteEntry {
                    path: join_remote(dir, &e.file_name()),
                    name: e.file_name(),
                    kind: kind_of(e.file_type()),
                    size: meta.size.unwrap_or(0),
                    modified: meta.mtime.map(i64::from),
                    permissions: meta.permissions.map(|p| p & 0o7777),
                }
            })
            .collect();
        sort_entries(&mut entries);
        Ok(entries)
    }

    pub async fn kind(&self, path: &str) -> Result<EntryKind> {
        Ok(kind_of(
            self.sftp
                .symlink_metadata(path)
                .await
                .map_err(sftp_error)?
                .file_type(),
        ))
    }

    pub async fn create_dir(&self, path: &str) -> Result<()> {
        self.sftp.create_dir(path).await.map_err(sftp_error)
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<()> {
        self.sftp.rename(from, to).await.map_err(sftp_error)
    }

    /// Deletes a file, a symlink (not its target) or a whole directory tree.
    pub async fn remove(&self, path: &str) -> Result<()> {
        if self.kind(path).await? != EntryKind::Directory {
            return self.sftp.remove_file(path).await.map_err(sftp_error);
        }
        for entry in self.list(path).await? {
            Box::pin(self.remove(&entry.path)).await?;
        }
        self.sftp.remove_dir(path).await.map_err(sftp_error)
    }

    /// Streams `remote` into `local` in chunks; `progress(done, total)` follows each chunk.
    /// A cancelled or failed download removes the partial local file.
    pub async fn download(
        &self,
        remote: &str,
        local: &Path,
        cancel: &CancelFlag,
        mut progress: impl FnMut(u64, u64) + Send,
    ) -> Result<u64> {
        let total = self
            .sftp
            .metadata(remote)
            .await
            .map_err(sftp_error)?
            .size
            .unwrap_or(0);
        let mut source = self.sftp.open(remote).await.map_err(sftp_error)?;
        let mut target = tokio::fs::File::create(local)
            .await
            .map_err(|e| CoreError::Sftp(format!("cannot create {}: {e}", local.display())))?;
        let copied = copy_chunks(&mut source, &mut target, total, cancel, &mut progress).await;
        if copied.is_err() {
            drop(target);
            let _ = tokio::fs::remove_file(local).await;
        }
        copied
    }

    /// Streams `local` into `remote`, replacing it; a cancelled or failed upload removes the partial remote file.
    pub async fn upload(
        &self,
        local: &Path,
        remote: &str,
        cancel: &CancelFlag,
        mut progress: impl FnMut(u64, u64) + Send,
    ) -> Result<u64> {
        let mut source = tokio::fs::File::open(local)
            .await
            .map_err(|e| CoreError::Sftp(format!("cannot read {}: {e}", local.display())))?;
        let total = source.metadata().await.map(|m| m.len()).unwrap_or(0);
        let mut target = self
            .sftp
            .open_with_flags(
                remote,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(sftp_error)?;
        let copied = copy_chunks(&mut source, &mut target, total, cancel, &mut progress).await;
        if copied.is_err() {
            drop(target);
            let _ = self.sftp.remove_file(remote).await;
        }
        copied
    }

    pub async fn close(&self) -> Result<()> {
        let _ = self.sftp.close().await;
        self.connection.disconnect().await
    }
}

async fn copy_chunks<R, W>(
    source: &mut R,
    target: &mut W,
    total: u64,
    cancel: &CancelFlag,
    progress: &mut (impl FnMut(u64, u64) + Send),
) -> Result<u64>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut buf = vec![0u8; CHUNK];
    let mut done = 0u64;
    progress(0, total);
    loop {
        if cancel.is_cancelled() {
            return Err(CoreError::Cancelled);
        }
        let n = source.read(&mut buf).await.map_err(sftp_error)?;
        if n == 0 {
            break;
        }
        target.write_all(&buf[..n]).await.map_err(sftp_error)?;
        done += n as u64;
        progress(done, total.max(done));
    }
    target.flush().await.map_err(sftp_error)?;
    target.shutdown().await.map_err(sftp_error)?;
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, kind: EntryKind) -> RemoteEntry {
        RemoteEntry {
            name: name.into(),
            path: format!("/x/{name}"),
            kind,
            size: 0,
            modified: None,
            permissions: None,
        }
    }

    #[test]
    fn joins_remote_paths_with_a_single_slash() {
        assert_eq!(join_remote("/home/me", "a.txt"), "/home/me/a.txt");
        assert_eq!(join_remote("/", "etc"), "/etc");
        assert_eq!(join_remote("/srv/", "app"), "/srv/app");
    }

    #[test]
    fn lists_directories_first_then_names_case_insensitively() {
        let mut entries = vec![
            entry("b.txt", EntryKind::File),
            entry("Zeta", EntryKind::Directory),
            entry("A.log", EntryKind::File),
            entry("alpha", EntryKind::Directory),
            entry("link", EntryKind::Symlink),
        ];
        sort_entries(&mut entries);
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["alpha", "Zeta", "A.log", "b.txt", "link"]);
    }

    #[tokio::test]
    async fn copies_in_chunks_and_reports_progress() {
        let data = vec![7u8; CHUNK * 2 + 10];
        let mut source = std::io::Cursor::new(data.clone());
        let mut target = Vec::new();
        let mut seen = Vec::new();
        let copied = copy_chunks(
            &mut source,
            &mut target,
            data.len() as u64,
            &CancelFlag::default(),
            &mut |d, t| seen.push((d, t)),
        )
        .await
        .unwrap();

        assert_eq!(copied, data.len() as u64);
        assert_eq!(target, data);
        assert_eq!(seen.first(), Some(&(0, data.len() as u64)));
        assert_eq!(seen.last(), Some(&(data.len() as u64, data.len() as u64)));
        assert!(seen.len() >= 4);
    }

    #[tokio::test]
    async fn stops_when_cancelled() {
        let cancel = CancelFlag::default();
        let mut source = std::io::Cursor::new(vec![1u8; CHUNK * 4]);
        let mut target = Vec::new();
        let flag = cancel.clone();
        let result = copy_chunks(
            &mut source,
            &mut target,
            (CHUNK * 4) as u64,
            &cancel,
            &mut |done, _| {
                if done >= CHUNK as u64 {
                    flag.cancel();
                }
            },
        )
        .await;
        assert!(matches!(result, Err(CoreError::Cancelled)));
        assert!(target.len() < CHUNK * 4);
    }

    #[tokio::test]
    async fn reports_growth_beyond_the_expected_size() {
        let mut source = std::io::Cursor::new(vec![0u8; 100]);
        let mut target = Vec::new();
        let mut last = (0, 0);
        copy_chunks(
            &mut source,
            &mut target,
            10,
            &CancelFlag::default(),
            &mut |d, t| last = (d, t),
        )
        .await
        .unwrap();
        assert_eq!(last, (100, 100));
    }
}

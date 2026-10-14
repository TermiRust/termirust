use std::path::Path;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileType, OpenFlags};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::ssh::SshConnection;
use crate::{CoreError, Result};

const CHUNK: usize = 256 * 1024;

/// Largest file the built-in editor opens; bigger files are downloaded instead.
pub const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

fn too_large_to_edit() -> CoreError {
    CoreError::InvalidData(format!(
        "file is larger than {} MB; download it to edit",
        MAX_EDIT_BYTES / (1024 * 1024)
    ))
}

/// Text the editor can show, or why not: too large, binary (contains NUL) or not UTF-8.
pub fn editable_text(bytes: Vec<u8>) -> Result<String> {
    if bytes.len() as u64 > MAX_EDIT_BYTES {
        return Err(too_large_to_edit());
    }
    if bytes.contains(&0) {
        return Err(CoreError::InvalidData(
            "this looks like a binary file; download it instead".into(),
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| CoreError::InvalidData("file is not UTF-8 text; download it instead".into()))
}

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

pub use crate::cancel::CancelFlag;

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
pub(crate) fn sort_entries(entries: &mut [RemoteEntry]) {
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

    /// Reads a whole file for the editor, refusing anything over [`MAX_EDIT_BYTES`].
    pub async fn read_file(&self, path: &str) -> Result<Vec<u8>> {
        let size = self
            .sftp
            .metadata(path)
            .await
            .map_err(sftp_error)?
            .size
            .unwrap_or(0);
        if size > MAX_EDIT_BYTES {
            return Err(too_large_to_edit());
        }
        let file = self.sftp.open(path).await.map_err(sftp_error)?;
        let mut bytes = Vec::with_capacity(size as usize);
        file.take(MAX_EDIT_BYTES + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(sftp_error)?;
        Ok(bytes)
    }

    /// Replaces a file's contents (keeping its permissions), creating it when missing.
    pub async fn write_file(&self, path: &str, contents: &[u8]) -> Result<()> {
        let mut file = self
            .sftp
            .open_with_flags(
                path,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(sftp_error)?;
        file.write_all(contents).await.map_err(sftp_error)?;
        file.shutdown().await.map_err(sftp_error)
    }

    pub async fn close(&self) -> Result<()> {
        let _ = self.sftp.close().await;
        self.connection.disconnect().await
    }

    /// Uploads a file or a whole directory to `remote` (the new item's full path).
    pub async fn upload_tree(
        &self,
        local: &Path,
        remote: &str,
        cancel: &CancelFlag,
        mut progress: impl FnMut(&TreeProgress) + Send,
    ) -> Result<u64> {
        let plan = plan_local_tree(local, remote)?;
        let mut state = TreeProgress::new(&plan);
        for step in &plan {
            match step {
                TreeStep::Dir { remote, .. } => {
                    if self.kind(remote).await.ok() != Some(EntryKind::Directory) {
                        self.create_dir(remote).await?;
                    }
                }
                TreeStep::File { local, remote, .. } => {
                    state.current = remote.clone();
                    let base = state.done;
                    self.upload(local, remote, cancel, |done, _| {
                        state.done = base + done;
                        progress(&state);
                    })
                    .await?;
                    state.files_done += 1;
                    progress(&state);
                }
            }
        }
        Ok(state.done)
    }

    /// Downloads a file or a whole directory from `remote` into `local` (the new item's full path).
    pub async fn download_tree(
        &self,
        remote: &str,
        local: &Path,
        cancel: &CancelFlag,
        mut progress: impl FnMut(&TreeProgress) + Send,
    ) -> Result<u64> {
        let plan = self.plan_remote_tree(remote, local).await?;
        let mut state = TreeProgress::new(&plan);
        for step in &plan {
            match step {
                TreeStep::Dir { local, .. } => {
                    tokio::fs::create_dir_all(local).await.map_err(|e| {
                        CoreError::Sftp(format!("cannot create {}: {e}", local.display()))
                    })?;
                }
                TreeStep::File { local, remote, .. } => {
                    state.current = remote.clone();
                    let base = state.done;
                    self.download(remote, local, cancel, |done, _| {
                        state.done = base + done;
                        progress(&state);
                    })
                    .await?;
                    state.files_done += 1;
                    progress(&state);
                }
            }
        }
        Ok(state.done)
    }

    async fn plan_remote_tree(&self, remote: &str, local: &Path) -> Result<Vec<TreeStep>> {
        let mut plan = Vec::new();
        let mut pending = vec![(remote.to_owned(), local.to_path_buf())];
        let root_kind = self.kind(remote).await?;
        if root_kind != EntryKind::Directory {
            let size = self
                .sftp
                .metadata(remote)
                .await
                .map_err(sftp_error)?
                .size
                .unwrap_or(0);
            return Ok(vec![TreeStep::File {
                local: local.to_path_buf(),
                remote: remote.to_owned(),
                size,
            }]);
        }
        while let Some((dir, local_dir)) = pending.pop() {
            plan.push(TreeStep::Dir {
                local: local_dir.clone(),
                remote: dir.clone(),
            });
            for entry in self.list(&dir).await? {
                let target = local_dir.join(&entry.name);
                match entry.kind {
                    EntryKind::Directory => pending.push((entry.path, target)),
                    EntryKind::File => plan.push(TreeStep::File {
                        local: target,
                        remote: entry.path,
                        size: entry.size,
                    }),
                    EntryKind::Symlink | EntryKind::Other => {}
                }
            }
        }
        Ok(plan)
    }
}

/// Progress over a whole file or directory transfer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeProgress {
    pub done: u64,
    pub total: u64,
    pub files_done: u32,
    pub files_total: u32,
    /// Remote path of the file being transferred.
    pub current: String,
}

impl TreeProgress {
    fn new(plan: &[TreeStep]) -> Self {
        let (total, files_total) =
            plan.iter()
                .fold((0u64, 0u32), |(bytes, files), step| match step {
                    TreeStep::File { size, .. } => (bytes + size, files + 1),
                    TreeStep::Dir { .. } => (bytes, files),
                });
        Self {
            done: 0,
            total,
            files_done: 0,
            files_total,
            current: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TreeStep {
    Dir {
        local: std::path::PathBuf,
        remote: String,
    },
    File {
        local: std::path::PathBuf,
        remote: String,
        size: u64,
    },
}

/// Directories before their contents; symlinks are skipped rather than followed.
fn plan_local_tree(local: &Path, remote: &str) -> Result<Vec<TreeStep>> {
    let meta = std::fs::symlink_metadata(local)
        .map_err(|e| CoreError::Sftp(format!("cannot read {}: {e}", local.display())))?;
    if meta.is_file() {
        return Ok(vec![TreeStep::File {
            local: local.to_path_buf(),
            remote: remote.to_owned(),
            size: meta.len(),
        }]);
    }
    if !meta.is_dir() {
        return Err(CoreError::Sftp(format!(
            "{} is not a regular file or directory",
            local.display()
        )));
    }
    let mut plan = vec![TreeStep::Dir {
        local: local.to_path_buf(),
        remote: remote.to_owned(),
    }];
    let mut entries: Vec<_> = std::fs::read_dir(local)
        .map_err(|e| CoreError::Sftp(format!("cannot list {}: {e}", local.display())))?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        plan.extend(plan_local_tree(&entry.path(), &join_remote(remote, &name))?);
    }
    Ok(plan)
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

    #[test]
    fn opens_only_utf8_text_for_editing() {
        assert_eq!(
            editable_text(b"server {\n}\n".to_vec()).unwrap(),
            "server {\n}\n"
        );
        assert!(
            editable_text(vec![0x7f, b'E', b'L', b'F', 0, 1])
                .unwrap_err()
                .to_string()
                .contains("binary")
        );
        assert!(
            editable_text(vec![0xff, 0xfe, b'a'])
                .unwrap_err()
                .to_string()
                .contains("UTF-8")
        );
        let big = vec![b'a'; (MAX_EDIT_BYTES + 1) as usize];
        assert!(
            editable_text(big)
                .unwrap_err()
                .to_string()
                .contains("larger than 2 MB")
        );
    }

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
    fn plans_a_local_tree_with_directories_first_and_skips_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("site");
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("index.html"), b"12345").unwrap();
        std::fs::write(root.join("assets/app.js"), b"123").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/passwd", root.join("link")).unwrap();

        let plan = plan_local_tree(&root, "/srv/site").unwrap();
        let remotes: Vec<String> = plan
            .iter()
            .map(|s| match s {
                TreeStep::Dir { remote, .. } => format!("dir {remote}"),
                TreeStep::File { remote, size, .. } => format!("file {remote} {size}"),
            })
            .collect();
        assert_eq!(
            remotes,
            [
                "dir /srv/site",
                "dir /srv/site/assets",
                "file /srv/site/assets/app.js 3",
                "file /srv/site/index.html 5"
            ]
        );

        let progress = TreeProgress::new(&plan);
        assert_eq!((progress.total, progress.files_total), (8, 2));
    }

    #[test]
    fn plans_a_single_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"hello").unwrap();
        let plan = plan_local_tree(&dir.path().join("a.txt"), "/tmp/a.txt").unwrap();
        assert_eq!(
            plan,
            vec![TreeStep::File {
                local: dir.path().join("a.txt"),
                remote: "/tmp/a.txt".into(),
                size: 5
            }]
        );
        assert!(plan_local_tree(&dir.path().join("missing"), "/x").is_err());
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

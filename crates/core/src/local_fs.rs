//! The local side of the SFTP panel.

use std::path::{Path, PathBuf};

use crate::sftp::{EntryKind, RemoteEntry, sort_entries};
use crate::{CoreError, Result};

/// A local listing row has the same shape as a remote one.
pub type LocalEntry = RemoteEntry;

fn io_error(action: &str, path: &Path, err: std::io::Error) -> CoreError {
    CoreError::InvalidData(format!("cannot {action} {}: {err}", path.display()))
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Directories first, then by name ignoring case; unreadable entries are skipped.
pub fn list(dir: &Path) -> Result<Vec<LocalEntry>> {
    let mut entries: Vec<LocalEntry> = std::fs::read_dir(dir)
        .map_err(|e| io_error("list", dir, e))?
        .flatten()
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            let file_type = entry.file_type().ok()?;
            let kind = if file_type.is_symlink() {
                EntryKind::Symlink
            } else if file_type.is_dir() {
                EntryKind::Directory
            } else if file_type.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);
            Some(LocalEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
                kind,
                size: if kind == EntryKind::File {
                    meta.len()
                } else {
                    0
                },
                modified,
                permissions: permissions(&meta),
            })
        })
        .collect();
    sort_entries(&mut entries);
    Ok(entries)
}

#[cfg(unix)]
fn permissions(meta: &std::fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    Some(meta.permissions().mode() & 0o7777)
}

#[cfg(not(unix))]
fn permissions(_: &std::fs::Metadata) -> Option<u32> {
    None
}

pub fn create_dir(path: &Path) -> Result<()> {
    std::fs::create_dir(path).map_err(|e| io_error("create", path, e))
}

pub fn rename(from: &Path, to: &Path) -> Result<()> {
    if to.exists() {
        return Err(CoreError::InvalidData(format!(
            "{} already exists",
            to.display()
        )));
    }
    std::fs::rename(from, to).map_err(|e| io_error("rename", from, e))
}

/// Deletes a file or a directory tree. A symlink is removed itself; its target is never touched.
pub fn remove(path: &Path) -> Result<()> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| io_error("remove", path, e))?;
    let result = if meta.is_dir() {
        // std's remove_dir_all does not follow symlinks inside the tree.
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path).or_else(|e| {
            // A Windows symlink to a directory is removed as a directory.
            if cfg!(windows) && meta.file_type().is_symlink() {
                std::fs::remove_dir(path)
            } else {
                Err(e)
            }
        })
    };
    result.map_err(|e| io_error("remove", path, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_directories_first_then_files_by_name() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("b.txt"), b"12").unwrap();
        std::fs::write(dir.path().join("A.txt"), b"1").unwrap();
        std::fs::create_dir(dir.path().join("zeta")).unwrap();

        let entries = list(dir.path()).unwrap();
        let names: Vec<_> = entries
            .iter()
            .map(|e| (e.name.as_str(), e.kind, e.size))
            .collect();
        assert_eq!(
            names,
            [
                ("zeta", EntryKind::Directory, 0),
                ("A.txt", EntryKind::File, 1),
                ("b.txt", EntryKind::File, 2)
            ]
        );
        assert_eq!(entries[1].path, dir.path().join("A.txt").to_string_lossy());
        assert!(entries[1].modified.is_some());
    }

    #[test]
    fn creates_renames_and_refuses_to_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        create_dir(&a).unwrap();
        assert!(create_dir(&a).is_err());
        std::fs::write(dir.path().join("taken"), b"").unwrap();
        assert!(rename(&a, &dir.path().join("taken")).is_err());
        rename(&a, &dir.path().join("b")).unwrap();
        assert!(dir.path().join("b").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn recursive_removal_never_follows_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("keep.txt"), b"precious").unwrap();

        let tree = dir.path().join("tree");
        std::fs::create_dir_all(tree.join("sub")).unwrap();
        std::fs::write(tree.join("sub/file"), b"x").unwrap();
        std::os::unix::fs::symlink(&outside, tree.join("link")).unwrap();
        std::os::unix::fs::symlink(&outside, dir.path().join("top-link")).unwrap();

        assert!(
            list(&tree)
                .unwrap()
                .iter()
                .any(|e| e.name == "link" && e.kind == EntryKind::Symlink)
        );
        remove(&tree).unwrap();
        remove(&dir.path().join("top-link")).unwrap();

        assert!(!tree.exists());
        assert!(!dir.path().join("top-link").exists());
        assert_eq!(
            std::fs::read(outside.join("keep.txt")).unwrap(),
            b"precious"
        );
    }

    #[test]
    fn missing_paths_are_errors() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(&dir.path().join("nope")).is_err());
        assert!(remove(&dir.path().join("nope")).is_err());
    }
}

pub mod ai;
mod cancel;
mod error;
pub mod forward;
pub mod local_fs;
pub mod pty;
pub mod sftp;
pub mod ssh;
pub mod storage;
pub mod terminal;
pub mod vault;

pub use cancel::CancelFlag;
pub use error::{CoreError, Result};

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    /// The app shows the version from apps/desktop/package.json; both must move together.
    #[test]
    fn version_matches_the_desktop_package() {
        let package = include_str!("../../../apps/desktop/package.json");
        assert!(
            package.contains(&format!("\"version\": \"{}\"", super::version())),
            "Cargo.toml says {} but apps/desktop/package.json differs",
            super::version()
        );
    }
}

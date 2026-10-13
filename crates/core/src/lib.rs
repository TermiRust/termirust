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
    #[test]
    fn version_matches_manifest() {
        assert_eq!(super::version(), "0.0.1");
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("not implemented: {0}")]
    NotImplemented(&'static str),

    #[error("could not reach {host}:{port}: {reason}")]
    Unreachable {
        host: String,
        port: u16,
        reason: String,
    },

    #[error("timed out after {0:?}")]
    Timeout(std::time::Duration),

    #[error("authentication failed")]
    AuthenticationFailed,

    #[error("host key rejected")]
    HostKeyRejected,

    #[error("session is closed")]
    SessionClosed,

    #[error("ssh protocol error: {0}")]
    Ssh(String),
}

impl From<russh::Error> for CoreError {
    fn from(err: russh::Error) -> Self {
        match err {
            russh::Error::UnknownKey => CoreError::HostKeyRejected,
            other => CoreError::Ssh(other.to_string()),
        }
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;

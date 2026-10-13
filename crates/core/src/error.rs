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

    #[error("storage error: {0}")]
    Storage(String),

    #[error("crypto error: {0}")]
    Crypto(String),

    #[error("data could not be decrypted (wrong key or tampered data)")]
    DecryptionFailed,

    #[error("the vault key is missing from the OS keychain")]
    VaultKeyMissing,

    #[error("the vault key does not match this vault")]
    WrongVaultKey,

    #[error("OS keychain error: {0}")]
    Keychain(String),

    #[error("{kind} {id} not found")]
    NotFound { kind: &'static str, id: String },

    #[error("invalid data: {0}")]
    InvalidData(String),

    #[error("this private key is protected by a passphrase")]
    PassphraseRequired,

    #[error("wrong passphrase for this private key")]
    WrongPassphrase,

    #[error("no SSH agent is running: {0}")]
    AgentUnavailable(String),

    #[error("local terminal error: {0}")]
    LocalShell(String),

    #[error("jump host: {0}")]
    JumpHost(Box<CoreError>),

    #[error("file transfer error: {0}")]
    Sftp(String),

    #[error("cancelled")]
    Cancelled,

    #[error("port forwarding: {0}")]
    PortForward(String),

    #[error("AI: {0}")]
    Ai(String),
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

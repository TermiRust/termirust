use serde::Serialize;
use termirust_core::CoreError;

/// Error shape returned to the frontend; `code` is stable so the UI can localise it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct CommandError {
    pub code: CommandErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum CommandErrorCode {
    Unreachable,
    Timeout,
    AuthenticationFailed,
    HostKeyRejected,
    SessionNotFound,
    SessionClosed,
    Ssh,
    Storage,
    VaultKeyMissing,
    WrongVaultKey,
    Keychain,
    DecryptionFailed,
    NotFound,
    InvalidData,
    PassphraseRequired,
    WrongPassphrase,
    AgentUnavailable,
    Internal,
}

impl CommandError {
    pub fn session_not_found(id: u32) -> Self {
        Self {
            code: CommandErrorCode::SessionNotFound,
            message: format!("session {id} does not exist"),
        }
    }
}

impl From<CoreError> for CommandError {
    fn from(err: CoreError) -> Self {
        let code = match &err {
            CoreError::Unreachable { .. } => CommandErrorCode::Unreachable,
            CoreError::Timeout(_) => CommandErrorCode::Timeout,
            CoreError::AuthenticationFailed => CommandErrorCode::AuthenticationFailed,
            CoreError::HostKeyRejected => CommandErrorCode::HostKeyRejected,
            CoreError::SessionClosed => CommandErrorCode::SessionClosed,
            CoreError::Ssh(_) => CommandErrorCode::Ssh,
            CoreError::Storage(_) => CommandErrorCode::Storage,
            CoreError::VaultKeyMissing => CommandErrorCode::VaultKeyMissing,
            CoreError::WrongVaultKey => CommandErrorCode::WrongVaultKey,
            CoreError::Keychain(_) => CommandErrorCode::Keychain,
            CoreError::DecryptionFailed => CommandErrorCode::DecryptionFailed,
            CoreError::NotFound { .. } => CommandErrorCode::NotFound,
            CoreError::InvalidData(_) => CommandErrorCode::InvalidData,
            CoreError::PassphraseRequired => CommandErrorCode::PassphraseRequired,
            CoreError::WrongPassphrase => CommandErrorCode::WrongPassphrase,
            CoreError::AgentUnavailable(_) => CommandErrorCode::AgentUnavailable,
            CoreError::NotImplemented(_) | CoreError::Crypto(_) => CommandErrorCode::Internal,
        };
        Self {
            code,
            message: err.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn maps_every_core_error_to_a_stable_code() {
        let cases = [
            (
                CoreError::Unreachable {
                    host: "h".into(),
                    port: 22,
                    reason: "refused".into(),
                },
                CommandErrorCode::Unreachable,
            ),
            (
                CoreError::Timeout(Duration::from_secs(1)),
                CommandErrorCode::Timeout,
            ),
            (
                CoreError::AuthenticationFailed,
                CommandErrorCode::AuthenticationFailed,
            ),
            (
                CoreError::HostKeyRejected,
                CommandErrorCode::HostKeyRejected,
            ),
            (CoreError::SessionClosed, CommandErrorCode::SessionClosed),
            (CoreError::Ssh("x".into()), CommandErrorCode::Ssh),
            (CoreError::Storage("x".into()), CommandErrorCode::Storage),
            (
                CoreError::VaultKeyMissing,
                CommandErrorCode::VaultKeyMissing,
            ),
            (CoreError::WrongVaultKey, CommandErrorCode::WrongVaultKey),
            (CoreError::Keychain("x".into()), CommandErrorCode::Keychain),
            (
                CoreError::DecryptionFailed,
                CommandErrorCode::DecryptionFailed,
            ),
            (
                CoreError::NotFound {
                    kind: "host",
                    id: "1".into(),
                },
                CommandErrorCode::NotFound,
            ),
            (
                CoreError::InvalidData("x".into()),
                CommandErrorCode::InvalidData,
            ),
            (CoreError::Crypto("x".into()), CommandErrorCode::Internal),
            (CoreError::NotImplemented("x"), CommandErrorCode::Internal),
        ];
        for (core, code) in cases {
            assert_eq!(CommandError::from(core).code, code);
        }
    }

    #[test]
    fn keeps_the_human_readable_message() {
        let err = CommandError::from(CoreError::Unreachable {
            host: "10.0.0.1".into(),
            port: 2222,
            reason: "connection refused".into(),
        });
        assert_eq!(
            err.message,
            "could not reach 10.0.0.1:2222: connection refused"
        );
    }

    #[test]
    fn serialises_the_code_in_snake_case() {
        let json = serde_json::to_string(&CommandError::session_not_found(7)).unwrap();
        assert_eq!(
            json,
            r#"{"code":"session_not_found","message":"session 7 does not exist"}"#
        );
    }
}

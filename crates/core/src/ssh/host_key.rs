use std::sync::Arc;

use russh::keys::{HashAlg, PublicKeyOrCertificate};

/// What the user is shown when deciding whether to trust a server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKeyInfo {
    pub algorithm: String,
    /// OpenSSH-style fingerprint, e.g. `SHA256:x1Yq…`.
    pub fingerprint: String,
}

/// Decides whether a server's host key is trusted; returning false aborts the connection.
pub type HostKeyVerifier = Arc<dyn Fn(&HostKeyInfo) -> bool + Send + Sync>;

impl HostKeyInfo {
    pub(crate) fn from_server_key(key: &PublicKeyOrCertificate) -> Self {
        match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => Self {
                algorithm: key.algorithm().to_string(),
                fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
            },
            PublicKeyOrCertificate::Certificate(cert) => Self {
                algorithm: cert.algorithm().to_string(),
                fingerprint: cert.public_key().fingerprint(HashAlg::Sha256).to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use russh::keys::PublicKey;

    use super::*;

    // Throwaway key; its fingerprint was taken from `ssh-keygen -lf -E sha256`.
    const ED25519_PUB: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMFDSpufxoZg1gW6LZSz50wBLhgmBEZjM23hI6Gd2TWX";

    #[test]
    fn matches_the_fingerprint_openssh_shows() {
        let key = PublicKey::from_openssh(ED25519_PUB).unwrap();
        let info = HostKeyInfo::from_server_key(&PublicKeyOrCertificate::PublicKey {
            key,
            hash_alg: None,
        });

        assert_eq!(info.algorithm, "ssh-ed25519");
        assert_eq!(
            info.fingerprint,
            "SHA256:ZSe2cqkP7enpVYdlk3RFFQsFXhD7vmrRa8cDmzmL6MQ"
        );
    }
}

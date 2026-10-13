use russh::keys::ssh_key::LineEnding;
use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::{HashAlg, PrivateKey};
use zeroize::Zeroize;

use crate::{CoreError, Result};

/// Public facts about a private key, safe to show in the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyInfo {
    pub algorithm: String,
    pub fingerprint: String,
    /// `ssh-ed25519 AAAA… comment`, ready to paste into authorized_keys.
    pub public_key: String,
    pub encrypted: bool,
}

pub struct GeneratedKey {
    /// OpenSSH PEM of the new private key.
    pub private_key: String,
    pub info: KeyInfo,
}

impl std::fmt::Debug for GeneratedKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GeneratedKey")
            .field("private_key", &"[REDACTED]")
            .field("info", &self.info)
            .finish()
    }
}

fn info_of(key: &PrivateKey, encrypted: bool) -> Result<KeyInfo> {
    let public = key.public_key();
    Ok(KeyInfo {
        algorithm: public.algorithm().to_string(),
        fingerprint: public.fingerprint(HashAlg::Sha256).to_string(),
        public_key: public
            .to_openssh()
            .map_err(|e| CoreError::InvalidData(format!("cannot encode public key: {e}")))?,
        encrypted,
    })
}

/// Decrypts and parses OpenSSH, PEM (PKCS#1/PKCS#8) or PuTTY private keys.
pub fn load_private_key(pem: &str, passphrase: Option<&str>) -> Result<PrivateKey> {
    let passphrase = passphrase.filter(|p| !p.is_empty());
    match russh::keys::decode_secret_key(pem, passphrase) {
        Ok(key) => Ok(key),
        Err(russh::keys::Error::KeyIsEncrypted) => Err(match passphrase {
            None => CoreError::PassphraseRequired,
            Some(_) => CoreError::WrongPassphrase,
        }),
        Err(_) if passphrase.is_some() && is_encrypted_openssh(pem) => {
            Err(CoreError::WrongPassphrase)
        }
        Err(e) => Err(CoreError::InvalidData(format!(
            "not a supported private key: {e}"
        ))),
    }
}

fn is_encrypted_openssh(pem: &str) -> bool {
    PrivateKey::from_openssh(pem)
        .map(|k| k.is_encrypted())
        .unwrap_or(false)
}

/// Reads what a key file contains; an encrypted OpenSSH key reveals its public half
/// without the passphrase, so the UI can show the fingerprint before asking.
pub fn inspect_private_key(pem: &str, passphrase: Option<&str>) -> Result<KeyInfo> {
    if let Ok(key) = PrivateKey::from_openssh(pem.trim())
        && key.is_encrypted()
    {
        if let Some(passphrase) = passphrase.filter(|p| !p.is_empty()) {
            key.decrypt(passphrase)
                .map_err(|_| CoreError::WrongPassphrase)?;
        }
        return info_of(&key, true);
    }
    let key = load_private_key(pem, passphrase)?;
    info_of(&key, false)
}

pub fn generate_ed25519(comment: &str) -> Result<GeneratedKey> {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).map_err(|e| CoreError::Crypto(e.to_string()))?;
    let mut key = PrivateKey::from(Ed25519Keypair::from_seed(&seed));
    seed.zeroize();
    key.set_comment(comment);
    let private_key = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| CoreError::Crypto(e.to_string()))?
        .to_string();
    Ok(GeneratedKey {
        private_key,
        info: info_of(&key, false)?,
    })
}

#[cfg(test)]
pub(crate) mod fixtures {
    pub const ED25519: &str = include_str!("../../tests/fixtures/keys/ed25519");
    pub const ED25519_ENCRYPTED: &str = include_str!("../../tests/fixtures/keys/ed25519_encrypted");
    pub const RSA_PEM: &str = include_str!("../../tests/fixtures/keys/rsa_pem");
    pub const ECDSA: &str = include_str!("../../tests/fixtures/keys/ecdsa");
    pub const PASSPHRASE: &str = "test-passphrase";
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;

    // Expected fingerprints come from `ssh-keygen -lf <key>.pub -E sha256`.
    #[test]
    fn reads_every_supported_format_with_the_fingerprint_openssh_shows() {
        let cases = [
            (
                ED25519,
                "ssh-ed25519",
                "SHA256:NkmZjAZ5a2Iai06/4rqvzAM4Ckxj7TUhIIRon4FXeX0",
            ),
            (
                RSA_PEM,
                "ssh-rsa",
                "SHA256:UtgKRDKEMR4Ao4wXKNUMeS6KRRdE9oVK46Q+o2mTtow",
            ),
            (
                ECDSA,
                "ecdsa-sha2-nistp256",
                "SHA256:CXdFANEuqN2h/rVqY85PdIHoTYh6cVys5YoRbU3kBm4",
            ),
        ];
        for (pem, algorithm, fingerprint) in cases {
            let info = inspect_private_key(pem, None).unwrap();
            assert_eq!(info.algorithm, algorithm);
            assert_eq!(info.fingerprint, fingerprint);
            assert!(!info.encrypted);
            assert!(info.public_key.starts_with(algorithm));
        }
    }

    #[test]
    fn shows_an_encrypted_key_fingerprint_before_the_passphrase_is_known() {
        let info = inspect_private_key(ED25519_ENCRYPTED, None).unwrap();
        assert!(info.encrypted);
        assert_eq!(
            info.fingerprint,
            "SHA256:9szLGNV+ymjLmQLkXQzri+OLZd+NbliDBztGthb6mRQ"
        );
    }

    #[test]
    fn inspect_rejects_a_wrong_passphrase() {
        assert!(matches!(
            inspect_private_key(ED25519_ENCRYPTED, Some("nope")),
            Err(CoreError::WrongPassphrase)
        ));
        assert!(inspect_private_key(ED25519_ENCRYPTED, Some(PASSPHRASE)).is_ok());
    }

    #[test]
    fn loading_an_encrypted_key_needs_the_right_passphrase() {
        assert!(matches!(
            load_private_key(ED25519_ENCRYPTED, None),
            Err(CoreError::PassphraseRequired)
        ));
        assert!(matches!(
            load_private_key(ED25519_ENCRYPTED, Some("")),
            Err(CoreError::PassphraseRequired)
        ));
        assert!(matches!(
            load_private_key(ED25519_ENCRYPTED, Some("nope")),
            Err(CoreError::WrongPassphrase)
        ));
        assert!(load_private_key(ED25519_ENCRYPTED, Some(PASSPHRASE)).is_ok());
    }

    #[test]
    fn garbage_is_invalid_data() {
        assert!(matches!(
            inspect_private_key("hello", None),
            Err(CoreError::InvalidData(_))
        ));
        assert!(matches!(
            load_private_key("-----BEGIN NOPE-----\nAAAA\n-----END NOPE-----", None),
            Err(CoreError::InvalidData(_))
        ));
    }

    #[test]
    fn generates_a_loadable_ed25519_key_with_its_comment() {
        let generated = generate_ed25519("deploy@laptop").unwrap();
        assert!(
            generated
                .private_key
                .starts_with("-----BEGIN OPENSSH PRIVATE KEY-----")
        );
        assert_eq!(generated.info.algorithm, "ssh-ed25519");
        assert!(generated.info.public_key.ends_with(" deploy@laptop"));

        let reloaded = inspect_private_key(&generated.private_key, None).unwrap();
        assert_eq!(reloaded.fingerprint, generated.info.fingerprint);
        assert_ne!(
            generate_ed25519("x").unwrap().info.fingerprint,
            generated.info.fingerprint
        );
    }

    #[test]
    fn generated_key_debug_hides_the_private_half() {
        let generated = generate_ed25519("x").unwrap();
        assert!(!format!("{generated:?}").contains("PRIVATE KEY"));
    }
}

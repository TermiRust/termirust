use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{CoreError, Result};

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 24;

/// The 256-bit key that encrypts every vault item. Wiped from memory on drop.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct VaultKey([u8; KEY_LEN]);

impl VaultKey {
    pub fn generate() -> Result<Self> {
        let mut bytes = [0u8; KEY_LEN];
        getrandom::fill(&mut bytes).map_err(|e| CoreError::Crypto(e.to_string()))?;
        Ok(Self(bytes))
    }

    pub fn from_slice(bytes: &[u8]) -> Result<Self> {
        let bytes: [u8; KEY_LEN] = bytes
            .try_into()
            .map_err(|_| CoreError::Crypto(format!("vault key must be {KEY_LEN} bytes")))?;
        Ok(Self(bytes))
    }

    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

impl std::fmt::Debug for VaultKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("VaultKey([REDACTED])")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sealed {
    pub nonce: [u8; NONCE_LEN],
    pub ciphertext: Vec<u8>,
}

/// Encrypts with a fresh random nonce; `aad` binds the ciphertext to its context.
pub fn seal(key: &VaultKey, aad: &[u8], plaintext: &[u8]) -> Result<Sealed> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|e| CoreError::Crypto(e.to_string()))?;
    seal_with_nonce(key, nonce, aad, plaintext)
}

fn seal_with_nonce(
    key: &VaultKey,
    nonce: [u8; NONCE_LEN],
    aad: &[u8],
    plaintext: &[u8],
) -> Result<Sealed> {
    let cipher = XChaCha20Poly1305::new(&Key::from(key.0));
    let ciphertext = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CoreError::Crypto("encryption failed".into()))?;
    Ok(Sealed { nonce, ciphertext })
}

pub fn open(key: &VaultKey, aad: &[u8], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
    let nonce: [u8; NONCE_LEN] = nonce
        .try_into()
        .map_err(|_| CoreError::Crypto(format!("nonce must be {NONCE_LEN} bytes")))?;
    let cipher = XChaCha20Poly1305::new(&Key::from(key.0));
    cipher
        .decrypt(
            &XNonce::from(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| CoreError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> VaultKey {
        VaultKey([byte; KEY_LEN])
    }

    #[test]
    fn round_trips_plaintext() {
        let sealed = seal(&key(1), b"ctx", b"secret host").unwrap();
        assert_eq!(
            open(&key(1), b"ctx", &sealed.nonce, &sealed.ciphertext).unwrap(),
            b"secret host"
        );
    }

    #[test]
    fn ciphertext_hides_the_plaintext_and_carries_a_16_byte_tag() {
        let sealed = seal(&key(1), b"", b"hunter2").unwrap();
        assert_eq!(sealed.ciphertext.len(), b"hunter2".len() + 16);
        assert!(!sealed.ciphertext.windows(7).any(|w| w == b"hunter2"));
    }

    #[test]
    fn every_seal_uses_a_fresh_nonce() {
        let a = seal(&key(1), b"", b"same").unwrap();
        let b = seal(&key(1), b"", b"same").unwrap();
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    #[test]
    fn wrong_key_fails_to_decrypt() {
        let sealed = seal(&key(1), b"ctx", b"x").unwrap();
        assert!(matches!(
            open(&key(2), b"ctx", &sealed.nonce, &sealed.ciphertext),
            Err(CoreError::DecryptionFailed)
        ));
    }

    #[test]
    fn different_associated_data_fails_to_decrypt() {
        let sealed = seal(&key(1), b"item-a", b"x").unwrap();
        assert!(matches!(
            open(&key(1), b"item-b", &sealed.nonce, &sealed.ciphertext),
            Err(CoreError::DecryptionFailed)
        ));
    }

    #[test]
    fn tampered_ciphertext_fails_to_decrypt() {
        let mut sealed = seal(&key(1), b"", b"payload").unwrap();
        sealed.ciphertext[0] ^= 0x01;
        assert!(open(&key(1), b"", &sealed.nonce, &sealed.ciphertext).is_err());
    }

    #[test]
    fn malformed_nonce_is_rejected() {
        assert!(matches!(
            open(&key(1), b"", &[0u8; 12], b"x"),
            Err(CoreError::Crypto(_))
        ));
    }

    // Expected bytes come from libsodium's crypto_aead_xchacha20poly1305_ietf_encrypt,
    // an implementation independent of the RustCrypto one used here.
    #[test]
    fn matches_a_fixed_test_vector() {
        let sealed = seal_with_nonce(
            &key(7),
            [9u8; NONCE_LEN],
            b"termirust:v1:id:host",
            b"{\"v\":1}",
        )
        .unwrap();
        let hex: String = sealed
            .ciphertext
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(hex, EXPECTED_VECTOR_HEX);
    }

    const EXPECTED_VECTOR_HEX: &str = "c55094a8469b043b33c78e4638dadaac109827e851fdd2";

    #[test]
    fn key_debug_output_is_redacted() {
        assert_eq!(format!("{:?}", key(5)), "VaultKey([REDACTED])");
    }

    #[test]
    fn generated_keys_differ_and_have_the_right_length() {
        let a = VaultKey::generate().unwrap();
        let b = VaultKey::generate().unwrap();
        assert_ne!(a.as_bytes(), b.as_bytes());
        assert!(VaultKey::from_slice(&[0u8; 31]).is_err());
        assert_eq!(
            VaultKey::from_slice(a.as_bytes()).unwrap().as_bytes(),
            a.as_bytes()
        );
    }
}

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// A password, private key or passphrase: never printed, wiped from memory on drop.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[REDACTED]")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_never_reveals_the_value() {
        assert_eq!(format!("{:?}", Secret::new("hunter2")), "[REDACTED]");
    }

    #[test]
    fn serialises_as_a_plain_string_for_the_encrypted_payload() {
        assert_eq!(serde_json::to_string(&Secret::new("pw")).unwrap(), "\"pw\"");
        let back: Secret = serde_json::from_str("\"pw\"").unwrap();
        assert_eq!(back.expose(), "pw");
    }
}

//! Masks anything that looks like a secret before text is sent to an AI provider.
//! Over-masking is acceptable; leaking is not.

use std::sync::LazyLock;

use regex::{Captures, Regex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redacted {
    pub text: String,
    /// How many secrets were masked, so the preview can say so.
    pub count: usize,
}

struct Rule {
    kind: &'static str,
    pattern: Regex,
    /// Capture group holding the secret; the rest of the match is kept.
    secret_group: usize,
}

fn rule(kind: &'static str, pattern: &str, secret_group: usize) -> Rule {
    Rule {
        kind,
        pattern: Regex::new(pattern).expect("redaction pattern compiles"),
        secret_group,
    }
}

static RULES: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    vec![
        // A private key block, or its start when the selection cut it off.
        rule(
            "private-key",
            r"(-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----(?s:.*?)(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|\z))",
            1,
        ),
        rule("aws-key", r"\b((?:AKIA|ASIA)[0-9A-Z]{16})\b", 1),
        rule(
            "github-token",
            r"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b",
            1,
        ),
        rule("slack-token", r"\b(xox[abprs]-[A-Za-z0-9-]{10,})", 1),
        rule("api-key", r"\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,})", 1),
        rule(
            "api-key",
            r"\b((?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,})\b",
            1,
        ),
        rule("api-key", r"\b(AIza[0-9A-Za-z_-]{35,})", 1),
        rule(
            "jwt",
            r"\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})",
            1,
        ),
        // scheme://user:password@host keeps the user and host.
        rule(
            "url-password",
            r"\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s/:@]+:([^\s/@]+)@",
            1,
        ),
        rule(
            "auth-header",
            r"(?i)\bauthorization:[ \t]*(?:bearer|basic|token)[ \t]+(\S+)",
            1,
        ),
        // password=…, API_TOKEN: …, --password …; values never span lines.
        rule(
            "secret",
            r#"(?i)\b[A-Za-z0-9_.-]*(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)[A-Za-z0-9_.-]*"?[ \t]*[=:][ \t]*("[^"\n]+"|'[^'\n]+'|[^\s"',;]+)"#,
            1,
        ),
        rule(
            "secret",
            r#"(?i)--(?:password|passwd|passphrase|secret|token|api-key|access-key)(?:=|[ \t]+)("[^"\n]+"|'[^'\n]+'|\S+)"#,
            1,
        ),
    ]
});

/// Long, random-looking words; '/' is excluded so file paths are left alone.
static CANDIDATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z0-9+=_-]{32,}").expect("candidate pattern compiles"));

const MARK: &str = "[REDACTED";

fn shannon_entropy(word: &str) -> f64 {
    let mut counts = [0usize; 256];
    for b in word.bytes() {
        counts[usize::from(b)] += 1;
    }
    let len = word.len() as f64;
    counts
        .iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = c as f64 / len;
            -p * p.log2()
        })
        .sum()
}

/// Hex digests (git SHAs, checksums) top out at 4 bits per char, so they stay readable.
fn looks_random(word: &str) -> bool {
    let has_digit = word.bytes().any(|b| b.is_ascii_digit());
    let has_upper = word.bytes().any(|b| b.is_ascii_uppercase());
    let has_lower = word.bytes().any(|b| b.is_ascii_lowercase());
    has_digit && has_upper && has_lower && shannon_entropy(word) > 4.2
}

pub fn redact(text: &str) -> Redacted {
    let mut count = 0;
    let mut out = text.to_owned();
    for rule in RULES.iter() {
        out = rule
            .pattern
            .replace_all(&out, |caps: &Captures| {
                let whole = caps.get(0).expect("match");
                let secret = caps.get(rule.secret_group).expect("secret group");
                if secret.as_str().starts_with(MARK) || secret.as_str().is_empty() {
                    return whole.as_str().to_owned();
                }
                count += 1;
                let start = secret.start() - whole.start();
                let end = secret.end() - whole.start();
                format!(
                    "{}[REDACTED:{}]{}",
                    &whole.as_str()[..start],
                    rule.kind,
                    &whole.as_str()[end..]
                )
            })
            .into_owned();
    }
    out = CANDIDATE
        .replace_all(&out, |caps: &Captures| {
            let word = &caps[0];
            if looks_random(word) {
                count += 1;
                "[REDACTED:random]".to_owned()
            } else {
                word.to_owned()
            }
        })
        .into_owned();
    Redacted { text: out, count }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIVATE_KEY: &str = include_str!("../../tests/fixtures/keys/ed25519");

    fn masked(text: &str) -> String {
        redact(text).text
    }

    #[test]
    fn masks_private_key_blocks_whole_or_cut_off() {
        let out = redact(&format!("cat key\n{PRIVATE_KEY}\n$ "));
        assert_eq!(out.count, 1);
        assert!(!out.text.contains("BEGIN OPENSSH"));
        assert!(out.text.contains("cat key\n[REDACTED:private-key]"));

        let cut = &PRIVATE_KEY[..PRIVATE_KEY.len() / 2];
        assert_eq!(masked(cut), "[REDACTED:private-key]");
        assert_eq!(
            masked("-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----"),
            "[REDACTED:private-key]"
        );
    }

    #[test]
    fn masks_well_known_token_formats() {
        let samples = [
            ("AKIAIOSFODNN7EXAMPLE", "aws-key"),
            ("ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github-token"),
            (
                "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
                "github-token",
            ),
            ("xoxb-1234567890-abcdefghij", "slack-token"),
            ("sk-ant-api03-abcdefghijklmnopqrstuvwx", "api-key"),
            ("sk-proj-abcdefghijklmnopqrstuvwxyz", "api-key"),
            ("sk_live_abcdefghijklmnop1234", "api-key"),
            ("AIzaSyA-abcdefghijklmnopqrstuvwxyz012345", "api-key"),
            (
                "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
                "jwt",
            ),
        ];
        for (secret, kind) in samples {
            let out = masked(&format!("value {secret} end"));
            assert_eq!(out, format!("value [REDACTED:{kind}] end"), "{secret}");
        }
    }

    #[test]
    fn masks_assignments_flags_headers_and_url_passwords() {
        let samples = [
            ("DB_PASSWORD=hunter2", "DB_PASSWORD=[REDACTED:secret]"),
            (
                "export API_TOKEN='abc def'",
                "export API_TOKEN=[REDACTED:secret]",
            ),
            (
                r#""client_secret": "s3cr3t","#,
                r#""client_secret": [REDACTED:secret],"#,
            ),
            (
                "aws_secret_access_key = wJalrXUtnFEMI",
                "aws_secret_access_key = [REDACTED:secret]",
            ),
            (
                "mysql --password=hunter2 -u root",
                "mysql --password=[REDACTED:secret] -u root",
            ),
            ("tool --token abc123", "tool --token [REDACTED:secret]"),
            (
                "Authorization: Bearer abc.def",
                "Authorization: Bearer [REDACTED:auth-header]",
            ),
            (
                "postgres://app:pa55word@db.internal:5432/app",
                "postgres://app:[REDACTED:url-password]@db.internal:5432/app",
            ),
        ];
        for (input, expected) in samples {
            assert_eq!(masked(input), expected, "{input}");
        }
    }

    #[test]
    fn masks_random_looking_strings() {
        let out = redact("key: 9fK2xQ7LmZ4pR8tW1vB6nY3cD5gH0jE2sA");
        assert_eq!(out.count, 1);
        assert!(out.text.contains("[REDACTED"));
        assert_eq!(
            masked("token 9fK2xQ7LmZ4pR8tW1vB6nY3cD5gH0jE2sA"),
            "token [REDACTED:random]"
        );
    }

    #[test]
    fn leaves_ordinary_terminal_text_alone() {
        let samples = [
            "ls -la /var/log/nginx",
            "commit 3f786850e387550fdab836ed7e6dc881de23001b",
            "sha256sum: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "CONTAINER ID   IMAGE   COMMAND\n4c01db0b339c   nginx   \"nginx -g\"",
            "id 0192f3a4-7b1c-7def-8a90-123456789abc",
            "export PATH=/usr/local/bin:$PATH",
            "[sudo] password for deploy:",
            "Password:\nLast login: Mon Oct 13",
            "error: token expired, please log in again",
            "/usr/lib/x86_64-linux-gnu/libssl.so.3",
            "npm install --save-dev typescript-eslint",
            "Permission denied (publickey,password).",
        ];
        for text in samples {
            let out = redact(text);
            assert_eq!(out.text, text, "should not change: {text}");
            assert_eq!(out.count, 0);
        }
    }

    #[test]
    fn never_masks_twice() {
        let once = masked("DB_PASSWORD=hunter2");
        assert_eq!(masked(&once), once);
    }

    #[test]
    fn entropy_separates_hex_from_random_text() {
        assert!(shannon_entropy("0123456789abcdef0123456789abcdef") <= 4.0);
        assert!(shannon_entropy("9fK2xQ7LmZ4pR8tW1vB6nY3cD5gH0jE2") > 4.2);
    }
}

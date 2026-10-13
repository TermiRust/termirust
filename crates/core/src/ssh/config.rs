use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::{CoreError, Result};

/// One concrete host alias from an OpenSSH client config, with its settings resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshConfigHost {
    pub alias: String,
    pub hostname: String,
    pub port: u16,
    pub user: Option<String>,
    pub identity_files: Vec<PathBuf>,
    pub proxy_jump: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SshConfigImport {
    pub hosts: Vec<SshConfigHost>,
    /// Directive names present in the file that Termirust does not apply.
    pub unsupported: Vec<String>,
}

#[derive(Debug, Clone)]
struct Block {
    patterns: Vec<String>,
    /// `Match` blocks are skipped: their conditions cannot be evaluated offline.
    is_match: bool,
    options: Vec<(String, String)>,
}

const APPLIED: &[&str] = &[
    "host",
    "hostname",
    "port",
    "user",
    "identityfile",
    "proxyjump",
    "include",
    "match",
];
/// Directives with no effect on which server we reach or how we log in.
const HARMLESS: &[&str] = &[
    "addkeystoagent",
    "usekeychain",
    "identitiesonly",
    "serveraliveinterval",
    "serveralivecountmax",
    "stricthostkeychecking",
    "userknownhostsfile",
    "loglevel",
    "compression",
    "connecttimeout",
    "tcpkeepalive",
    "preferredauthentications",
    "pubkeyauthentication",
    "passwordauthentication",
    "hashknownhosts",
    "sendenv",
    "setenv",
];

/// Reads `path` (following `Include`) and resolves every concrete alias.
pub fn read_ssh_config(path: &Path, home: &Path) -> Result<SshConfigImport> {
    let mut blocks = vec![Block {
        patterns: vec!["*".into()],
        is_match: false,
        options: Vec::new(),
    }];
    let mut unsupported = BTreeSet::new();
    parse_file(path, home, &mut blocks, &mut unsupported, 0)?;
    Ok(resolve(&blocks, home, unsupported))
}

/// Parses config text that has no `Include` lines (or whose includes may be ignored).
pub fn parse_ssh_config(text: &str, home: &Path) -> SshConfigImport {
    let mut blocks = vec![Block {
        patterns: vec!["*".into()],
        is_match: false,
        options: Vec::new(),
    }];
    let mut unsupported = BTreeSet::new();
    parse_text(text, None, home, &mut blocks, &mut unsupported, 0);
    resolve(&blocks, home, unsupported)
}

fn parse_file(
    path: &Path,
    home: &Path,
    blocks: &mut Vec<Block>,
    unsupported: &mut BTreeSet<String>,
    depth: usize,
) -> Result<()> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| CoreError::InvalidData(format!("cannot read {}: {e}", path.display())))?;
    parse_text(&text, path.parent(), home, blocks, unsupported, depth);
    Ok(())
}

/// Splits a config line into keyword and value; accepts `Key Value`, `Key=Value` and quotes.
fn split_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let split = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let (key, rest) = line.split_at(split);
    let value = rest
        .trim_start_matches(|c: char| c.is_whitespace() || c == '=')
        .trim();
    Some((key.to_ascii_lowercase(), value.to_owned()))
}

fn words(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for c in value.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn parse_text(
    text: &str,
    dir: Option<&Path>,
    home: &Path,
    blocks: &mut Vec<Block>,
    unsupported: &mut BTreeSet<String>,
    depth: usize,
) {
    for line in text.lines() {
        let Some((key, value)) = split_line(line) else {
            continue;
        };
        match key.as_str() {
            "host" => blocks.push(Block {
                patterns: words(&value),
                is_match: false,
                options: Vec::new(),
            }),
            "match" => {
                unsupported.insert("Match".into());
                blocks.push(Block {
                    patterns: Vec::new(),
                    is_match: true,
                    options: Vec::new(),
                });
            }
            "include" if depth < 8 => {
                for pattern in words(&value) {
                    for file in expand_include(&pattern, dir, home) {
                        let _ = parse_file(&file, home, blocks, unsupported, depth + 1);
                    }
                }
            }
            _ => {
                if !APPLIED.contains(&key.as_str()) && !HARMLESS.contains(&key.as_str()) {
                    unsupported.insert(canonical_name(&key));
                }
                if let Some(block) = blocks.last_mut() {
                    block.options.push((key, value));
                }
            }
        }
    }
}

fn canonical_name(key: &str) -> String {
    const KNOWN: &[&str] = &[
        "LocalForward",
        "RemoteForward",
        "DynamicForward",
        "ForwardAgent",
        "ForwardX11",
        "ProxyCommand",
        "CertificateFile",
        "ControlMaster",
        "ControlPath",
        "ControlPersist",
        "RequestTTY",
        "RemoteCommand",
    ];
    KNOWN
        .iter()
        .find(|k| k.eq_ignore_ascii_case(key))
        .map(|k| (*k).to_owned())
        .unwrap_or_else(|| key.to_owned())
}

fn expand_tilde(path: &str, home: &Path) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None if path == "~" => home.to_path_buf(),
        None => PathBuf::from(path),
    }
}

/// `Include` paths are relative to ~/.ssh and may contain `*` in the file name.
fn expand_include(pattern: &str, dir: Option<&Path>, home: &Path) -> Vec<PathBuf> {
    let path = expand_tilde(pattern, home);
    let path = if path.is_absolute() {
        path
    } else {
        dir.map(|d| d.join(&path))
            .unwrap_or_else(|| home.join(".ssh").join(&path))
    };
    let file_pattern = path
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !file_pattern.contains(['*', '?']) {
        return vec![path];
    }
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let mut matches: Vec<PathBuf> = std::fs::read_dir(parent)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .is_some_and(|n| glob_match(&file_pattern, &n.to_string_lossy()))
        })
        .collect();
    matches.sort();
    matches
}

/// OpenSSH pattern matching: `*` and `?` wildcards, case-insensitive.
fn glob_match(pattern: &str, text: &str) -> bool {
    fn go(p: &[char], t: &[char]) -> bool {
        match (p.first(), t.first()) {
            (None, None) => true,
            (Some('*'), _) => go(&p[1..], t) || (!t.is_empty() && go(p, &t[1..])),
            (Some('?'), Some(_)) => go(&p[1..], &t[1..]),
            (Some(a), Some(b)) => a.eq_ignore_ascii_case(b) && go(&p[1..], &t[1..]),
            _ => false,
        }
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    go(&p, &t)
}

/// A block applies when some positive pattern matches and no negated one does.
fn block_matches(block: &Block, alias: &str) -> bool {
    if block.is_match {
        return false;
    }
    let mut matched = false;
    for pattern in &block.patterns {
        if let Some(negated) = pattern.strip_prefix('!') {
            if glob_match(negated, alias) {
                return false;
            }
        } else if glob_match(pattern, alias) {
            matched = true;
        }
    }
    matched
}

fn is_concrete(pattern: &str) -> bool {
    !pattern.contains(['*', '?', '!'])
}

fn resolve(blocks: &[Block], home: &Path, unsupported: BTreeSet<String>) -> SshConfigImport {
    let mut aliases: Vec<String> = Vec::new();
    for block in blocks.iter().skip(1).filter(|b| !b.is_match) {
        for pattern in block.patterns.iter().filter(|p| is_concrete(p)) {
            if !aliases.iter().any(|a| a.eq_ignore_ascii_case(pattern)) {
                aliases.push(pattern.clone());
            }
        }
    }

    let hosts = aliases
        .into_iter()
        .filter_map(|alias| {
            // These directives take a single argument; extra words are ignored.
            let first = |name: &str| -> Option<String> {
                blocks
                    .iter()
                    .filter(|b| block_matches(b, &alias))
                    .flat_map(|b| &b.options)
                    .find(|(k, _)| k == name)
                    .and_then(|(_, v)| words(v).into_iter().next())
            };
            let hostname = first("hostname")
                .map(|h| h.replace("%h", &alias))
                .unwrap_or_else(|| alias.clone());
            let port = match first("port") {
                Some(p) => p.parse().ok()?,
                None => 22,
            };
            let user = first("user");
            let proxy_jump = first("proxyjump").filter(|p| !p.eq_ignore_ascii_case("none"));
            let identity_files = blocks
                .iter()
                .filter(|b| block_matches(b, &alias))
                .flat_map(|b| &b.options)
                .filter(|(k, _)| k == "identityfile")
                .map(|(_, v)| {
                    expand_tilde(
                        &v.replace("%d", &home.to_string_lossy())
                            .replace("%h", &alias),
                        home,
                    )
                })
                .fold(Vec::new(), |mut acc, p| {
                    if !acc.contains(&p) {
                        acc.push(p);
                    }
                    acc
                });
            Some(SshConfigHost {
                alias,
                hostname,
                port,
                user,
                identity_files,
                proxy_jump,
            })
        })
        .collect();

    SshConfigImport {
        hosts,
        unsupported: unsupported.into_iter().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/home/me")
    }

    fn hosts(text: &str) -> Vec<SshConfigHost> {
        parse_ssh_config(text, &home()).hosts
    }

    #[test]
    fn reads_a_simple_host_block() {
        let parsed = hosts(
            "Host prod\n  HostName 10.0.1.12\n  Port 2222\n  User deploy\n  IdentityFile ~/.ssh/prod_ed25519\n",
        );
        assert_eq!(
            parsed,
            vec![SshConfigHost {
                alias: "prod".into(),
                hostname: "10.0.1.12".into(),
                port: 2222,
                user: Some("deploy".into()),
                identity_files: vec![PathBuf::from("/home/me/.ssh/prod_ed25519")],
                proxy_jump: None,
            }]
        );
    }

    #[test]
    fn hostname_defaults_to_the_alias_and_port_to_22() {
        let parsed = hosts("Host db.internal\n  User postgres\n");
        assert_eq!(parsed[0].hostname, "db.internal");
        assert_eq!(parsed[0].port, 22);
    }

    #[test]
    fn first_value_wins_and_wildcard_blocks_supply_defaults() {
        let text = "Host web\n  User www\n\nHost *\n  User root\n  Port 2200\n  IdentityFile ~/.ssh/id_ed25519\n";
        let parsed = hosts(text);
        assert_eq!(parsed[0].user.as_deref(), Some("www"));
        assert_eq!(parsed[0].port, 2200);
        assert_eq!(
            parsed[0].identity_files,
            vec![PathBuf::from("/home/me/.ssh/id_ed25519")]
        );
    }

    #[test]
    fn earlier_wildcard_blocks_win_over_later_specific_ones() {
        let text = "Host *.corp\n  User corp-user\n\nHost api.corp\n  User api-user\n  HostName 10.9.9.9\n";
        let parsed = hosts(text);
        assert_eq!(parsed[0].alias, "api.corp");
        assert_eq!(parsed[0].user.as_deref(), Some("corp-user"));
        assert_eq!(parsed[0].hostname, "10.9.9.9");
    }

    #[test]
    fn several_aliases_on_one_line_become_several_hosts_and_wildcards_are_not_hosts() {
        let parsed = hosts("Host a b *.lab !c\n  User u\n");
        assert_eq!(
            parsed.iter().map(|h| h.alias.as_str()).collect::<Vec<_>>(),
            ["a", "b"]
        );
    }

    #[test]
    fn negated_patterns_exclude_a_host_from_a_block() {
        let text = "Host bastion\n  HostName 1.2.3.4\n\nHost * !bastion\n  ProxyJump bastion\n";
        let parsed =
            parse_ssh_config(&format!("{text}Host app\n  HostName 10.0.0.2\n"), &home()).hosts;
        let bastion = parsed.iter().find(|h| h.alias == "bastion").unwrap();
        let app = parsed.iter().find(|h| h.alias == "app").unwrap();
        assert_eq!(bastion.proxy_jump, None);
        assert_eq!(app.proxy_jump.as_deref(), Some("bastion"));
    }

    #[test]
    fn accepts_equals_signs_quotes_comments_and_any_keyword_case() {
        let text = "# personal\nhost=\"my box\"\n  HOSTNAME = box.example.com # trailing words kept by ssh too\n  port=2022\n";
        let parsed = hosts(text);
        assert_eq!(parsed[0].alias, "my box");
        assert_eq!(parsed[0].port, 2022);
        assert_eq!(parsed[0].hostname, "box.example.com");
    }

    #[test]
    fn collects_every_identity_file_once_and_expands_tokens() {
        let text = "Host x\n  IdentityFile ~/.ssh/a\n  IdentityFile %d/.ssh/%h_key\n  IdentityFile ~/.ssh/a\n";
        assert_eq!(
            hosts(text)[0].identity_files,
            vec![
                PathBuf::from("/home/me/.ssh/a"),
                PathBuf::from("/home/me/.ssh/x_key")
            ]
        );
    }

    #[test]
    fn proxy_jump_none_means_no_jump_host() {
        assert_eq!(hosts("Host x\n  ProxyJump none\n")[0].proxy_jump, None);
    }

    #[test]
    fn skips_hosts_with_an_unparseable_port() {
        assert!(hosts("Host x\n  Port abc\n").is_empty());
    }

    #[test]
    fn reports_directives_it_does_not_apply_but_not_harmless_ones() {
        let text = "Host x\n  LocalForward 5432 db:5432\n  ForwardAgent yes\n  ServerAliveInterval 30\n  UseKeychain yes\nMatch host y\n  User z\n";
        let parsed = parse_ssh_config(text, &home());
        assert_eq!(
            parsed.unsupported,
            ["ForwardAgent", "LocalForward", "Match"]
        );
    }

    #[test]
    fn match_blocks_never_apply() {
        let parsed = hosts("Match all\n  User wrong\nHost x\n  HostName h\n");
        assert_eq!(parsed[0].user, None);
    }

    #[test]
    fn follows_include_files_relative_to_the_config_directory() {
        let dir = tempfile::tempdir().unwrap();
        let ssh = dir.path().join(".ssh");
        std::fs::create_dir_all(ssh.join("conf.d")).unwrap();
        std::fs::write(
            ssh.join("config"),
            "Include conf.d/*.conf\nHost main\n  HostName m\n",
        )
        .unwrap();
        std::fs::write(ssh.join("conf.d/a.conf"), "Host a\n  HostName 10.0.0.1\n").unwrap();
        std::fs::write(ssh.join("conf.d/b.conf"), "Host b\n  HostName 10.0.0.2\n").unwrap();
        std::fs::write(ssh.join("conf.d/ignored.txt"), "Host nope\n").unwrap();

        let parsed = read_ssh_config(&ssh.join("config"), dir.path()).unwrap();
        assert_eq!(
            parsed
                .hosts
                .iter()
                .map(|h| h.alias.as_str())
                .collect::<Vec<_>>(),
            ["a", "b", "main"]
        );
    }

    #[test]
    fn a_missing_config_file_is_reported() {
        assert!(matches!(
            read_ssh_config(Path::new("/nonexistent/config"), &home()),
            Err(CoreError::InvalidData(_))
        ));
    }

    #[test]
    fn glob_matching_follows_openssh_rules() {
        assert!(glob_match("*.corp", "API.corp"));
        assert!(glob_match("web-?", "web-1"));
        assert!(!glob_match("web-?", "web-10"));
        assert!(glob_match("*", ""));
        assert!(!glob_match("a*b", "ac"));
    }
}

//! Flags commands whose mistakes are hard to undo, so a suggested command is shown with a
//! warning. It is a speed bump for review, not a sandbox.

use std::sync::LazyLock;

use regex::Regex;

struct Rule {
    pattern: Regex,
    reason: &'static str,
}

static RULES: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    let rule = |pattern: &str, reason| Rule {
        pattern: Regex::new(pattern).expect("danger pattern compiles"),
        reason,
    };
    vec![
        rule(
            r"(?:^|[;&|]\s*|sudo\s+)rm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+-?[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*\s+-?[a-zA-Z]*[rR]|-[a-zA-Z]*(?:[rR][a-zA-Z]*f|f[a-zA-Z]*[rR])|--recursive\s+--force|--force\s+--recursive)",
            "deletes files recursively without asking",
        ),
        rule(r"\bmkfs(?:\.\w+)?\b", "formats a disk"),
        rule(r"\bdd\b[^\n]*\bof=/dev/", "writes raw data to a device"),
        rule(
            r">\s*/dev/(?:sd|nvme|hd|disk|mmcblk)",
            "overwrites a disk device",
        ),
        rule(
            r"\b(?:wipefs|fdisk|sfdisk|parted|gdisk)\b",
            "changes disk partitions",
        ),
        rule(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:", "fork bomb"),
        rule(
            r"\bchmod\s+(?:-[a-zA-Z]*R[a-zA-Z]*\s+)?0?777\b",
            "makes files writable by everyone",
        ),
        rule(
            r"\bch(?:own|mod)\s+-[a-zA-Z]*R[a-zA-Z]*\s+[^\n]*\s/(?:\s|$)",
            "changes ownership or permissions of the whole system",
        ),
        rule(
            r"(?i)\bdrop\s+(?:table|database|schema)\b",
            "drops database objects",
        ),
        rule(r"(?i)\btruncate\s+(?:table\s+)?\w", "empties a table"),
        rule(
            r"(?i)\bdelete\s+from\s+[\w.`\x22]+\s*(?:;|$)",
            "deletes every row (no WHERE)",
        ),
        rule(
            r"\b(?:shutdown|reboot|halt|poweroff)\b",
            "stops or restarts the machine",
        ),
        rule(r"\bkill\s+-(?:9|KILL)\s+-1\b", "kills every process"),
        rule(
            r"\bgit\s+push\b[^\n]*\s(?:--force\b|-f\b)",
            "rewrites remote history",
        ),
        rule(
            r"\bgit\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*f)",
            "discards local changes",
        ),
        rule(
            r"\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b",
            "runs a script straight from the internet",
        ),
        rule(
            r"\biptables\s+(?:-F|--flush)\b",
            "removes every firewall rule",
        ),
        rule(
            r"\bsystemctl\s+(?:stop|disable|mask)\s+(?:ssh|sshd)\b",
            "can lock you out of this server",
        ),
    ]
});

/// Why the command deserves a second look, or `None` when nothing matched.
pub fn danger(command: &str) -> Option<&'static str> {
    RULES
        .iter()
        .find(|rule| rule.pattern.is_match(command))
        .map(|rule| rule.reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_destructive_commands() {
        let samples = [
            "rm -rf /",
            "sudo rm -fr ~/projects",
            "rm -r -f build",
            "cd /tmp && rm -Rf *",
            "rm --recursive --force dist",
            "mkfs.ext4 /dev/sdb1",
            "dd if=/dev/zero of=/dev/sda bs=1M",
            "cat image > /dev/sdb",
            "fdisk /dev/nvme0n1",
            ":(){ :|:& };:",
            "chmod -R 777 /var/www",
            "chmod 777 secrets.txt",
            "sudo chown -R nobody /",
            "psql -c 'DROP TABLE users;'",
            "TRUNCATE orders",
            "DELETE FROM sessions;",
            "sudo reboot",
            "kill -9 -1",
            "git push origin main --force",
            "git push -f",
            "git reset --hard HEAD~3",
            "git clean -fdx",
            "curl -fsSL https://example.com/install.sh | sh",
            "wget -qO- https://x.y/i | sudo bash",
            "iptables -F",
            "systemctl stop sshd",
        ];
        for command in samples {
            assert!(danger(command).is_some(), "should flag: {command}");
        }
    }

    #[test]
    fn leaves_everyday_commands_alone() {
        let samples = [
            "rm file.txt",
            "rm -i old.log",
            "rm -r empty-dir",
            "ls -la /dev",
            "df -h",
            "chmod 644 index.html",
            "chmod +x deploy.sh",
            "chown -R www-data /var/www/site",
            "SELECT * FROM users WHERE id = 1;",
            "DELETE FROM sessions WHERE expires_at < now();",
            "git push origin main",
            "git reset --soft HEAD~1",
            "curl -O https://example.com/file.tar.gz",
            "systemctl restart nginx",
            "kill -9 4242",
            "docker compose down",
        ];
        for command in samples {
            assert_eq!(danger(command), None, "should not flag: {command}");
        }
    }

    #[test]
    fn explains_the_risk() {
        assert_eq!(
            danger("rm -rf /"),
            Some("deletes files recursively without asking")
        );
        assert_eq!(
            danger("DELETE FROM t"),
            Some("deletes every row (no WHERE)")
        );
    }
}

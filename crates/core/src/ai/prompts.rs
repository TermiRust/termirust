//! Builds every request sent to a provider. The preview shows the output of these same
//! functions, so what the user approves is exactly what leaves the machine.

use super::provider::{ChatMessage, ChatRequest, Role};
use super::redact::redact;

/// What the model may know about where the command will run. Never hostnames, IPs or users.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellContext {
    /// e.g. "macOS (zsh)" or "a remote Unix-like server".
    pub environment: String,
}

impl ShellContext {
    /// This machine: OS family and the login shell's name only.
    pub fn local() -> Self {
        let os = match std::env::consts::OS {
            "macos" => "macOS",
            "windows" => "Windows",
            "linux" => "Linux",
            other => other,
        };
        let shell = std::env::var("SHELL")
            .ok()
            .and_then(|s| s.rsplit('/').next().map(str::to_owned))
            .filter(|s| !s.is_empty());
        Self {
            environment: match shell {
                Some(shell) => format!("{os} ({shell})"),
                None => os.to_owned(),
            },
        }
    }

    pub fn remote() -> Self {
        Self {
            environment: "a remote Unix-like server reached over SSH (assume bash or POSIX sh)"
                .into(),
        }
    }
}

/// A request ready to send, plus how many secrets were masked in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedRequest {
    pub chat: ChatRequest,
    pub masked: usize,
}

const COMMAND_SYSTEM: &str = "You turn a request into one shell command for the user's terminal. \
Reply with the command only, on a single line, without code fences or commentary. \
Prefer standard, widely available tools. If the request cannot be done safely in one command, \
reply with a line starting with '# ' that explains why.";

const EXPLAIN_SYSTEM: &str = "You explain terminal output, errors and commands to a developer. \
Be brief and concrete: what it means, the likely cause, and how to fix it. \
Put any command the user could run in its own ```sh code block. \
Parts shown as [REDACTED:…] were masked on purpose; do not ask for them.";

pub fn command_request(request: &str, context: &ShellContext) -> PreparedRequest {
    let masked = redact(request.trim());
    PreparedRequest {
        chat: ChatRequest {
            system: format!(
                "{COMMAND_SYSTEM}\nThe command will run on {}.",
                context.environment
            ),
            messages: vec![ChatMessage {
                role: Role::User,
                content: masked.text,
            }],
            max_tokens: 300,
        },
        masked: masked.count,
    }
}

/// `question` is optional; without one the model explains the selection.
pub fn explain_request(selection: &str, question: &str, context: &ShellContext) -> PreparedRequest {
    let selection = redact(selection.trim_end());
    let question = redact(question.trim());
    let ask = if question.text.is_empty() {
        "Explain this.".to_owned()
    } else {
        question.text
    };
    PreparedRequest {
        chat: ChatRequest {
            system: format!(
                "{EXPLAIN_SYSTEM}\nThe terminal is connected to {}.",
                context.environment
            ),
            messages: vec![ChatMessage {
                role: Role::User,
                content: format!("{ask}\n\n```\n{}\n```", selection.text),
            }],
            max_tokens: 1200,
        },
        masked: selection.count + question.count,
    }
}

/// The command in a reply, tolerating code fences or a leading "$ "; `None` when the model
/// declined (a "# " line) or said nothing usable.
pub fn extract_command(reply: &str) -> Option<String> {
    let line = reply
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with("```"))?;
    if line.starts_with('#') {
        return None;
    }
    let line = line
        .strip_prefix("$ ")
        .unwrap_or(line)
        .trim_matches('`')
        .trim();
    (!line.is_empty()).then(|| line.to_owned())
}

/// Commands inside ```sh / ```bash / plain ``` blocks of an explanation.
pub fn code_blocks(reply: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current: Option<Vec<&str>> = None;
    for line in reply.lines() {
        let trimmed = line.trim_start();
        if let Some(lang) = trimmed.strip_prefix("```") {
            match current.take() {
                Some(lines) => {
                    let block = lines.join("\n").trim().to_owned();
                    if !block.is_empty() {
                        blocks.push(block);
                    }
                }
                None if matches!(
                    lang.trim(),
                    "" | "sh" | "bash" | "shell" | "zsh" | "console"
                ) =>
                {
                    current = Some(Vec::new())
                }
                None => current = None,
            }
        } else if let Some(lines) = current.as_mut() {
            lines.push(line);
        }
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_requests_carry_only_the_environment_and_masked_text() {
        let prepared = command_request(
            "connect with password=hunter2 and list dbs",
            &ShellContext::remote(),
        );
        assert_eq!(prepared.masked, 1);
        let user = &prepared.chat.messages[0].content;
        assert!(user.contains("password=[REDACTED:secret]"));
        assert!(!user.contains("hunter2"));
        assert!(prepared.chat.system.contains("remote Unix-like server"));
    }

    #[test]
    fn explain_requests_mask_the_selection_and_default_the_question() {
        let prepared = explain_request(
            "Error: AKIAIOSFODNN7EXAMPLE denied\n",
            "",
            &ShellContext::remote(),
        );
        assert_eq!(prepared.masked, 1);
        let user = &prepared.chat.messages[0].content;
        assert!(user.starts_with("Explain this.\n\n```\nError: [REDACTED:aws-key] denied\n```"));
    }

    #[test]
    fn local_context_names_os_and_shell_only() {
        let context = ShellContext::local();
        assert!(
            !context.environment.contains('/'),
            "{}",
            context.environment
        );
    }

    #[test]
    fn extracts_the_command_from_common_reply_shapes() {
        assert_eq!(extract_command("ls -la\n"), Some("ls -la".into()));
        assert_eq!(
            extract_command("```sh\ndu -sh *\n```"),
            Some("du -sh *".into())
        );
        assert_eq!(extract_command("$ df -h"), Some("df -h".into()));
        assert_eq!(extract_command("`uptime`"), Some("uptime".into()));
        assert_eq!(extract_command("# That would delete your data."), None);
        assert_eq!(extract_command("  \n"), None);
    }

    #[test]
    fn finds_shell_code_blocks_in_an_explanation() {
        let reply = "The port is taken.\n```sh\nlsof -i :8080\n```\nThen:\n```bash\nkill 4242\n```\n```json\n{}\n```";
        assert_eq!(code_blocks(reply), ["lsof -i :8080", "kill 4242"]);
        assert!(code_blocks("no code here").is_empty());
    }
}

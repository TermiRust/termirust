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

/// A piece of terminal output the user attached, labelled with where it came from (e.g. "L35–L55").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quote {
    pub label: String,
    pub text: String,
}

const CHAT_SYSTEM: &str = "You are the assistant inside an SSH client, helping a developer at the terminal. \
Answer in GitHub-flavored Markdown and keep it concise. \
Put every command the user could run in its own ```sh code block, one command per block when you can, \
and never assume a command was run. \
Parts shown as [REDACTED:…] were masked on purpose; do not ask for them.";

/// Older turns kept, so long conversations do not grow without bound.
const MAX_HISTORY_TURNS: usize = 8;
const MAX_QUOTE_CHARS: usize = 12_000;
const MAX_SCREEN_CHARS: usize = 8_000;

/// Keeps the end of long text (the newest output matters most) and says it was cut.
fn tail(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let kept: String = text
        .chars()
        .rev()
        .take(max)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("[… earlier lines cut]\n{kept}")
}

/// One turn of a conversation; history and the new message are all masked before sending.
pub fn chat_request(
    history: &[ChatMessage],
    message: &str,
    quotes: &[Quote],
    screen: Option<&str>,
    context: &ShellContext,
) -> PreparedRequest {
    let mut masked = 0;
    let mut clean = |text: &str| {
        let r = redact(text);
        masked += r.count;
        r.text
    };

    let skip = history.len().saturating_sub(MAX_HISTORY_TURNS);
    let mut messages: Vec<ChatMessage> = history[skip..]
        .iter()
        .map(|m| ChatMessage {
            role: m.role,
            content: clean(&m.content),
        })
        .collect();

    let mut content = String::new();
    let question = message.trim();
    content.push_str(if question.is_empty() {
        "Explain this."
    } else {
        question
    });
    let mut quote_budget = MAX_QUOTE_CHARS;
    for quote in quotes {
        let text = tail(quote.text.trim_end(), quote_budget);
        quote_budget = quote_budget.saturating_sub(text.chars().count());
        content.push_str(&format!(
            "\n\nQuoted from the terminal ({}):\n```\n{}\n```",
            quote.label,
            clean(&text)
        ));
    }
    if let Some(screen) = screen.map(str::trim_end).filter(|s| !s.is_empty()) {
        let text = tail(screen, MAX_SCREEN_CHARS);
        content.push_str(&format!(
            "\n\nCurrent terminal screen:\n```\n{}\n```",
            clean(&text)
        ));
    }
    messages.push(ChatMessage {
        role: Role::User,
        content,
    });

    PreparedRequest {
        chat: ChatRequest {
            system: format!(
                "{CHAT_SYSTEM}\nThe terminal is connected to {}.",
                context.environment
            ),
            messages,
            max_tokens: 1500,
        },
        masked,
    }
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

    fn turn(role: Role, content: &str) -> ChatMessage {
        ChatMessage {
            role,
            content: content.into(),
        }
    }

    #[test]
    fn asks_for_markdown_and_names_only_the_environment() {
        let prepared = chat_request(
            &[],
            "why is nginx down?",
            &[],
            None,
            &ShellContext::remote(),
        );
        assert!(prepared.chat.system.contains("GitHub-flavored Markdown"));
        assert!(prepared.chat.system.contains("remote Unix-like server"));
        assert_eq!(
            prepared.chat.messages,
            vec![turn(Role::User, "why is nginx down?")]
        );
    }

    #[test]
    fn attaches_labelled_quotes_and_the_screen_with_secrets_masked() {
        let quotes = [Quote {
            label: "L35–L55".into(),
            text: "Error: DB_PASSWORD=hunter2 rejected\n".into(),
        }];
        let prepared = chat_request(
            &[],
            "",
            &quotes,
            Some("$ export API_TOKEN=abc\n$ "),
            &ShellContext::remote(),
        );
        let user = &prepared.chat.messages[0].content;
        assert!(user.starts_with("Explain this."));
        assert!(user.contains("Quoted from the terminal (L35–L55):\n```\nError: DB_PASSWORD=[REDACTED:secret] rejected\n```"));
        assert!(user.contains(
            "Current terminal screen:\n```\n$ export API_TOKEN=[REDACTED:secret]\n$\n```"
        ));
        assert!(!user.contains("hunter2") && !user.contains("=abc"));
        assert_eq!(prepared.masked, 2);
    }

    #[test]
    fn keeps_recent_history_masked_and_bounded() {
        let mut history: Vec<ChatMessage> = (0..20)
            .map(|i| {
                turn(
                    if i % 2 == 0 {
                        Role::User
                    } else {
                        Role::Assistant
                    },
                    &format!("turn {i}"),
                )
            })
            .collect();
        history[19] = turn(Role::Assistant, "use password=s3cret");
        let prepared = chat_request(&history, "and now?", &[], None, &ShellContext::remote());
        assert_eq!(prepared.chat.messages.len(), MAX_HISTORY_TURNS + 1);
        assert_eq!(prepared.chat.messages[0].content, "turn 12");
        assert!(
            prepared.chat.messages[MAX_HISTORY_TURNS - 1]
                .content
                .contains("[REDACTED:secret]")
        );
    }

    #[test]
    fn cuts_huge_output_from_the_start_keeping_the_newest_lines() {
        let screen = format!("{}\nLAST LINE", "x".repeat(20_000));
        let prepared = chat_request(&[], "?", &[], Some(&screen), &ShellContext::remote());
        let user = &prepared.chat.messages[0].content;
        assert!(user.contains("[… earlier lines cut]"));
        assert!(user.contains("LAST LINE"));
        assert!(user.len() < 9_000);
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
    fn finds_shell_code_blocks_in_an_explanation() {
        let reply = "The port is taken.\n```sh\nlsof -i :8080\n```\nThen:\n```bash\nkill 4242\n```\n```json\n{}\n```";
        assert_eq!(code_blocks(reply), ["lsof -i :8080", "kill 4242"]);
        assert!(code_blocks("no code here").is_empty());
    }
}

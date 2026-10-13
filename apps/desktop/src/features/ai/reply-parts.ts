export type ReplyPart = { kind: "text"; text: string } | { kind: "code"; code: string; shell: boolean };

const SHELL_LANGS = new Set(["", "sh", "bash", "shell", "zsh", "console"]);

/** Splits a reply into prose and fenced code blocks; an unfinished block (still streaming) counts as code. */
export function splitReply(reply: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let text: string[] = [];
  let code: string[] | null = null;
  let shell = false;
  const flushText = () => {
    const joined = text.join("\n").trim();
    if (joined) parts.push({ kind: "text", text: joined });
    text = [];
  };
  for (const line of reply.split("\n")) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      if (code === null) {
        flushText();
        code = [];
        shell = SHELL_LANGS.has((fence[1] ?? "").trim().toLowerCase());
      } else {
        parts.push({ kind: "code", code: code.join("\n").trim(), shell });
        code = null;
      }
    } else if (code !== null) {
      code.push(line);
    } else {
      text.push(line);
    }
  }
  if (code !== null) parts.push({ kind: "code", code: code.join("\n").trim(), shell });
  flushText();
  return parts.filter((p) => p.kind === "text" || p.code.length > 0);
}

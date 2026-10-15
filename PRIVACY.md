# Privacy

Termirust is local-first. It has **no telemetry, no analytics and no account**.

## What stays on your machine

Hosts, groups, snippets, keys, passwords, settings and AI chat history are stored in an
encrypted vault on your computer. The vault key lives in the operating system keychain.
Logs never contain passwords, keys, passphrases or terminal content.

## When Termirust talks to the network

| When | To whom | What is sent |
|---|---|---|
| You connect to a host | That server (and any jump host) | Your SSH login, then whatever you type |
| Monitor screen | The hosts you chose | A read-only command reading `/proc` |
| Update check (can be turned off in Settings › About) | GitHub (`github.com`) | A request for the latest release; GitHub sees your IP address |
| You use the AI assistant | The provider you configured (OpenAI, Anthropic, DeepSeek, Gemini, any OpenAI-compatible endpoint, or Ollama running on your own machine) | Your question, any lines you quoted, and the terminal screen only if you switch it on. Passwords and keys found in that text are masked before sending. The first request of a session can be previewed. |

The AI assistant is off until you add a provider and can be disabled per host. Each
provider's own privacy policy applies to what it receives.

## Paid sync (future)

The planned sync service will be end-to-end encrypted: the server stores only data
encrypted with keys it never sees. This document will be updated before it launches.

Questions: open an issue, or see [SECURITY.md](SECURITY.md) for private reports.

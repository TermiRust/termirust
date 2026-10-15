# Termirust 🦀

An open-source, local-first SSH client **written in Rust** with Tauri.
Lightweight, fast and fully offline — no account required.
End-to-end encrypted sync and team features will be the paid tier (open-core).

> **Status: pre-release (0.x).** Usable day to day, but expect rough edges and breaking
> changes until 1.0. Please [report problems](https://github.com/termirust/termirust/issues/new/choose).

## Features

- **SSH terminals** — password, key and agent login, jump hosts, host key verification,
  auto-reconnect, tabs that shrink and overflow into a searchable switcher.
- **Split panes** — side by side or stacked, each pane on a different server, with
  broadcast input to type into all of them at once.
- **Host library** — groups, tags, PROD/STAGING markers with a terminal watermark,
  OS icons, import from `~/.ssh/config`.
- **SFTP** — two-panel browser with drag and drop, transfer queue, right-click menu,
  in-place editing of text files, open with any app.
- **Monitor** — CPU, memory, disk, IP, uptime and top processes of several servers at a glance.
- **Port forwarding** — local, remote and dynamic (SOCKS) tunnels.
- **Snippets** — reusable commands with variables, run on one or many hosts.
- **AI assistant** (optional, bring your own key) — chat beside the terminal, quote
  output by line, insert suggested commands; dangerous commands are flagged.
- **Encrypted vault** — every secret encrypted on disk with a key kept in the OS keychain.
  No telemetry; nothing leaves your machine unless you use AI or connect to a server.

## Install

Download the installer for your platform from the
[latest release](https://github.com/termirust/termirust/releases/latest)
(macOS Apple Silicon / Intel, Windows, Linux AppImage / .deb). The app checks for updates
itself (Settings › About).

## Build from source

Requirements: Rust (see `rust-toolchain.toml`), Node.js 22, pnpm.

```sh
pnpm install
pnpm --filter @termirust/desktop tauri dev     # run in development
pnpm --filter @termirust/desktop tauri build   # build an installer
```

Tests: `cargo test --workspace` and `pnpm --filter @termirust/desktop test`.
Integration tests use Docker SSH servers: `docker compose -f docker/test-ssh.yml up -d`,
then `cargo test -p termirust-core --features integration`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).
By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[AGPL-3.0-only](LICENSE). Contributions require signing the [CLA](CLA.md).
The name and logo are covered by the [trademark policy](TRADEMARKS.md).
See also [PRIVACY.md](PRIVACY.md).

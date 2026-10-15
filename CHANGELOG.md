# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/) (0.x: minor versions may break things).

## [Unreleased] — first public release (0.1.0)

### Added
- SSH terminals with password, key and agent login, jump hosts, host key verification,
  auto-reconnect with countdown, and a disconnect banner that keeps the output.
- Tabs that shrink and overflow into a searchable switcher; split panes (side by side or
  stacked), each able to open a different server, with broadcast input.
- Host library: grid/list views, groups with drag and drop, tags, PROD/STAGING markers
  with a terminal watermark, OS detection and icons, import from `~/.ssh/config`.
- SFTP: two-panel browser, drag and drop, transfer queue, right-click menu, new file and
  folder, in-place text editor, open with the default or a chosen app.
- Monitor: CPU, memory, swap, disk, addresses, uptime and top processes per server.
- Port forwarding: local, remote and dynamic (SOCKS) tunnels.
- Snippets with variables, run on one or several hosts.
- Optional AI assistant (bring your own provider): chat beside the terminal, line-labelled
  quotes, suggested commands with danger warnings, per-server chat history.
- Encrypted vault with the key in the OS keychain; onboarding that explains it first.
- App-wide themes, iTerm2 / Windows Terminal scheme import, frameless window on Windows.
- About screen with license notices and third-party licenses; signed automatic updates,
  including updates a release can make mandatory.

### Security
- The webview's Reload menu and reload shortcuts are blocked so a stray click cannot drop
  every open session.

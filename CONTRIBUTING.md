# Contributing to Termirust

Thanks for your interest! Termirust is an open-source SSH client written in Rust.

## Before you start

- Look at the [open issues](https://github.com/TermiRust/termirust/issues); `good first issue` is a good start.
- For anything larger, open an issue first so we can agree on the approach.
- `crates/core` holds SSH, SFTP, the vault and storage (no Tauri); `apps/desktop` is the Tauri
  shell (`src-tauri`) and the React UI (`src`). Secrets never reach the webview or the logs.

## Workflow

1. Fork and create a branch: `feat/password-auth` or `fix/hostkey-prompt`.
2. Keep one change per pull request, linked to its issue.
3. Add tests. Rust logic needs unit tests; UI logic needs Vitest tests.
4. Run the checks locally:

   ```sh
   cargo fmt --all --check
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --workspace
   pnpm --filter @termirust/desktop lint
   pnpm --filter @termirust/desktop typecheck
   pnpm --filter @termirust/desktop test
   ```

5. Commit with [Conventional Commits](https://www.conventionalcommits.org):
   `feat(ssh): password auth (#123)`.
6. Open a pull request using the template.

## Contributor License Agreement

All contributions require signing the [CLA](CLA.md). The CLA bot comments on your first
pull request; reply with the sentence it asks for. You keep the copyright of your work.

## Security

Never open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

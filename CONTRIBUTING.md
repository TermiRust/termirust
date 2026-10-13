# Contributing to Termirust

Thanks for your interest! Termirust is an open-source SSH client written in Rust.

## Before you start

- Read [`CLAUDE.md`](CLAUDE.md) and the docs in [`docs/`](docs/index.html) (architecture, data model, security).
- Pick a task from the task board (`docs/11-tasks.html`). Tasks marked ⚡ have all dependencies done.
- For anything not on the board, open an issue first so we can agree on the approach.

## Workflow

1. Fork and create a branch: `feat/T-121-password-auth` or `fix/T-124-hostkey-prompt`.
2. Keep one task per pull request and meet every acceptance criterion listed for it.
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

5. Commit with [Conventional Commits](https://www.conventionalcommits.org) and the task ID:
   `feat(ssh): password auth [T-121]`.
6. Open a pull request using the template.

## Contributor License Agreement

All contributions require signing the [CLA](CLA.md). The CLA bot comments on your first
pull request; reply with the sentence it asks for. You keep the copyright of your work.

## Security

Never open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

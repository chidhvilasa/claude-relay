# Contributing to Claude Relay

## Architecture
- Core is completely agnostic of VS Code.
- No UI scraping or unauthorized credentials usage.
- All handoff and checkpoint operations must pass JSON Schema validation.

## Setup
1. `git clone` the repository.
2. Ensure `corepack enable pnpm` is active.
3. Run `pnpm install`
4. Run `pnpm lint`
5. Run `pnpm typecheck`
6. Run `pnpm test`
7. Run `pnpm build`
8. Run `pnpm package` to generate the `.vsix`

Follow standard GitHub Flow (fork, branch, pull request) for submitting patches.

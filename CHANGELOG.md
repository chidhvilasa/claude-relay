# Changelog

## [0.2.2] - VS Code Companion only (Plugin remains 0.2.0)
### Fixed (found by writing real automated tests, second pass)
- `.relay/` now self-gitignores — writing a checkpoint/handoff no longer changes `git status`'s dirty-file
  count, which previously made a just-created handoff immediately report `POSSIBLY_STALE` in any project
  that hadn't manually gitignored `.relay/`.
- The `execFile(..., { shell: false })` hardening below broke plugin detection entirely on Windows for
  any `claude` CLI installed via `npm install -g` (a `.cmd` shim) — Windows doesn't resolve `.cmd`/`.bat`
  without a shell. Fixed with a platform-conditional shell, still safe since every argument is a fixed
  literal.
- All 11 commands now register *before* the async plugin-status check, not after — previously every
  Claude Relay command was "command not found" for however long that check took after VS Code started.
- The extension-host test suite now runs and passes (4/4): fixed `ELECTRON_RUN_AS_NODE` poisoning the
  downloaded test binary in sandboxed dev environments, and moved the test cache/profile out of the repo.
- `tsc --noEmit` never covered `tests/` in any package; added per-package typecheck configs that do.
- Added automated test suites that didn't exist before: `hook-runtime` (17 tests, was 0), plus
  `relay-service`, `legacy-migration`, `plugin-detector`, and `marketplace-metadata` suites for
  `packages/vscode` (40 tests, was 2).

### Fixed (first pass)
- Manual `Create Checkpoint` / `Create Handoff Now` / `Resume Previous Task` commands were UI stubs;
  wired them to the existing (previously unused) `@claude-relay/core` storage/resume logic.
- Registered 6 commands declared in `package.json` but never implemented (`setup`, `openLatestHandoff`,
  `openDashboard`, `clearResolvedHandoff`, `reinstallClaudeIntegration`, `removeClaudeIntegration`,
  `showLogs`) — invoking them previously produced a "command not found" error.
- Dashboard "Recovery" row was a hardcoded string; now reflects real checkpoint/handoff state.
- Multi-root workspaces now prompt for a target folder instead of silently defaulting to the first one.
- `DefaultGitProvider` git calls had no timeout/output bound; a hung `git` process hung Relay. Added a
  5s timeout and bounded output, and safe degradation for zero-commit repositories.
- `plugin-detector.ts` used shell-based `exec()` with no timeout; switched to `execFile` with structured
  args, a timeout, bounded output, and a short-lived cache.
- `StaleDetector` could throw on a schema-valid handoff missing optional git-status arrays.
- `LegacyMigrator` wrote the user's global `~/.claude/settings.json` non-atomically; now atomic
  (temp file + rename).
- `WakeupGenerator` wrote `.relay/WAKEUP.md` non-atomically; now atomic.
- `SecretRedactor` was unit-tested but never called from the handoff-generation path; wired in.
- Generated handoff/resume text now explicitly labels itself untrusted historical context.
- `packages/vscode` had no `typecheck` script, so CI's `pnpm typecheck` silently skipped it.
- Fixed a pre-existing lint failure in `hook-runtime` blocking `pnpm lint`.
- `@vscode/test-electron` version mismatch between root (`^3.1.0`) and `packages/vscode` (`^2.4.1`)
  caused a real bug: on a workspace path containing a space, the older version's Windows spawn logic
  split `--extensionTestsPath=...` and crashed the test runner. Aligned to `^3.1.0`.

### Marketplace / discoverability
- Added `icon` (extension shipped with none; its own activity-bar icon path also pointed at a
  nonexistent file), `bugs`, `homepage`, `license`, fuller `keywords`, corrected `repository.url`.
- Added `packages/vscode/README.md` (the Marketplace page body was previously empty).
- Added `LICENSE` and `.vscodeignore` to the packaged extension — VSIX no longer ships the TypeScript
  `src/` tree, `tsconfig.json`, or compiled test files (40 files/102 KB → 16 files/81 KB).
- Corrected `docs/VS_CODE_COMPANION_AUDIT.md`, which described a webview-based dashboard that has never
  existed in this extension (the dashboard is a native `TreeDataProvider`).

### Corrected records
- `docs/RELEASE_NOTES_V0_2_1.md` previously claimed UX/reliability/webview-security improvements that
  never shipped — `git diff v0.2.0 v0.2.1` shows v0.2.1 was a version-number-only release. Corrected.

## [0.2.1] - VS Code Companion only (Plugin remains 0.2.0)
### Changed
- Version-number-only release (Marketplace publish checkpoint). No functional code changes.

## [0.2.0]
### Added
- Claude Relay Plugin manifest (`plugin.json`).
- Claude Relay Marketplace manifest (`marketplace.json`) pointing to immutable Git tag.
- Standalone zero-dependency `hook-runtime` executing via `spawnSync`.
- Native Claude Code Skill (`/claude-relay:relay`) bundled within plugin.
- Companion VS Code Extension dashboard for Plugin tracking.
- Automated legacy hook migrator (`LegacyMigrator`).

### Changed
- Refactored `extension.ts` to remove legacy automatic hook injection into `settings.json`.
- Restructured workspace packages to isolate `hook-runtime` from `vscode` dependencies.
- Tightened filesystem boundaries and path resolutions across the core API.

### Removed
- `PostCompact`, `Stop`, and `SessionEnd` automatic hooks to minimize attack surface.

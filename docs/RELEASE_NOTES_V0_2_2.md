# Claude Relay VS Code Companion v0.2.2

Patch release. Claude Relay Plugin stays at `0.2.0` — no plugin defect was found, so it was not bumped.

This release was produced by a source-level audit (not a pure metadata patch like v0.2.1 — see the
correction in `docs/RELEASE_NOTES_V0_2_1.md`). Every item below was verified against a diff, a passing
test, or a reproduced failure; nothing here is aspirational.

## Fixed — functionality
The manual commands were UI stubs that showed a success message without doing anything, while
`@claude-relay/core` already had working, tested checkpoint/handoff/resume logic that was simply never
called from the extension:
- `Claude Relay: Create Checkpoint` and `Create Handoff Now` now actually write to `.relay/` (they
  previously only showed a toast).
- `Claude Relay: Resume Previous Task` now loads the latest handoff, evaluates staleness against the
  current Git state, and opens the resume instruction.
- Registered 6 commands that were declared in `package.json` but never implemented, so invoking them
  produced a VS Code "command not found" error: `claudeRelay.setup`, `openLatestHandoff`,
  `openDashboard`, `clearResolvedHandoff`, `reinstallClaudeIntegration`, `removeClaudeIntegration`,
  `showLogs`.
- The dashboard's "Recovery" row was a hardcoded string (`Last checkpoint: unknown, Handoff: None`) that
  never changed. It now reflects the real latest checkpoint/handoff and freshness.
- Multi-root workspaces now prompt for which folder a manual action targets instead of silently guessing
  the first one.

## Fixed — reliability
- `DefaultGitProvider`'s git calls had no timeout; a hung `git` process would hang Relay indefinitely.
  Added a 5s timeout and a bounded output cap, matching the pattern already used by the hook runtime.
- A freshly-initialized repository (zero commits) reported a blank `HEAD` as if it were valid instead of
  degrading safely.
- `plugin-detector.ts` shelled out via `exec()` with no timeout or output bound; switched to `execFile`
  with structured arguments, a 5s timeout, and a bounded buffer. Added a 3s in-memory cache (invalidated
  on manual refresh, migration, and reinstall) so rapid dashboard refreshes don't each spawn `claude`.
- `StaleDetector` read `handoff.git.staged/unstaged/untracked`, which the handoff JSON schema doesn't
  require — a schema-valid handoff missing those fields would crash resume with a `TypeError`. Now
  defaults to empty.
- `LegacyMigrator` wrote the user's global `~/.claude/settings.json` with a plain (non-atomic)
  `writeFileSync`. A crash mid-write could have corrupted a file Relay doesn't own. Now writes via
  temp-file + rename, consistent with the checkpoint/handoff stores.
- `WakeupGenerator` wrote `.relay/WAKEUP.md` non-atomically; switched to the same temp+rename pattern.

## Fixed — security hardening
- `SecretRedactor` existed and was unit-tested but was never called from the handoff-generation path.
  Wired it into `WakeupGenerator` and `ResumeReconciler` so semantic handoff text is scanned before it's
  written to disk or surfaced to a resuming session.
- Neither the generated `WAKEUP.md` nor the resume instruction text labeled historical handoff content as
  untrusted. Both now open with an explicit "untrusted historical context" notice instructing the reader
  not to treat embedded text as a command.

## Fixed — CI / test infra
- `packages/vscode` had no `typecheck` script, so `pnpm typecheck` (used by CI on both Windows and Linux)
  silently skipped the extension entirely. Added the script; it now runs and passes.
- Fixed a pre-existing `no-constant-condition` ESLint failure in `hook-runtime` that was failing
  `pnpm lint`.
- `packages/vscode`'s `@vscode/test-electron` was pinned to `^2.4.1` while the workspace root pinned
  `^3.1.0` — two different versions resolved across the workspace. Reproduced a real bug caused by this:
  on a workspace path containing a space (this repo's own path), `@vscode/test-electron@2.5.2`'s Windows
  spawn logic (`shell: true` for any Windows executable) split `--extensionTestsPath=...` on the space,
  crashing the extension-host test runner before a single test ran. `@vscode/test-electron@3.1.0` only
  uses a shell for `.cmd` wrappers, which fixes it. Aligned the version to `^3.1.0`.

## Marketplace / discoverability
- Added `icon` (the extension previously shipped with no Marketplace icon, and its activity-bar icon
  path — `media/icon.svg` — pointed at a file that didn't exist in the package).
- Added `bugs`, `homepage`, `license`, and a fuller `keywords` list; corrected `repository.url`.
- The packaged VSIX had no `packages/vscode/README.md`, so the Marketplace page body was effectively
  empty below the description. Added one.
- The VSIX had no `LICENSE` and no `.vscodeignore`, so it shipped the full TypeScript `src/` tree,
  `tsconfig.json`, and compiled test files alongside the runtime bundle (40 files, 102 KB). Added both;
  the packaged VSIX is now 16 files, 81 KB.
- Corrected `docs/VS_CODE_COMPANION_AUDIT.md`, which described a webview-based dashboard and command IDs
  that don't match the shipped extension (the dashboard has always been a native `TreeDataProvider`).

## Verified, not changed
- No network code, no authentication/credential handling, no automatic Git mutation (commit/push/reset/
  etc.) anywhere in `packages/core`, `packages/hook-runtime`, or `packages/vscode`.
- No webview exists in this extension, so webview-specific hardening doesn't apply yet.
- `packages/core` test suite: 17/17 passing (`state-machine`, `redactor`, `usage-providers`, `security`).
- Atomic writes (temp file + rename) were already correct in `checkpoint-store.ts` and `handoff-store.ts`
  prior to this release.

## Not verified in this release (requires a human driving VS Code / Claude Code interactively)
Live testing through the actual Claude Code VS Code extension (`/plugins`, real `SessionStart`/
`PreCompact`/`StopFailure` firing, real OAuth-authenticated resume), multi-window and multi-root GUI
testing, WSL/Remote-SSH/Dev Container behavior, Marketplace search-indexing latency, and
accessibility/screen-reader passes were not performed — they require a live, human-driven VS Code session
this audit did not have. See the audit summary for the full list.

## Compatibility
Compatible with: Claude Relay Plugin v0.2.0 (unchanged; no plugin defect found).

## Remote environments
No change this release. Still degraded as before; not re-verified live (see above).

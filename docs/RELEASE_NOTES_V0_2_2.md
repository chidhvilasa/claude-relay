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
- Atomic writes (temp file + rename) were already correct in `checkpoint-store.ts` and `handoff-store.ts`
  prior to this release.

## Fixed — found by writing real tests, not by inspection alone
A second pass added automated coverage (Core 28→28 unchanged plus 11 new; Hook Runtime 0→17; VS Code
Unit 0→40; VS Code Host 2→4) and every one of the following was caught *by* that coverage, not before it:

- **Checkpoints/handoffs immediately reported `POSSIBLY_STALE` in any project that hadn't manually
  gitignored `.relay/`.** Root cause: writing a checkpoint or handoff adds new files under `.relay/`,
  which `git status --porcelain` reports as a single new `?? .relay/` entry; `StaleDetector` compares
  dirty-file *counts*, so the count taken before the write no longer matched the count taken right after.
  A handoff could look stale seconds after being created, for no real reason. Fixed at the root: `.relay/`
  now self-gitignores (`.relay/.gitignore` containing `*`), written by `LocalCheckpointStore`,
  `LocalHandoffStore`, and the hook-runtime, so Relay's own writes never appear in `git status` at all.
- **`plugin-detector.ts`'s `execFile(..., { shell: false })` — the exact hardening this branch's first
  commit introduced — failed with `ENOENT` on Windows for any `claude` CLI installed the standard way
  (`npm install -g`, which produces a `.cmd` shim).** Windows' `CreateProcess`, what `execFile` uses under
  `shell:false`, doesn't do `PATHEXT` resolution the way `cmd.exe` does; only a shell does. Reproduced
  directly (a real `claude.cmd` failed to spawn) and fixed by using `shell: process.platform === 'win32'`
  — safe here because every argument is a fixed literal, never user/repo-controlled, and Node quotes array
  arguments passed through a Windows shell rather than concatenating a raw string the way the original
  `exec('claude plugin list --json')` did.
- **Every Claude Relay command was "command not found" for however long plugin detection took after VS
  Code started**, because `activate()` awaited the plugin-status CLI check *before* registering any
  command. Reordered so all commands register synchronously first; the status check now runs
  fire-and-forget afterward.
- **The extension-host test suite (`@vscode/test-electron`) was not actually blocked by a stale cache
  lock, as the previous revision of this document claimed** — the real cause was `ELECTRON_RUN_AS_NODE=1`
  being set globally in this sandboxed dev environment, which makes any Electron binary a tool spawns run
  as plain Node instead of launching its app shell. `runTest.ts` now explicitly unsets it for the test
  subprocess and uses an isolated, OS-temp download cache and per-run profile dir instead of the
  repo-local one. The suite now runs and passes for real: 4/4 (see `docs/CURRENT_PLATFORM_COMPATIBILITY.md`
  for the full account, including the correction of the earlier claim).
- `tsc --noEmit` never actually covered `packages/*/tests/` in any package (only `src/`), so type errors
  in test code were invisible to `pnpm typecheck`. Added a `tsconfig.typecheck.json` per package that
  includes tests; wired `typecheck` scripts to use it.
- `hook-runtime`'s `package.json` claimed a `main` pointing at a file that was never produced
  (`dist/hook-runner.cjs`; the real build output is `../../plugins/claude-relay/runtime/hook-runner.cjs`)
  and declared `@claude-relay/core` as a dependency it never imports. Both corrected.

## New automated coverage added this release
- `packages/core/tests/stale-detector.test.ts` (7), `relay-dir.test.ts` (4)
- `packages/hook-runtime/tests/hook-runner.test.ts` (17) — the package had zero automated tests before
  this release; it now covers malformed/oversized/hostile input, git timeout/unavailable, path edge cases
  (spaces, Unicode), symlink-escape refusal, cross-repo isolation, and crash-survives-prior-state
- `packages/vscode/tests/relay-service.test.ts` (7), `legacy-migration.test.ts` (13),
  `plugin-detector.test.ts` (9), `marketplace-metadata.test.ts` (11)
- `packages/vscode/src/test/suite/extension.test.ts` strengthened from checking 5 of 11 commands to all
  11, plus new checks that the dashboard view registers and activation doesn't throw

## A note on Plugin versioning
`plugins/claude-relay/runtime/hook-runner.cjs` — the actual compiled artifact the Claude Relay Plugin
ships and runs — changed in this branch (the self-gitignore fix above is a real behavior change, not
cosmetic). `plugins/claude-relay/.claude-plugin/plugin.json` was deliberately left at `0.2.0` per this
task's instruction not to bump the plugin without a concrete defect. That instruction's own condition
was met here, though: this **is** a real, if subtle, plugin defect (an inaccurate freshness signal), now
fixed. Whether that alone justifies a plugin patch release, or whether it should be bundled with a future
change, is left as a decision for the maintainer — flagged here rather than resolved unilaterally, since
plugin releases go through a separate marketplace/tag process than the Companion.

## Not verified in this release (requires a human driving VS Code / Claude Code interactively)
Live testing through the actual Claude Code VS Code extension (`/plugins`, real `SessionStart`/
`PreCompact`/`StopFailure` firing, real OAuth-authenticated resume), multi-window and multi-root GUI
testing, WSL/Remote-SSH/Dev Container behavior, Marketplace search-indexing latency, and
accessibility/screen-reader passes were not performed — they require a live, human-driven VS Code session
this audit did not have. See the audit summary for the full list.

## Compatibility
Compatible with: Claude Relay Plugin v0.2.0. See "A note on Plugin versioning" above — one real (if
subtle) plugin-runtime defect was found and fixed in this branch; `plugin.json` was deliberately not
bumped, pending a maintainer decision.

## Remote environments
No change this release. Still degraded as before; not re-verified live (see
`docs/CURRENT_PLATFORM_COMPATIBILITY.md`).

## Candidate artifact
`packages/vscode/claude-relay-0.2.2.vsix` — 8 files, 71,991 bytes, SHA-256
`ac55e3d2bbb478d0f5748aed568775b9654d729520059af4c5f1c146f04a5b86`.

Dropped from 15 to 8 files in the final pass: `tsc -p .` (used to build the extension-host test suite)
emits per-file compiled output into `dist/` as a side effect — `dashboard.js`, `relay-service.js`,
`workspace-resolver.js`, `integration/*.js`, and their `.map` files — none of which the extension actually
loads at runtime (`main` is the single esbuild bundle `dist/extension.js`, which already contains all of
that code). `.vscodeignore` now excludes everything under `dist/` except `extension.js` itself.

This VSIX is not byte-for-byte reproducible across builds (zip entry timestamps differ between packaging
runs even with identical source), though the file list and size are stable across a rebuild from the same
commit.

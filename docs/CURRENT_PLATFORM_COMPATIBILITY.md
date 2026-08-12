# Current Platform Compatibility

Facts below were captured directly on the development machine during the discoverability/reliability
audit that produced v0.2.2. Anything not listed here as "verified this session" was not independently
re-tested — treat prior claims about it with the same skepticism this document itself was born from
(see the correction in `docs/RELEASE_NOTES_V0_2_1.md`).

## Verified this session (Windows 11, 2026-08-12)
| Tool | Version |
|---|---|
| Node.js | v22.14.0 |
| npm | 11.2.0 |
| pnpm | 11.21.0 |
| TypeScript (`npx tsc`) | 5.9.3 |
| Claude Code CLI (`claude --version`) | 2.1.217 |
| VS Code (this machine's actual install, `code --version`) | 1.132.0 |
| `@vscode/test-electron` download used for extension-host tests | 1.132.1 |

`claude plugin list --json` on this machine returns a genuine JSON array; the Claude Relay entry seen was
`claude-relay@clauderelay-oss`, version `0.2.0-dev`, `enabled: true`, `scope: user` — confirming the
plugin detector's parsing/matching logic against a real, non-fixture response (not a live `/plugins` UI
session — that requires a human in the loop; see below).

The hook-runtime binary (`plugins/claude-relay/runtime/hook-runner.cjs`) was exercised directly against
the repository's own fixtures (`fixtures/claude/pre-compact.json`, `session-start.json`) and against a
scratch repository at a path containing a space and parentheses
(`...\Relay Test (Space)`) — it correctly wrote an atomic, schema-valid checkpoint reflecting the real
Git branch/HEAD/dirty state. It was also fed malformed JSON, an unrecognized event type, an oversized
(300 KB) payload, and empty stdin — all four exited `0` with no write and no crash.

## Manifest-declared ranges (not independently verified against every listed version)
- `packages/vscode/package.json` → `engines.vscode: ^1.90.0`
- `packages/vscode/package.json` devDependency `@types/vscode: ^1.90.0`
- Root `package.json` devDependency `@types/vscode: ^1.125.0` — **inconsistent with the extension's own
  `^1.90.0` range.** Not resolved in this pass; worth deciding intentionally (either the engines range is
  stale, or the root type declarations are wider than needed) rather than leaving it implicit.

## Not verified this session (needs a human driving VS Code / Claude Code interactively)
- The actual Claude Code VS Code extension's `/plugins` panel, live `SessionStart`/`PreCompact`
  (via real `/compact`)/`StopFailure` firing inside a real session, and an authenticated resume flow.
- macOS and Linux behavior (CI covers Linux for lint/typecheck/core-tests/build only — see
  `.github/workflows/ci.yml`; it does not run the VS Code extension-host tests on Linux).
- WSL, Remote-SSH, and Dev Container behavior — prior docs record these as DEGRADED; not re-verified.
- Marketplace search indexing latency and multi-profile/clean-VS-Code-instance search behavior.
- Accessibility (screen reader, high contrast, keyboard-only) passes.

## A note on the extension-host test suite specifically
`pnpm --filter claude-relay test` (which runs `@vscode/test-electron`'s `runTests()`) could not be run to
a clean pass in this session: this machine's `packages/vscode/.vscode-test` cache had a locked directory
(`Device or resource busy`) consistent with an already-running `Code.exe` process holding it open — very
plausibly one of the many `Code.exe` processes already running on this machine, including the one this
audit itself was performed inside of. Force-clearing or killing arbitrary `Code.exe` processes to work
around that was judged too risky to do unsupervised (real risk of killing the user's actual editor
session) and was not attempted. Everything upstream of that — `tsc -p ./` and the `pretest` build — passed
cleanly, and the underlying bug that *was* reproducible (the space-in-path argument-splitting issue, see
`docs/RELEASE_NOTES_V0_2_2.md`) was fixed and confirmed via the corrected, unsplit argument in the error
output before the run hit the unrelated cache lock. Re-run `pnpm --filter claude-relay test` after closing
other VS Code windows, or after deleting `packages/vscode/.vscode-test` outside of an active VS Code
session, to get a clean extension-host test result.

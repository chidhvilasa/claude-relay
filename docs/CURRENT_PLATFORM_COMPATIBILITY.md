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

## Update: the extension-host test suite now runs and passes (resolved, not worked around)
The prior revision of this document reported the extension-host suite (`@vscode/test-electron`'s
`runTests()`) as blocked by a locked `.vscode-test` cache directory. That blocker is fixed, and the
actual root cause was more specific — and more interesting — than a simple lock:

1. **Space-in-path argument splitting** (fixed previously): `@vscode/test-electron@2.5.2`'s Windows
   `shell:true` spawn split `--extensionTestsPath=...claude wake\...` on the space. Fixed by aligning to
   `^3.1.0`, which only shells out for `.cmd` wrappers.
2. **`ELECTRON_RUN_AS_NODE=1` is set globally in this sandboxed dev environment.** That variable makes
   any Electron binary a tool spawns run as plain Node instead of launching its normal GUI/app shell —
   almost certainly a deliberate sandbox default so headless tools don't accidentally pop windows. It
   silently broke the downloaded VS Code test binary: `Code.exe --version` printed a *Node* version
   (`v24.18.0`), and every VS Code CLI flag was rejected with `bad option: --no-sandbox` etc. — Node's
   own arg parser, not VS Code's, because Electron never actually launched VS Code's app code.
3. **The repo-local `.vscode-test/` cache was genuinely locked** (`Device or resource busy`) by another
   process on this machine — plausibly this very editor session. Rather than investigate or kill
   processes, `packages/vscode/src/test/runTest.ts` was changed to use an isolated download cache and a
   fresh per-run user-data-dir/extensions-dir under the OS temp directory, entirely outside the repo, so
   it can never collide with a currently-open VS Code instance again.

With both fixed, `pnpm --filter claude-relay run test:host` (and the full `pnpm --filter claude-relay
test`) passes for real: **4/4 passing** — extension present, all 11 declared commands registered with no
`command not found`, the dashboard tree view registered, and activation completes without throwing.
No process was killed and no other VS Code window was closed to achieve this.

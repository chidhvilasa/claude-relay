# VS Code API Version Contract

## The inconsistency this replaces

Before this pass: `packages/vscode/package.json` declared `engines.vscode: ^1.90.0` while the root
workspace's `@types/vscode` devDependency was `^1.125.0` — two different numbers, neither derived from
what the code actually calls, and `packages/vscode` had its own separate `@types/vscode: ^1.90.0`. None
of the three were verified against the real API surface.

## Method

1. Extracted every `vscode.*` API reference from production source (`extension.ts`, `dashboard.ts`,
   `relay-service.ts`, `workspace-resolver.ts`, `integration/*.ts` — test files excluded, since they
   don't ship and don't constrain runtime compatibility).
2. Identified, from known VS Code API introduction history, the newest (most restrictive) API in that
   list: `vscode.Uri.joinPath`, added in VS Code **1.45** (April 2020). Everything else used
   (`TreeDataProvider`/`TreeItem` since ~1.23, `workspace.workspaceFolders` since 1.18 with multi-root
   workspaces, `env.clipboard` since 1.30, `StatusBarItem`/`OutputChannel`/`commands.*`/
   `window.show*Message`/`showInputBox`/`showQuickPick`/`showTextDocument`/`EventEmitter` since VS Code's
   earliest stable API) predates that by a wide margin.
3. **Mechanically verified**, not just asserted from memory: extracted the real `@types/vscode@1.74.0`
   package (a round, well-known floor comfortably past 1.45) and compiled the actual production source
   against it with `tsc -p . --noEmit`. Result: **zero errors.** This is real evidence, not a claim — the
   compiler enforced it, not this document.
4. Did **not** install and run an actual VS Code 1.74.0 binary against the extension — that's the
   difference between "the API surface used compiles clean against 1.74.0's type declarations" (verified)
   and "the extension has been runtime-tested on VS Code 1.74.0" (not done, and not claimed).

## Decision

- `engines.vscode`: lowered from `^1.90.0` to `^1.74.0` (VS Code, November 2022) — a round, well-known
  version comfortably past every API actually used, rather than the unexplained `1.90.0` floor that was
  excluding roughly two years of VS Code releases for no functional reason.
- `@types/vscode`: pinned to the **exact** version `1.74.0` (no `^`), matching the `engines.vscode` floor,
  rather than left on a newer range. This is a deliberate, permanent choice, not a one-time check:
  because `@types/vscode` is dev-only (erased at compile time, zero runtime effect), it's tempting to just
  track the newest version — but doing so is exactly what let the original `^1.90.0`/`^1.125.0`
  inconsistency happen invisibly. Pinning it to the engines floor means `tsc` will fail the moment
  production code uses any API introduced after 1.74.0, catching a compatibility regression at compile
  time instead of relying on manual review.
- Root `package.json`'s separate `@types/vscode: ^1.125.0` was removed outright rather than reconciled —
  nothing at the workspace root compiles against it (no root `tsconfig.json`, no root `src/`), so it was
  dead, duplicate metadata that could only ever drift out of sync with the real one again.

## Result

`packages/vscode/package.json`:
```json
"engines": { "vscode": "^1.74.0" },
"devDependencies": { "@types/vscode": "1.74.0" }
```

Both `pnpm typecheck` and `pnpm build`/`vsce package` were re-run against this exact configuration and
pass cleanly (see the regression results in the audit report).

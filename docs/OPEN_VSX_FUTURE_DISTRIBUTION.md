# Open VSX — Future Distribution (Not Yet Published)

VS Code-compatible editors that don't use Microsoft's Marketplace (VSCodium, Theia-based editors, and
others) resolve extensions through [Open VSX](https://open-vsx.org/) instead. This is a note for later,
not a current action — no Open VSX publish has happened, and none is planned until the Microsoft
Marketplace listing itself is live and stable.

## What would stay the same
- Product name: **Claude Relay**
- Extension identity: same `name`/`publisher` fields already in `packages/vscode/package.json`
  (`claude-relay` / `clauderelay-oss`), so the same manifest works unmodified — Open VSX reads the same
  `package.json`.
- Same VSIX. Open VSX accepts the identical package `vsce package` produces; no separate build.

## What's different
- A separate account/namespace claim on open-vsx.org (their own auth, not Microsoft's) — a distinct
  credential from the VS Code Marketplace publisher token.
- Open VSX has its own validation and namespace-ownership verification (typically via a GitHub token
  proving control of the linked repository).
- Publishing is normally done with [`ovsx`](https://github.com/eclipse/openvsx/tree/master/cli), the
  Open VSX equivalent of `vsce`, using the same VSIX.

## Why this is deferred, not skipped
Publishing to a second registry before the first (Microsoft) listing is confirmed working would double
the surface area to debug if something's wrong with the manifest, and there's no user-reported need for
Open VSX specifically yet. Once `clauderelay-oss.claude-relay` is live and verified on the Microsoft
Marketplace, revisit this — the actual publish step is small (`ovsx publish` with the same VSIX).

No duplicate product identity would be created for this; it's the same Claude Relay, same extension ID,
on a second registry.

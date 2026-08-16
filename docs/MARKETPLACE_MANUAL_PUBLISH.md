# Marketplace Manual Publish (Human Required)

Automated investigation (see the Marketplace publication truth report earlier in this project's audit
history) found that `clauderelay-oss.claude-relay` does not currently resolve on the public VS Code
Marketplace — the item page and publisher page both 404, and `code --install-extension
clauderelay-oss.claude-relay` returns "not found." No evidence exists anywhere in this repo (CI, scripts,
docs) that a real `vsce publish` has ever been run. This is very likely the **first real publish**, not a
republish.

This step requires a human — it needs interactive Microsoft/Azure DevOps sign-in, which cannot be
automated, scraped, or bypassed.

### Publisher
ID: `clauderelay-oss`
Display name: `Claude Relay OSS`

### Extension
Full ID: `clauderelay-oss.claude-relay`

### Exact file to upload
- Path: `packages/vscode/claude-relay-0.2.2.vsix`
- Bytes: 75,574
- SHA-256: `05940a166dd7e7bca1f8fc4934e020ccbff9e184e8d108e16dc9bb7673f9743d`
- Built from master commit `f73b7c200fd6a132f046a705568156ac97d9540d` (parent of the checksum-recording
  commit) — rebuild with `pnpm install && pnpm build && cd packages/vscode && npx vsce package
  --no-dependencies` from a clean `master` checkout if you want to reproduce it yourself; note the VSIX is
  not byte-for-byte reproducible (zip entry timestamps differ) though the file list and size are stable.

### Human steps
1. Sign into the [Visual Studio Marketplace publisher management page](https://marketplace.visualstudio.com/manage).
2. Create or verify the publisher `clauderelay-oss` (display name `Claude Relay OSS`) exists under your
   account. If it doesn't exist yet, this confirms the "never published" hypothesis above.
3. Choose **New Extension → Visual Studio Code**.
4. Upload the exact VSIX above — do not rebuild a different one and swap it in without re-verifying the
   hash matches what's documented in `docs/RELEASE_NOTES_V0_2_2.md`.
5. Wait for Marketplace validation/scanning to complete (can take a few minutes; don't re-upload while
   it's pending).
6. Verify the public item page: `https://marketplace.visualstudio.com/items?itemName=clauderelay-oss.claude-relay`
7. Verify exact-ID install works from a machine/profile that's never installed it before:
   `code --install-extension clauderelay-oss.claude-relay`
8. Verify search once indexing completes — this can lag behind publish; see
   `docs/POST_RELEASE_MONITORING.md` and don't republish just to force it. Classify as `PASS` or
   `PENDING_INDEXING`, not `FAIL`, if direct install already works.

A Personal Access Token walkthrough is intentionally not included here — for a first publish, the
Marketplace's own web upload flow (step 3-4) is simpler and lower-risk than setting up `vsce publish`
with a token. Set that up later if you want a scripted/CI publish flow for future versions.

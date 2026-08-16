# Post-Publish Verification Commands

Run these after completing `docs/MARKETPLACE_MANUAL_PUBLISH.md`. Harmless, read-only/install-only —
nothing here modifies the Marketplace listing.

## Direct install (should PASS immediately, doesn't depend on search indexing)
```powershell
code --install-extension clauderelay-oss.claude-relay
code --list-extensions --show-versions
```
Expect `clauderelay-oss.claude-relay@0.2.2` in the output. If this fails with "not found" shortly after
publishing, the extension may still be in Marketplace validation — wait a few minutes and retry before
concluding something is wrong.

## Search (may lag behind direct install — that's expected, not a bug)
In VS Code's Extensions view search box, try each of these and record the result:
- `Claude Relay`
- `claude relay`
- `@id:clauderelay-oss.claude-relay`
- `@publisher:clauderelay-oss`

Classify each as:
- **PASS** — the extension appears
- **PENDING_INDEXING** — direct install (above) already works, but this particular search doesn't yet
- **FAIL** — direct install also doesn't work; this is a real problem, not indexing lag

Do not republish a new version solely to try to force search indexing to update sooner — it won't help,
and it adds noise to the version history. Recheck after a day or so if a search variant is still failing
while direct install passes.

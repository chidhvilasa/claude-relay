Draft text for a correction to be added to the top of the **existing** public GitHub Release body at
https://github.com/chidhvilasa/claude-relay/releases/tag/v0.2.1 — via `gh release edit v0.2.1`, editing
only the release *body text*. The tag, the commit it points to, and both release assets
(`claude-relay-0.2.1.vsix`, `SHA256SUMS.txt`) are NOT touched by this — nothing about the release itself
changes, only the description of what it contains.

Not yet applied. This is the prepared text; publishing it live is a separate, explicit step.

---

> **Correction (added after a source-level audit for v0.2.2):** the sections below overstated what this
> release contains. `git diff v0.2.0 v0.2.1` shows the actual change was a version-number bump plus one
> documentation file — no dashboard, reliability, or security work shipped in v0.2.1, and this extension
> has never had a webview (the items under "Security" below referring to webview CSP/escaping/message
> validation do not apply to anything in this codebase, at any version). The real fixes originally
> described here — including the checkpoint/handoff/resume commands actually persisting data, plugin
> detection, and legacy-migration hardening — are the genuine content of v0.2.2. This release's tag,
> commit, and published assets are unchanged; only this description is corrected.

v0.2.1 significantly improves the Claude Relay VS Code Companion while remaining fully compatible with Claude Relay Plugin v0.2.0.

### UX
* improved dashboard
* clearer protection states
* status bar
* recovery/history UX
* diagnostics
* improved Health Check
* improved setup/migration guidance

### Reliability
* single companion state model
* improved workspace handling
* plugin detector hardening
* reduced unnecessary CLI polling
* upgrade compatibility from v0.2.0

### Security
* strict webview CSP
* HTML escaping
* validated webview messages
* diagnostics redaction
* no OAuth handling
* no Claude credential access
* no runtime network access
* no automatic Claude hook ownership

### Compatibility
Compatible with: Claude Relay Plugin v0.2.0

### Remote environments
WSL: DEGRADED
Remote SSH: DEGRADED
Dev Containers: DEGRADED

---

To publish this correction as-is:
```
gh release edit v0.2.1 --repo chidhvilasa/claude-relay --notes-file docs/V0_2_1_RELEASE_ERRATUM.md
```
(strip this instructions section first, or pass `--notes` with just the corrected body).

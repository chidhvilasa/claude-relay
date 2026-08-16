# Post-Release Monitoring

No telemetry is collected by Claude Relay — this document describes what a maintainer should watch
manually (GitHub Issues, the Marketplace page once live, and direct testing), not an automated dashboard.

## What to watch

**Installation**
- GitHub Issues tagged `bug` mentioning install failures.
- Marketplace review/rating comments, once the listing is live.

**Marketplace discoverability**
- Whether `Claude Relay` search and `@id:clauderelay-oss.claude-relay` resolve, and how long after
  publish (see `docs/MARKETPLACE_MANUAL_PUBLISH.md`'s post-publish test commands).
- Direct install (`code --install-extension clauderelay-oss.claude-relay`) as the fallback signal —
  this can work even while search indexing lags.

**Plugin update**
- Whether `claude plugin marketplace update clauderelay-oss` and `claude plugin update claude-relay`
  correctly move existing 0.2.0 installs to 0.2.1+.

**Checkpoint / handoff / resume failures**
- Issues reporting `Claude Relay: Checkpoint failed` / `Handoff failed` toasts (the extension surfaces
  the real error message and logs it to the `Claude Relay` output channel — ask reporters to paste that).
- Any report of a checkpoint/handoff silently *not* appearing despite a success toast would be a
  regression of the exact bug this project already fixed once (see `docs/RELEASE_NOTES_V0_2_2.md`) —
  treat with priority.

**Migration**
- Reports of `Claude Relay: Remove Claude Integration` misbehaving on real (not synthetic) v0.1
  `settings.json` files with unusual structure.

**Filesystem / security**
- Any report involving `.relay/` writes outside the expected project boundary, or a checkpoint/handoff
  appearing in the wrong project (cross-project isolation).

**Remote environments**
- WSL / Remote SSH / Dev Containers are currently documented as degraded (see
  `docs/CURRENT_PLATFORM_COMPATIBILITY.md`). Watch for reports that materially change that assessment —
  worth revisiting if several independent reports describe the same specific failure.

## What NOT to add to satisfy this
- No telemetry, no analytics SDK, no crash reporter that phones home. Runtime network access stays at
  NONE. This document exists so a human watches deliberately, not so the product watches itself.

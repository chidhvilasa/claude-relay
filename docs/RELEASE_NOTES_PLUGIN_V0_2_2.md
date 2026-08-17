# Claude Relay Plugin v0.2.2 — release notes (draft, not published)

**Status: prepared on `hotfix/plugin-hook-event-contract`. Not tagged, not published, awaiting
explicit release authorization.**

## Summary

Fixes a defect present in every release since v0.2.0: the Plugin's hook runtime read the wrong
field name for identifying which Claude Code hook event fired, so **no automatic checkpoint was
ever written by SessionStart, PreCompact, or StopFailure in a real installation** — the manual
Companion commands (Create Checkpoint, Create Handoff Now) were unaffected. See
`docs/PLUGIN_HOOK_EVENT_DEFECT.md` for the full technical writeup.

## What changed

- Hook event detection now reads `hook_event_name` (the real field Claude Code sends), with
  `argv[2]` and the old `type`/`event` fields kept only as harmless fallbacks.
- 5 new regression tests pin the real payload contract so this can't silently regress again.
- No other behavior, commands, settings, or UI changed. This is a pure correctness fix.

## What did NOT change

- Plugin hook set: still exactly `SessionStart`, `PreCompact`, `StopFailure` — no new hooks added.
- The `relay` skill — unchanged.
- VS Code Companion — no changes required for this fix; the Companion's own version is unaffected.

## Compatibility

Compatible with Claude Relay VS Code Companion v0.2.1 and v0.2.2. No Companion update is required
to benefit from this fix, though `docs/PLUGIN_HOOK_EVENT_DEFECT.md`-aware Companion messaging
(recommending an update from Plugin ≤0.2.1) is a separate, later piece of work.

## Verification performed before this draft

- 21/21 hook-runtime regression tests passing (real payload shape).
- Full monorepo build/typecheck/lint clean (3 packages: core, hook-runtime, vscode).
- Core: 28/28, VS Code unit: 41/41, VS Code host: 4/4 — all unaffected, all still passing.
- `claude plugin validate plugins/claude-relay` — passed.
- **Live, real acceptance test** (not just the regression suite): a genuine `claude -p` session,
  real authentication, with hooks wired via `--settings` to point at this exact build, produced a
  correct checkpoint (`schemaVersion`, `id`, `createdAt`, `type: "lightweight"`,
  `reason: "SessionStart"`, workspace path, `git.head`/`branch`/`isDirty`) in a scratch repository.
  The identical test run against the *old* v0.2.1 hook build, same prompt, same repo setup,
  produced no `.relay/` directory at all — direct, live, side-by-side confirmation of both the bug
  and the fix.
- **Live plugin-install upgrade path**: installed the real, tag-pinned v0.2.1 plugin via
  `claude plugin install` into an isolated config directory, confirmed the installed cache
  literally contained the buggy code (`eventPayload.type` present, `hook_event_name` absent),
  then updated the local marketplace source to this v0.2.2 content and ran
  `claude plugin update claude-relay@clauderelay-oss` — reported *"Plugin claude-relay updated
  from 0.2.1 to 0.2.2"*. The upgraded installed copy has the fix, exactly the same 3 hooks
  declared, and the `relay` skill intact.
- PreCompact and StopFailure: verified mechanically against the real documented payload shape
  (regression tests), not via a live interactive trigger — headless `-p` mode has no equivalent
  of an interactive `/compact`, and StopFailure requires an actual error condition, which was not
  deliberately provoked per this project's own "don't burn quota deliberately" constraint.

## Release checklist (not yet executed)

- [ ] Bump `plugins/claude-relay/.claude-plugin/plugin.json` and
      `.claude-plugin/marketplace.json` on `master` (currently only on the hotfix branch)
- [ ] Tag `claude-relay--v0.2.2`
- [ ] Publish to the live Marketplace listing (manual step, per existing project convention)
- [ ] Post `docs/PLUGIN_HOOK_EVENT_DEFECT.md`'s summary as a note on the existing v0.2.1 release

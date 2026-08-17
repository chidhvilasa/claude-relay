# Claude Relay Plugin hook-event contract defect (affects v0.2.0 and v0.2.1)

**Status: fixed on `hotfix/plugin-hook-event-contract`, not yet released.** This document is the
plain-language record of the defect, for the eventual release notes and for anyone auditing the
history later. Not published anywhere yet — drafting only.

## What was wrong

The Plugin's hook runtime (`runtime/hook-runner.cjs`, built from
`packages/hook-runtime/src/index.ts`) identified which hook event fired by reading:

```js
const eventType = eventPayload.type || eventPayload.event;
```

Real Claude Code hook payloads do not have a `type` or `event` field. The actual field, confirmed
both in current official documentation (`code.claude.com/docs/en/hooks.md`) and by inspecting the
installed CLI directly, is `hook_event_name`.

Because `eventType` was always `undefined` against a real payload, the handler's own event
allowlist check (`if (!handlers[eventType]) process.exit(0)`) rejected every real invocation
immediately. In practice, this means:

**Every SessionStart, PreCompact, and StopFailure hook invocation from a real Claude Code process,
in every install of Plugin v0.2.0 and v0.2.1, silently did nothing. No automatic checkpoint was
ever written by the hook path in a real installation.**

## Why the existing tests didn't catch it

The test suite's fixture for constructing a hook payload built the same shape the code expected
(`{ type, sessionId, ... }`) rather than the real shape Claude Code actually sends. Code and test
agreed with each other; neither matched reality. All 20 tests passed on every commit up to and
including the v0.2.2 (Companion) / v0.2.1 (Plugin) release.

## How this was found

Not from a user report. Found during unrelated `v0.3` research by re-verifying the hook payload
contract directly against current documentation and against the installed `claude.exe` binary,
rather than continuing to trust the existing (wrong) assumption baked into both the code and its
tests.

## What manual checkpoints were unaffected

Nothing about this defect touches the VS Code Companion's manual commands (`Claude Relay: Create
Checkpoint`, `Create Handoff Now`, etc.) — those call into `@claude-relay/core` directly from the
extension process and never depended on the hook payload contract. Only the *automatic*,
hook-triggered checkpoint path was broken.

## The fix

`hook_event_name` is now the primary, authoritative source for the event type, with `argv[2]`
(the event name `hooks.json` itself passes on the command line — Relay's own manifest content, not
attacker-influenced) as a fallback, and the old `type`/`event` fields kept as a last-resort
fallback for robustness. All three real event payloads (`SessionStart`, `PreCompact`,
`StopFailure`) were re-verified against the actual official docs example and the decompiled
binary's own payload-construction code before writing the fix. See
`packages/hook-runtime/src/index.ts`'s inline comment for the full technical detail, and
`packages/hook-runtime/tests/hook-runner.test.ts`'s "event-type resolution" test group for the
regression coverage that pins this contract going forward.

## Affected versions

- Claude Relay Plugin v0.2.0 — affected
- Claude Relay Plugin v0.2.1 — affected
- Claude Relay Plugin v0.2.2 (this hotfix) — fixed

The VS Code Companion extension is not itself affected (see "What manual checkpoints were
unaffected" above) — no Companion version bump is required for this fix alone.

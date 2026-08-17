# Human gate: real, interactive `/compact` proof for the stable hotfix

**Status: not yet run. This is the one gate this environment genuinely cannot drive itself.**

## Why this exists

Every other piece of evidence for the `hook_event_name` fix is real:

- 21/21 regression tests using the actual documented payload shape.
- A live, real `claude -p` session (real auth) with hooks wired to this exact build produced a
  correct checkpoint for `SessionStart`; the identical test against the old build produced nothing.
- A real `claude plugin install` → `claude plugin update` cycle in an isolated config directory,
  confirmed the installed 0.2.1 cache literally had the bug and the updated 0.2.2 cache has the fix.

What's missing is specifically `PreCompact` triggered the way it happens in real use: a live,
**interactive** Claude Code session where a person runs `/compact`. `claude -p` (headless,
non-interactive) has no equivalent of the interactive `/compact` command, and there is no way to
drive an interactive terminal session's slash commands from this sandboxed environment — no PTY
control is available here. This isn't a corner being cut; it's a real capability boundary, stated
plainly rather than worked around with something that would look like proof but isn't.

## What to do (3 steps, ~2 minutes)

1. In a real Claude Code interactive session, in any real git repository, note whether
   `.relay/checkpoints/` currently exists and what it contains (or that it doesn't exist yet).
2. Make sure the `claude-relay` plugin active in that session is built from
   `hotfix/plugin-hook-event-contract` (commit `5b002fd`) — either by installing it from that
   branch specifically, or by confirming (once released) it's genuinely running Plugin 0.2.2, not
   0.2.1.
3. Run `/compact`.
4. Check `.relay/checkpoints/` again. A new file should exist with `"reason": "PreCompact"`,
   `"type": "recovery"`, and correct `session`/`git` fields.

## Recording the result

| Date | Claude Code version | Plugin version/commit | New checkpoint appeared? | Notes |
|---|---|---|---|---|
| _(not yet run)_ | | | | |

## What this blocks

Per this task's own instruction: **do not merge, tag, or publish the stable hotfix until this
gate is run** (or the decision is explicitly made to accept the mechanical regression-test
evidence as sufficient without it — that's a call for you to make, not this session). Everything
else needed for release (diff scope, full regression, plugin validation, install/upgrade path,
release notes) is complete and is not blocked on this.

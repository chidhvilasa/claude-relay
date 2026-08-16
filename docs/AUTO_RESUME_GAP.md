# The Auto-Resume Gap

## Observed production scenario

A real Claude Code session, running interactively inside the VS Code extension, hit:

```
You've hit your session limit · resets <time>
```

Claude Relay's existing behavior at that point:
- **Checkpointing**: worked. `StopFailure` (or whatever hook actually fired — see below) would have
  captured a deterministic Git snapshot, per the existing v0.2.x design.
- **Handoff**: works when manually invoked, or automatically if a hook that captures semantic state fired.
- **Recovery state**: preserved in `.relay/`, correctly.
- **Manual resume**: available — a human could run `Claude Relay: Resume Previous Task` at any time.

What did **not** happen: once the stated reset time passed, nothing continued the interrupted task
automatically. The user had to notice, come back, and manually resume — hours later, in the reported case.

## Why hooks cannot do this

`SessionStart`, `PreCompact`, and `StopFailure` share a structural property: **each one only fires while
Claude Code's own process is actively executing.** A hook is Claude Code calling out to an external
script at a specific point in its own lifecycle — it cannot exist, let alone fire, once that lifecycle has
ended (the process exited) or is blocked waiting on something external (a usage-limit reset timer that
Claude Code itself is not actively counting down against a running process).

Concretely: once a session is blocked or has exited because of a usage limit, there is no live Claude Code
process left to invoke *any* hook — StopFailure or otherwise — at the moment the limit resets. A hook
cannot summon a process into existence; something else has to *start* a process at the right time,
and hooks are not that. Waking a stopped/blocked session back up is fundamentally a **process-lifecycle
and scheduling problem**, categorically different from what SessionStart/PreCompact/StopFailure were ever
designed to solve — Relay's own checkpoint-on-hook architecture correctly captures *state*, but state
capture was never going to be sufficient by itself. This isn't a bug in the hooks; they did their job.
The gap is the absence of anything that watches the clock and acts once the process is gone.

## What this means for the architecture question

The real questions this document doesn't answer on its own — deferred to
`docs/AUTOMATIC_WAKE_ARCHITECTURE.md`, after verifying what Claude Code actually, currently supports
(rather than assuming it):
- Is there any official, built-in mechanism for waiting out a usage limit and continuing automatically?
- Is the kind of session that hit this limit (an interactive VS Code extension chat session) even the
  same kind of thing as a background agent that any external tool could restart later?
- If nothing built-in solves this, what is the smallest, safest thing Relay could add — and is doing so
  even advisable, given the unattended-execution security implications of resuming AI tool use without a
  human present to supervise it?

This document exists to state the gap precisely, without either dismissing it as unimportant or assuming
a solution exists before checking.

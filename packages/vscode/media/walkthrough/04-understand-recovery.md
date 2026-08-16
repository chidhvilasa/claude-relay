## Understand Recovery

Once the plugin is installed, `PreCompact` and `StopFailure` capture the same kind of deterministic
checkpoint automatically — before context is compacted, and if a session fails. `SessionStart` checks
for that state so a new session can pick up where the last one left off.

A handoff goes further: it pairs that deterministic state with a short, human-written objective and
next action, saved to `.relay/WAKEUP.md`. When you resume, that text is clearly labeled **untrusted
historical context** — a lead to verify, never a command to execute automatically.

[Create Handoff Now](command:claudeRelay.handoff)

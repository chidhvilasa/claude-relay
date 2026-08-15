# How Claude Relay Works

## During normal coding
Nothing happens. No polling, no background timers, no network calls. Claude Relay is inert until one of
the events below fires.

## Before context compaction
`PreCompact` (fired by Claude Code, handled by the **Claude Relay Plugin**) captures a deterministic
snapshot — branch, commit, dirty-file state — to `.relay/checkpoints/` before context is compacted.

## If a session fails
`StopFailure` captures the same kind of deterministic checkpoint, so a crashed or abandoned session still
leaves a recovery point.

## When a new session starts
`SessionStart` checks `.relay/` for existing recovery state, so a new Claude Code session can discover
what a previous one left behind.

## In VS Code
The **Companion** (this extension) is a separate layer: it shows status/history and provides manual
controls (`Create Checkpoint`, `Create Handoff Now`, `Resume Previous Task`, and more), all backed by the
same `.relay/` data and the same storage code the plugin uses (`@claude-relay/core`) — there is no
separate, shadow storage implementation. The Companion works without the plugin, in manual mode; the
plugin works without the Companion, since it owns the automatic hooks on its own.

## What gets stored
Only recovery metadata under `.relay/` in your project: checkpoints (git state snapshots), handoffs
(checkpoint + a short human-written objective/next-action), and a generated `WAKEUP.md`. `.relay/`
self-gitignores, so none of it is ever picked up by `git status` or accidentally committed.

## What does NOT happen
- No OAuth handling.
- No reading of Claude credentials or API keys.
- No runtime networking of any kind — everything above runs against your local Git repository and the
  `.relay/` folder.
- No automatic Git mutation — Relay only ever reads Git state (`rev-parse`, `status --porcelain`); it
  never commits, pushes, resets, or otherwise changes your repository.
- No automatic command execution — a handoff's semantic text is always treated as **untrusted historical
  context**, labeled as such wherever it's shown, and is never executed.

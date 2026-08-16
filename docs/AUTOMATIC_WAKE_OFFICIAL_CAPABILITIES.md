# Automatic Wake — Official Capability Verification

**Method note (read this first):** none of the mechanisms below appear in Anthropic's public documentation
(`code.claude.com/docs`) — checked twice, once against Claude Code 2.1.217 and again after updating to
2.1.233. What changed between the two research passes wasn't the documentation; it was the method. The
first pass trusted doc pages and a subagent's doc fetches at face value. This pass greps the actual
installed binary (`claude.exe`, 2.1.233) for the literal environment-variable strings and reads the
decompiled call sites around them. That is direct evidence of what the shipped code does, independent of
whether Anthropic has published a page about it yet. Treat the "supported?" column below as "real and
present in this build," not "officially documented and stable" — those are different claims, and the
distinction matters for how much Relay should rely on this.

## Correction to the previous report

`docs/AUTOMATIC_WAKE_ARCHITECTURE.md`'s original conclusion — that `CLAUDE_CODE_RETRY_WATCHDOG` and
`CLAUDE_CODE_RESUME_INTERRUPTED_TURN` "do not exist" — **was wrong.** Both are real, and so are
`CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` and `CLAUDE_CODE_RESUME_PROMPT`. They are absent from the
public env-vars reference not because they're fake, but because they're apparently undocumented/internal
surface. The previous report's caution ("don't build core architecture on an undocumented internal") turns
out to be the right instinct even though its premise ("doesn't exist") was factually wrong — this document
replaces the premise with what's actually true and keeps the caution, now correctly scoped.

## Capability table

| Capability | Real? | Min. version seen | Tested version | Scope | Security implications | Relay usage |
|---|---|---|---|---|---|---|
| `CLAUDE_CODE_RETRY_WATCHDOG` | **YES** — confirmed by decompiling the retry-loop code around it | Unknown (present in 2.1.233; not checked against older binaries beyond the earlier absence-from-docs check on 2.1.217, which doesn't prove absence from that binary — see caveat below) | 2.1.233 | Generic HTTP-retry layer for *any* Claude Code process making API requests — not restricted to background agents | None directly — it changes retry persistence, not what's retried or with what permissions | Set to `1` for **Level 1** |
| `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` | **YES** — confirmed | 2.1.233 | 2.1.233 | Wired specifically into the **background-agent crash-respawn path** (the debug log literal is `"[sessionRestore] Auto-resuming interrupted turn for bg crash-respawn"`) — not confirmed to apply to a normal interactive VS Code chat session that was never a background agent | Auto-injects a continuation message without a human re-approving that specific message; inherits normal tool permissions (confirmed no permission-mode change tied to this flag) | Relevant to **Level 2**, and only directly to sessions run as background agents |
| `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` | **YES** — confirmed, default 3,600,000 ms (1 hour) when unset-but-truthy, no bound applied at all if the var itself is absent | 2.1.233 | 2.1.233 | Same scope as above | Bounds how old an "interrupted turn" can be before auto-resume is suppressed (`tengu_resume_stale_turn_suppressed`) | Set to a deliberate, longer value (task's suggested 8h = `28800000`) if Level 2 is enabled |
| `CLAUDE_CODE_RESUME_PROMPT` | **YES** — confirmed, default value is literally `"Continue from where you left off."` | 2.1.233 | 2.1.233 | Same scope as above | The exact text a user never typed becomes the "user" turn — must be a fixed, Relay-controlled string, never handoff-derived (already the plan) | Set to the reconciliation-first prompt from Phase 18/9 of the original task |
| `claude respawn <id>\|--all` | **YES** — real command, works directly (`claude respawn --help`), just absent from top-level `claude --help`'s command list | Present in 2.1.217 already | 2.1.217, 2.1.233 | Background agents (`claude agents`/`--bg`) specifically | Restarts a process; doesn't touch credentials | Level 2/3 fallback for sessions that *are* background agents |
| `claude --resume <session-id>` / `claude -p ... --resume <id>` | **YES**, publicly documented (unlike the above) | Long-standing | 2.1.217, 2.1.233 | Any session, any front-end — VS Code extension and CLI share the same session store (documented: *"To continue an extension conversation in the CLI, run `claude --resume` in the terminal"*) | Reloads history; does not itself re-inject a continuation message (that's what `CLAUDE_CODE_RESUME_PROMPT` is for, but only inside the interrupted-turn path above) | Level 2 building block for non-background-agent sessions |
| Cross-directory session lookup by ID | Version-gated | v2.1.223+ | This machine is now 2.1.233 (≥ threshold) | `--resume <id>` from any directory, not just the original project | — | Now available on this machine after the Phase 0 update |
| VS Code session URI (`vscode://...`) | **NOT verified this pass** — original task names a specific URI form; not found or disproven in the time available this session | — | — | — | — | Deferred; see "Not yet verified" below |
| Status line `rate_limits.five_hour.*` / `rate_limits.seven_day.*` | **NOT verified this pass** | — | — | — | — | Deferred |

## What "real but undocumented" means for how Relay should use this

These are genuine, working mechanisms in the current shipped binary — not fabricated, contrary to the
previous report. They are also not published, versioned, or covered by any stability guarantee Anthropic
has stated publicly. Concretely, that means:

- Relay should set them defensively (never assume a version has them; check `claude doctor`/version first).
- Relay should treat "configured" and "confirmed active" as different states in Health Check — writing
  the env var is not the same as proving Claude Code's current version actually reads it the way this
  document describes, and a future Claude Code release could rename or remove any of them without notice.
- None of this should be presented to the user as an officially-documented Claude Code feature. It's
  accurately described as "an undocumented mechanism this version of Claude Code appears to implement,"
  which is a meaningfully weaker and more honest claim than "Anthropic's retry watchdog."

## Not yet verified this pass

- The VS Code session URI handler (`vscode://anthropic.claude-code/open?session=<id>`) named in the task
  — not confirmed or disproven; needs its own check before Level 3 work relies on it.
- Status-line `rate_limits.*` fields — not confirmed or disproven this pass.
- Whether the literal "You've hit your session limit" block is actually communicated to the client as an
  HTTP 429 (which the watchdog's retry logic is keyed on) as opposed to a client-side pre-check that never
  issues a request at all. The retry code's use of server-provided retry timing on 429 responses is
  suggestive but not conclusive proof this exact user-facing message flows through that path — the
  strongest remaining way to close this is observing a real (not deliberately provoked) occurrence, which
  is exactly what `.relay/wake-observations.jsonl` (already shipping on the research branch) exists to
  capture.

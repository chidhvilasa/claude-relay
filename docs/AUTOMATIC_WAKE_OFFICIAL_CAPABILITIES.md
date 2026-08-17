# Automatic Wake — Official Capability Verification

**Method note (read this first):** none of the four wake-related env vars below appear in Anthropic's
public documentation (`code.claude.com/docs`) — checked **three separate times now**: against Claude Code
2.1.217 (doc-fetch pass), again after updating to 2.1.233 (binary-decompile pass), and a third time this
pass specifically to check a claim that current docs now publish them (targeted doc-page re-fetch +
web search, this pass). All three checks agree: **absent from the public docs.** The evidence source that
did change across passes is what's real regardless of docs — grepping the actual installed binary
(`claude.exe`, 2.1.233) for the literal environment-variable strings and reading the decompiled call sites
around them. Treat "real?" and "officially documented?" as two different columns below, because they give
different answers for different rows in this table.

## Correction history (both directions, neither hidden)

**Correction #1 (previous pass):** `docs/AUTOMATIC_WAKE_ARCHITECTURE.md`'s original conclusion — that
`CLAUDE_CODE_RETRY_WATCHDOG` and `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` "do not exist" — **was wrong.** Both
are real, confirmed by decompiling the shipped binary. That correction stands.

**Correction #2 (this pass):** the task instruction that opened this pass asserted "Current official
Anthropic documentation DOES publicly document" all four wake env vars, with a specific claim (minimum
version `>=2.1.186`, indefinite-retry-until-reset-timestamp behavior) attributed to "Anthropic's current
official env-var documentation." That specific claim **does not hold up.** Re-checked directly, not taken
on faith:

1. Fetched `code.claude.com/docs/en/env-vars.md` and asked two independent targeted queries whether
   `CLAUDE_CODE_RETRY_WATCHDOG` appears anywhere on the page, and whether `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`
   / `..._MAX_AGE_MS` / `CLAUDE_CODE_RESUME_PROMPT` appear anywhere on the page. Both queries returned
   `TRULY_ABSENT` for all four.
2. Cross-checked with a web search for the literal strings `"CLAUDE_CODE_RETRY_WATCHDOG"` and
   `"CLAUDE_CODE_RESUME_INTERRUPTED_TURN"` restricted toward Anthropic's own domains. Neither turned up an
   Anthropic doc page defining either variable; results were third-party community tools solving the same
   problem externally (e.g. `cheapestinference/claude-auto-retry`, `mo-arvan/herdr-claude-auto-retry`) and
   unrelated GitHub issues.
3. Also fetched the full `code.claude.com/docs/en/vs-code.md` page directly (not summarized) rather than
   trusting a model's paraphrase of it.

So: the four env vars remain **real but undocumented** — the conclusion from the previous pass stands
unchanged. What *is* newly confirmed this pass, and where the task's broader instinct was right even though
the specific env-var claim wasn't, is the VS Code session URI (see table below) — that one **is** genuinely,
currently, officially documented, with exact parameter semantics now on record instead of assumed.

This is reported plainly rather than silently substituting the task's claim for the verified one, per the
same standard applied when the roles were reversed in the previous pass.

## Capability table

| Capability | Real? | Min. version seen | Tested version | Scope | Security implications | Relay usage |
|---|---|---|---|---|---|---|
| `CLAUDE_CODE_RETRY_WATCHDOG` | **YES** — confirmed by decompiling the retry-loop code around it | Unknown (present in 2.1.233; not checked against older binaries beyond the earlier absence-from-docs check on 2.1.217, which doesn't prove absence from that binary — see caveat below) | 2.1.233 | Generic HTTP-retry layer for *any* Claude Code process making API requests — not restricted to background agents | None directly — it changes retry persistence, not what's retried or with what permissions | Set to `1` for **Level 1** |
| `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` | **YES** — confirmed | 2.1.233 | 2.1.233 | Wired specifically into the **background-agent crash-respawn path** (the debug log literal is `"[sessionRestore] Auto-resuming interrupted turn for bg crash-respawn"`) — not confirmed to apply to a normal interactive VS Code chat session that was never a background agent | Auto-injects a continuation message without a human re-approving that specific message; inherits normal tool permissions (confirmed no permission-mode change tied to this flag) | Relevant to **Level 2**, and only directly to sessions run as background agents |
| `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` | **YES** — confirmed, default 3,600,000 ms (1 hour) when unset-but-truthy, no bound applied at all if the var itself is absent | 2.1.233 | 2.1.233 | Same scope as above | Bounds how old an "interrupted turn" can be before auto-resume is suppressed (`tengu_resume_stale_turn_suppressed`) | Set to a deliberate, longer value (task's suggested 8h = `28800000`) if Level 2 is enabled |
| `CLAUDE_CODE_RESUME_PROMPT` | **YES** — confirmed, default value is literally `"Continue from where you left off."` | 2.1.233 | 2.1.233 | Same scope as above | The exact text a user never typed becomes the "user" turn — must be a fixed, Relay-controlled string, never handoff-derived (already the plan) | Set to the reconciliation-first prompt from Phase 18/9 of the original task |
| `claude respawn <id>\|--all` | **YES** — real command, works directly (`claude respawn --help`), just absent from top-level `claude --help`'s command list | Present in 2.1.217 already | 2.1.217, 2.1.233 | Background agents (`claude agents`/`--bg`) specifically | Restarts a process; doesn't touch credentials | Level 2/3 fallback for sessions that *are* background agents |
| `claude --resume <session-id>` / `claude -p ... --resume <id>` | **YES**, publicly documented (unlike the above) | Long-standing | 2.1.217, 2.1.233 | Any session, any front-end — VS Code extension and CLI share the same session store (documented: *"To continue an extension conversation in the CLI, run `claude --resume` in the terminal"*) | Reloads history; does not itself re-inject a continuation message (that's what `CLAUDE_CODE_RESUME_PROMPT` is for, but only inside the interrupted-turn path above) | Level 2 building block for non-background-agent sessions |
| Cross-directory session lookup by ID | Version-gated, **officially documented** | v2.1.223+ | This machine is now 2.1.233 (≥ threshold) | `--resume <id>` from any directory, not just the original project | — | Now available on this machine after the Phase 0 update |
| VS Code session URI (`vscode://anthropic.claude-code/open?session=<id>`) | **YES, officially documented** — confirmed by fetching `code.claude.com/docs/en/vs-code.md` directly this pass | Long-standing (URI handler section doesn't cite a version gate) | 2.1.233 | Handler is `vscode://anthropic.claude-code/open`. Two independent optional query params: `prompt` (pre-fills the prompt box, **does not auto-submit**) and `session` (resumes that ID **only if it belongs to the workspace currently open in VS Code**; otherwise silently starts a fresh conversation instead of erroring; if already open in a tab, that tab is focused instead of duplicating) | None directly; `session` param never executes anything on its own — worst case is opening the wrong/a fresh conversation, not the wrong workspace running arbitrary state | Level 3 building block. The workspace-scoping behavior is exactly the safety property Part 21 of the task asked for: Relay does not need to build cross-workspace guarding here, the URI handler already refuses cross-workspace resume by design (falls back to "fresh conversation" rather than opening someone else's session in the wrong folder) |
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

## Additional confirmed facts relevant to safety design (this pass)

From `code.claude.com/docs/en/sessions.md`, fetched and read in full this pass (not summarized/truncated):

- **Permission mode is *not* blanket-restored on resume.** `plan` and `bypassPermissions` are never
  restored — a session that was in either resumes in the mode a new session would start in instead. This is
  a real, official safety backstop independent of anything Relay does: even if Relay's fallback resumer
  (Level 2) targets a session ID that happened to be in `bypassPermissions` when it was interrupted (which
  Relay would never itself set, per the hard constraint), Claude Code's own resume path refuses to restore
  that mode. `auto` mode is restored only if the account still meets auto-mode requirements at resume time.
  Manual resumes as Manual.
- **Flags are not implicitly restored.** `--settings`, `--mcp-config`, `--plugin-dir`, `--fallback-model`,
  `--add-dir` are *not* carried over automatically on `--resume`; only `settings.json`/`settings.local.json`
  are re-read at launch. This matters directly for Level 2: the fallback resumer must re-pass
  `CLAUDE_CODE_RETRY_WATCHDOG=1` etc. itself (already the plan, per Part 6 of the task) rather than assuming
  the resumed process inherits it from the original invocation.
- **Cross-directory `--resume <id>` resolution is conservative by design**, not just by version gate: it
  only resolves to another project when *exactly one* other project holds a transcript with messages for
  that ID — a hand-copied/duplicated transcript makes it report not-found rather than guess. This is useful
  corroboration for Relay's own "don't guess, fail closed" posture (Part 34 of the task).
- **`claude -p --resume <id>`** is the documented headless form for sending a follow-up prompt to an
  existing session non-interactively and capturing structured JSON output — this is the exact primitive
  Level 2's fallback resumer uses (Part 6), now confirmed as the intended, documented use of that flag
  rather than an incidental capability.

## Not yet verified this pass

- Status-line `rate_limits.*` fields — not confirmed or disproven this pass.
- Whether the literal "You've hit your session limit" block is actually communicated to the client as an
  HTTP 429 (which the watchdog's retry logic is keyed on) as opposed to a client-side pre-check that never
  issues a request at all. The retry code's use of server-provided retry timing on 429 responses is
  suggestive but not conclusive proof this exact user-facing message flows through that path — the
  strongest remaining way to close this is observing a real (not deliberately provoked) occurrence, which
  is exactly what `.relay/wake-observations.jsonl` (already shipping on the research branch) exists to
  capture.

# Automatic Wake Architecture — Decision Record

> **SUPERSEDED, IN PART — READ THIS FIRST.** The "Does not exist" verdicts below (for
> `CLAUDE_CODE_RETRY_WATCHDOG`, `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` and its variants, and automatic
> retry/wait on a usage limit) **were wrong.** A later pass decompiled the actual installed `claude.exe`
> binary directly instead of relying only on published documentation, and found all of them really
> present and wired into the retry/resume code paths — just undocumented, not fictional. The full
> correction, with the evidence, is in
> [`docs/AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md`](./AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md); read that
> document for the current, accurate capability table. This page is kept as-written (not edited to hide
> the error) because the *reasoning process* it documents — verify a claimed mechanism directly rather
> than trust it, and say plainly when a claim doesn't check out — turned out to still be exactly right;
> only the specific verdict for these four variables was wrong, because "checked against public docs"
> and "checked against what the shipped binary actually does" are different, non-substitutable checks,
> and this pass only did the first one. `claude respawn` and the general caution about not building on an
> unverified mechanism remain accurate as originally written below.

**Can Claude Relay automatically continue a Claude Code session after a usage-limit reset? Not yet, and
not with real confidence — because of one specific, unresolved observability gap identified below, not
because the idea is unworkable.** This document explains what was verified against official Anthropic
documentation, what was checked directly against the installed CLI (2.1.217), what remains genuinely
unknown, and why nothing here was implemented as a shipped feature yet.

## Correcting the premise this task started from

The task that prompted this investigation asserted several specific Claude Code mechanisms as if they
were confirmed official features to build around: `CLAUDE_CODE_RETRY_WATCHDOG`,
`CLAUDE_CODE_RESUME_INTERRUPTED_TURN` (and `_MAX_AGE_MS`, `_PROMPT` variants), and `claude respawn <id>`
described as generally resuming "the interrupted session." Checked directly, not assumed:

| Claimed mechanism | Verified status (at the time this page was written) |
|---|---|
| `CLAUDE_CODE_RETRY_WATCHDOG` | ~~Does not exist.~~ **Corrected — see the notice above.** Real; absent only from public docs, not from the shipped binary. |
| `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` (+ `_MAX_AGE_MS`, `_PROMPT`) | ~~Does not exist.~~ **Corrected — see the notice above.** Real; same caveat. |
| Automatic retry/wait when a plan usage limit is hit | Still not confirmed as of the correction pass either — `CLAUDE_CODE_RETRY_WATCHDOG` is architecturally positioned to cover this (it removes the retry ceiling for 429/529 responses and uses server-provided retry timing), but whether the specific plan-level "usage limit" message flows through that exact path, as opposed to a client-side pre-check that never issues a request at all, remained an open question pending a real (non-provoked) occurrence — see `AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md`'s "Not yet verified" section. |
| `claude respawn <id>\|--all` | **Real** — confirmed directly (`claude respawn --help` on the installed 2.1.217 CLI). Not listed in top-level `claude --help`, but functional. Its documented purpose is narrower than "resume an interrupted session": *"Restart a background session (or all of them) so it picks up the current Claude binary."* It's a background-agent mechanism (`claude agents`), not a generic "continue where you left off" command. |

If a task asks you to build around a specific env var or flag, verify it against the current CLI/docs
first — this project's own history includes several confidently-stated claims that turned out false when
actually checked (fabricated release notes, a "Marketplace publication" that had never happened, a
`shell:true` "fix" that was itself unsafe). This is another instance of the same failure mode, caught
before anything was built on it — **and, as the notice above documents, this page's own "checked against
docs only" method was itself later subject to the same standard and found wanting.** The lesson compounds
rather than being a one-time catch: verification methods themselves need re-checking, not just claims.

## What's real, and directly useful

- **Transient per-request rate limits** (HTTP 429 tied to an API key/cloud project) are retried
  automatically by Claude Code's own SDK-level backoff — this already works and needs nothing from Relay.
  This is a *different, smaller* thing than the plan-level limit the user actually hit.
- **Plan-level usage limits** ("You've hit your session limit · resets 3:45pm") are a hard block with
  *no* automatic retry, confirmed above. This is the case that actually matters here.
- **VS Code extension sessions and CLI sessions share the same conversation store.** Official docs,
  quoted verbatim: *"The extension and CLI share the same conversation history. To continue an extension
  conversation in the CLI, run `claude --resume` in the terminal."* This means a session that hit its
  limit inside the VS Code chat panel is not sealed off from external tooling — it's the same session ID
  system the CLI uses.
- **Headless continuation is a real, documented pattern**: `claude -p "next message" --resume
  "$session_id"` sends a new message into a specific past session non-interactively and returns the
  result. This is the actual building block for "Model C" from the original task's proposal — not
  `respawn`, which is scoped to background agents specifically.
- **Resuming reloads history; it does not auto-continue an incomplete turn.** Confirmed for both
  `--resume`/`--continue` and `respawn`: after reload, a *new* message is required to prompt continuation.
  There is no mechanism, official or otherwise, that picks a half-finished turn back up on its own.
- **Version-dependent behavior worth knowing:** cross-directory session lookup by ID (`claude --resume
  <id>` from any directory on the machine) requires Claude Code **v2.1.223+**. This machine runs 2.1.217 —
  older. On this version, resume must run from the same project directory (or a git worktree of it) as
  the original session.
- **Hook payloads include `session_id`** for every hook event (`SessionStart`, `PreCompact`,
  `StopFailure`, and others) — already true of the fixtures in this repo. If a hook fires at the right
  moment, capturing the session ID for later use is straightforward.

## The unresolved gap: does anything observable fire when a plan usage limit blocks a session?

This is the one open question this document could not close, and it is the one that actually matters —
everything above is a plausible mechanism *once Relay knows a session got blocked and what its ID was*.

`StopFailure`'s documented trigger is *"when the turn ends due to an API error,"* and its matcher can
filter on an error-type category that includes `rate_limit` among others (`overloaded`,
`billing_error`, `server_error`, etc. — the same category list used by the SDK's internal
`system/api_retry` event for per-request retry accounting). That similarity suggests `StopFailure`'s
`rate_limit` category is more likely tied to the *per-request* retry-exhaustion case than the *plan-level*
block. Separately, and more directly: **the official error reference for session/usage limits does not
mention any hook firing at all.** Quoted in full: *"The documentation does not mention any hooks
(StopFailure, Stop, SessionEnd) firing when usage limits are hit. There is no reference to hook mechanisms
in this error reference documentation."*

The most literal reading of "the session simply stops accepting new requests" is that Claude Code may
refuse the request client-side, before any API call is even made — which would mean there is no "API
error" for `StopFailure` to be triggered by in this specific case at all.

I did not resolve this by deliberately exhausting a real usage limit — the task that prompted this
explicitly said not to burn subscription usage for the purpose of testing, and doing so just to settle a
documentation ambiguity would be a bad trade. I also checked this machine's actual session transcripts and
`.relay/` state for independent evidence from the user's real incident; none exists (no `.relay/`
directory was ever created against the project where it happened, and hook-runner.cjs currently doesn't
log its own invocations anywhere persistent).

**This is the one thing that needs to happen before any wake architecture can be built with real
confidence — not writing more design, running more real usage-limit events through an instrumented
setup.**

## What this means for the four proposed models

- **Model A (retry watchdog keeps the process alive):** not available. The mechanism it depends on
  doesn't exist.
- **Model B (Wake Controller + `respawn`):** doesn't fit the actual scenario. `respawn` is scoped to
  background agents (`claude agents`/`--bg`); the user's session was a normal interactive VS Code chat
  session, a different session category.
- **Model C (Wake Controller + `--resume` + a fixed continuation prompt via `-p`):** the only one built
  on confirmed, real mechanisms — *if* Relay can ever learn that a session was blocked and capture its ID.
  That "if" is exactly the unresolved gap above.
- **Model D (hybrid):** not applicable — Model A's half doesn't exist to hybridize with.

## Decision

**Not implementing a WakeController that claims to auto-continue sessions in this pass.** Shipping
something that silently doesn't fire — because the triggering signal turns out not to exist for this
exact scenario — would be worse than not having the feature: a user would trust it and be let down at the
exact moment they needed it, which is the same failure mode as every fabricated claim already corrected
in this project's history.

**What's actually being added instead: observability, not automation.** See "Instrumentation prototype"
below — a small, safe, honest step that answers the open question the next time a real (not
deliberately-triggered) usage-limit event occurs, without claiming to solve continuation before that
question is answered.

## Product-level scope answers

- Does the Claude process need to stay alive? — Not applicable; no live-process-based mechanism exists to design around.
- Does VS Code need to stay open? — Only matters once a real trigger mechanism is confirmed; not evaluated further here.
- Does the PC need to stay awake? — Same as above.
- Survives VS Code restart? — Not evaluated; premature before the trigger question is resolved.
- Survives OS restart? — Not evaluated, same reason.
- Level reached (of the 4-level progressive scale from the original task): **Level 0** — the trigger
  itself isn't confirmed to exist yet, so no level of "keeps working across X" can honestly be claimed.

## Documentation truth check

Audited README.md, packages/vscode/README.md, and docs/RELEASE_NOTES_V0_2_2.md for any implication that
Claude Relay automatically resumes work after a usage-limit reset: **none found.** Existing wording
("checkpoint on `StopFailure`", "manual controls", "Resume Previous Task") already accurately describes
only what's real — capture and *manual* resume. Nothing needed correcting.

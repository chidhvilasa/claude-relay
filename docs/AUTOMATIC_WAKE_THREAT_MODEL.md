# Automatic Wake — Threat Model

Scope: everything added on `feature/v0.3-automatic-wake` — Level 1 configuration
(`AutomaticWakeConfigManager`), session-identity capture in hook-runtime, and the Level 2
engine (`wake-store`, `wake-lease`, `repo-safety`, `claude-resolver`, `fallback-resumer`,
`wake-runtime`'s `WakeController`). Level 3 (VS Code session URI) and Level 4 (OS scheduler)
are not implemented yet — threats specific to them are noted as forward-looking, not mitigated
by code that exists today.

Format per threat: what it is, what happens if unmitigated, what actually stops it in this
codebase (with the file/test that proves it), and residual risk if any.

## 1. Malicious repository content

**Threat.** A cloned/pulled repository contains files crafted to manipulate an unattended
Claude process into doing something harmful once "resumed."

**Mitigation.** The fallback resumer's controlling prompt (`WAKE_CONTINUATION_PROMPT`,
`packages/core/src/wake/continuation-prompt.ts`) is a single fixed string, never built from
repository content, handoff content, or any other file. It explicitly instructs the resumed
Claude to treat everything it reads afterward as untrusted. Normal Claude Code permission
checks still apply to every tool call the resumed session makes — nothing here elevates or
bypasses them.

**Residual risk.** A sufficiently permissive existing permission configuration (the user's own,
not something Relay grants) could still let a resumed session run something harmful if the
repository steers it convincingly. This is the same risk that exists in any Claude Code
session, automatic or not — Automatic Wake doesn't add a new bypass, but it does mean nobody
is watching the terminal live while it runs.

## 2. Poisoned handoff

**Threat.** A `.relay/handoffs/*.json` file (written by a prior session, or tampered with)
contains instructions designed to be followed uncritically on resume.

**Mitigation.** Same as #1 — the controlling prompt never embeds handoff content directly; it
tells Claude to treat handoff/repository text as untrusted context and reconcile before acting.
This mirrors the existing `ResumeReconciler`'s framing (`packages/core/src/resume/reconciler.ts`),
extended to the automated path.

**Residual risk.** Same as #1.

## 3. Stale task (user already finished manually)

**Threat.** The user returns and finishes the interrupted task by hand before a fallback
attempt fires; a later fallback then "wakes" a task that's already done.

**Mitigation.** `classifyRepoSafety` (`packages/core/src/wake/repo-safety.ts`) compares the
git branch/HEAD/dirty-count recorded when the wake was armed against the current state at
fallback time. Any material change — the expected shape of "I did more work already" —
classifies as `STALE` at minimum (forces reconciliation via the prompt) or `DIVERGED` (blocks
autonomous continuation outright if the branch itself changed). There is no semantic
"is the task done" guess anywhere in this code, by design (task instruction: don't guess
completion from arbitrary files) — only observable repository state.

**Residual risk.** A user who finishes the task without changing git state Relay can observe
(e.g., only reads/verifies, makes no commits, no working-tree changes) would still see a
fallback attempt classified `CURRENT`. Manual "Cancel Pending Wake" — not yet built as a VS
Code command in this pass, see the final report — would be the intended way to disarm that
case explicitly.

## 4. Session ID tampering / substitution

**Threat.** A wake record's `sessionId` is altered (accidentally or maliciously) to point at a
different, unrelated session.

**Mitigation.** Wake records live under `.relay/`, inside the workspace, subject to the same
filesystem trust boundary as everything else Relay writes there (a local attacker with write
access to `.relay/` already has write access to the whole repository). `WakeStateStore` reads
are defensive (`try`/`catch` around JSON parsing, corrupt files skipped not trusted) but this
is not designed to resist a fully capable local attacker who can also edit the wake record —
no local-only tool credibly can.

**Residual risk.** Accepted, consistent with every other piece of Relay state (checkpoints,
handoffs) living in the same trust boundary. Not a new attack surface introduced by wake.

## 5. Wake-file tampering (state corruption, not just content forgery)

**Threat.** `.relay/wake/<hash>.json` or `index.json` becomes corrupted (crash mid-write, disk
full, concurrent writers).

**Mitigation.** All writes are atomic (temp file + `fs.renameSync`, `WakeStateStore.atomicWrite`)
and re-parsed immediately after write to catch a broken serialization before it becomes the
live file. A corrupt `index.json` is rebuilt from the individual record files on next read
(`rebuildIndexFromDisk`) rather than losing state — covered by
`wake-store.test.ts`'s "rebuilds a corrupt index from the record files" test. State-machine
transitions are validated against a fixed legal-transition table (`isLegalWakeTransition`) and
rejected outright if illegal, so a corrupted or manually-edited `state` field that doesn't match
a sane progression can't silently be advanced further.

**Residual risk.** A record edited to claim an already-legal state (e.g. manually set to
`ARMED`) is accepted as-is on the next read — there's no cryptographic integrity check on the
record content itself, only on the write process being atomic and the transition graph being
enforced going forward.

## 6. Symlink / junction escape

**Threat.** `.relay/checkpoints` or `.relay/wake` resolves (via a symlink/junction) outside the
workspace, and Relay writes into that external location.

**Mitigation.** Directly ported from the existing, tested checkpoint-write defense: hook-runtime
checks `realCheckpointsDir.startsWith(workspaceRoot)` after resolving symlinks, refusing to
write if it escapes (`hook-runner.test.ts`'s symlink-escape test). `WakeStateStore` writes are
confined to `path.join(workspaceRoot, '.relay', 'wake', ...)`, constructed from a
`fs.realpathSync`-resolved workspace root the same way checkpoints are.

**Residual risk.** None beyond what already applies to checkpoint writes.

## 7. Duplicate agent (the race Part 10 names explicitly)

**Threat.** The native retry watchdog (Level 1) resumes a still-live process at the same moment
Relay's fallback (Level 2) independently decides to spawn a second, competing continuation for
the same session.

**Mitigation.** `WakeLeaseManager` (`packages/core/src/wake/wake-lease.ts`) requires acquiring a
time-bounded lease before any fallback spawn; a lease already held by another owner causes an
immediate, silent no-op rather than a competing spawn. `WakeController.run()` acquires the
lease before resolving the executable or spawning anything, and releases it in a `finally`
block so a completed/failed/blocked attempt never leaves a stale lease behind for its own run.
Directly tested: `wake-lease.test.ts`'s "refuses a second acquire while a live lease is held",
`wake-controller.test.ts`'s "refuses to run when another owner already holds the lease."

**Residual risk.** Relay cannot observe the *native* watchdog's internal state directly (no API
for that exists) — the lease only prevents two *Relay-initiated* fallback attempts from racing
each other, or a fallback racing a manually-invoked one. Preventing the native watchdog itself
from double-processing is Anthropic's own responsibility inside the CLI, outside what Relay can
inspect or control.

## 8. Permission escalation

**Threat.** The unattended fallback path is used as a vector to grant broader permissions than
the user configured (e.g., slipping in `bypassPermissions`).

**Mitigation.** `spawnFallbackResumer`'s argument list is fixed source
(`packages/core/src/wake/fallback-resumer.ts`) — `-p`, the fixed prompt, `--resume`, the session
id, `--output-format json`. There is no parameter on `FallbackResumerOptions` that could carry a
permission-mode flag in, and `--dangerously-skip-permissions`/`bypassPermissions` do not appear
anywhere in the constructed args (statically checked in
`fallback-resumer.test.ts`'s "never passes --dangerously-skip-permissions..." test, which reads
the actual args-construction line of the shipped source, not just asserts behavior). Per
`sessions.md`'s documented resume behavior (re-verified this pass, see
`AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md`), Claude Code itself never restores `bypassPermissions`
on `--resume` even if the original session happened to be in that mode — an independent backstop
Relay doesn't have to build.

**Residual risk.** None identified beyond what's already documented as Claude Code's own
behavior.

## 9. User already finished manually / workspace changed underneath a pending wake

**Threat.** Between arming and a fallback attempt, the user opens a *different* project in the
same VS Code window, or the workspace folder is deleted/moved.

**Mitigation.** `classifyRepoSafety` checks the workspace path still exists on disk and matches
the path recorded at arm time; a mismatch or missing path classifies `UNSAFE`, which
`WakeController` maps straight to `CANCELLED` — no fallback spawn happens at all.

**Residual risk.** None identified for the cases this function can observe.

## 10. Old wake after reboot

**Threat.** A machine reboot (or a long sleep) leaves a stale armed wake record from days ago
that fires as if it were still recent.

**Mitigation.** Every wake record carries an `expiresAt` (default 8h from arming, configurable).
`WakeController.run()` checks this before doing anything else and transitions to `EXPIRED`
(never attempting a fallback) if past it — this uses wall-clock time (`Date.now()`), which
survives a sleep/reboot correctly (not, e.g., a process-uptime-based timer that would reset).

**Residual risk.** None identified — this is exactly the case the expiry gate exists for.

## 11. Arbitrary executable substitution / PATH hijacking

**Threat.** Between an initial fallback attempt and a later retry for the same wake record, the
`claude` executable at the resolved path is swapped for something else (a supply-chain-style
local attack, or an accidental PATH change).

**Mitigation.** `claude-resolver.ts`'s `resolveClaudeExecutable`/`fingerprintExecutable`/
`verifyClaudeExecutable` resolve the executable via direct filesystem checks (never a shell,
never `which`/`where` via a subprocess) and record a size + sha256-prefix fingerprint.
`WakeController` stores this fingerprint on a wake record's first attempt and verifies a later
attempt's freshly-resolved executable against it before spawning — a mismatch fails the attempt
outright rather than running the substituted binary. Directly tested end-to-end:
`wake-controller.test.ts`'s "detects claude executable substitution between two attempts...",
which tampers the actual file on disk between two real `WakeController.run()` calls and confirms
the second is refused.

**Residual risk.** The very first attempt for a record has nothing to compare against yet — it
trusts whatever resolves at that moment (a configured path, or the first PATH match found via
direct filesystem walk, never a shell). This is a reasonable floor: at arm time, the user's own
environment is presumed trustworthy in the same way installing any CLI tool presumes it.

## 12. Auth expiry during an unattended wait

**Threat.** Claude Code's login expires during a multi-hour wait, and the fallback path tries to
silently trigger a new OAuth flow.

**Mitigation.** `fallback-resumer.ts`'s `classifyOutcome` recognizes auth-failure-shaped output
(`not logged in`, `please run /login`, `authentication`) and reports `blocked_auth` —
`WakeController` maps this to the `BLOCKED_AUTH` terminal state. Nothing in this codebase
initiates a browser OAuth flow, reads `~/.claude/.credentials.json`, or handles credentials in
any form — grep-verifiable (no reference to that file, no OAuth-related code, anywhere in
`packages/core/src/wake/`, `packages/wake-runtime/`, or `packages/hook-runtime/`).

**Residual risk.** None identified — this is a hard stop, not a workaround.

## 13. Network offline / repeated failures hammering restarts

**Threat.** The machine is offline; a naive retry loop spawns fallback attempts in a tight loop.

**Mitigation.** There is no retry loop in this codebase — `WakeController.run()` makes exactly
one fallback attempt per invocation and returns; nothing here re-invokes itself. Repeated
invocation (e.g. by a future scheduler) would each individually go through the full lease/
repo-safety/expiry gate sequence, so a lease held by a still-running prior attempt prevents a
second one from starting concurrently. `attemptCount` is tracked on the record for observability
of how many attempts have actually happened.

**Residual risk.** Since no scheduler/trigger is wired up yet (Level 3/4 undone), there is
nothing yet that could actually hammer restarts in practice — this section describes the
engine's own safety property, to hold once a trigger is added, not a currently-exploitable gap.

## 14. Multiple projects / multiple sessions in one project

**Threat.** Wake state for one project or session interferes with another.

**Mitigation.** Wake records live under `<workspace>/.relay/wake/`, so different workspaces
are isolated by construction (`wake-store.test.ts`'s "isolates records per workspace"). Within
one workspace, each session gets its own record keyed by a hash of its session id
(`wake-store.test.ts`'s "supports multiple independent sessions in one project"). Leases are
acquired per session id, so two different sessions in the same project never contend for the
same lease (`wake-lease.test.ts`'s "isolates leases per session").

**Residual risk.** None identified for the cases tested.

## 15. Forward-looking: Level 3 (VS Code session URI)

Not implemented this pass. The relevant threat once it is — reopening the wrong workspace's
session, or reopening on every old checkpoint instead of only a valid armed wake — is
substantially pre-mitigated by the URI handler's own documented behavior (confirmed this pass,
see `AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md`): the `session` parameter only resumes a session
that belongs to the workspace currently open in VS Code, falling back to a fresh conversation
rather than opening a foreign session. Relay-side work still needed: only invoke the URI for a
genuinely valid, armed, non-expired wake record — never for every old checkpoint, per the task's
explicit instruction.

## 16. Forward-looking: Level 4 (OS scheduler)

Not implemented, and not designed in detail this pass beyond the option comparison in
`AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md`. Threats to design against when it is: a scheduled
task that outlives Automatic Wake being disabled (must be removed on disable, not just stop
being useful), embedded credentials in a scheduled task definition (must be none — same "no
credential access" constraint as everywhere else), and elevation (must run as the current user,
never elevated).

## Summary

| # | Threat | Mitigated today? |
|---|---|---|
| 1 | Malicious repository | Yes (fixed prompt, untrusted-context framing) |
| 2 | Poisoned handoff | Yes (same) |
| 3 | Stale/already-finished task | Partial (repo-state detection; no explicit "mark done" command yet) |
| 4 | Session ID tampering | Accepted risk, same trust boundary as all Relay state |
| 5 | Wake-file corruption | Yes (atomic writes, index rebuild, transition validation) |
| 6 | Symlink escape | Yes (ported from existing checkpoint defense) |
| 7 | Duplicate agent | Yes for Relay-initiated races; native watchdog unobservable by design |
| 8 | Permission escalation | Yes (fixed args, no bypass flag possible, Claude Code's own resume-mode reset) |
| 9 | Workspace changed underneath a pending wake | Yes (UNSAFE classification) |
| 10 | Stale wake after reboot | Yes (wall-clock expiry) |
| 11 | Executable substitution | Yes for retries within a record; first attempt trusts initial resolution |
| 12 | Auth expiry | Yes (hard stop, no OAuth code exists) |
| 13 | Restart hammering | Yes by construction (no retry loop exists) |
| 14 | Multi-project/multi-session interference | Yes |
| 15 | Level 3 URI misuse | Partially pre-mitigated by the documented handler; Relay-side gating not yet built |
| 16 | Level 4 scheduler risks | Not yet applicable — not implemented |

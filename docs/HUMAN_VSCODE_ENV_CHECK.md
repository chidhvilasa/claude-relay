# Human check: does Automatic Wake's env config actually reach a real VS Code session?

## Why this exists

Everything Relay's Level 1 config does is write four env vars into a Claude settings file.
That mechanism is fully tested (`packages/core/src/wake/wake-config.ts`, 14 tests) and was
verified to reach a *real* Claude session **via the CLI** — a marker var set through
`claude -p --settings '{"env":{...}}'` was echoed back by a live Bash tool call in that session.

That is not the same claim as "the VS Code extension's bundled Claude process reads the same
`env` block the same way." The VS Code docs (`vs-code.md`, fetched directly this pass) say
`~/.claude/settings.json` is "shared between the extension and CLI," which is strong evidence,
but Relay has not independently proven it by watching a real VS Code panel do it — and per this
project's own standard (verify, don't infer), that gap should be stated plainly rather than
silently assumed away. This is a 2-minute check; no Relay code changes based on the result.

## Steps

1. Open a project in VS Code with the Claude Code extension installed.
2. Run `claude-relay.enableAutomaticWake` (Command Palette → "Claude Relay: Enable Automatic
   Wake") and choose **This Workspace**.
3. Open `<workspace>/.claude/settings.local.json` and confirm it now has an `env` block
   containing `CLAUDE_CODE_RETRY_WATCHDOG`, `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`,
   `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS`, `CLAUDE_CODE_RESUME_PROMPT`.
4. **Fully close and reopen the workspace in VS Code** (env vars are typically read at process
   start, not hot-reloaded — reopening avoids a false negative from a stale process).
5. Open the Claude Code panel (the Spark icon) and start a new conversation.
6. Ask Claude to run this exact Bash command and report only whether it printed `1` or nothing:
   ```
   echo "WAKE_CHECK=$CLAUDE_CODE_RETRY_WATCHDOG"
   ```
7. Record the result below.

No credentials, no real work, no quota-sensitive action — this is a single environment-variable
read.

## Result log

| Date | Claude Code version | VS Code version | `CLAUDE_CODE_RETRY_WATCHDOG` seen in the Bash tool's environment? | Notes |
|---|---|---|---|---|
| _(not yet run)_ | | | | This check has not been performed yet as of this document's creation. Fill in a row after running the steps above. |

## What a PASS here does and doesn't prove

**Proves:** the env var Relay writes reaches a tool subprocess Claude spawns from inside a real
VS Code session — the same propagation path Level 1's actual value depends on.

**Does not prove:** that `CLAUDE_CODE_RETRY_WATCHDOG=1` changes VS Code's own retry behavior on a
real 429/529/usage-limit response. That is a separate, harder-to-provoke-safely claim, and is
exactly what Release Gate A (a genuine, un-provoked natural usage-limit event) is for — see
`AUTOMATIC_WAKE_OFFICIAL_CAPABILITIES.md`.

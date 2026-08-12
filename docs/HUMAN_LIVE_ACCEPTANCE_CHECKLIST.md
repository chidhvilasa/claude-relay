# Human Live Acceptance Checklist — Claude Relay v0.2.2

Everything below requires a human driving the real, authenticated Claude Code VS Code extension. None of
it was run by this audit — it could not be, and nothing here should be read as claiming otherwise. Every
deterministic behavior these steps exercise has already been verified by automated tests (see the audit
report); this checklist is for the remaining slice that genuinely needs a live session.

Use the candidate artifact: `packages/vscode/claude-relay-0.2.2.vsix`
(SHA-256 recorded in the audit report).

## Setup
- Install the candidate VSIX into your real VS Code: `code --install-extension claude-relay-0.2.2.vsix`
  (or Extensions view → `...` → Install from VSIX).
- Open a real Git repository as your workspace folder.

## Checklist

1. **Open the Claude Code extension** and run `/plugins`. Confirm `claude-relay` is listed under the
   `clauderelay-oss` marketplace, version `0.2.0`, **enabled**. *(Automated evidence already shows the
   plugin is installed and enabled via `claude plugin list --json`; this step confirms the same fact
   through Claude Code's own UI.)*
2. **Invoke `/claude-relay:relay`** if authenticated. Confirm the skill loads and references resolve with
   no dependency on this source repo or a local dev path. If auth is expired: mark **BLOCKED_AUTH** and
   move on — do not attempt to authenticate on the user's behalf.
3. **Run `Claude Relay: Create Checkpoint`** from the Command Palette. Confirm a toast appears *and*
   `.relay/checkpoints/` gains a new file. *(Automated evidence: `RelayService.createCheckpoint` is
   directly tested; this step confirms the same code path fires correctly from the real Command Palette.)*
4. **Run `Claude Relay: Create Handoff Now`.** Answer the two prompts. Confirm `.relay/handoffs/` and
   `.relay/WAKEUP.md` are created, and that `WAKEUP.md` opens correctly when you accept the "Open" toast
   action.
5. **Start a genuinely new Claude Code session** in the same project (or trigger `/compact`). Confirm
   `SessionStart`/`PreCompact` fires without error and the dashboard's Recovery row reflects the new
   checkpoint. Confirm no duplicate hook execution (only one new checkpoint file appears per event).
6. **Run `Claude Relay: Resume Previous Task`.** Confirm the opened document contains the real objective/
   next-action text you entered in step 4, clearly labeled as untrusted historical context, and a
   freshness status.
7. **Modify a file, then re-run Resume.** Confirm the freshness status changes (no longer "fresh") and
   this is visible before you'd naturally notice the drift yourself.
8. **Run `Claude Relay: Open Dashboard`.** Confirm the tree view shows Claude Code, Plugin, Protection,
   Recovery, and Repository rows with real (not placeholder) values.
9. **Run `Claude Relay: Run Health Check`** and `Claude Relay: Show Logs`. Confirm the health message
   reflects current plugin/recovery state, and the output channel shows a real, timestamped operation log
   — not credentials, not full handoff bodies, not a raw stack trace.
10. **Ask Claude, in a live session:** "Resume the previous Claude Relay handoff." Observe whether Claude
    treats the WAKEUP.md content as background information to verify, not as instructions to execute
    outright. This is the one step that can't be mechanically asserted — it's a judgment call on the
    actual model behavior in a live session.

## Recording results

For each step, record one of: **PASS**, **FAIL** (with what happened), or **BLOCKED_AUTH**. Do not mark
anything PASS that wasn't actually run.

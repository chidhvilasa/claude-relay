# Human Live Acceptance Checklist — Claude Relay v0.2.2

Everything below requires a human driving the real, authenticated Claude Code VS Code extension. None of
it was run by this audit — it could not be, and nothing here should be read as claiming otherwise. Every
deterministic behavior these steps exercise has already been verified by automated tests, including a
real E2E run against the actual Marketplace-downloaded package (`Create Checkpoint` writing a real,
schema-valid file) — see the audit report. This checklist is for the remaining slice that genuinely needs
a live session: what it *looks* like, and how a live authenticated Claude session actually behaves.

## Setup
- Install from the Marketplace (now live): search **Claude Relay** in the Extensions view, or
  `code --install-extension clauderelay-oss.claude-relay`.
- Open a real Git repository as your workspace folder.

## Part 1 — Visual check (no automated tests can see this)
1. Activity Bar shows the Claude Relay icon.
2. The icon looks like the intended mark (a checkpoint ring → curve → checkpoint disc → forward chevron)
   — not broken, not a generic default icon.
3. It reads correctly in your current theme (dark and, if convenient, light).
4. Opening the Relay view shows a readable layout, no visual overflow/breakage.
5. Health Check / status text is understandable at a glance, not raw JSON or a stack trace.

## Part 2 — Live Claude Code session
6. **Run `/plugins`.** Confirm `claude-relay` is listed under the `clauderelay-oss` marketplace, version
   **`0.2.1`** (bumped from 0.2.0 in this release — not 0.2.0), **enabled**.
7. **Invoke `/claude-relay:relay`** if authenticated. Confirm the skill loads and references resolve with
   no dependency on this source repo or a local dev path. If auth is expired: mark **BLOCKED_AUTH** and
   move on — do not attempt to authenticate on the user's behalf.
8. **Run `Claude Relay: Create Checkpoint`** from the Command Palette. Confirm a toast appears *and*
   `.relay/checkpoints/` gains a new file.
9. **Run `Claude Relay: Create Handoff Now`.** Answer the two prompts. Confirm `.relay/handoffs/` and
   `.relay/WAKEUP.md` are created, and that `WAKEUP.md` opens correctly when you accept the "Open" toast
   action.
10. **Start a genuinely new Claude Code session** in the same project (or trigger `/compact`). Confirm
    `SessionStart`/`PreCompact` fires without error and the dashboard's Recovery row reflects the new
    checkpoint. Confirm no duplicate hook execution (only one new checkpoint file appears per event).
11. **Run `Claude Relay: Resume Previous Task`.** Confirm the opened document contains the real objective/
    next-action text you entered in step 9, clearly labeled as untrusted historical context, and a
    freshness status.
12. **Modify a file, then re-run Resume.** Confirm the freshness status changes (no longer "fresh") and
    this is visible before you'd naturally notice the drift yourself.
13. **Ask Claude, in a live session:** "Resume the previous Claude Relay handoff." Observe whether Claude
    treats the WAKEUP.md content as background information to verify, not as instructions to execute
    outright. This is the one step that can't be mechanically asserted — it's a judgment call on the
    actual model behavior in a live session.

## Recording results

For each step, record one of: **PASS**, **FAIL** (with what happened), or **BLOCKED_AUTH**. Do not mark
anything PASS that wasn't actually run.

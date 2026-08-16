# Claude Relay

Session continuity, checkpoints, handoffs, and recovery for [Claude Code](https://docs.claude.com/en/docs/claude-code).

Claude Relay captures a deterministic snapshot of your repository (branch, commit, dirty state) and an optional human-written handoff before context is lost — so a new Claude Code session, or a teammate, can pick up where you left off instead of starting cold.

Claude Relay ships as two parts:

| | Purpose |
|---|---|
| **Claude Relay Plugin** | Installed into Claude Code itself. Automatic protection — captures a checkpoint on `SessionStart`, `PreCompact`, and `StopFailure`. |
| **Claude Relay — VS Code Companion** *(this extension)* | Dashboard, manual checkpoint/handoff controls, recovery history, diagnostics, and legacy migration. Works even without the plugin, in manual mode. |

## Install

**1. Install the Claude Relay Plugin** (in a terminal, or Claude Code's own `/plugins` UI):

```bash
claude plugin marketplace add chidhvilasa/claude-relay
claude plugin install claude-relay@clauderelay-oss
```

**2. Install this extension** from the VS Code Marketplace (you're on its page now), then open the **Claude Relay** view in the Activity Bar.

The Companion works without step 1, but automatic protection between sessions requires the plugin.

*First-time install from a new publisher?* VS Code may ask you to confirm you trust the publisher
`clauderelay-oss` — that's normal platform behavior for any extension you haven't installed before, not
something specific to Claude Relay.

## What you get

- **Protection** — is this project currently protected, and by what (plugin vs. manual)?
- **Recovery** — is there a checkpoint or handoff to resume from, and is it still fresh relative to the current Git state?
- **Manual controls** — `Claude Relay: Create Checkpoint`, `Claude Relay: Create Handoff`, `Claude Relay: Resume Previous Task`, and more, all from the Command Palette.
- **Diagnostics** — `Claude Relay: Show Logs` and `Claude Relay: Health Check` for troubleshooting.

## Security

- **No auth** — Claude Relay never touches Claude credentials, API keys, or OAuth.
- **No network** — all Relay logic runs locally against your Git repository and `.relay/` folder.
- **Untrusted context** — restored handoffs are explicitly labeled *untrusted historical context* and are never executed automatically; they're a lead for the current session to verify, not a command.

## Troubleshooting

- **Can't find this extension in Marketplace search?** Install directly by ID: `code --install-extension clauderelay-oss.claude-relay`, or use the direct [Marketplace page](https://marketplace.visualstudio.com/items?itemName=clauderelay-oss.claude-relay).
- **"Claude Relay Plugin not detected"** — the Companion works in manual mode; run the install commands above for automatic protection.
- **Legacy v0.1 conflict** — use `Claude Relay: Remove Claude Integration` to safely remove old hooks from `settings.json` (a backup is created first).
- **"Recovery State: Invalid"** — the `.relay` folder contents don't match the expected schema; this is reported rather than guessed at.

---

*Claude Relay is an independent open-source project and is not affiliated with or endorsed by Anthropic.*

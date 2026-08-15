## Install the Claude Relay Plugin

The **Claude Relay Plugin** runs inside Claude Code itself and provides automatic protection —
it captures a checkpoint on `SessionStart`, `PreCompact`, and `StopFailure` without you doing anything.
This VS Code extension is the dashboard and manual-control layer; automatic protection comes from the
plugin.

Run in a terminal:

```bash
claude plugin marketplace add chidhvilasa/claude-relay
claude plugin install claude-relay@clauderelay-oss
```

Or use the button below to copy the commands and re-check status once you've run them.

You can also skip this step — the extension still works in manual mode without the plugin.

[Copy Install Commands and Re-check](command:claudeRelay.setup)

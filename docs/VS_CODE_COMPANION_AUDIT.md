# VS Code Companion Audit

> Verified against source as of the discoverability/reliability audit in `fix/vscode-discoverability-reliability`.
> Earlier versions of this document described a webview-based dashboard and command IDs that do not
> match the shipped extension; this revision replaces those claims with what the code actually does.

## Current Commands
(`packages/vscode/src/extension.ts`, all registered at activation)
- `claudeRelay.setup`: Claude Relay: Set Up — shows plugin install instructions, re-checks status
- `claudeRelay.healthCheck`: Claude Relay: Health Check — plugin status + recovery-state summary
- `claudeRelay.checkpoint`: Claude Relay: Create Checkpoint — real, writes `.relay/checkpoints/*.json`
- `claudeRelay.handoff`: Claude Relay: Create Handoff Now — prompts for objective/next action, writes `.relay/handoffs/*.json` and `.relay/WAKEUP.md`
- `claudeRelay.resume`: Claude Relay: Resume Previous Task — loads latest handoff, evaluates freshness, opens the resume instruction
- `claudeRelay.openLatestHandoff`: Claude Relay: Open Latest Handoff — opens `.relay/WAKEUP.md`
- `claudeRelay.openDashboard`: Claude Relay: Open Dashboard — focuses the tree view
- `claudeRelay.clearResolvedHandoff`: Claude Relay: Clear Resolved Handoff — moves the active handoff to `.relay/history` (confirmation required)
- `claudeRelay.reinstallClaudeIntegration`: Claude Relay: Reinstall Claude Integration — re-checks plugin status/install guidance (Relay 0.2 does not own hooks itself, so there is nothing else to "reinstall")
- `claudeRelay.removeClaudeIntegration`: Claude Relay: Remove Claude Integration — runs the legacy-hook migrator against `~/.claude/settings.json` (backup + atomic write, confirmation required)
- `claudeRelay.showLogs`: Claude Relay: Show Logs — reveals the `Claude Relay` output channel

## Current Views
- **Dashboard**: a native `TreeDataProvider` in the Activity Bar (`claudeRelayDashboard`) — **not** a webview. There is currently no webview anywhere in this extension, so webview-specific hardening (CSP, message schema validation, HTML escaping) does not apply; if a webview is added later, that hardening becomes a hard requirement at that time.
- Status Bar item (`Claude Relay: Ready`, opens Health Check)

## Current Dependencies
- `vscode` (build-only)
- `esbuild` (build-only)
- `typescript` (build-only)
- `@claude-relay/core` (runtime — bundled via esbuild; brings in `ajv`/`ajv-formats` transitively for schema validation)

## Activation Events
- `onStartupFinished` — used because plugin/legacy detection and the dashboard's initial state both need to run once at startup regardless of which view the user opens first. Narrower activation events (e.g. `onView:claudeRelayDashboard`) would delay detection until the user opens the view, which would leave the status bar and startup notifications (missing plugin / legacy conflict) silent until then — considered, not adopted, for that reason.

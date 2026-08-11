# VS Code Companion Audit

## Current Commands
- `claudeRelay.openDashboard`: Open Dashboard (Primary UI)
- `claudeRelay.createCheckpoint`: Create Checkpoint (Manual recovery action)
- `claudeRelay.createHandoff`: Create Handoff (Manual recovery action)
- `claudeRelay.healthCheck`: Run Health Check (Diagnostics)
- `claudeRelay.migrateLegacy`: Migrate Legacy Setup (v0.1 -> v0.2)

## Current Views
- Dashboard Webview
- Status Bar (`Claude Relay`)

## Current Dependencies
- `vscode` (Build-only)
- `esbuild` (Build-only)
- `typescript` (Build-only)
No heavy runtime dependencies.

## Activation Events
- `onStartupFinished` (Plugin detection requires workspace check early, but this can be optimized to `onWorkspaceContains:.relay` or similar lazy activation if needed, though plugin status benefits from early load).

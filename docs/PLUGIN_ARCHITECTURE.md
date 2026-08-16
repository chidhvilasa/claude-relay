# Claude Relay: Plugin Architecture (v0.2.0-dev)

## 1. Overview
The v0.1 architecture relied entirely on the VS Code extension to orchestrate Claude Relay, manually mutating `~/.claude/settings.json` to insert hard-coded hooks.

The v0.2.0-dev architecture separates concerns into two standalone products:
1. **Claude Code Plugin**: The canonical, headless installation mechanism for Claude CLI users.
2. **VS Code Extension**: A rich graphical companion providing dashboards, plugin detection, migration, and manual controls.

Both products share business logic through a common `@claude-relay/core` package but operate independently.

## 2. Component Responsibilities

### `@claude-relay/core`
- **Responsibility**: Core business logic (checkpointing, state machine, Git reconciliation, storage schemas).
- **Execution**: Imported as a library by the VS Code Extension and the `hook-runtime`.
- **Constraint**: Must not depend on the VS Code extension or `hook-runtime`.

### `hook-runtime`
- **Responsibility**: Parsing hook input, deterministic recovery, checkpointing, state updates, schema validation, event deduplication.
- **Constraint**: Must be a self-contained bundled artifact for plugin distribution. Must NOT uninstall itself, modify plugin installation, remove Claude settings, rewrite user configuration, or perform migrations. 

### Claude Code Plugin (`plugins/claude-relay`)
- **Responsibility**: Canonical hook management and headless recovery.
- **Components**:
  - `.claude-plugin/plugin.json`: Plugin metadata and schema.
  - `skills/relay/SKILL.md`: Exposes the `/relay` skill to the user. It handles semantic reasoning only.
  - `hooks/hooks.json`: Officially supported Claude Code hook definitions (SessionStart, PreCompact, PostCompact, Stop, StopFailure, SessionEnd). Uses `${CLAUDE_PLUGIN_ROOT}` or verified pathing to invoke the runtime.
  - `runtime/`: The bundled `hook-runtime`.
- **Behavior**: Operates entirely independently of VS Code.

### VS Code Extension (`packages/vscode`)
- **Responsibility**: Graphical companion and manual orchestration.
- **Behavior**:
  - Plugin Detection: Uses a provider-based strategy (`ClaudePluginDetector`) to detect `NOT_INSTALLED`, `INSTALLED`, `LEGACY_INTEGRATION`, `PLUGIN_AND_LEGACY_CONFLICT`, etc.
  - Legacy Migration: Owns the process of migrating users from v0.1 manual hooks to the Plugin. 
  - Status UI: Displays Plugin Active vs Not Installed, health info, manual checkpoint controls.
- **Constraint**: The VS Code extension NO LONGER directly installs automatic hooks into `settings.json`.

## 3. Hook & State Ownership
- **Automatic Hooks**: Owned entirely by the **Claude Relay Plugin**.
- **State**: Project recovery state remains project-scoped (e.g., `<workspace>/.relay/`). Plugin installation files remain plugin-owned.
- **Skill**: Owned by the **Claude Relay Plugin**.

## 4. Migration Path for v0.1 Users
Migration is owned by the VS Code extension and requires explicit user action:
1. Detect legacy v0.1 Relay hooks.
2. Detect Claude Relay Plugin.
3. If both exist or only legacy exists, offer migration.
4. User approves.
5. Backup settings.
6. Verify plugin installed and healthy.
7. Remove ONLY legacy Relay-owned entries.
8. Validate config.
9. Run Health Check (rollback if any validation fails).

If a conflict is detected (`PLUGIN_AND_LEGACY_CONFLICT`), the user is warned and automatic duplicate checkpoints are prevented where possible.

## 5. Failure & Edge Case Behavior
- **Plugin without VS Code**: Fully functional. Users won't have the GUI dashboard but can use standard CLI workflows and the Relay skill. Checkpoints occur automatically.
- **VS Code without Plugin**: Displays "Plugin Not Installed" in the Dashboard UI. Manual Checkpoints still work, but automatic hook-driven checkpoints will not trigger.
- **Security**: The standalone hook runner uses secure architecture, preventing credential leakage. All runtime references in hooks must use officially supported path tokens.

# Claude Relay

Claude Relay is an automatic session continuity extension for Claude Code. It safely preserves deterministic project state and semantic checkpoints during your coding sessions to ensure you never lose context when you hit usage quotas or close your terminal.

*Claude Relay is an independent open-source project and is not affiliated with or endorsed by Anthropic.*

## Architecture
- **Core Engine**: A platform-agnostic deterministic snapshot tool and JSON schema manager.
- **Hook Runner**: A completely self-contained `.cjs` hook runtime invoked automatically by Claude Code during `PreCompact`, `StopFailure`, and `SessionStart`.
- **VS Code Extension**: A lightweight dashboard and command suite for managing your Claude Relay state natively in the editor.

## Status (v0.1)
- Hook runtime correctly merges into `~/.claude/settings.json` idempotently.
- Deterministic checkpoints include Git states, atomic writes, and schema validation.
- Commands implemented: Setup, Checkpoint, Resume, Health Check, Handoffs.

## Installation
Currently in development. Install via VSIX:
`code --install-extension claude-relay-0.1.0.vsix`

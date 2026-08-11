# Phase 0 Research Notes

## Verified Capabilities
- Git is initialized in the workspace.
- Node.js (v22.14.0) and pnpm are installed.
- VS Code CLI (`code`) is available.
- Claude Code VS Code extension ID is confirmed as `anthropic.claude-code`.
- `~/.claude/settings.json` exists and contains basic configuration.
- The user's global `~/.claude` directory contains standard folders (`backups`, `cache`, `projects`, `sessions`, `plugins`, etc.).

## Unsupported Capabilities & Assumptions
- **Hooks (`PreCompact`, `Stop`, etc.)**: The exact mechanism for injecting custom JS hooks (e.g., `PreCompact`) into the closed-source `anthropic.claude-code` extension is an assumption based on the requirements. I will design the architecture to support these hooks, but if they are not standard configuration options, they will require a mock or fallback in testing. I will document this heavily.
- **Usage Metrics (Percentage)**: Real-time API extraction of context usage percentage from the Claude VS Code extension is an assumption (not exposed via standard VS Code Extension API). I will use the `UsageProvider` abstraction and default to "unavailable" for the VS Code extension, prioritizing deterministic recovery first as requested.
- **Skills**: Adding a custom `SKILL.md` via `~/.claude` config is assumed to be supported.

## Next Steps
Proceeding to Phase 1: Architecture and Contracts.

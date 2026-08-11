# Claude Relay

Automatic session continuity for Claude Code.

## Install

### Recommended: Claude Plugin + VS Code Companion

**Claude Plugin**:
automatic lifecycle protection

**VS Code Extension**:
dashboard and recovery controls

### Claude Plugin Only
For Claude Code terminal or IDE users who want automatic continuity without the companion dashboard.

```bash
claude plugin marketplace add chidhvilasa/claude-relay
claude plugin install claude-relay@clauderelay-oss
```

### VS Code Companion Only
Manual Relay features only.
Automatic lifecycle recovery requires the Claude Relay Plugin.

## Security
- **No Auth**: Claude Relay handles zero authentication and has no access to your credentials.
- **Network Zero**: The standalone plugin runtime executes completely offline.
- **Untrusted State**: Restored checkpoints and handoffs are treated strictly as untrusted context, safeguarding you against prompt injection.

## Migration
Upgrading from v0.1.0? Your existing `.relay` history is compatible. The VS Code extension will safely guide you to migrate your legacy hooks to the new Claude Plugin structure.

## How it works
Relay hooks into Claude Code's PreCompact and StopFailure events to deterministically capture a Git snapshot of your workspace. Upon SessionStart, it loads this snapshot or a generated handoff so you never lose context!

## Known limitations
- Relay only supports deterministic history and semantic context files. It does not restore active terminal histories outside of Claude.

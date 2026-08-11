# Migration: v0.1 to v0.2

## Architecture Change
- **v0.1.0**: The Claude Relay VS Code extension was responsible for auto-injecting standalone lifecycle hooks directly into your `~/.claude/settings.json`.
- **v0.2.0**: Claude Relay is now distributed primarily as a Claude Code Plugin. The automatic lifecycle hooks are registered entirely within the Plugin environment. The VS Code extension now acts purely as a Companion UI for manual commands (Checkpoint/Handoff) and state visibility.

## Migration Process
If you upgrade your VS Code extension to v0.2.0 while still retaining v0.1.0 hooks in your `settings.json`, the extension Dashboard will report `PLUGIN_AND_LEGACY_CONFLICT`. 

A prompt will appear asking you to explicitly migrate:
1. It will create a backup of your `~/.claude/settings.json`.
2. It will parse and cleanly remove **only** the legacy `anthropic.claude-relay` hooks.
3. Unrelated Claude customizations will remain untouched.

After migrating, install the official Plugin to restore automatic lifecycle protection:
```bash
claude plugin marketplace add chidhvilasa/claude-relay
claude plugin install claude-relay@clauderelay-oss
```

Your existing project `.relay` state history is completely compatible and will continue to work seamlessly.

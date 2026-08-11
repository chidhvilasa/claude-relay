# Claude Relay v0.2.0 Release Notes

Claude Relay v0.2.0 marks a significant architectural and security milestone! Claude Relay is now a proper Claude Code Plugin with a dedicated Companion VS Code Extension.

## Highlights
- **Proper Claude Plugin**: Automatic hooks are now governed natively by the Claude Code plugin ecosystem, resolving auto-injection fragility.
- **Relay Skill Included**: The Relay skill is now officially bundled in the plugin, allowing for semantic continuity queries like "Resume Relay task".
- **Standalone Operation**: Relay can now operate purely from the terminal via the plugin; VS Code is optional.
- **VS Code Companion UI**: The VS Code Extension has evolved into a Companion Dashboard to monitor your Plugin status, run manual commands, and safely migrate from v0.1.0.

## Security Hardening
- **No Auth Handling**: Relay handles zero authentication; it runs locally and independently.
- **No Runtime Network Access**: The standalone hook-runtime executes entirely offline with zero dependencies.
- **Safe Filesystem Boundary**: Strict directory traversal and symlink checks restrict all writes to `.relay/checkpoints`.
- **Untrusted Handoff Model**: The Relay SKILL now explicitly treats saved handoffs as untrusted historical context to prevent malicious prompt injection.

## Migration
Please review the [Migration Guide](MIGRATION_V0_1_TO_V0_2.md) for upgrading from v0.1.0 and transferring your hooks to the new plugin model safely.

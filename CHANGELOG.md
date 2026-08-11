# Changelog

## [0.2.0]
### Added
- Claude Relay Plugin manifest (`plugin.json`).
- Claude Relay Marketplace manifest (`marketplace.json`) pointing to immutable Git tag.
- Standalone zero-dependency `hook-runtime` executing via `spawnSync`.
- Native Claude Code Skill (`/claude-relay:relay`) bundled within plugin.
- Companion VS Code Extension dashboard for Plugin tracking.
- Automated legacy hook migrator (`LegacyMigrator`).

### Changed
- Refactored `extension.ts` to remove legacy automatic hook injection into `settings.json`.
- Restructured workspace packages to isolate `hook-runtime` from `vscode` dependencies.
- Tightened filesystem boundaries and path resolutions across the core API.

### Removed
- `PostCompact`, `Stop`, and `SessionEnd` automatic hooks to minimize attack surface.

# Changelog

## [0.1.0] - 2026-08-11
### Added
- Deterministic checkpoints
- Standalone Claude hook runtime
- SessionStart integration
- PreCompact recovery
- Stop/StopFailure/SessionEnd handling
- Semantic handoffs
- Canonical JSON handoff format
- WAKEUP.md projection
- Git-aware reconciliation
- Stale-state detection
- Integrity hashes
- JSON Schema validation
- VS Code Dashboard
- Health Check
- One-click Claude integration setup
- Safe configuration merging
- Config backup and rollback
- Clean integration removal
- Local-first operation
- Packaged VSIX with bundled runtime dependencies

### Security
- Added JSON Schema (Ajv) enforcement at handoff and checkpoint boundaries.
- Standalone runner is entirely decoupled from repo node_modules.

### Known Limitations
- Exact Claude subscription usage percentage requires official metadata provider access.

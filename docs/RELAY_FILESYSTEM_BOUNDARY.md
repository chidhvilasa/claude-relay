# Claude Relay Filesystem Boundary

## Canonical State Root
All project-local state for Claude Relay is strictly constrained to:
`<repository-root>/.relay/`

## Safe Path Guard
All writes must pass through a canonical path resolution process (currently embedded inside `hook-runtime/src/index.ts` and Core state managers).
The resolution process MUST:
1. Resolve absolute path.
2. Ensure the resolved path `startsWith` the canonical root.
3. Call `fs.realpathSync` to detect escapes via symlinks/junctions.

## Writable Children
- `.relay/checkpoints/`: (Written by `hook-runtime`) Stores JSON continuity snapshots.
- `.relay/handoffs/`: (Written by VS Code Companion) Stores markdown handoff summaries.
- `.relay/WAKEUP.md`: (Written by VS Code Companion) Legacy context file, maintained for basic terminal usage.

## Escapes Tested & Blocked
- Traversal (`../../`) - Refused
- Absolute Paths (`C:\Temp`) - Refused
- Nested Symlinks / Windows Junctions pointing outside repository - Refused

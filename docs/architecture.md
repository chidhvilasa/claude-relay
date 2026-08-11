# Claude Relay Architecture

## Overview
Claude Relay is a session continuity engine for Claude Code. It consists of a core recovery engine (platform-agnostic) and a VS Code extension that provides the user interface and integrates with the IDE.

## Packages
The workspace is structured as a pnpm monorepo:
- `packages/core`: The deterministic recovery engine, state machine, Git provider, and storage logic. No VS Code API dependencies.
- `packages/vscode`: The VS Code extension, setup wizard, and UI integration.
- `packages/cli` (Future): CLI installer and tools.

## Core Models

### RelayState
```typescript
type RelayState = 
  | "IDLE"
  | "ARMED"
  | "CHECKPOINTED"
  | "HANDOFF_IN_PROGRESS"
  | "HANDOFF_READY"
  | "LIMITED"
  | "RESUME_PENDING"
  | "RESUMED"
  | "RESOLVED"
  | "ERROR";
```

### Checkpoint Hierarchy
1. **LightweightCheckpoint**: Fast, captures Git state and timestamps.
2. **RecoveryCheckpoint**: Richer, captures recent commands and workspace info.
3. **FullHandoff**: Includes semantic Claude state (WAKEUP.md/JSON).

## Interfaces

```typescript
interface UsageProvider {
    readonly id: string;
    isAvailable(): Promise<boolean>;
    getUsage(): Promise<UsageSnapshot | null>;
}

interface GitProvider {
    getSnapshot(): Promise<GitSnapshot>;
}

interface CheckpointStore {
    save(checkpoint: Checkpoint): Promise<void>;
    loadLatest(): Promise<Checkpoint | null>;
}

interface HandoffStore {
    save(handoff: Handoff): Promise<void>;
    loadLatest(): Promise<Handoff | null>;
    markResolved(id: string): Promise<void>;
}
```

## State Machine
The core engine manages transitions based on UsageProvider triggers or manual commands.
- `IDLE` -> (Usage > 90%) -> `ARMED`
- `ARMED` -> (Usage > 95%) -> `CHECKPOINTED`
- `CHECKPOINTED` -> (Usage > 97%) -> `HANDOFF_IN_PROGRESS` -> `HANDOFF_READY`

## Data Flow
1. Checkpoint Trigger -> Capture Git State -> Capture Deterministic Data -> Save Checkpoint.
2. Handoff Trigger -> Claude generates semantic summary -> Merge with Checkpoint -> Save Handoff -> Generate WAKEUP.md.
3. Resume -> Reconcile Git State vs Handoff Git State -> Prompt Claude to verify and continue.

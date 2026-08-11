export type RelayState =
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

export interface WorkspaceMetadata {
  path: string;
  name?: string;
}

export interface GitSnapshot {
  branch: string;
  head: string;
  isDetached: boolean;
  isDirty: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface UsageSnapshot {
  contextPercent: number | null;
  fiveHourPercent: number | null;
  provider: string;
}

export interface BaseSnapshot {
  schemaVersion: "1.0";
  id: string;
  createdAt: string;
  reason: string;
  workspace: WorkspaceMetadata;
  git: GitSnapshot;
}

export interface Checkpoint extends BaseSnapshot {
  type: "lightweight" | "recovery";
  usage?: UsageSnapshot;
}

export interface SemanticHandoff {
  objective: string;
  completed: string[];
  currentWork: string;
  decisions: string[];
  rejectedApproaches: string[];
  failures: string[];
  constraints: string[];
  importantFiles: string[];
  blockers: string[];
  nextAction: string;
  doNotRepeat: string[];
  verifyOnResume: string[];
}

export interface Handoff extends BaseSnapshot {
  semantic: SemanticHandoff;
  integrity: {
    hash: string;
  };
}

export type HandoffFreshness = "FRESH" | "POSSIBLY_STALE" | "STALE" | "INVALID";

export interface UsageProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  getUsage(): Promise<UsageSnapshot | null>;
}

export interface GitProvider {
  getSnapshot(): Promise<GitSnapshot>;
}

export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<void>;
  loadLatest(): Promise<Checkpoint | null>;
}

export interface HandoffStore {
  save(handoff: Handoff): Promise<void>;
  loadLatest(): Promise<Handoff | null>;
  markResolved(id: string): Promise<void>;
}

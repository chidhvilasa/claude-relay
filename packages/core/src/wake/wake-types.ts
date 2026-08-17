import { GitSnapshot } from '../models/types';

/**
 * States for a single Automatic Wake record. One record tracks one interrupted
 * session's road back to running, from the moment Relay notices an interruption
 * worth watching through to either a safe continuation or a safe stop.
 *
 * State machine (not every transition is legal from every state — see
 * `isLegalWakeTransition` in wake-store.ts):
 *
 *   IDLE -> ARMED -> WAITING_NATIVE -> COMPLETED
 *                                   -> FALLBACK_STARTING -> FALLBACK_RUNNING -> RESUMING -> COMPLETED
 *                        (any of the above) -> BLOCKED_STALE | BLOCKED_DIVERGED | BLOCKED_PERMISSION
 *                        (any of the above) -> EXPIRED | CANCELLED | FAILED
 */
export type WakeRunState =
  | 'IDLE'
  | 'ARMED'
  | 'WAITING_NATIVE'
  | 'FALLBACK_STARTING'
  | 'FALLBACK_RUNNING'
  | 'RESUMING'
  | 'BLOCKED_STALE'
  | 'BLOCKED_DIVERGED'
  | 'BLOCKED_PERMISSION'
  | 'BLOCKED_USER_INPUT'
  | 'BLOCKED_AUTH'
  | 'FAILED_SESSION_NOT_FOUND'
  | 'EXPIRED'
  | 'RECOVERY_AVAILABLE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

/** Who currently owns the right to continue this session. Prevents duplicate continuation (Part 10). */
export type WakeOwnerType = 'NATIVE' | 'FALLBACK' | 'VSCODE';

/** Repository-safety classification used to gate any autonomous continuation (Part 16). */
export type RepoSafetyClassification = 'CURRENT' | 'STALE' | 'DIVERGED' | 'UNSAFE';

export interface WakeLease {
  ownerType: WakeOwnerType;
  ownerPid?: number;
  acquiredAt: string;
  expiresAt: string;
}

export interface WakeProjectIdentity {
  /** Absolute, resolved workspace path. Never a relative or symlinked-unresolved path. */
  path: string;
  /** Best-effort git repository identity — the resolved .git directory path, when available. */
  gitDir?: string;
}

export interface WakeGitFingerprint {
  branch: string;
  head: string;
  /** staged + unstaged + untracked file count at the moment this record was armed/updated. */
  dirtyCount: number;
}

export const WAKE_SCHEMA_VERSION = 1 as const;

/**
 * Persisted record for one interrupted session under Automatic Wake. Deliberately excludes
 * anything security-sensitive per the task's hard constraint (Part 4): no tokens, no API keys,
 * no authorization headers, no cookies, no full transcript, no environment dump.
 */
export interface WakeRecord {
  schemaVersion: typeof WAKE_SCHEMA_VERSION;
  /** Relay-generated record id (not the Claude session id) — stable filename key. */
  recordId: string;
  state: WakeRunState;
  sessionId: string;
  project: WakeProjectIdentity;
  createdAt: string;
  updatedAt: string;
  reason: string;
  savedGit: WakeGitFingerprint;
  attemptCount: number;
  lastAttemptAt?: string;
  /** ISO timestamp after which this record is no longer eligible for autonomous continuation. */
  expiresAt: string;
  /** OS user identity that armed this record (os.userInfo().username) — never credentials. */
  ownerIdentity: string;
  lease?: WakeLease;
  /**
   * The resolved claude executable's identity as of the most recent fallback
   * attempt (path + size + content-hash-prefix, never the file's full
   * contents) — lets a *later* attempt for this same record detect the
   * executable being swapped out between attempts (Part 38). Intentionally
   * NOT the mechanism for the very first attempt (nothing to compare against
   * yet there); see wake-runtime's WakeController.
   */
  claudeFingerprint?: {
    resolvedPath: string;
    sizeBytes: number;
    contentHashPrefix: string;
  };
  lastResult?: {
    outcome: 'success' | 'blocked' | 'failed';
    detail: string;
    at: string;
  };
}

export function currentGitFingerprint(git: GitSnapshot): WakeGitFingerprint {
  return {
    branch: git.branch,
    head: git.head,
    dirtyCount: (git.staged?.length ?? 0) + (git.unstaged?.length ?? 0) + (git.untracked?.length ?? 0),
  };
}

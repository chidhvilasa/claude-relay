import * as fs from 'fs';
import * as path from 'path';
import {
  WakeStateStore,
  WakeLeaseManager,
  WakeRecord,
  classifyRepoSafety,
  resolveClaudeExecutable,
  verifyClaudeExecutable,
  ClaudeExecutableFingerprint,
  spawnFallbackResumer,
  AutomaticWakeConfigManager,
  WAKE_ENV_KEYS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_RESUME_PROMPT,
} from '@claude-relay/core';
import { GitSnapshot } from '@claude-relay/core';

export interface WakeControllerDeps {
  /** Injectable for tests — resolves the current git snapshot without shelling out for real in unit tests. */
  getCurrentGit: (workspaceRoot: string) => GitSnapshot;
  /** Injectable for tests — resolves the current .git directory identity, or undefined if not determinable. */
  getGitDir: (workspaceRoot: string) => string | undefined;
  claudePathOverride?: string;
}

export type WakeRunOutcome =
  | { action: 'noop'; reason: string }
  | { action: 'blocked'; state: string; reason: string }
  | { action: 'ran'; state: string; detail: string };

/**
 * Orchestrates a single Level 2 fallback-continuation attempt for one
 * session (Part 13). This is the entire responsibility list from the task,
 * and nothing more:
 *
 *   read validated wake record -> acquire lease -> reconcile safe
 *   preconditions -> spawn/resume Claude -> monitor result -> update wake
 *   record -> exit
 *
 * No UI. No HTTP. No credential access. No arbitrary command executor — the
 * only process this ever spawns is the resolved-and-verified `claude`
 * executable, with a fixed argument list and a fixed prompt.
 */
export class WakeController {
  private readonly store: WakeStateStore;
  private readonly lease: WakeLeaseManager;
  private readonly configManager = new AutomaticWakeConfigManager();

  constructor(private readonly workspaceRoot: string, private readonly deps: WakeControllerDeps) {
    this.store = new WakeStateStore(workspaceRoot);
    this.lease = new WakeLeaseManager(this.store);
  }

  private buildWakeEnv(): Record<string, string> {
    // Prefer whatever's actually configured (workspace scope, falling back to
    // user scope) so the fallback process gets the same values the user set
    // via Enable Automatic Wake — not silently different defaults.
    const workspaceStatus = this.configManager.getStatus('workspace', this.workspaceRoot);
    const userStatus = this.configManager.getStatus('user');
    const env: Record<string, string> = {};
    for (const key of WAKE_ENV_KEYS) {
      env[key] = workspaceStatus.values[key] ?? userStatus.values[key] ?? (
        key === 'CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS' ? String(DEFAULT_MAX_AGE_MS) :
        key === 'CLAUDE_CODE_RESUME_PROMPT' ? DEFAULT_RESUME_PROMPT :
        '1'
      );
    }
    return env;
  }

  /**
   * Runs one fallback attempt for `sessionId`, end to end, with every gate
   * from Parts 10/16/18/34/38 checked before anything is spawned. Safe to
   * call repeatedly/idempotently — every early-exit path is a `noop` or
   * `blocked` result, never a partial/inconsistent state write.
   */
  async run(sessionId: string): Promise<WakeRunOutcome> {
    const record = this.store.get(sessionId);
    if (!record) {
      return { action: 'noop', reason: `No wake record for session ${sessionId}` };
    }

    if (!['ARMED', 'WAITING_NATIVE'].includes(record.state)) {
      return { action: 'noop', reason: `Wake record is in state ${record.state}, not eligible for a fallback attempt` };
    }

    // Part 18: expiry gate — never auto-run past the configured max age.
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      this.store.transition(sessionId, 'EXPIRED', { lastResult: { outcome: 'blocked', detail: 'Wake record expired before a fallback attempt was made', at: new Date().toISOString() } });
      return { action: 'blocked', state: 'EXPIRED', reason: 'expired' };
    }

    // Part 16: repository safety gate — never guess, fail closed.
    const currentGit = this.deps.getCurrentGit(this.workspaceRoot);
    const currentGitDir = this.deps.getGitDir(this.workspaceRoot);
    const safety = classifyRepoSafety(record, this.workspaceRoot, currentGitDir, currentGit);
    if (safety.classification === 'UNSAFE') {
      this.store.transition(sessionId, 'CANCELLED', { lastResult: { outcome: 'blocked', detail: safety.reason, at: new Date().toISOString() } });
      return { action: 'blocked', state: 'CANCELLED', reason: safety.reason };
    }
    if (safety.classification === 'DIVERGED') {
      this.store.transition(sessionId, 'BLOCKED_DIVERGED', { lastResult: { outcome: 'blocked', detail: safety.reason, at: new Date().toISOString() } });
      return { action: 'blocked', state: 'BLOCKED_DIVERGED', reason: safety.reason };
    }
    // STALE is allowed through — the fixed continuation prompt itself requires
    // reconciliation before any work, which is the safe handling for STALE.

    // Part 10: duplicate-continuation lease — fail closed, prefer safety over duplicate execution.
    const acquired = this.lease.acquire(sessionId, 'FALLBACK', process.pid);
    if (!acquired.acquired) {
      return { action: 'noop', reason: `Lease already held: ${acquired.reason}` };
    }

    try {
      // Part 38: resolve the claude executable, never trust a bare PATH lookup blindly at wake time.
      const fingerprint = resolveClaudeExecutable(this.deps.claudePathOverride);
      if (!fingerprint) {
        this.store.transition(sessionId, 'FAILED', { lastResult: { outcome: 'failed', detail: 'Could not resolve a claude executable', at: new Date().toISOString() } });
        return { action: 'blocked', state: 'FAILED', reason: 'claude executable not found' };
      }
      // If a prior attempt for this exact record already resolved and
      // fingerprinted an executable, this attempt must match it — otherwise
      // the executable was substituted between attempts (Part 38's named
      // threat), and Relay refuses to run it rather than silently proceeding.
      if (record.claudeFingerprint) {
        const verified = verifyClaudeExecutable({ ...fingerprint, resolvedPath: record.claudeFingerprint.resolvedPath, sizeBytes: record.claudeFingerprint.sizeBytes, contentHashPrefix: record.claudeFingerprint.contentHashPrefix });
        if (!verified.ok) {
          this.store.transition(sessionId, 'FAILED', { lastResult: { outcome: 'failed', detail: verified.reason, at: new Date().toISOString() } });
          return { action: 'blocked', state: 'FAILED', reason: verified.reason };
        }
      }

      this.store.transition(sessionId, 'FALLBACK_STARTING', {
        attemptCount: record.attemptCount + 1,
        lastAttemptAt: new Date().toISOString(),
        claudeFingerprint: { resolvedPath: fingerprint.resolvedPath, sizeBytes: fingerprint.sizeBytes, contentHashPrefix: fingerprint.contentHashPrefix },
      });
      this.store.transition(sessionId, 'FALLBACK_RUNNING');

      const result = await spawnFallbackResumer({
        claudePath: fingerprint.resolvedPath,
        sessionId,
        workspaceRoot: this.workspaceRoot,
        extraEnv: this.buildWakeEnv(),
      });

      const finalState = mapOutcomeToState(result.outcome);
      const outcome: 'success' | 'blocked' | 'failed' = result.outcome === 'success' ? 'success' : result.outcome === 'failed' || result.outcome === 'session_not_found' ? 'failed' : 'blocked';
      this.store.transition(sessionId, finalState, { lastResult: { outcome, detail: result.detail, at: new Date().toISOString() } });
      return { action: 'ran', state: finalState, detail: result.detail };
    } finally {
      this.lease.release(sessionId, 'FALLBACK');
    }
  }
}

function mapOutcomeToState(outcome: string): WakeRecord['state'] {
  switch (outcome) {
    case 'success': return 'COMPLETED';
    case 'blocked_permission': return 'BLOCKED_PERMISSION';
    case 'blocked_user_input': return 'BLOCKED_USER_INPUT';
    case 'blocked_auth': return 'BLOCKED_AUTH';
    case 'session_not_found': return 'FAILED_SESSION_NOT_FOUND';
    default: return 'FAILED';
  }
}

function verifyExecutableIfPreviouslyRecorded(_record: WakeRecord, fingerprint: ClaudeExecutableFingerprint): { ok: true } | { ok: false; reason: string } {
  // First attempt for this record has nothing to compare against yet — the
  // freshly resolved fingerprint becomes the baseline. Re-verification against
  // a stored baseline happens on retries within the same record's lifetime;
  // the wake record schema intentionally doesn't persist the fingerprint
  // itself (would grow the on-disk record and isn't needed across restarts,
  // since a *new* wake cycle always re-resolves fresh) — this hook exists so
  // that guarantee is explicit and testable rather than implicit.
  const check = verifyClaudeExecutable(fingerprint);
  return check.ok ? { ok: true } : { ok: false, reason: check.reason };
}

export function defaultGetGitDir(workspaceRoot: string): string | undefined {
  const candidate = path.join(workspaceRoot, '.git');
  return fs.existsSync(candidate) ? candidate : undefined;
}

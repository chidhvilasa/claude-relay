import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WAKE_SCHEMA_VERSION, WakeRecord, WakeRunState } from './wake-types';

/**
 * Legal state transitions. Anything not listed here is rejected by `transition()` — this is the
 * "never guess, fail closed" posture the task asks for (Part 34), applied to the state machine
 * itself: a caller cannot accidentally skip BLOCKED_* / EXPIRED handling by writing an
 * unanticipated state directly.
 */
const LEGAL_TRANSITIONS: Record<WakeRunState, WakeRunState[]> = {
  IDLE: ['ARMED', 'CANCELLED'],
  ARMED: ['WAITING_NATIVE', 'FALLBACK_STARTING', 'BLOCKED_STALE', 'BLOCKED_DIVERGED', 'BLOCKED_PERMISSION', 'EXPIRED', 'CANCELLED', 'FAILED'],
  WAITING_NATIVE: ['COMPLETED', 'FALLBACK_STARTING', 'EXPIRED', 'CANCELLED', 'FAILED'],
  FALLBACK_STARTING: ['FALLBACK_RUNNING', 'FAILED_SESSION_NOT_FOUND', 'BLOCKED_AUTH', 'FAILED', 'CANCELLED'],
  // WakeController's actual implementation spawns the fallback resumer once
  // and awaits its single classified outcome — there is no separately
  // observable "now sending the resume message" sub-phase distinct from
  // "the fallback process is running", so FALLBACK_RUNNING's legal targets
  // are every terminal/blocked outcome `mapOutcomeToState` can produce, not
  // just a transition into RESUMING. RESUMING remains a valid state in the
  // enum (and FALLBACK_RUNNING can still reach it) for a future
  // implementation that does distinguish those phases.
  FALLBACK_RUNNING: ['RESUMING', 'COMPLETED', 'BLOCKED_PERMISSION', 'BLOCKED_USER_INPUT', 'BLOCKED_AUTH', 'FAILED_SESSION_NOT_FOUND', 'FAILED', 'CANCELLED'],
  RESUMING: ['COMPLETED', 'BLOCKED_STALE', 'BLOCKED_DIVERGED', 'BLOCKED_PERMISSION', 'BLOCKED_USER_INPUT', 'FAILED', 'CANCELLED'],
  BLOCKED_STALE: ['RECOVERY_AVAILABLE', 'CANCELLED'],
  BLOCKED_DIVERGED: ['RECOVERY_AVAILABLE', 'CANCELLED'],
  BLOCKED_PERMISSION: ['RECOVERY_AVAILABLE', 'CANCELLED'],
  BLOCKED_USER_INPUT: ['RECOVERY_AVAILABLE', 'CANCELLED'],
  BLOCKED_AUTH: ['RECOVERY_AVAILABLE', 'CANCELLED'],
  FAILED_SESSION_NOT_FOUND: ['RECOVERY_AVAILABLE', 'CANCELLED'],
  EXPIRED: ['RECOVERY_AVAILABLE', 'CANCELLED'],
  RECOVERY_AVAILABLE: ['ARMED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: ['RECOVERY_AVAILABLE'],
};

export function isLegalWakeTransition(from: WakeRunState, to: WakeRunState): boolean {
  if (from === to) return true; // idempotent re-write of the same state (e.g. heartbeat updates)
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** sha256, hex, truncated to 16 chars — enough to avoid collisions for a per-project record count, short enough to be an unremarkable filename. Never the raw session id (Part 45). */
export function hashSessionId(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}

interface WakeIndexEntry {
  recordId: string;
  sessionIdHash: string;
  state: WakeRunState;
  updatedAt: string;
}

interface WakeIndex {
  schemaVersion: typeof WAKE_SCHEMA_VERSION;
  records: WakeIndexEntry[];
}

/**
 * Persists Automatic Wake records under `<workspace>/.relay/wake/<sessionIdHash>.json`, one file
 * per session, plus a small `index.json` for cheap enumeration (Part 45). This directly supports
 * Part 43/44: multiple projects are naturally isolated because each has its own `.relay/wake/`
 * directory, and multiple sessions within one project each get their own record instead of one
 * being silently overwritten by another.
 */
export class WakeStateStore {
  private readonly dir: string;
  private readonly indexPath: string;

  constructor(private readonly workspaceRoot: string) {
    this.dir = path.join(workspaceRoot, '.relay', 'wake');
    this.indexPath = path.join(this.dir, 'index.json');
  }

  private recordPath(sessionIdHash: string): string {
    return path.join(this.dir, `${sessionIdHash}.json`);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private atomicWrite(filePath: string, data: unknown): void {
    this.ensureDir();
    const tmp = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, json, 'utf-8');
    // Re-parse before rename to catch a broken serialization before it becomes the live file.
    JSON.parse(fs.readFileSync(tmp, 'utf-8'));
    fs.renameSync(tmp, filePath);
  }

  private readIndex(): WakeIndex {
    if (!fs.existsSync(this.indexPath)) {
      return { schemaVersion: WAKE_SCHEMA_VERSION, records: [] };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
        throw new Error('malformed wake index');
      }
      return parsed as WakeIndex;
    } catch {
      // A corrupt index is recoverable by rebuilding from the record files themselves — never
      // block wake functionality on a damaged index (Part 33: crash safety).
      return this.rebuildIndexFromDisk();
    }
  }

  private rebuildIndexFromDisk(): WakeIndex {
    const records: WakeIndexEntry[] = [];
    if (fs.existsSync(this.dir)) {
      for (const file of fs.readdirSync(this.dir)) {
        if (!file.endsWith('.json') || file === 'index.json') continue;
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf-8')) as WakeRecord;
          records.push({
            recordId: rec.recordId,
            sessionIdHash: file.replace(/\.json$/, ''),
            state: rec.state,
            updatedAt: rec.updatedAt,
          });
        } catch {
          // Skip unreadable record files rather than failing the whole rebuild.
        }
      }
    }
    return { schemaVersion: WAKE_SCHEMA_VERSION, records };
  }

  private writeIndex(index: WakeIndex): void {
    this.atomicWrite(this.indexPath, index);
  }

  private upsertIndexEntry(entry: WakeIndexEntry): void {
    const index = this.readIndex();
    const i = index.records.findIndex((r) => r.sessionIdHash === entry.sessionIdHash);
    if (i >= 0) {
      index.records[i] = entry;
    } else {
      index.records.push(entry);
    }
    this.writeIndex(index);
  }

  get(sessionId: string): WakeRecord | null {
    const p = this.recordPath(hashSessionId(sessionId));
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as WakeRecord;
    } catch {
      return null;
    }
  }

  list(): WakeRecord[] {
    const index = this.readIndex();
    const out: WakeRecord[] = [];
    for (const entry of index.records) {
      const p = this.recordPath(entry.sessionIdHash);
      if (!fs.existsSync(p)) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(p, 'utf-8')) as WakeRecord);
      } catch {
        // Skip corrupt individual records; other sessions' records remain usable (Part 43/44 isolation).
      }
    }
    return out;
  }

  save(record: WakeRecord): void {
    const hash = hashSessionId(record.sessionId);
    this.atomicWrite(this.recordPath(hash), record);
    this.upsertIndexEntry({ recordId: record.recordId, sessionIdHash: hash, state: record.state, updatedAt: record.updatedAt });
  }

  /** Validates the transition before writing; throws rather than silently persisting an illegal jump. */
  transition(sessionId: string, to: WakeRunState, patch: Partial<WakeRecord> = {}): WakeRecord {
    const existing = this.get(sessionId);
    if (!existing) {
      throw new Error(`No wake record for session ${sessionId} — cannot transition to ${to}`);
    }
    if (!isLegalWakeTransition(existing.state, to)) {
      throw new Error(`Illegal wake transition: ${existing.state} -> ${to} for session ${sessionId}`);
    }
    const updated: WakeRecord = {
      ...existing,
      ...patch,
      state: to,
      updatedAt: new Date().toISOString(),
    };
    this.save(updated);
    return updated;
  }

  remove(sessionId: string): void {
    const hash = hashSessionId(sessionId);
    const p = this.recordPath(hash);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
    }
    const index = this.readIndex();
    index.records = index.records.filter((r) => r.sessionIdHash !== hash);
    this.writeIndex(index);
  }
}

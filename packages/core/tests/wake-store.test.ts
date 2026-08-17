import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WakeStateStore, hashSessionId, isLegalWakeTransition } from '../src/wake/wake-store';
import { WakeRecord, WAKE_SCHEMA_VERSION } from '../src/wake/wake-types';

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function newWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-store-'));
  cleanupDirs.push(dir);
  return dir;
}

function makeRecord(overrides: Partial<WakeRecord> = {}): WakeRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: WAKE_SCHEMA_VERSION,
    recordId: 'rec_1',
    state: 'IDLE',
    sessionId: 'ses_abc',
    project: { path: '/workspace' },
    createdAt: now,
    updatedAt: now,
    reason: 'test',
    savedGit: { branch: 'main', head: 'deadbeef', dirtyCount: 0 },
    attemptCount: 0,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    ownerIdentity: 'tester',
    ...overrides,
  };
}

describe('hashSessionId', () => {
  it('never exposes the raw session id in its output', () => {
    const hash = hashSessionId('ses_super_secret_identifier');
    expect(hash).not.toContain('ses_super_secret_identifier');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic', () => {
    expect(hashSessionId('ses_x')).toBe(hashSessionId('ses_x'));
  });

  it('differs for different session ids', () => {
    expect(hashSessionId('ses_a')).not.toBe(hashSessionId('ses_b'));
  });
});

describe('isLegalWakeTransition', () => {
  it('allows the documented Level 1 happy path', () => {
    expect(isLegalWakeTransition('IDLE', 'ARMED')).toBe(true);
    expect(isLegalWakeTransition('ARMED', 'WAITING_NATIVE')).toBe(true);
    expect(isLegalWakeTransition('WAITING_NATIVE', 'COMPLETED')).toBe(true);
  });

  it('allows the documented Level 2 happy path', () => {
    expect(isLegalWakeTransition('ARMED', 'FALLBACK_STARTING')).toBe(true);
    expect(isLegalWakeTransition('FALLBACK_STARTING', 'FALLBACK_RUNNING')).toBe(true);
    expect(isLegalWakeTransition('FALLBACK_RUNNING', 'RESUMING')).toBe(true);
    expect(isLegalWakeTransition('RESUMING', 'COMPLETED')).toBe(true);
  });

  it('allows FALLBACK_RUNNING straight to every terminal/blocked outcome WakeController can classify (its actual, single-await implementation, not just via RESUMING)', () => {
    expect(isLegalWakeTransition('FALLBACK_RUNNING', 'COMPLETED')).toBe(true);
    expect(isLegalWakeTransition('FALLBACK_RUNNING', 'BLOCKED_PERMISSION')).toBe(true);
    expect(isLegalWakeTransition('FALLBACK_RUNNING', 'BLOCKED_USER_INPUT')).toBe(true);
    expect(isLegalWakeTransition('FALLBACK_RUNNING', 'BLOCKED_AUTH')).toBe(true);
    expect(isLegalWakeTransition('FALLBACK_RUNNING', 'FAILED_SESSION_NOT_FOUND')).toBe(true);
    expect(isLegalWakeTransition('FALLBACK_RUNNING', 'FAILED')).toBe(true);
  });

  it('rejects skipping straight from IDLE to COMPLETED', () => {
    expect(isLegalWakeTransition('IDLE', 'COMPLETED')).toBe(false);
  });

  it('rejects transitions out of a terminal state', () => {
    expect(isLegalWakeTransition('COMPLETED', 'ARMED')).toBe(false);
    expect(isLegalWakeTransition('CANCELLED', 'ARMED')).toBe(false);
  });

  it('allows a blocked state to reach RECOVERY_AVAILABLE, and RECOVERY_AVAILABLE back to ARMED', () => {
    expect(isLegalWakeTransition('BLOCKED_DIVERGED', 'RECOVERY_AVAILABLE')).toBe(true);
    expect(isLegalWakeTransition('RECOVERY_AVAILABLE', 'ARMED')).toBe(true);
  });

  it('treats a same-state write as legal (idempotent heartbeat)', () => {
    expect(isLegalWakeTransition('FALLBACK_RUNNING', 'FALLBACK_RUNNING')).toBe(true);
  });
});

describe('WakeStateStore', () => {
  it('returns null for a session with no record', () => {
    const store = new WakeStateStore(newWorkspace());
    expect(store.get('ses_none')).toBeNull();
  });

  it('saves and retrieves a record by session id', () => {
    const store = new WakeStateStore(newWorkspace());
    const record = makeRecord();
    store.save(record);
    expect(store.get('ses_abc')).toEqual(record);
  });

  it('never puts the raw session id in the on-disk filename', () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    store.save(makeRecord({ sessionId: 'ses_should_not_appear_in_filenames' }));
    const files = fs.readdirSync(path.join(ws, '.relay', 'wake'));
    for (const f of files) {
      expect(f).not.toContain('ses_should_not_appear_in_filenames');
    }
  });

  it('lists all saved records', () => {
    const store = new WakeStateStore(newWorkspace());
    store.save(makeRecord({ sessionId: 'ses_1', recordId: 'r1' }));
    store.save(makeRecord({ sessionId: 'ses_2', recordId: 'r2' }));
    const all = store.list();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.sessionId).sort()).toEqual(['ses_1', 'ses_2']);
  });

  it('isolates records per workspace (multi-project safety, Part 43)', () => {
    const wsA = newWorkspace();
    const wsB = newWorkspace();
    const storeA = new WakeStateStore(wsA);
    const storeB = new WakeStateStore(wsB);
    storeA.save(makeRecord({ sessionId: 'ses_a' }));
    expect(storeA.list()).toHaveLength(1);
    expect(storeB.list()).toHaveLength(0);
  });

  it('supports multiple independent sessions in one project (Part 44)', () => {
    const store = new WakeStateStore(newWorkspace());
    store.save(makeRecord({ sessionId: 'ses_1', recordId: 'r1', reason: 'first' }));
    store.save(makeRecord({ sessionId: 'ses_2', recordId: 'r2', reason: 'second' }));
    expect(store.get('ses_1')!.reason).toBe('first');
    expect(store.get('ses_2')!.reason).toBe('second');
  });

  it('transition() validates and applies a legal transition', () => {
    const store = new WakeStateStore(newWorkspace());
    store.save(makeRecord());
    const updated = store.transition('ses_abc', 'ARMED', { reason: 'now armed' });
    expect(updated.state).toBe('ARMED');
    expect(updated.reason).toBe('now armed');
    expect(store.get('ses_abc')!.state).toBe('ARMED');
  });

  it('transition() throws on an illegal jump rather than silently applying it', () => {
    const store = new WakeStateStore(newWorkspace());
    store.save(makeRecord({ state: 'IDLE' }));
    expect(() => store.transition('ses_abc', 'COMPLETED')).toThrow(/Illegal wake transition/);
    expect(store.get('ses_abc')!.state).toBe('IDLE'); // unchanged
  });

  it('transition() throws for an unknown session rather than creating one implicitly', () => {
    const store = new WakeStateStore(newWorkspace());
    expect(() => store.transition('ses_ghost', 'ARMED')).toThrow(/No wake record/);
  });

  it('remove() deletes the record and drops it from the index', () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    store.save(makeRecord());
    store.remove('ses_abc');
    expect(store.get('ses_abc')).toBeNull();
    expect(store.list()).toHaveLength(0);
  });

  it('rebuilds a corrupt index from the record files rather than losing them (Part 33 crash safety)', () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    store.save(makeRecord({ sessionId: 'ses_1' }));
    store.save(makeRecord({ sessionId: 'ses_2' }));
    fs.writeFileSync(path.join(ws, '.relay', 'wake', 'index.json'), '{not valid json', 'utf-8');
    expect(store.list()).toHaveLength(2); // rebuilt from disk, not lost
  });

  it('writes atomically — no leftover .tmp files after a save', () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    store.save(makeRecord());
    const files = fs.readdirSync(path.join(ws, '.relay', 'wake'));
    expect(files.some((f) => f.includes('.tmp.'))).toBe(false);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WakeStateStore } from '../src/wake/wake-store';
import { WakeLeaseManager } from '../src/wake/wake-lease';
import { WakeRecord, WAKE_SCHEMA_VERSION } from '../src/wake/wake-types';

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeStore(): WakeStateStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-lease-'));
  cleanupDirs.push(dir);
  return new WakeStateStore(dir);
}

function seed(store: WakeStateStore, sessionId = 'ses_abc'): void {
  const now = new Date().toISOString();
  const record: WakeRecord = {
    schemaVersion: WAKE_SCHEMA_VERSION,
    recordId: 'r1',
    state: 'ARMED',
    sessionId,
    project: { path: '/workspace' },
    createdAt: now,
    updatedAt: now,
    reason: 'test',
    savedGit: { branch: 'main', head: 'deadbeef', dirtyCount: 0 },
    attemptCount: 0,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    ownerIdentity: 'tester',
  };
  store.save(record);
}

describe('WakeLeaseManager (Part 10: duplicate-continuation prevention)', () => {
  it('acquires a lease when none is held', () => {
    const store = makeStore();
    seed(store);
    const mgr = new WakeLeaseManager(store);
    const result = mgr.acquire('ses_abc', 'FALLBACK', 1234);
    expect(result.acquired).toBe(true);
  });

  it('refuses a second acquire while a live lease is held — the core race Part 10 describes', () => {
    const store = makeStore();
    seed(store);
    const mgr = new WakeLeaseManager(store);
    const first = mgr.acquire('ses_abc', 'NATIVE');
    expect(first.acquired).toBe(true);
    // Simulates the exact scenario named in the task: the native watchdog
    // acquires first, then Relay's own fallback tries to acquire moments
    // later for the same session — it must be refused, not double-run.
    const second = mgr.acquire('ses_abc', 'FALLBACK', 5678);
    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.heldBy.ownerType).toBe('NATIVE');
    }
  });

  it('allows re-acquiring after the previous lease expires', () => {
    const store = makeStore();
    seed(store);
    const mgr = new WakeLeaseManager(store);
    mgr.acquire('ses_abc', 'FALLBACK', 1, 1); // 1ms TTL — expires almost immediately
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const second = mgr.acquire('ses_abc', 'VSCODE', 2);
        expect(second.acquired).toBe(true);
        resolve();
      }, 20);
    });
  });

  it('release() only removes a lease the caller actually owns', () => {
    const store = makeStore();
    seed(store);
    const mgr = new WakeLeaseManager(store);
    mgr.acquire('ses_abc', 'NATIVE');
    mgr.release('ses_abc', 'FALLBACK'); // not the owner — must be a no-op
    const stillHeld = mgr.acquire('ses_abc', 'FALLBACK');
    expect(stillHeld.acquired).toBe(false); // proves NATIVE's lease is still intact
  });

  it('release() by the true owner frees the lease for another owner to acquire', () => {
    const store = makeStore();
    seed(store);
    const mgr = new WakeLeaseManager(store);
    mgr.acquire('ses_abc', 'NATIVE');
    mgr.release('ses_abc', 'NATIVE');
    const next = mgr.acquire('ses_abc', 'FALLBACK');
    expect(next.acquired).toBe(true);
  });

  it('renew() extends an existing lease held by the same owner', () => {
    const store = makeStore();
    seed(store);
    const mgr = new WakeLeaseManager(store);
    const first = mgr.acquire('ses_abc', 'FALLBACK', 1, 100);
    const renewed = mgr.renew('ses_abc', 'FALLBACK', 100000);
    expect(renewed.acquired).toBe(true);
    if (first.acquired && renewed.acquired) {
      expect(new Date(renewed.lease.expiresAt).getTime()).toBeGreaterThan(new Date(first.lease.expiresAt).getTime());
    }
  });

  it('isolates leases per session — two different sessions never contend', () => {
    const store = makeStore();
    seed(store, 'ses_1');
    seed(store, 'ses_2');
    const mgr = new WakeLeaseManager(store);
    expect(mgr.acquire('ses_1', 'FALLBACK').acquired).toBe(true);
    expect(mgr.acquire('ses_2', 'FALLBACK').acquired).toBe(true);
  });

  it('throws rather than silently creating a lease for a session with no wake record', () => {
    const store = makeStore();
    const mgr = new WakeLeaseManager(store);
    expect(() => mgr.acquire('ses_ghost', 'FALLBACK')).toThrow(/No wake record/);
  });
});

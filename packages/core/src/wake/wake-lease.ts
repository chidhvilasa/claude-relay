import { WakeStateStore } from './wake-store';
import { WakeLease, WakeOwnerType } from './wake-types';

export const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type LeaseAcquireResult =
  | { acquired: true; lease: WakeLease }
  | { acquired: false; reason: string; heldBy: WakeLease };

/**
 * Prevents duplicate continuation (Part 10): the scenario the task calls out by
 * name is the original Claude process's own native watchdog (Level 1) resuming
 * at the same moment Relay's fallback (Level 2) would otherwise wake the same
 * session. Whoever acquires the lease first — checked, not assumed — owns the
 * continuation; the other side must back off.
 *
 * This does not attempt to detect the native watchdog's activity directly
 * (Relay has no visibility into another process's internal retry state). It
 * only prevents *Relay's own* fallback from launching more than once
 * concurrently for the same session, and requires the fallback path to always
 * check "is there recent evidence this session is still being handled
 * natively" (see wake-runtime's grace-window logic) before ever attempting to
 * acquire a lease at all — bounded uncertainty resolved in favor of not
 * duplicating work, per the task's explicit "prefer safety over duplicate
 * execution."
 */
export class WakeLeaseManager {
  constructor(private readonly store: WakeStateStore) {}

  private isExpired(lease: WakeLease, now: number): boolean {
    return new Date(lease.expiresAt).getTime() <= now;
  }

  acquire(sessionId: string, ownerType: WakeOwnerType, ownerPid?: number, ttlMs = DEFAULT_LEASE_TTL_MS): LeaseAcquireResult {
    const record = this.store.get(sessionId);
    if (!record) {
      throw new Error(`No wake record for session ${sessionId} — cannot acquire a lease for it`);
    }
    const now = Date.now();
    if (record.lease && !this.isExpired(record.lease, now)) {
      return { acquired: false, reason: `Lease already held by ${record.lease.ownerType} (expires ${record.lease.expiresAt})`, heldBy: record.lease };
    }
    const lease: WakeLease = {
      ownerType,
      ownerPid,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    };
    this.store.save({ ...record, lease, updatedAt: new Date(now).toISOString() });
    return { acquired: true, lease };
  }

  /** Extends an already-held lease — used by a long-running fallback process to prove it's still alive. */
  renew(sessionId: string, ownerType: WakeOwnerType, ttlMs = DEFAULT_LEASE_TTL_MS): LeaseAcquireResult {
    const record = this.store.get(sessionId);
    if (!record) {
      throw new Error(`No wake record for session ${sessionId} — cannot renew a lease for it`);
    }
    if (!record.lease || record.lease.ownerType !== ownerType) {
      return this.acquire(sessionId, ownerType, record.lease?.ownerPid, ttlMs);
    }
    const now = Date.now();
    const lease: WakeLease = { ...record.lease, expiresAt: new Date(now + ttlMs).toISOString() };
    this.store.save({ ...record, lease, updatedAt: new Date(now).toISOString() });
    return { acquired: true, lease };
  }

  release(sessionId: string, ownerType: WakeOwnerType): void {
    const record = this.store.get(sessionId);
    if (!record || !record.lease || record.lease.ownerType !== ownerType) return; // not ours to release
    const { lease: _releasedLease, ...rest } = record;
    this.store.save({ ...rest, updatedAt: new Date().toISOString() });
  }
}

import { describe, it, expect } from 'vitest';
import { buildSessionResumeUri, shouldOfferSessionReopen } from '../src/wake/session-uri';
import { WakeRecord, WAKE_SCHEMA_VERSION } from '../src/wake/wake-types';

function makeRecord(overrides: Partial<WakeRecord> = {}): WakeRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: WAKE_SCHEMA_VERSION,
    recordId: 'r1',
    state: 'ARMED',
    sessionId: 'ses_abc',
    project: { path: '/workspace' },
    createdAt: now,
    updatedAt: now,
    reason: 'test',
    savedGit: { branch: 'main', head: 'abc', dirtyCount: 0 },
    attemptCount: 0,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    ownerIdentity: 'tester',
    ...overrides,
  };
}

describe('buildSessionResumeUri (Part 19)', () => {
  it('builds the documented handler URL with a session param', () => {
    const uri = buildSessionResumeUri('ses_abc123');
    expect(uri).toBe('vscode://anthropic.claude-code/open?session=ses_abc123');
  });

  it('URL-encodes a session id with special characters', () => {
    const uri = buildSessionResumeUri('ses abc/123');
    expect(uri).toContain('session=ses+abc%2F123');
  });

  it('includes an optional prompt param when given, without ever auto-submitting (that is Claude Code handler behavior, not this function\'s job to enforce)', () => {
    const uri = buildSessionResumeUri('ses_abc', 'continue please');
    expect(uri).toContain('prompt=continue+please');
  });

  it('never includes a prompt param when none is given', () => {
    const uri = buildSessionResumeUri('ses_abc');
    expect(uri).not.toContain('prompt=');
  });
});

describe('shouldOfferSessionReopen (Part 19: never for every old checkpoint)', () => {
  it('true for an ARMED, unexpired record', () => {
    expect(shouldOfferSessionReopen(makeRecord({ state: 'ARMED' }))).toBe(true);
  });

  it('true for WAITING_NATIVE and RECOVERY_AVAILABLE, the other reopenable states', () => {
    expect(shouldOfferSessionReopen(makeRecord({ state: 'WAITING_NATIVE' }))).toBe(true);
    expect(shouldOfferSessionReopen(makeRecord({ state: 'RECOVERY_AVAILABLE' }))).toBe(true);
  });

  it('false for IDLE — a record merely captured by a hook, never armed, is not a wake condition', () => {
    expect(shouldOfferSessionReopen(makeRecord({ state: 'IDLE' }))).toBe(false);
  });

  it('false for a terminal state (COMPLETED/CANCELLED/EXPIRED)', () => {
    expect(shouldOfferSessionReopen(makeRecord({ state: 'COMPLETED' }))).toBe(false);
    expect(shouldOfferSessionReopen(makeRecord({ state: 'CANCELLED' }))).toBe(false);
    expect(shouldOfferSessionReopen(makeRecord({ state: 'EXPIRED' }))).toBe(false);
  });

  it('false for an ARMED record that is already past its expiresAt', () => {
    const record = makeRecord({ state: 'ARMED', expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(shouldOfferSessionReopen(record)).toBe(false);
  });

  it('false for BLOCKED_* states — those need explicit recovery, not a reopen offer', () => {
    expect(shouldOfferSessionReopen(makeRecord({ state: 'BLOCKED_DIVERGED' }))).toBe(false);
    expect(shouldOfferSessionReopen(makeRecord({ state: 'BLOCKED_PERMISSION' }))).toBe(false);
  });
});

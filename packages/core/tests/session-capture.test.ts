import { describe, it, expect } from 'vitest';
import { captureSessionId, captureSessionIdentity } from '../src/wake/session-capture';

describe('captureSessionId (Part 5)', () => {
  it('reads the real field name (session_id), confirmed against decompiled claude.exe', () => {
    expect(captureSessionId({ session_id: 'ses_abc123', hook_event_name: 'SessionStart' })).toBe('ses_abc123');
  });

  it('does NOT read the old, wrong field name (sessionId) — that was the confirmed bug', () => {
    expect(captureSessionId({ sessionId: 'ses_abc123' })).toBeUndefined();
  });

  it('returns undefined for a non-object payload', () => {
    expect(captureSessionId(null)).toBeUndefined();
    expect(captureSessionId('a string')).toBeUndefined();
    expect(captureSessionId(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-string session_id', () => {
    expect(captureSessionId({ session_id: 12345 })).toBeUndefined();
  });

  it('returns undefined for an empty or whitespace-only session_id', () => {
    expect(captureSessionId({ session_id: '' })).toBeUndefined();
    expect(captureSessionId({ session_id: '   ' })).toBeUndefined();
  });

  it('rejects an implausibly long session_id (defensive bound, not a real Claude Code id shape)', () => {
    expect(captureSessionId({ session_id: 'x'.repeat(300) })).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    expect(captureSessionId({ session_id: '  ses_abc  ' })).toBe('ses_abc');
  });
});

describe('captureSessionIdentity', () => {
  it('returns a full identity with event and timestamp when a session id is present', () => {
    const identity = captureSessionIdentity('PreCompact', { session_id: 'ses_xyz' });
    expect(identity).toBeDefined();
    expect(identity!.sessionId).toBe('ses_xyz');
    expect(identity!.event).toBe('PreCompact');
    expect(new Date(identity!.capturedAt).toString()).not.toBe('Invalid Date');
  });

  it('returns undefined when no session id is present, regardless of event', () => {
    expect(captureSessionIdentity('StopFailure', {})).toBeUndefined();
  });
});

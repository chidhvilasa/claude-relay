import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { classifyRepoSafety } from '../src/wake/repo-safety';
import { WakeRecord, WAKE_SCHEMA_VERSION } from '../src/wake/wake-types';
import { GitSnapshot } from '../src/models/types';

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function newWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-safety-'));
  cleanupDirs.push(dir);
  return dir;
}

function makeRecord(workspacePath: string, overrides: Partial<WakeRecord> = {}): WakeRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: WAKE_SCHEMA_VERSION,
    recordId: 'r1',
    state: 'ARMED',
    sessionId: 'ses_abc',
    project: { path: workspacePath },
    createdAt: now,
    updatedAt: now,
    reason: 'test',
    savedGit: { branch: 'main', head: 'abc123', dirtyCount: 0 },
    attemptCount: 0,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    ownerIdentity: 'tester',
    ...overrides,
  };
}

function snapshot(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return { branch: 'main', head: 'abc123', isDetached: false, isDirty: false, staged: [], unstaged: [], untracked: [], ...overrides };
}

describe('classifyRepoSafety (Part 16)', () => {
  it('CURRENT when nothing changed since the wake was armed', () => {
    const ws = newWorkspace();
    const record = makeRecord(ws);
    const result = classifyRepoSafety(record, ws, undefined, snapshot());
    expect(result.classification).toBe('CURRENT');
  });

  it('UNSAFE when the workspace path no longer exists on disk', () => {
    const record = makeRecord('/definitely/does/not/exist/anywhere');
    const result = classifyRepoSafety(record, '/definitely/does/not/exist/anywhere', undefined, snapshot());
    expect(result.classification).toBe('UNSAFE');
  });

  it('UNSAFE when the current workspace path differs from what was armed', () => {
    const ws = newWorkspace();
    const otherWs = newWorkspace();
    const record = makeRecord(ws);
    const result = classifyRepoSafety(record, otherWs, undefined, snapshot());
    expect(result.classification).toBe('UNSAFE');
  });

  it('UNSAFE when the .git directory identity differs (path reused for a different repo)', () => {
    const ws = newWorkspace();
    const record = makeRecord(ws, { project: { path: ws, gitDir: '/old/.git' } });
    const result = classifyRepoSafety(record, ws, '/new/.git', snapshot());
    expect(result.classification).toBe('UNSAFE');
  });

  it('DIVERGED when the branch changed', () => {
    const ws = newWorkspace();
    const record = makeRecord(ws, { savedGit: { branch: 'feature-a', head: 'abc123', dirtyCount: 0 } });
    const result = classifyRepoSafety(record, ws, undefined, snapshot({ branch: 'feature-b' }));
    expect(result.classification).toBe('DIVERGED');
  });

  it('STALE when HEAD moved but the branch is the same', () => {
    const ws = newWorkspace();
    const record = makeRecord(ws, { savedGit: { branch: 'main', head: 'old111', dirtyCount: 0 } });
    const result = classifyRepoSafety(record, ws, undefined, snapshot({ head: 'new222' }));
    expect(result.classification).toBe('STALE');
  });

  it('STALE when the dirty-file count changed but HEAD/branch did not', () => {
    const ws = newWorkspace();
    const record = makeRecord(ws, { savedGit: { branch: 'main', head: 'abc123', dirtyCount: 0 } });
    const result = classifyRepoSafety(record, ws, undefined, snapshot({ unstaged: ['a.txt'] }));
    expect(result.classification).toBe('STALE');
  });

  it('never returns a more permissive classification than warranted (UNSAFE beats DIVERGED beats STALE)', () => {
    // Wrong project path AND wrong branch AND wrong HEAD all at once —
    // must still land on UNSAFE (the most restrictive), never DIVERGED/STALE.
    const ws = newWorkspace();
    const otherWs = newWorkspace();
    const record = makeRecord(ws, { savedGit: { branch: 'feature-a', head: 'old', dirtyCount: 0 } });
    const result = classifyRepoSafety(record, otherWs, undefined, snapshot({ branch: 'feature-b', head: 'new' }));
    expect(result.classification).toBe('UNSAFE');
  });

  it('always includes a human-readable reason', () => {
    const ws = newWorkspace();
    const record = makeRecord(ws);
    const result = classifyRepoSafety(record, ws, undefined, snapshot());
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

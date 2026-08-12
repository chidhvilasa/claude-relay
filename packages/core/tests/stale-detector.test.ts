import { describe, it, expect } from 'vitest';
import { StaleDetector } from '../src/state/stale-detector';
import { Handoff, GitSnapshot } from '../src/models/types';

function makeGit(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    branch: 'main',
    head: 'abc123',
    isDetached: false,
    isDirty: false,
    staged: [],
    unstaged: [],
    untracked: [],
    ...overrides,
  };
}

function makeHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    schemaVersion: '1.0',
    id: 'h1',
    createdAt: new Date().toISOString(),
    reason: 'manual',
    workspace: { path: '/repo' },
    git: makeGit(),
    semantic: {
      objective: 'obj',
      completed: [],
      currentWork: 'work',
      decisions: [],
      rejectedApproaches: [],
      failures: [],
      constraints: [],
      importantFiles: [],
      blockers: [],
      nextAction: 'next',
      doNotRepeat: [],
      verifyOnResume: [],
    },
    integrity: { hash: 'x' },
    ...overrides,
  };
}

describe('StaleDetector', () => {
  it('reports FRESH when nothing has changed', () => {
    const handoff = makeHandoff();
    expect(StaleDetector.evaluate(handoff, makeGit(), '/repo')).toBe('FRESH');
  });

  it('reports INVALID when the workspace path differs (cross-project safety)', () => {
    const handoff = makeHandoff({ workspace: { path: '/repo-a' } });
    expect(StaleDetector.evaluate(handoff, makeGit(), '/repo-b')).toBe('INVALID');
  });

  it('reports STALE when HEAD has moved', () => {
    const handoff = makeHandoff();
    expect(StaleDetector.evaluate(handoff, makeGit({ head: 'def456' }), '/repo')).toBe('STALE');
  });

  it('reports STALE when the branch has changed', () => {
    const handoff = makeHandoff();
    expect(StaleDetector.evaluate(handoff, makeGit({ branch: 'other' }), '/repo')).toBe('STALE');
  });

  it('reports POSSIBLY_STALE when the dirty-file count differs', () => {
    const handoff = makeHandoff({ git: makeGit({ untracked: [] }) });
    const current = makeGit({ untracked: ['new-file.txt'] });
    expect(StaleDetector.evaluate(handoff, current, '/repo')).toBe('POSSIBLY_STALE');
  });

  it('reports STALE when the handoff is older than 24 hours, even with no other drift', () => {
    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const handoff = makeHandoff({ createdAt: oldTimestamp });
    expect(StaleDetector.evaluate(handoff, makeGit(), '/repo')).toBe('STALE');
  });

  it('does not throw when staged/unstaged/untracked are missing (not required by the handoff schema)', () => {
    // Regression guard: handoffSchema in schema/validator.ts only requires
    // branch/head/isDirty on `git` — staged/unstaged/untracked are optional,
    // so a schema-valid handoff can arrive here without them.
    const handoff = makeHandoff();
    // @ts-expect-error intentionally simulating a schema-valid-but-sparse handoff
    handoff.git = { branch: 'main', head: 'abc123', isDetached: false, isDirty: false };
    expect(() => StaleDetector.evaluate(handoff, makeGit(), '/repo')).not.toThrow();
  });
});

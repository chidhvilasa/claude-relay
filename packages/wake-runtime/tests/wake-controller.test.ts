import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { WakeStateStore, WakeRecord, WAKE_SCHEMA_VERSION, GitSnapshot, WakeLeaseManager } from '@claude-relay/core';
import { WakeController, WakeRunOutcome } from '../src/wake-controller';

/** Narrows a WakeRunOutcome to its `state`-bearing variants, or fails the test with a clear message if it was a `noop` (which carries no `state`). */
function expectState(outcome: WakeRunOutcome): string {
  if (outcome.action === 'noop') {
    throw new Error(`Expected a state-bearing outcome (blocked/ran), got noop: ${outcome.reason}`);
  }
  return outcome.state;
}

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function newWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-controller-ws-'));
  cleanupDirs.push(dir);
  return dir;
}

function snapshot(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return { branch: 'main', head: 'abc123', isDetached: false, isDirty: false, staged: [], unstaged: [], untracked: [], ...overrides };
}

function seedRecord(store: WakeStateStore, workspaceRoot: string, overrides: Partial<WakeRecord> = {}): WakeRecord {
  const now = new Date().toISOString();
  const record: WakeRecord = {
    schemaVersion: WAKE_SCHEMA_VERSION,
    recordId: 'r1',
    state: 'ARMED',
    sessionId: 'ses_test',
    project: { path: workspaceRoot },
    createdAt: now,
    updatedAt: now,
    reason: 'test',
    savedGit: { branch: 'main', head: 'abc123', dirtyCount: 0 },
    attemptCount: 0,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    ownerIdentity: 'tester',
    ...overrides,
  };
  store.save(record);
  return record;
}

// Compiled once at module-collection time — see fallback-resumer.test.ts in
// packages/core for the full rationale on why a real compiled binary is used
// instead of a script here (Windows shell:false constraints).
function compileFakeClaude(): string | null {
  try {
    const rsPath = path.resolve(__dirname, 'fixtures', 'fake-claude.rs');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-controller-fake-claude-'));
    const outPath = path.join(outDir, process.platform === 'win32' ? 'fake-claude.exe' : 'fake-claude');
    const result = spawnSync('rustc', ['-O', '-o', outPath, rsPath], { stdio: 'pipe', encoding: 'utf-8', timeout: 60000 });
    return result.status === 0 && fs.existsSync(outPath) ? outPath : null;
  } catch {
    return null;
  }
}

const fakeClaudePath = compileFakeClaude();
if (!fakeClaudePath) {
  // eslint-disable-next-line no-console
  console.warn('[wake-controller.test.ts] rustc unavailable — skipping WakeController integration tests.');
}

describe.skipIf(fakeClaudePath === null)('WakeController (Part 13 orchestration)', () => {
  it('is a noop when there is no wake record for the session', async () => {
    const ws = newWorkspace();
    const controller = new WakeController(ws, { getCurrentGit: () => snapshot(), getGitDir: () => undefined });
    const outcome = await controller.run('ses_ghost');
    expect(outcome.action).toBe('noop');
  });

  it('is a noop when the record is in a non-eligible state (e.g. already COMPLETED)', async () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    seedRecord(store, ws, { state: 'COMPLETED' });
    const controller = new WakeController(ws, { getCurrentGit: () => snapshot(), getGitDir: () => undefined });
    const outcome = await controller.run('ses_test');
    expect(outcome.action).toBe('noop');
  });

  it('blocks and marks EXPIRED when past expiresAt, without ever spawning anything', async () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    seedRecord(store, ws, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const controller = new WakeController(ws, { getCurrentGit: () => snapshot(), getGitDir: () => undefined, claudePathOverride: fakeClaudePath! });
    const outcome = await controller.run('ses_test');
    expect(outcome.action).toBe('blocked');
    expect(expectState(outcome)).toBe('EXPIRED');
    expect(store.get('ses_test')!.state).toBe('EXPIRED');
  });

  it('blocks and cancels on UNSAFE repo state (wrong workspace path) — Part 16', async () => {
    const ws = newWorkspace();
    const otherWs = newWorkspace();
    const store = new WakeStateStore(ws);
    seedRecord(store, ws, { project: { path: otherWs } }); // armed for a different path than `ws`
    const controller = new WakeController(ws, { getCurrentGit: () => snapshot(), getGitDir: () => undefined, claudePathOverride: fakeClaudePath! });
    const outcome = await controller.run('ses_test');
    expect(outcome.action).toBe('blocked');
    expect(expectState(outcome)).toBe('CANCELLED');
  });

  it('blocks with BLOCKED_DIVERGED when the branch changed — never autonomously continues across a branch switch', async () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    seedRecord(store, ws, { savedGit: { branch: 'feature-a', head: 'abc123', dirtyCount: 0 } });
    const controller = new WakeController(ws, { getCurrentGit: () => snapshot({ branch: 'feature-b' }), getGitDir: () => undefined, claudePathOverride: fakeClaudePath! });
    const outcome = await controller.run('ses_test');
    expect(outcome.action).toBe('blocked');
    expect(expectState(outcome)).toBe('BLOCKED_DIVERGED');
  });

  it('proceeds through STALE (allowed — the fixed prompt requires reconciliation) to a successful completion', async () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    seedRecord(store, ws, { savedGit: { branch: 'main', head: 'old-head', dirtyCount: 0 } }); // HEAD moved -> STALE, not DIVERGED
    const controller = new WakeController(ws, {
      getCurrentGit: () => snapshot({ head: 'new-head' }),
      getGitDir: () => undefined,
      claudePathOverride: fakeClaudePath!,
    });
    const prevBehavior = process.env.FAKE_CLAUDE_BEHAVIOR;
    process.env.FAKE_CLAUDE_BEHAVIOR = 'success';
    try {
      const outcome = await controller.run('ses_test');
      expect(outcome.action).toBe('ran');
      expect(expectState(outcome)).toBe('COMPLETED');
    } finally {
      if (prevBehavior === undefined) delete process.env.FAKE_CLAUDE_BEHAVIOR;
      else process.env.FAKE_CLAUDE_BEHAVIOR = prevBehavior;
    }
  });

  it('reports FAILED with no state corruption when the claude executable cannot be resolved', async () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    seedRecord(store, ws);
    const controller = new WakeController(ws, {
      getCurrentGit: () => snapshot(),
      getGitDir: () => undefined,
      claudePathOverride: path.join(os.tmpdir(), 'definitely-does-not-exist-claude'),
    });
    const outcome = await controller.run('ses_test');
    expect(outcome.action).toBe('blocked');
    expect(expectState(outcome)).toBe('FAILED');
  });

  it('refuses to run when another owner already holds the lease — the core Part 10 race', async () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    seedRecord(store, ws);
    const leaseMgr = new WakeLeaseManager(store);
    leaseMgr.acquire('ses_test', 'NATIVE'); // simulates the native watchdog already owning continuation
    const controller = new WakeController(ws, { getCurrentGit: () => snapshot(), getGitDir: () => undefined, claudePathOverride: fakeClaudePath! });
    const outcome = await controller.run('ses_test');
    expect(outcome.action).toBe('noop');
    // Record must be untouched — still ARMED, not silently advanced.
    expect(store.get('ses_test')!.state).toBe('ARMED');
  });

  it('releases its lease after completion, so a subsequent legitimate attempt is not permanently blocked', async () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    seedRecord(store, ws);
    const controller = new WakeController(ws, { getCurrentGit: () => snapshot(), getGitDir: () => undefined, claudePathOverride: fakeClaudePath! });
    await controller.run('ses_test');
    expect(store.get('ses_test')!.lease).toBeUndefined();
  });

  it('maps a permission-block outcome to BLOCKED_PERMISSION, never silently succeeding', async () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    seedRecord(store, ws);
    const controller = new WakeController(ws, {
      getCurrentGit: () => snapshot(),
      getGitDir: () => undefined,
      claudePathOverride: fakeClaudePath!,
    });
    const prevBehavior = process.env.FAKE_CLAUDE_BEHAVIOR;
    process.env.FAKE_CLAUDE_BEHAVIOR = 'permission_block';
    try {
      const outcome = await controller.run('ses_test');
      expect(outcome.action).toBe('ran');
      expect(expectState(outcome)).toBe('BLOCKED_PERMISSION');
    } finally {
      if (prevBehavior === undefined) delete process.env.FAKE_CLAUDE_BEHAVIOR;
      else process.env.FAKE_CLAUDE_BEHAVIOR = prevBehavior;
    }
  });

  it('detects claude executable substitution between two attempts on the same record and refuses to run (Part 38)', async () => {
    const ws = newWorkspace();
    const store = new WakeStateStore(ws);
    // Give this record its own private copy of the fake-claude binary so
    // overwriting it doesn't affect other tests sharing fakeClaudePath.
    const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-controller-substitution-'));
    cleanupDirs.push(privateDir);
    const privatePath = path.join(privateDir, path.basename(fakeClaudePath!));
    fs.copyFileSync(fakeClaudePath!, privatePath);

    seedRecord(store, ws);
    const controller = new WakeController(ws, { getCurrentGit: () => snapshot(), getGitDir: () => undefined, claudePathOverride: privatePath });

    const prevBehavior = process.env.FAKE_CLAUDE_BEHAVIOR;
    process.env.FAKE_CLAUDE_BEHAVIOR = 'permission_block'; // any non-terminal-blocked outcome works — just need attemptCount 1 + a stored fingerprint
    try {
      // First attempt: blocked (not success/terminal), records a fingerprint of `privatePath`.
      const first = await controller.run('ses_test');
      expect(expectState(first)).toBe('BLOCKED_PERMISSION');

      // A real recovery flow moves BLOCKED_PERMISSION -> RECOVERY_AVAILABLE -> ARMED before retrying.
      store.transition('ses_test', 'RECOVERY_AVAILABLE');
      store.transition('ses_test', 'ARMED');

      // Simulate substitution: same path, different bytes, between attempts.
      fs.appendFileSync(privatePath, Buffer.from('tampered'));

      const second = await controller.run('ses_test');
      expect(second.action).toBe('blocked');
      expect(expectState(second)).toBe('FAILED');
      if (second.action === 'blocked') {
        expect(second.reason).toMatch(/changed since it was last verified/);
      }
    } finally {
      if (prevBehavior === undefined) delete process.env.FAKE_CLAUDE_BEHAVIOR;
      else process.env.FAKE_CLAUDE_BEHAVIOR = prevBehavior;
    }
  });
});

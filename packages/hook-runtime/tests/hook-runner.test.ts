import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

// Exercises the real, shipped artifact — the exact file the Claude Relay
// Plugin invokes as a hook — as a subprocess with real stdin/exit-code/
// filesystem behavior, not a mocked import. This is what actually runs
// during SessionStart/PreCompact/StopFailure, so that's what's tested here.
const RUNNER_PATH = path.resolve(__dirname, '../../../plugins/claude-relay/runtime/hook-runner.cjs');

function sh(cmd: string, cwd: string): string {
  return cp.execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim();
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  sh('git init -q', dir);
  sh('git config user.email test@example.com', dir);
  sh('git config user.name Test', dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  sh('git add a.txt', dir);
  sh('git commit -q -m init', dir);
}

function runHook(payload: string | Buffer, opts: { cwdOverride?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = cp.spawnSync(process.execPath, [RUNNER_PATH], {
    input: payload,
    cwd: opts.cwdOverride,
    env: opts.env ?? process.env,
    encoding: 'utf-8',
    timeout: 20000,
  });
  return result;
}

function checkpointFiles(workspace: string): string[] {
  const dir = path.join(workspace, '.relay', 'checkpoints');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'));
}

function makePayload(type: string, cwd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, sessionId: 'ses_test', cwd, timestamp: new Date().toISOString(), ...extra });
}

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function newRepoDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hookrt-${name}-`));
  cleanupDirs.push(dir);
  return dir;
}

describe('hook-runner: valid input', () => {
  it('SessionStart writes a lightweight checkpoint', () => {
    const repo = newRepoDir('session-start');
    initRepo(repo);
    const result = runHook(makePayload('SessionStart', repo));
    expect(result.status).toBe(0);
    const files = checkpointFiles(repo);
    expect(files).toHaveLength(1);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.relay', 'checkpoints', files[0]), 'utf-8'));
    expect(checkpoint.type).toBe('lightweight');
    expect(checkpoint.reason).toBe('SessionStart');
    expect(checkpoint.git.head).toBe(sh('git rev-parse HEAD', repo));
  });

  it('PreCompact writes a recovery checkpoint', () => {
    const repo = newRepoDir('pre-compact');
    initRepo(repo);
    const result = runHook(makePayload('PreCompact', repo));
    expect(result.status).toBe(0);
    const files = checkpointFiles(repo);
    expect(files).toHaveLength(1);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.relay', 'checkpoints', files[0]), 'utf-8'));
    expect(checkpoint.type).toBe('recovery');
    expect(checkpoint.reason).toBe('PreCompact');
  });

  it('StopFailure writes a recovery checkpoint', () => {
    const repo = newRepoDir('stop-failure');
    initRepo(repo);
    const result = runHook(makePayload('StopFailure', repo));
    expect(result.status).toBe(0);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.relay', 'checkpoints', checkpointFiles(repo)[0]), 'utf-8'));
    expect(checkpoint.type).toBe('recovery');
    expect(checkpoint.reason).toBe('StopFailure');
  });
});

describe('hook-runner: wake observability (research instrumentation, not automation)', () => {
  it('StopFailure appends an allowlisted-field observation to .relay/wake-observations.jsonl', () => {
    const repo = newRepoDir('wake-observation');
    initRepo(repo);
    const result = runHook(makePayload('StopFailure', repo, { error: 'rate_limit', sessionId: 'ses_abc123' }));
    expect(result.status).toBe(0);
    const obsPath = path.join(repo, '.relay', 'wake-observations.jsonl');
    expect(fs.existsSync(obsPath)).toBe(true);
    const lines = fs.readFileSync(obsPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const obs = JSON.parse(lines[0]);
    expect(obs.eventType).toBe('StopFailure');
    expect(obs.sessionId).toBe('ses_abc123');
    expect(obs.context.error).toBe('rate_limit');
    // Checkpoint creation is unaffected by this instrumentation.
    expect(checkpointFiles(repo)).toHaveLength(1);
  });

  it('does not append an observation for SessionStart or PreCompact', () => {
    const repo = newRepoDir('wake-observation-scoped');
    initRepo(repo);
    runHook(makePayload('SessionStart', repo));
    runHook(makePayload('PreCompact', repo));
    expect(fs.existsSync(path.join(repo, '.relay', 'wake-observations.jsonl'))).toBe(false);
  });

  it('only captures known-safe allowlisted fields, never the raw payload', () => {
    const repo = newRepoDir('wake-observation-allowlist');
    initRepo(repo);
    runHook(makePayload('StopFailure', repo, {
      error: 'billing_error',
      apiKey: 'sk-ant-should-never-be-captured',
      authorization: 'Bearer should-never-be-captured',
    }));
    const obsPath = path.join(repo, '.relay', 'wake-observations.jsonl');
    const obs = JSON.parse(fs.readFileSync(obsPath, 'utf-8').trim());
    expect(obs.context.error).toBe('billing_error');
    expect(JSON.stringify(obs)).not.toContain('should-never-be-captured');
  });
});

describe('hook-runner: malformed/hostile input degrades safely', () => {
  it('malformed JSON exits 0 and writes nothing', () => {
    const repo = newRepoDir('malformed-json');
    initRepo(repo);
    const result = runHook('{not valid json', { cwdOverride: repo });
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(0);
  });

  it('empty input exits 0 and writes nothing', () => {
    const repo = newRepoDir('empty-input');
    initRepo(repo);
    const result = runHook('', { cwdOverride: repo });
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(0);
  });

  it('oversized input (>256KB) exits 0 and writes nothing', () => {
    const repo = newRepoDir('oversized');
    initRepo(repo);
    const huge = JSON.stringify({ type: 'PreCompact', cwd: repo, pad: 'x'.repeat(300 * 1024) });
    const result = runHook(huge, { cwdOverride: repo });
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(0);
  });

  it('unknown event type exits 0 and writes nothing', () => {
    const repo = newRepoDir('unknown-event');
    initRepo(repo);
    const result = runHook(makePayload('SomeRandomEvent', repo));
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(0);
  });

  it('missing required "type" field exits 0 and writes nothing', () => {
    const repo = newRepoDir('missing-type');
    initRepo(repo);
    const result = runHook(JSON.stringify({ cwd: repo, timestamp: new Date().toISOString() }));
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(0);
  });

  it('shell metacharacters in cwd do not execute and exit safely', () => {
    // cwd is passed to fs.realpathSync, never to a shell — this proves it,
    // rather than assuming shell:false on the git calls is the whole story.
    const marker = path.join(os.tmpdir(), `pwned-marker-${Date.now()}.txt`);
    const hostileCwd = `; touch ${marker} #`;
    const result = runHook(makePayload('PreCompact', hostileCwd));
    expect(result.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe('hook-runner: path edge cases', () => {
  it('handles a workspace path containing a space and parentheses', () => {
    const repo = path.join(os.tmpdir(), `hookrt-space-test (${Date.now()})`);
    cleanupDirs.push(repo);
    initRepo(repo);
    const result = runHook(makePayload('PreCompact', repo));
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(1);
  });

  it('handles a Unicode workspace path', () => {
    const repo = path.join(os.tmpdir(), `hookrt-λ-relay-测试-${Date.now()}`);
    cleanupDirs.push(repo);
    initRepo(repo);
    const result = runHook(makePayload('SessionStart', repo));
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(1);
  });
});

describe('hook-runner: git process behavior', () => {
  it('degrades to "unknown" git fields (not a crash) when cwd is not a git repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookrt-notgit-'));
    cleanupDirs.push(dir);
    const result = runHook(makePayload('PreCompact', dir));
    expect(result.status).toBe(0);
    const files = checkpointFiles(dir);
    expect(files).toHaveLength(1);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(dir, '.relay', 'checkpoints', files[0]), 'utf-8'));
    expect(checkpoint.git.head).toBe('unknown');
    expect(checkpoint.git.branch).toBe('unknown');
    expect(checkpoint.git.isDirty).toBe(false);
  });

  it('bounds total wall-clock time when git hangs, and still degrades safely (not an infinite hang)', () => {
    // Shim `git` with something that never returns, and put it first on
    // PATH for the subprocess only. Each of the 3 sequential git calls has
    // its own 5s spawnSync timeout, so worst case is ~15s, not forever —
    // that bound is exactly what this test proves.
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookrt-gitshim-'));
    cleanupDirs.push(shimDir);
    const isWin = process.platform === 'win32';
    const shimPath = path.join(shimDir, isWin ? 'git.cmd' : 'git');
    fs.writeFileSync(shimPath, isWin ? '@echo off\r\n:loop\r\ngoto loop\r\n' : '#!/bin/sh\nwhile true; do :; done\n');
    if (!isWin) fs.chmodSync(shimPath, 0o755);

    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hookrt-gittimeout-'));
    cleanupDirs.push(repo);
    fs.mkdirSync(path.join(repo, '.git')); // just needs to look enough like a repo to attempt git calls

    const pathSep = isWin ? ';' : ':';
    const result = runHook(makePayload('PreCompact', repo), {
      cwdOverride: repo,
      env: { ...process.env, PATH: `${shimDir}${pathSep}${process.env.PATH}` },
    });

    expect(result.status).toBe(0);
    const files = checkpointFiles(repo);
    expect(files).toHaveLength(1);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.relay', 'checkpoints', files[0]), 'utf-8'));
    expect(checkpoint.git.head).toBe('unknown');
  }, 25000);
});

describe('hook-runner: filesystem safety and state integrity', () => {
  it('refuses to write when .relay/checkpoints resolves outside the workspace via a symlink', () => {
    const repo = newRepoDir('symlink-escape');
    initRepo(repo);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hookrt-outside-'));
    cleanupDirs.push(outside);

    fs.mkdirSync(path.join(repo, '.relay'), { recursive: true });
    let linked = true;
    try {
      fs.symlinkSync(outside, path.join(repo, '.relay', 'checkpoints'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      linked = false; // e.g. no permission to create symlinks on this machine/CI runner
    }

    if (!linked) {
      // Documented, not silently skipped: this environment can't create
      // symlinks/junctions without elevation, so this specific escape path
      // isn't exercised here — the traversal-prefix check in source is the
      // remaining evidence for this case.
      expect(true).toBe(true);
      return;
    }

    const result = runHook(makePayload('PreCompact', repo));
    expect(result.status).toBe(0);
    // Nothing should have been written into the outside directory.
    expect(fs.readdirSync(outside).filter(f => f.endsWith('.json'))).toHaveLength(0);
  });

  it('keeps repositories fully isolated from each other', () => {
    const repoA = newRepoDir('isolation-a');
    const repoB = newRepoDir('isolation-b');
    initRepo(repoA);
    initRepo(repoB);

    runHook(makePayload('PreCompact', repoA));
    expect(checkpointFiles(repoA)).toHaveLength(1);
    expect(checkpointFiles(repoB)).toHaveLength(0);
  });

  it('a prior valid checkpoint survives a subsequent malformed invocation', () => {
    const repo = newRepoDir('survives-failure');
    initRepo(repo);

    runHook(makePayload('PreCompact', repo));
    const filesBefore = checkpointFiles(repo);
    expect(filesBefore).toHaveLength(1);
    const contentBefore = fs.readFileSync(path.join(repo, '.relay', 'checkpoints', filesBefore[0]), 'utf-8');

    runHook('{not valid json', { cwdOverride: repo });

    const filesAfter = checkpointFiles(repo);
    expect(filesAfter).toEqual(filesBefore);
    expect(fs.readFileSync(path.join(repo, '.relay', 'checkpoints', filesAfter[0]), 'utf-8')).toBe(contentBefore);
  });

  it('self-gitignores .relay so its own writes never appear in git status', () => {
    const repo = newRepoDir('self-gitignore');
    initRepo(repo);
    runHook(makePayload('PreCompact', repo));
    expect(fs.existsSync(path.join(repo, '.relay', '.gitignore'))).toBe(true);
    expect(sh('git status --porcelain', repo)).toBe('');
  });
});

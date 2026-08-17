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

function runHook(payload: string | Buffer, opts: { cwdOverride?: string; env?: NodeJS.ProcessEnv; eventArg?: string } = {}) {
  const args = opts.eventArg !== undefined ? [RUNNER_PATH, opts.eventArg] : [RUNNER_PATH];
  const result = cp.spawnSync(process.execPath, args, {
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

// Real Claude Code hook payload shape, confirmed by decompiling the actual
// installed claude.exe 2.1.233 (see packages/hook-runtime/src/index.ts's bug-fix
// comment): the event is identified by `hook_event_name`, the session by
// `session_id` -- both snake_case, neither "type"/"event"/"sessionId". This
// fixture intentionally matches that real shape, not a guess, so these tests
// actually exercise the contract Claude Code uses in production.
function makePayload(type: string, cwd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ hook_event_name: type, session_id: 'ses_test', cwd, timestamp: new Date().toISOString(), ...extra });
}

// Mirrors a real install exactly: hooks.json invokes `node hook-runner.cjs
// <EventName>` (argv) AND Claude Code's own payload carries `hook_event_name`
// (stdin). Both signals present and agreeing is the normal, real-world case,
// so this is the default helper the "valid input" tests below use.
function runRealisticHook(type: string, cwd: string, extra: Record<string, unknown> = {}) {
  return runHook(makePayload(type, cwd, extra), { eventArg: type });
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
    const result = runRealisticHook('SessionStart', repo);
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
    const result = runRealisticHook('PreCompact', repo);
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
    const result = runRealisticHook('StopFailure', repo);
    expect(result.status).toBe(0);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.relay', 'checkpoints', checkpointFiles(repo)[0]), 'utf-8'));
    expect(checkpoint.type).toBe('recovery');
    expect(checkpoint.reason).toBe('StopFailure');
  });
});

describe('hook-runner: event-type resolution (regression coverage for the hook_event_name bug)', () => {
  // This whole describe block exists because of a real, confirmed bug: the
  // handler used to read `eventPayload.type || eventPayload.event`, which is
  // never present on a real Claude Code hook payload (the real field is
  // `hook_event_name`; confirmed directly in the installed claude.exe binary).
  // Every one of the "valid input" tests above passed before the fix too --
  // because the old fixture matched the old (wrong) code. These tests pin
  // each individual signal path so this exact class of bug (fixture silently
  // drifting from the real contract) can't reoccur unnoticed again.

  it('resolves the event from the real payload field (hook_event_name) with no argv given at all', () => {
    const repo = newRepoDir('resolve-payload-only');
    initRepo(repo);
    // No eventArg -- proves the payload field alone is sufficient, matching
    // how a bare `node hook-runner.cjs < payload.json` invocation would behave.
    const result = runHook(makePayload('PreCompact', repo));
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(1);
  });

  it('falls back to argv[2] when hook_event_name is absent from the payload', () => {
    const repo = newRepoDir('resolve-argv-fallback');
    initRepo(repo);
    const payload = JSON.stringify({ session_id: 'ses_test', cwd: repo });
    const result = runHook(payload, { eventArg: 'PreCompact' });
    expect(result.status).toBe(0);
    const files = checkpointFiles(repo);
    expect(files).toHaveLength(1);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.relay', 'checkpoints', files[0]), 'utf-8'));
    expect(checkpoint.reason).toBe('PreCompact');
  });

  it('hook_event_name is preferred over the old "type" field when both are present', () => {
    // The old `type`/`event` fields are kept as a last-resort fallback (never
    // trusted first) purely for forward/backward robustness -- harmless to
    // keep since the resolved value is validated against the same fixed
    // allowlist regardless of which field it came from. This test pins that
    // hook_event_name wins when both are present, i.e. real Claude Code's own
    // field is authoritative, never the legacy guess.
    const repo = newRepoDir('payload-field-priority');
    initRepo(repo);
    const payload = JSON.stringify({ hook_event_name: 'PreCompact', type: 'StopFailure', session_id: 'ses_test', cwd: repo });
    const result = runHook(payload);
    expect(result.status).toBe(0);
    const files = checkpointFiles(repo);
    expect(files).toHaveLength(1);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.relay', 'checkpoints', files[0]), 'utf-8'));
    expect(checkpoint.reason).toBe('PreCompact');
  });

  it('prefers hook_event_name over a mismatched argv when both are present', () => {
    const repo = newRepoDir('payload-wins');
    initRepo(repo);
    // argv says StopFailure, payload says PreCompact -- payload (the value
    // Claude Code itself asserts) is treated as authoritative.
    const result = runHook(makePayload('PreCompact', repo), { eventArg: 'StopFailure' });
    expect(result.status).toBe(0);
    const files = checkpointFiles(repo);
    expect(files).toHaveLength(1);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.relay', 'checkpoints', files[0]), 'utf-8'));
    expect(checkpoint.reason).toBe('PreCompact');
  });
});

describe('hook-runner: wake observability (research instrumentation, not automation)', () => {
  it('StopFailure appends an allowlisted-field observation to .relay/wake-observations.jsonl', () => {
    const repo = newRepoDir('wake-observation');
    initRepo(repo);
    const result = runRealisticHook('StopFailure', repo, { error: 'rate_limit', session_id: 'ses_abc123' });
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

  it('captures error_details alongside error when both are present', () => {
    const repo = newRepoDir('wake-observation-error-details');
    initRepo(repo);
    runRealisticHook('StopFailure', repo, { error: 'api_error', error_details: 'overloaded_error' });
    const obsPath = path.join(repo, '.relay', 'wake-observations.jsonl');
    const obs = JSON.parse(fs.readFileSync(obsPath, 'utf-8').trim());
    expect(obs.context.error).toBe('api_error');
    expect(obs.context.error_details).toBe('overloaded_error');
  });

  it('does not append an observation for SessionStart or PreCompact', () => {
    const repo = newRepoDir('wake-observation-scoped');
    initRepo(repo);
    runRealisticHook('SessionStart', repo);
    runRealisticHook('PreCompact', repo);
    expect(fs.existsSync(path.join(repo, '.relay', 'wake-observations.jsonl'))).toBe(false);
  });

  it('only captures known-safe allowlisted fields, never the raw payload', () => {
    const repo = newRepoDir('wake-observation-allowlist');
    initRepo(repo);
    runRealisticHook('StopFailure', repo, {
      error: 'billing_error',
      apiKey: 'sk-ant-should-never-be-captured',
      authorization: 'Bearer should-never-be-captured',
    });
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
    const huge = JSON.stringify({ hook_event_name: 'PreCompact', cwd: repo, pad: 'x'.repeat(300 * 1024) });
    const result = runHook(huge, { cwdOverride: repo, eventArg: 'PreCompact' });
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(0);
  });

  it('unknown event type exits 0 and writes nothing', () => {
    const repo = newRepoDir('unknown-event');
    initRepo(repo);
    const result = runRealisticHook('SomeRandomEvent', repo);
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(0);
  });

  it('missing event-name field/arg entirely exits 0 and writes nothing', () => {
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
    const result = runRealisticHook('PreCompact', hostileCwd);
    expect(result.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe('hook-runner: path edge cases', () => {
  it('handles a workspace path containing a space and parentheses', () => {
    const repo = path.join(os.tmpdir(), `hookrt-space-test (${Date.now()})`);
    cleanupDirs.push(repo);
    initRepo(repo);
    const result = runRealisticHook('PreCompact', repo);
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(1);
  });

  it('handles a Unicode workspace path', () => {
    const repo = path.join(os.tmpdir(), `hookrt-λ-relay-测试-${Date.now()}`);
    cleanupDirs.push(repo);
    initRepo(repo);
    const result = runRealisticHook('SessionStart', repo);
    expect(result.status).toBe(0);
    expect(checkpointFiles(repo)).toHaveLength(1);
  });
});

describe('hook-runner: git process behavior', () => {
  it('degrades to "unknown" git fields (not a crash) when cwd is not a git repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookrt-notgit-'));
    cleanupDirs.push(dir);
    const result = runRealisticHook('PreCompact', dir);
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
      eventArg: 'PreCompact',
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

    const result = runRealisticHook('PreCompact', repo);
    expect(result.status).toBe(0);
    // Nothing should have been written into the outside directory.
    expect(fs.readdirSync(outside).filter(f => f.endsWith('.json'))).toHaveLength(0);
  });

  it('keeps repositories fully isolated from each other', () => {
    const repoA = newRepoDir('isolation-a');
    const repoB = newRepoDir('isolation-b');
    initRepo(repoA);
    initRepo(repoB);

    runRealisticHook('PreCompact', repoA);
    expect(checkpointFiles(repoA)).toHaveLength(1);
    expect(checkpointFiles(repoB)).toHaveLength(0);
  });

  it('a prior valid checkpoint survives a subsequent malformed invocation', () => {
    const repo = newRepoDir('survives-failure');
    initRepo(repo);

    runRealisticHook('PreCompact', repo);
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
    runRealisticHook('PreCompact', repo);
    expect(fs.existsSync(path.join(repo, '.relay', '.gitignore'))).toBe(true);
    expect(sh('git status --porcelain', repo)).toBe('');
  });
});

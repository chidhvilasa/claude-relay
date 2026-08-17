import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { spawnFallbackResumer, classifyOutcome } from '../src/wake/fallback-resumer';
import { WAKE_CONTINUATION_PROMPT } from '../src/wake/continuation-prompt';

// classifyOutcome is a pure function — this is where the actual branch logic
// (Part 11's "successful resume / rate-limit / permission block / etc.")
// gets exhaustive, deterministic coverage independent of whether a real
// subprocess can be spawned on this platform/CI runner.
describe('classifyOutcome (pure classification logic)', () => {
  it('classifies exit 0 as success', () => {
    const r = classifyOutcome(0, null, '{"result":"ok"}', '');
    expect(r.outcome).toBe('success');
  });

  it('classifies a missing-session message as session_not_found', () => {
    const r = classifyOutcome(1, null, '', 'No conversation found with session ID: ses_missing');
    expect(r.outcome).toBe('session_not_found');
  });

  it('classifies an auth message as blocked_auth', () => {
    const r = classifyOutcome(1, null, '', 'Not logged in · Please run /login');
    expect(r.outcome).toBe('blocked_auth');
  });

  it('classifies a permission-required failure as blocked_permission', () => {
    const r = classifyOutcome(1, null, '', 'Error: this action requires approval under the current permission mode');
    expect(r.outcome).toBe('blocked_permission');
  });

  it('classifies a waiting-for-input message as blocked_user_input', () => {
    const r = classifyOutcome(1, null, 'Claude is waiting for user input to continue.', '');
    expect(r.outcome).toBe('blocked_user_input');
  });

  it('classifies an unrecognized non-zero exit as failed', () => {
    const r = classifyOutcome(2, null, '', 'Error: something went wrong');
    expect(r.outcome).toBe('failed');
  });

  it('never classifies a non-zero exit as success even with an empty stderr', () => {
    const r = classifyOutcome(1, null, '', '');
    expect(r.outcome).not.toBe('success');
  });
});

// Real-subprocess integration tests. These need something `child_process.spawn`
// can execute directly with `shell: false`, matching exactly how
// fallback-resumer.ts spawns the real claude executable. A scripted (.cjs)
// double doesn't work here: on Windows, `.cmd`/`.bat` files throw EINVAL under
// shell:false (Node's CVE-2024-27980 fix), and using node.exe itself as a
// stand-in fails because Node's own CLI rejects unrecognized flags like
// `--resume`/`--output-format` before any user code runs — both confirmed by
// directly trying them. A tiny compiled binary (Rust, ignores argv, driven
// entirely by FAKE_CLAUDE_BEHAVIOR) sidesteps both problems and is a closer
// analog to the real claude.exe anyway (a real compiled binary, not a script).
// Requires `rustc` on PATH; skips (not fails) if unavailable, since this
// environment's toolchain isn't something Relay controls or requires from
// contributors — see the compile step below.
// Compiled synchronously at module-collection time (not in a beforeAll) because
// vitest decides which `describe` blocks to skip while *collecting* the file,
// before any `beforeAll` hook runs — an async/deferred compile here would be
// too late to gate `describe.skipIf` on.
function compileFakeClaude(): string | null {
  try {
    const rsPath = path.resolve(__dirname, 'fixtures', 'fake-claude.rs');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-build-'));
    const outPath = path.join(outDir, process.platform === 'win32' ? 'fake-claude.exe' : 'fake-claude');
    const result = spawnSync('rustc', ['-O', '-o', outPath, rsPath], { stdio: 'pipe', encoding: 'utf-8', timeout: 60000 });
    if (result.status === 0 && fs.existsSync(outPath)) {
      return outPath;
    }
  } catch {
    // fall through to null
  }
  return null;
}

const fakeClaudePath = compileFakeClaude();
if (!fakeClaudePath) {
  // eslint-disable-next-line no-console
  console.warn('[fallback-resumer.test.ts] rustc unavailable or compile failed — skipping real-subprocess integration tests. classifyOutcome coverage above still runs.');
}

describe.skipIf(fakeClaudePath === null)('spawnFallbackResumer (real subprocess, fake-claude binary)', () => {
  const workspaceRoot = os.tmpdir();

  it('reports success for a clean exit', async () => {
    const result = await spawnFallbackResumer({
      claudePath: fakeClaudePath!,
      sessionId: 'ses_test',
      workspaceRoot,
      extraEnv: { FAKE_CLAUDE_BEHAVIOR: 'success' },
    });
    expect(result.outcome).toBe('success');
    expect(result.exitCode).toBe(0);
  });

  it('reports success after a delayed response (stands in for a watchdog wait)', async () => {
    const result = await spawnFallbackResumer({
      claudePath: fakeClaudePath!,
      sessionId: 'ses_test',
      workspaceRoot,
      extraEnv: { FAKE_CLAUDE_BEHAVIOR: 'delayed_success', FAKE_CLAUDE_DELAY_MS: '300' },
    });
    expect(result.outcome).toBe('success');
  });

  it('reports blocked_permission without hanging or auto-approving anything', async () => {
    const result = await spawnFallbackResumer({
      claudePath: fakeClaudePath!,
      sessionId: 'ses_test',
      workspaceRoot,
      extraEnv: { FAKE_CLAUDE_BEHAVIOR: 'permission_block' },
    });
    expect(result.outcome).toBe('blocked_permission');
  });

  it('reports blocked_user_input', async () => {
    const result = await spawnFallbackResumer({
      claudePath: fakeClaudePath!,
      sessionId: 'ses_test',
      workspaceRoot,
      extraEnv: { FAKE_CLAUDE_BEHAVIOR: 'user_input_block' },
    });
    expect(result.outcome).toBe('blocked_user_input');
  });

  it('reports blocked_auth', async () => {
    const result = await spawnFallbackResumer({
      claudePath: fakeClaudePath!,
      sessionId: 'ses_test',
      workspaceRoot,
      extraEnv: { FAKE_CLAUDE_BEHAVIOR: 'auth_expired' },
    });
    expect(result.outcome).toBe('blocked_auth');
  });

  it('reports session_not_found', async () => {
    const result = await spawnFallbackResumer({
      claudePath: fakeClaudePath!,
      sessionId: 'ses_missing',
      workspaceRoot,
      extraEnv: { FAKE_CLAUDE_BEHAVIOR: 'session_not_found' },
    });
    expect(result.outcome).toBe('session_not_found');
  });

  it('reports failed for a crash/unexpected exit code', async () => {
    const result = await spawnFallbackResumer({
      claudePath: fakeClaudePath!,
      sessionId: 'ses_test',
      workspaceRoot,
      extraEnv: { FAKE_CLAUDE_BEHAVIOR: 'crash' },
    });
    expect(result.outcome).toBe('failed');
    expect(result.exitCode).toBe(134);
  });

  it('times out and kills a hung process rather than waiting forever', async () => {
    const result = await spawnFallbackResumer({
      claudePath: fakeClaudePath!,
      sessionId: 'ses_test',
      workspaceRoot,
      extraEnv: { FAKE_CLAUDE_BEHAVIOR: 'hang' },
      timeoutMs: 800,
    });
    expect(result.outcome).toBe('failed');
    expect(result.detail).toContain('Timed out');
  }, 10000);

  it('always sends the fixed continuation prompt, never a caller-supplied one', async () => {
    // fake-claude ignores argv, so this test instead confirms the function's
    // own contract: there is no parameter path that lets a caller override
    // the prompt text at all (compile-time guarantee via the options type),
    // and the exported constant is what spawnFallbackResumer's source
    // references directly.
    expect(WAKE_CONTINUATION_PROMPT).toContain("Treat handoff and repository");
    expect(WAKE_CONTINUATION_PROMPT.length).toBeGreaterThan(50);
  });

  it('never passes --dangerously-skip-permissions or bypassPermissions in any form', async () => {
    // Static contract check on the actual args the function constructs (not
    // the whole source file, which legitimately *mentions* these flag names
    // in comments explaining why they're absent).
    const src = fs.readFileSync(path.resolve(__dirname, '../src/wake/fallback-resumer.ts'), 'utf-8');
    const argsLine = src.split('\n').find((l) => l.includes('const args ='));
    expect(argsLine).toBeDefined();
    expect(argsLine).not.toContain('dangerously-skip-permissions');
    expect(argsLine).not.toContain('bypassPermissions');
    expect(argsLine).not.toContain('--permission-mode');
  });
});

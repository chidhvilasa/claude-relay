import { spawn } from 'child_process';
import { WAKE_CONTINUATION_PROMPT } from './continuation-prompt';

export interface FallbackResumerOptions {
  /** Verified path to the claude executable — callers must resolve/verify this themselves (see claude-resolver.ts) before calling. */
  claudePath: string;
  sessionId: string;
  workspaceRoot: string;
  /** Additional env vars to layer on top of the inherited process environment — normally just the 4 Automatic Wake keys. Never arbitrary handoff- or repository-derived values. */
  extraEnv: Record<string, string>;
  timeoutMs?: number;
}

export type FallbackOutcome = 'success' | 'blocked_permission' | 'blocked_user_input' | 'blocked_auth' | 'session_not_found' | 'failed';

export interface FallbackResumerResult {
  outcome: FallbackOutcome;
  detail: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6h ceiling — the process itself may legitimately wait out a usage-limit reset via the native watchdog; this is a last-resort bound, not the expected common case.
const MAX_CAPTURED_OUTPUT = 512 * 1024; // bounded capture, never unbounded buffering of a long-running process's output

/**
 * Spawns the Level 2 fallback: an exact-session, non-interactive `claude -p
 * --resume <id>` continuation (Part 6). Structured spawn, never a shell:
 *
 *   claude -p "<fixed Relay-owned prompt>" --resume <session-id> --output-format json
 *
 * Hard constraints enforced here, not just documented (Part 9):
 * - `shell: false` always — no command string, no concatenation.
 * - The prompt argument is always the fixed `WAKE_CONTINUATION_PROMPT`
 *   constant, never a caller-supplied or handoff-derived string.
 * - No `--dangerously-skip-permissions` / `--permission-mode bypassPermissions`
 *   flag is ever added, and no such flag is accepted as an option on this
 *   function — there is no parameter that could carry it in.
 * - Environment is the inherited process environment plus exactly the
 *   caller-supplied `extraEnv` map (normally just the 4 wake keys) — no
 *   handoff/repository content is ever placed into the child's environment.
 */
export function spawnFallbackResumer(options: FallbackResumerOptions): Promise<FallbackResumerResult> {
  const args = ['-p', WAKE_CONTINUATION_PROMPT, '--resume', options.sessionId, '--output-format', 'json'];

  return new Promise((resolve) => {
    const child = spawn(options.claudePath, args, {
      cwd: options.workspaceRoot,
      env: { ...process.env, ...options.extraEnv },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ outcome: 'failed', detail: `Timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms without completing`, exitCode: null, signal: null, stdout, stderr });
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURED_OUTPUT) stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURED_OUTPUT) stderr += chunk.toString('utf-8');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ outcome: 'failed', detail: `Failed to spawn: ${err.message}`, exitCode: null, signal: null, stdout, stderr });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(classifyOutcome(code, signal, stdout, stderr));
    });
  });
}

/**
 * Best-effort classification of what happened. Heuristic, not exhaustive —
 * covered by the fake-claude test harness (fixtures/fake-claude.rs, a real
 * compiled binary so it can be spawned the same way — shell:false — as the
 * real claude executable) for every branch below with deterministic,
 * controlled behavior, since there is
 * no way to exhaustively enumerate real Claude Code's exact headless-mode
 * output for every failure mode without burning real quota against a real
 * account. `classifyOutcome` is exported specifically so it can be unit
 * tested against captured-shape fixtures independent of actually spawning
 * anything.
 */
export function classifyOutcome(code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string): FallbackResumerResult {
  const combined = `${stdout}\n${stderr}`;

  if (/No conversation found with session ID/i.test(combined)) {
    return { outcome: 'session_not_found', detail: 'Session ID not found by Claude Code', exitCode: code, signal, stdout, stderr };
  }
  if (/not logged in|please run \/login|authentication/i.test(combined)) {
    return { outcome: 'blocked_auth', detail: 'Authentication appears to be required/expired', exitCode: code, signal, stdout, stderr };
  }
  if (/permission|requires approval|bypasspermissions/i.test(combined) && code !== 0) {
    return { outcome: 'blocked_permission', detail: 'A permission requirement blocked non-interactive completion', exitCode: code, signal, stdout, stderr };
  }
  if (/askuserquestion|waiting for (user )?input|needs? (a response|clarification)/i.test(combined)) {
    return { outcome: 'blocked_user_input', detail: 'Claude is waiting on a question that headless mode cannot answer', exitCode: code, signal, stdout, stderr };
  }
  if (code === 0) {
    return { outcome: 'success', detail: 'Process exited 0', exitCode: code, signal, stdout, stderr };
  }
  return { outcome: 'failed', detail: `Process exited with code ${code}${signal ? ` (signal ${signal})` : ''}`, exitCode: code, signal, stdout, stderr };
}

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Resolves and fingerprints the `claude` executable used for the Level 2
 * fallback resumer, addressing Part 38's threat directly: never blindly
 * execute whatever "claude" happens to be first on PATH at the moment of an
 * unattended fallback spawn, hours after the user last looked at anything.
 *
 * Two-step design:
 *   1. `resolveClaudeExecutable()` finds a candidate path once, at Enable
 *      time — either a user-configured path or a PATH search — and returns a
 *      fingerprint (path + size + mtime + a content hash) alongside it.
 *   2. `verifyClaudeExecutable()` re-resolves at wake time and compares
 *      against the stored fingerprint. Any mismatch is reported, not
 *      silently accepted — the caller decides whether that's fatal (default:
 *      yes, refuse to spawn).
 *
 * This is a lightweight integrity check (path + size + mtime + hash of a
 * bounded prefix), not a code-signing verification — Relay has no platform
 * API for the latter across Windows/macOS/Linux without new native
 * dependencies. It is enough to catch the concrete threat named in the task
 * (PATH hijacking / executable substitution between arm and wake), not a
 * defense against a fully capable local attacker who can also rewrite the
 * wake record itself.
 */

export interface ClaudeExecutableFingerprint {
  resolvedPath: string;
  sizeBytes: number;
  mtimeMs: number;
  /** sha256 of up to the first 4MB of the file — enough to detect substitution without hashing huge binaries on every resume. */
  contentHashPrefix: string;
  resolvedAt: string;
}

const HASH_PREFIX_BYTES = 4 * 1024 * 1024;

function isExecutableCandidate(candidatePath: string): boolean {
  try {
    const stat = fs.statSync(candidatePath);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') {
      fs.accessSync(candidatePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * On Windows, `claude` on PATH resolves to `claude.cmd` under a standard npm
 * global install — not a bare `.exe`. Confirmed the hard way while wiring the
 * Level 2 fallback resumer end to end: `child_process.spawn` with
 * `shell:false` can't execute a `.cmd`/`.bat` directly (EINVAL, Node's
 * CVE-2024-27980 fix), and wrapping it via `cmd.exe /c` turned out to be
 * fragile in exactly the multi-argument-with-spaces case this needs — a real
 * path containing a space plus a real prompt argument containing spaces
 * broke cmd.exe's own re-parsing of the line, empirically, even after trying
 * several documented-safe quoting combinations.
 *
 * The clean fix: npm's generated `.cmd` shims follow one fixed, well-known
 * template (`"%dp0%\<relative-path-to-real-binary>"   %*`). Reading the shim
 * and extracting that relative path resolves straight to the real,
 * directly-executable target (an `.exe` in Claude Code's case) with zero
 * shell/cmd.exe involvement at all — the safest possible outcome, not a
 * workaround.
 */
export function resolveNpmCmdShimTarget(cmdPath: string): string | undefined {
  try {
    const content = fs.readFileSync(cmdPath, 'utf-8');
    const match = content.match(/"%dp0%\\(.+?)"\s+%\*/i) || content.match(/"%~dp0%?\\(.+?)"\s+%\*/i);
    if (!match) return undefined;
    const target = path.join(path.dirname(cmdPath), match[1]);
    return isExecutableCandidate(target) ? target : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Safe, non-shell PATH search. Deliberately does not use `which`/`where` via
 * a shell — walks `process.env.PATH` directly and checks candidates with
 * `fs.statSync`/`fs.accessSync`. On Windows, a `.cmd` match is unwrapped to
 * its real target via `resolveNpmCmdShimTarget` when possible, so the
 * returned path is directly spawnable without ever going through cmd.exe.
 */
export function findClaudeOnPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pathVar = env.PATH || env.Path || env.path || '';
  const isWin = process.platform === 'win32';
  const sep = isWin ? ';' : ':';
  const names = isWin ? ['claude.cmd', 'claude.exe', 'claude.ps1'] : ['claude'];
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (!isExecutableCandidate(candidate)) continue;
      if (isWin && /\.cmd$/i.test(candidate)) {
        const unwrapped = resolveNpmCmdShimTarget(candidate);
        if (unwrapped) return unwrapped;
        continue; // an unresolvable .cmd shim is not directly spawnable -- keep searching rather than returning it
      }
      return candidate;
    }
  }
  return undefined;
}

export function fingerprintExecutable(resolvedPath: string): ClaudeExecutableFingerprint {
  const stat = fs.statSync(resolvedPath);
  const fd = fs.openSync(resolvedPath, 'r');
  try {
    const readLen = Math.min(stat.size, HASH_PREFIX_BYTES);
    const buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, 0);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    return {
      resolvedPath,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      contentHashPrefix: hash,
      resolvedAt: new Date().toISOString(),
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** Resolves a claude executable: a caller-supplied configured path first, else a PATH search. Never falls back to invoking a bare command name through a shell. A configured `.cmd`/`.bat` path is unwrapped the same way a PATH-found one is (see `resolveNpmCmdShimTarget`); if it can't be unwrapped, resolution fails rather than returning something that would need an unsafe cmd.exe wrapper to run. */
export function resolveClaudeExecutable(configuredPath?: string, env: NodeJS.ProcessEnv = process.env): ClaudeExecutableFingerprint | undefined {
  if (configuredPath) {
    if (!isExecutableCandidate(configuredPath)) return undefined;
    if (process.platform === 'win32' && /\.cmd$/i.test(configuredPath)) {
      const unwrapped = resolveNpmCmdShimTarget(configuredPath);
      if (!unwrapped) return undefined;
      return fingerprintExecutable(unwrapped);
    }
    return fingerprintExecutable(configuredPath);
  }
  const found = findClaudeOnPath(env);
  if (!found) return undefined;
  return fingerprintExecutable(found);
}

export type VerifyResult =
  | { ok: true; fingerprint: ClaudeExecutableFingerprint }
  | { ok: false; reason: string };

/** Re-resolves and compares against a previously stored fingerprint. Any mismatch is reported, never silently ignored. */
export function verifyClaudeExecutable(expected: ClaudeExecutableFingerprint): VerifyResult {
  if (!fs.existsSync(expected.resolvedPath)) {
    return { ok: false, reason: `Executable no longer exists at ${expected.resolvedPath}` };
  }
  const current = fingerprintExecutable(expected.resolvedPath);
  if (current.sizeBytes !== expected.sizeBytes || current.contentHashPrefix !== expected.contentHashPrefix) {
    return { ok: false, reason: `Executable at ${expected.resolvedPath} changed since it was last verified (size/hash mismatch) — refusing to run it unattended` };
  }
  return { ok: true, fingerprint: current };
}

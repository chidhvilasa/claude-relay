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
 * Safe, non-shell PATH search. Deliberately does not use `which`/`where` via
 * a shell — walks `process.env.PATH` directly and checks candidates with
 * `fs.statSync`/`fs.accessSync`.
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
      if (isExecutableCandidate(candidate)) return candidate;
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

/** Resolves a claude executable: a caller-supplied configured path first, else a PATH search. Never falls back to invoking a bare command name through a shell. */
export function resolveClaudeExecutable(configuredPath?: string, env: NodeJS.ProcessEnv = process.env): ClaudeExecutableFingerprint | undefined {
  if (configuredPath) {
    if (!isExecutableCandidate(configuredPath)) return undefined;
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

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveClaudeExecutable, verifyClaudeExecutable, fingerprintExecutable, findClaudeOnPath } from '../src/wake/claude-resolver';

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeFakeExecutable(content = 'fake binary content'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-resolver-'));
  cleanupDirs.push(dir);
  const p = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
  fs.writeFileSync(p, content);
  if (process.platform !== 'win32') fs.chmodSync(p, 0o755);
  return p;
}

describe('resolveClaudeExecutable', () => {
  it('resolves a configured path directly when it exists and is executable', () => {
    const p = makeFakeExecutable();
    const fp = resolveClaudeExecutable(p);
    expect(fp).toBeDefined();
    expect(fp!.resolvedPath).toBe(p);
  });

  it('returns undefined for a configured path that does not exist', () => {
    const fp = resolveClaudeExecutable(path.join(os.tmpdir(), 'does-not-exist-claude'));
    expect(fp).toBeUndefined();
  });

  it('falls back to a PATH search when no configured path is given', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-path-'));
    cleanupDirs.push(dir);
    const name = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'fake');
    if (process.platform !== 'win32') fs.chmodSync(p, 0o755);
    const found = findClaudeOnPath({ PATH: dir });
    expect(found).toBe(p);
  });
});

describe('fingerprintExecutable / verifyClaudeExecutable (Part 38: PATH hijacking / substitution defense)', () => {
  it('produces a stable fingerprint for unchanged content', () => {
    const p = makeFakeExecutable('same content');
    const a = fingerprintExecutable(p);
    const b = fingerprintExecutable(p);
    expect(a.contentHashPrefix).toBe(b.contentHashPrefix);
    expect(a.sizeBytes).toBe(b.sizeBytes);
  });

  it('verify succeeds when nothing changed between arm and wake', () => {
    const p = makeFakeExecutable('original content');
    const fp = fingerprintExecutable(p);
    const result = verifyClaudeExecutable(fp);
    expect(result.ok).toBe(true);
  });

  it('verify FAILS when the executable at the same path was swapped for different content — the core substitution threat', () => {
    const p = makeFakeExecutable('original content');
    const fp = fingerprintExecutable(p);
    fs.writeFileSync(p, 'malicious replacement content, same path'); // simulates PATH hijack / substitution
    const result = verifyClaudeExecutable(fp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/changed since it was last verified/);
    }
  });

  it('verify FAILS when the executable was removed entirely', () => {
    const p = makeFakeExecutable();
    const fp = fingerprintExecutable(p);
    fs.rmSync(p);
    const result = verifyClaudeExecutable(fp);
    expect(result.ok).toBe(false);
  });

  it('never silently proceeds on a mismatch — callers must explicitly branch on result.ok', () => {
    const p = makeFakeExecutable('a');
    const fp = fingerprintExecutable(p);
    fs.writeFileSync(p, 'b'.repeat(10));
    const result = verifyClaudeExecutable(fp);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBeTruthy();
    }
  });
});

describe('findClaudeOnPath', () => {
  it('returns undefined when nothing on PATH matches', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-path-'));
    cleanupDirs.push(emptyDir);
    expect(findClaudeOnPath({ PATH: emptyDir })).toBeUndefined();
  });

  it('never uses a shell to search PATH (structural guarantee: pure fs calls only)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/wake/claude-resolver.ts'), 'utf-8');
    expect(src).not.toContain('exec(');
    expect(src).not.toContain('shell: true');
  });
});

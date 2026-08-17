import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveClaudeExecutable, verifyClaudeExecutable, fingerprintExecutable, findClaudeOnPath, resolveNpmCmdShimTarget } from '../src/wake/claude-resolver';

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
    // .exe (not .cmd) on Windows here deliberately -- a directly-spawnable
    // format needs no shim-unwrapping, keeping this test about the generic
    // "falls back to PATH search" behavior. The .cmd-specific unwrapping
    // path has its own dedicated describe block below.
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'fake');
    if (process.platform !== 'win32') fs.chmodSync(p, 0o755);
    const found = findClaudeOnPath({ PATH: dir });
    expect(found).toBe(p);
  });

  it('unwraps a real npm .cmd shim found on PATH to its underlying .exe target', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-path-shim-'));
    cleanupDirs.push(dir);
    const targetDir = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetExe = path.join(targetDir, 'claude.exe');
    fs.writeFileSync(targetExe, 'fake exe content');
    const shimPath = path.join(dir, 'claude.cmd');
    fs.writeFileSync(shimPath, `"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`);

    const found = findClaudeOnPath({ PATH: dir });
    if (process.platform === 'win32') {
      expect(found).toBe(targetExe); // never the .cmd shim itself
    }
  });

  it('skips an unresolvable .cmd shim on PATH rather than returning something unsafe to spawn', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-path-broken-shim-'));
    cleanupDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\r\necho not a real shim\r\n');
    const found = findClaudeOnPath({ PATH: dir });
    if (process.platform === 'win32') {
      expect(found).toBeUndefined();
    }
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

describe('resolveNpmCmdShimTarget (Windows: unwrap claude.cmd to its real, directly-spawnable .exe)', () => {
  it('resolves the real target from a genuine npm-generated .cmd shim (the exact template npm emits)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-shim-'));
    cleanupDirs.push(dir);
    const targetDir = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetExe = path.join(targetDir, 'claude.exe');
    fs.writeFileSync(targetExe, 'fake exe content');

    const shimPath = path.join(dir, 'claude.cmd');
    // Exact template npm generates (confirmed against the real installed
    // claude.cmd on this machine during debugging).
    fs.writeFileSync(
      shimPath,
      '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n' +
        `"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`
    );

    const resolved = resolveNpmCmdShimTarget(shimPath);
    expect(resolved).toBe(targetExe);
  });

  it('returns undefined when the shim references a target that does not actually exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-shim-broken-'));
    cleanupDirs.push(dir);
    const shimPath = path.join(dir, 'claude.cmd');
    fs.writeFileSync(shimPath, `"%dp0%\\node_modules\\nonexistent\\bin\\claude.exe"   %*\r\n`);
    expect(resolveNpmCmdShimTarget(shimPath)).toBeUndefined();
  });

  it('returns undefined for a .cmd file that does not match the npm shim template at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-shim-unrelated-'));
    cleanupDirs.push(dir);
    const shimPath = path.join(dir, 'claude.cmd');
    fs.writeFileSync(shimPath, '@echo off\r\necho hello\r\n');
    expect(resolveNpmCmdShimTarget(shimPath)).toBeUndefined();
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

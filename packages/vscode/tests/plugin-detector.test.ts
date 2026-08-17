import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CLIPluginDetector } from '../src/integration/plugin-detector';

// Shims `claude` on PATH with a fake script for the duration of one test,
// so these tests exercise the real execFile()-based CLIPluginDetector
// against controlled output without depending on a real Claude CLI install.

const isWin = process.platform === 'win32';
const cleanupDirs: string[] = [];
const savedPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = savedPath;
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function shimClaude(scriptBody: string): void {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-claude-shim-'));
  cleanupDirs.push(shimDir);
  const shimPath = path.join(shimDir, isWin ? 'claude.cmd' : 'claude');
  fs.writeFileSync(shimPath, scriptBody);
  if (!isWin) fs.chmodSync(shimPath, 0o755);
  process.env.PATH = `${shimDir}${isWin ? ';' : ':'}${savedPath}`;
}

function shimClaudeJson(json: unknown): void {
  // Writing the payload to a file and `type`/`cat`-ing it sidesteps Windows
  // batch `echo`'s fragile quoting rules for arbitrary JSON.
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-claude-shim-'));
  cleanupDirs.push(shimDir);
  const payloadPath = path.join(shimDir, 'payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify(json));
  const shimPath = path.join(shimDir, isWin ? 'claude.cmd' : 'claude');
  fs.writeFileSync(
    shimPath,
    isWin ? `@echo off\r\ntype "${payloadPath}"\r\n` : `#!/bin/sh\ncat "${payloadPath}"\n`
  );
  if (!isWin) fs.chmodSync(shimPath, 0o755);
  process.env.PATH = `${shimDir}${isWin ? ';' : ':'}${savedPath}`;
}

describe('CLIPluginDetector.detect', () => {
  it('reports INSTALLED when claude-relay@clauderelay-oss is present and enabled', async () => {
    shimClaudeJson([
      { id: 'claude-relay@clauderelay-oss', version: '0.2.0', scope: 'user', enabled: true, installPath: '/x' },
      { id: 'some-other-plugin@other', version: '1.0.0', scope: 'user', enabled: true, installPath: '/y' },
    ]);
    expect(await new CLIPluginDetector().detect()).toBe('INSTALLED');
  });

  it('reports INSTALLED_DISABLED when present but disabled', async () => {
    shimClaudeJson([{ id: 'claude-relay@clauderelay-oss', version: '0.2.0', scope: 'user', enabled: false, installPath: '/x' }]);
    expect(await new CLIPluginDetector().detect()).toBe('INSTALLED_DISABLED');
  });

  it('reports NOT_INSTALLED when the plugin is absent from a well-formed list', async () => {
    shimClaudeJson([{ id: 'some-other-plugin@other', version: '1.0.0', scope: 'user', enabled: true, installPath: '/y' }]);
    expect(await new CLIPluginDetector().detect()).toBe('NOT_INSTALLED');
  });

  it('reports NOT_INSTALLED for an empty plugin list', async () => {
    shimClaudeJson([]);
    expect(await new CLIPluginDetector().detect()).toBe('NOT_INSTALLED');
  });

  it('reports UNKNOWN (not NOT_INSTALLED) when the CLI returns malformed JSON', async () => {
    shimClaude(isWin ? '@echo off\r\necho not valid json\r\n' : "#!/bin/sh\necho 'not valid json'\n");
    expect(await new CLIPluginDetector().detect()).toBe('UNKNOWN');
  });

  it('reports UNKNOWN (not NOT_INSTALLED) when the CLI returns a non-array JSON shape', async () => {
    shimClaudeJson({ plugins: [] }); // e.g. a hypothetical future/older CLI wrapping the array
    expect(await new CLIPluginDetector().detect()).toBe('UNKNOWN');
  });

  it('reports UNKNOWN when the claude executable does not exist on PATH', async () => {
    process.env.PATH = isWin ? 'C:\\nonexistent-relay-test-path' : '/nonexistent-relay-test-path';
    expect(await new CLIPluginDetector().detect()).toBe('UNKNOWN');
  });

  it('reports UNKNOWN (bounded, not hung) when the CLI hangs past its timeout', async () => {
    shimClaude(isWin ? '@echo off\r\n:loop\r\ngoto loop\r\n' : '#!/bin/sh\nwhile true; do :; done\n');
    const start = Date.now();
    expect(await new CLIPluginDetector().detect()).toBe('UNKNOWN');
    expect(Date.now() - start).toBeLessThan(10000); // well under a hang; detector's own timeout is 5s
  }, 15000);

  it('caches results for a short window instead of re-spawning claude on every call', async () => {
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-claude-shim-count-'));
    cleanupDirs.push(shimDir);
    const counterFile = path.join(shimDir, 'count.txt');
    fs.writeFileSync(counterFile, '0');
    const payloadPath = path.join(shimDir, 'payload.json');
    fs.writeFileSync(
      payloadPath,
      JSON.stringify([{ id: 'claude-relay@clauderelay-oss', version: '0.2.0', scope: 'user', enabled: true, installPath: '/x' }])
    );
    const shimPath = path.join(shimDir, isWin ? 'claude.cmd' : 'claude');
    if (isWin) {
      fs.writeFileSync(
        shimPath,
        `@echo off\r\nset /p N=<"${counterFile}"\r\nset /a N=%N%+1\r\necho %N% > "${counterFile}"\r\ntype "${payloadPath}"\r\n`
      );
    } else {
      fs.writeFileSync(shimPath, `#!/bin/sh\nN=$(cat "${counterFile}")\necho $((N+1)) > "${counterFile}"\ncat "${payloadPath}"\n`);
      fs.chmodSync(shimPath, 0o755);
    }
    process.env.PATH = `${shimDir}${isWin ? ';' : ':'}${savedPath}`;

    const detector = new CLIPluginDetector();
    await detector.detect();
    await detector.detect();
    await detector.detect();
    expect(fs.readFileSync(counterFile, 'utf-8').trim()).toBe('1');

    detector.invalidate();
    await detector.detect();
    expect(fs.readFileSync(counterFile, 'utf-8').trim()).toBe('2');
  });
});

describe('CLIPluginDetector.detectDetailed', () => {
  it('exposes the installed version alongside status when present and enabled', async () => {
    shimClaudeJson([{ id: 'claude-relay@clauderelay-oss', version: '0.2.1', scope: 'user', enabled: true, installPath: '/x' }]);
    const detail = await new CLIPluginDetector().detectDetailed();
    expect(detail.status).toBe('INSTALLED');
    expect(detail.version).toBe('0.2.1');
  });

  it('exposes the installed version even when disabled', async () => {
    shimClaudeJson([{ id: 'claude-relay@clauderelay-oss', version: '0.2.0', scope: 'user', enabled: false, installPath: '/x' }]);
    const detail = await new CLIPluginDetector().detectDetailed();
    expect(detail.status).toBe('INSTALLED_DISABLED');
    expect(detail.version).toBe('0.2.0');
  });

  it('has no version when the plugin is not installed', async () => {
    shimClaudeJson([]);
    const detail = await new CLIPluginDetector().detectDetailed();
    expect(detail.status).toBe('NOT_INSTALLED');
    expect(detail.version).toBeUndefined();
  });

  it('has no version when the CLI status is UNKNOWN', async () => {
    process.env.PATH = isWin ? 'C:\\nonexistent-relay-test-path' : '/nonexistent-relay-test-path';
    const detail = await new CLIPluginDetector().detectDetailed();
    expect(detail.status).toBe('UNKNOWN');
    expect(detail.version).toBeUndefined();
  });
});

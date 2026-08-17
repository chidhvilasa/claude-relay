import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PluginManager } from '../src/integration/plugin-manager';

// Same shim pattern as plugin-detector.test.ts -- see that file for why
// exec() with a fake claude.cmd/claude shell shim is used instead of mocking.
const isWin = process.platform === 'win32';
const cleanupDirs: string[] = [];
const savedPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = savedPath;
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function shimClaudeJson(json: unknown): void {
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

describe('PluginManager.getPluginHealth (Part 20/25: version-aware, not just presence)', () => {
  it('PLUGIN_OUTDATED for the exact real-world case: installed Plugin 0.2.1', async () => {
    shimClaudeJson([{ id: 'claude-relay@clauderelay-oss', version: '0.2.1', scope: 'user', enabled: true, installPath: '/x' }]);
    const result = await new PluginManager().getPluginHealth();
    expect(result.health).toBe('PLUGIN_OUTDATED');
    expect(result.version).toBe('0.2.1');
  });

  it('PLUGIN_HEALTHY for Plugin 0.2.2', async () => {
    shimClaudeJson([{ id: 'claude-relay@clauderelay-oss', version: '0.2.2', scope: 'user', enabled: true, installPath: '/x' }]);
    const result = await new PluginManager().getPluginHealth();
    expect(result.health).toBe('PLUGIN_HEALTHY');
  });

  it('PLUGIN_MISSING when not installed', async () => {
    shimClaudeJson([]);
    const result = await new PluginManager().getPluginHealth();
    expect(result.health).toBe('PLUGIN_MISSING');
  });

  it('PLUGIN_DISABLED when installed-but-disabled, regardless of version', async () => {
    shimClaudeJson([{ id: 'claude-relay@clauderelay-oss', version: '0.2.2', scope: 'user', enabled: false, installPath: '/x' }]);
    const result = await new PluginManager().getPluginHealth();
    expect(result.health).toBe('PLUGIN_DISABLED');
  });
});

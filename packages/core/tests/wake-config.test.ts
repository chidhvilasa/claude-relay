import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AutomaticWakeConfigManager,
  WAKE_ENV_KEYS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_RESUME_PROMPT,
} from '../src/wake/wake-config';

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.CLAUDE_CONFIG_DIR;
});

function tmpConfigDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wake-config-${name}-`));
  cleanup.push(dir);
  process.env.CLAUDE_CONFIG_DIR = dir;
  return dir;
}

function tmpWorkspace(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wake-workspace-${name}-`));
  cleanup.push(dir);
  return dir;
}

describe('AutomaticWakeConfigManager — user scope', () => {
  it('reports not configured when settings.json does not exist', () => {
    tmpConfigDir('missing');
    const mgr = new AutomaticWakeConfigManager();
    expect(mgr.getStatus('user').configured).toBe(false);
  });

  it('enable() writes exactly the 4 wake keys with sensible defaults', () => {
    const dir = tmpConfigDir('enable');
    const mgr = new AutomaticWakeConfigManager();
    const result = mgr.enable('user');
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8'));
    expect(written.env.CLAUDE_CODE_RETRY_WATCHDOG).toBe('1');
    expect(written.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBe('1');
    expect(written.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS).toBe(String(DEFAULT_MAX_AGE_MS));
    expect(written.env.CLAUDE_CODE_RESUME_PROMPT).toBe(DEFAULT_RESUME_PROMPT);

    const status = mgr.getStatus('user');
    expect(status.configured).toBe(true);
    expect(status.values.CLAUDE_CODE_RETRY_WATCHDOG).toBe('1');
  });

  it('enable() accepts a custom max age and resume prompt', () => {
    tmpConfigDir('custom');
    const mgr = new AutomaticWakeConfigManager();
    mgr.enable('user', undefined, { maxAgeMs: 3600000, resumePrompt: 'Custom prompt.' });
    const status = mgr.getStatus('user');
    expect(status.values.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS).toBe('3600000');
    expect(status.values.CLAUDE_CODE_RESUME_PROMPT).toBe('Custom prompt.');
  });

  it('preserves unrelated settings and unrelated env vars already present', () => {
    const dir = tmpConfigDir('preserve');
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({
        env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
        theme: 'dark',
        enabledPlugins: { 'claude-mem@thedotmack': true },
      }, null, 2)
    );

    const mgr = new AutomaticWakeConfigManager();
    mgr.enable('user');

    const written = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8'));
    expect(written.theme).toBe('dark');
    expect(written.enabledPlugins['claude-mem@thedotmack']).toBe(true);
    expect(written.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    expect(written.env.CLAUDE_CODE_RETRY_WATCHDOG).toBe('1');
  });

  it('disable() removes exactly the wake keys and nothing else', () => {
    const dir = tmpConfigDir('disable');
    const mgr = new AutomaticWakeConfigManager();
    mgr.enable('user');
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8').replace('"env": {', '"env": {\n    "MY_OTHER_VAR": "keep-me",')
    );

    const disableResult = mgr.disable('user');
    expect(disableResult.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8'));
    for (const key of WAKE_ENV_KEYS) {
      expect(written.env[key]).toBeUndefined();
    }
    expect(written.env.MY_OTHER_VAR).toBe('keep-me');
    expect(mgr.getStatus('user').configured).toBe(false);
  });

  it('disable() drops the env object entirely if it becomes empty', () => {
    const dir = tmpConfigDir('disable-empty');
    const mgr = new AutomaticWakeConfigManager();
    mgr.enable('user');
    mgr.disable('user');
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8'));
    expect(written.env).toBeUndefined();
  });

  it('disable() on a settings file with no env block is a safe no-op', () => {
    const dir = tmpConfigDir('disable-noop');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
    const mgr = new AutomaticWakeConfigManager();
    const result = mgr.disable('user');
    expect(result.success).toBe(true);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8'));
    expect(written.theme).toBe('dark');
  });

  it('creates a timestamped backup before modifying an existing settings.json', () => {
    const dir = tmpConfigDir('backup');
    const original = JSON.stringify({ theme: 'dark' }, null, 2);
    fs.writeFileSync(path.join(dir, 'settings.json'), original);

    const mgr = new AutomaticWakeConfigManager();
    mgr.enable('user');

    const backups = fs.readdirSync(dir).filter(f => f.startsWith('settings.json.backup-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf-8')).toBe(original);
  });

  it('writes atomically: no leftover .tmp file after enable/disable', () => {
    const dir = tmpConfigDir('atomic');
    const mgr = new AutomaticWakeConfigManager();
    mgr.enable('user');
    mgr.disable('user');
    const leftovers = fs.readdirSync(dir).filter(f => f.includes('.tmp.'));
    expect(leftovers).toHaveLength(0);
  });

  it('fails safely (does not throw, does not corrupt the file) on malformed JSON', () => {
    const dir = tmpConfigDir('malformed');
    fs.writeFileSync(path.join(dir, 'settings.json'), '{not valid json');
    const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8');

    const mgr = new AutomaticWakeConfigManager();
    const result = mgr.enable('user');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8')).toBe(before);
  });
});

describe('AutomaticWakeConfigManager — workspace scope', () => {
  it('writes to <workspace>/.claude/settings.local.json, not settings.json', () => {
    const ws = tmpWorkspace('scope');
    const mgr = new AutomaticWakeConfigManager();
    const result = mgr.enable('workspace', ws);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(ws, '.claude', 'settings.local.json'))).toBe(true);
    expect(fs.existsSync(path.join(ws, '.claude', 'settings.json'))).toBe(false);
  });

  it('creates the .claude directory if it does not exist', () => {
    const ws = tmpWorkspace('mkdir');
    expect(fs.existsSync(path.join(ws, '.claude'))).toBe(false);
    const mgr = new AutomaticWakeConfigManager();
    mgr.enable('workspace', ws);
    expect(fs.existsSync(path.join(ws, '.claude'))).toBe(true);
  });

  it('user scope and workspace scope are fully independent', () => {
    tmpConfigDir('independent-user');
    const ws = tmpWorkspace('independent-ws');
    const mgr = new AutomaticWakeConfigManager();

    mgr.enable('workspace', ws);
    expect(mgr.getStatus('user').configured).toBe(false);
    expect(mgr.getStatus('workspace', ws).configured).toBe(true);
  });

  it('throws a clear error if workspaceRoot is omitted for scope "workspace"', () => {
    const mgr = new AutomaticWakeConfigManager();
    expect(mgr.enable('workspace').success).toBe(false);
  });
});

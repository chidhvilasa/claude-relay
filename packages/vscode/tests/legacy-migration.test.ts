import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LegacyMigrator } from '../src/integration/legacy-migrator';
import { LegacyDetector } from '../src/integration/legacy-detector';

// LegacyMigrator/LegacyDetector read/write ~/.claude/settings.json — a file
// Relay does not own. CLAUDE_CONFIG_DIR redirects that to an isolated temp
// directory for these tests, so nothing here ever touches a real machine's
// actual Claude settings.

let configDir: string;
let settingsPath: string;
const savedEnv = process.env.CLAUDE_CONFIG_DIR;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-legacy-migration-'));
  settingsPath = path.join(configDir, 'settings.json');
  process.env.CLAUDE_CONFIG_DIR = configDir;
});

afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedEnv;
});

function writeSettings(obj: unknown) {
  fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2), 'utf-8');
}

describe('LegacyDetector.detectLegacyHooks', () => {
  it('returns false when no settings.json exists', () => {
    expect(new LegacyDetector().detectLegacyHooks()).toBe(false);
  });

  it('returns false when settings.json has no hooks', () => {
    writeSettings({ someOtherSetting: true });
    expect(new LegacyDetector().detectLegacyHooks()).toBe(false);
  });

  it('returns false when hooks exist but none are Relay-owned', () => {
    writeSettings({ hooks: { SessionStart: [{ command: 'some-other-tool --run' }] } });
    expect(new LegacyDetector().detectLegacyHooks()).toBe(false);
  });

  it('returns true when a Relay-owned hook is present', () => {
    writeSettings({ hooks: { PreCompact: [{ command: 'node .../clauderelay-oss.claude-relay/hook.js' }] } });
    expect(new LegacyDetector().detectLegacyHooks()).toBe(true);
  });

  it('returns false (not true) on malformed JSON — degrades safely rather than crashing', () => {
    fs.writeFileSync(settingsPath, '{not valid json', 'utf-8');
    expect(new LegacyDetector().detectLegacyHooks()).toBe(false);
  });
});

describe('LegacyMigrator.migrate', () => {
  it('succeeds as a no-op when there is no settings.json', async () => {
    const result = await new LegacyMigrator().migrate();
    expect(result.success).toBe(true);
  });

  it('removes only Relay-owned hook entries, preserving unrelated hooks and settings', async () => {
    writeSettings({
      someUnrelatedSetting: 'keep-me',
      hooks: {
        SessionStart: [
          { command: 'node .../clauderelay-oss.claude-relay/hook.js' },
          { command: 'some-other-tool --on-start' },
        ],
        PreCompact: [{ command: 'node .../clauderelay-oss.claude-relay/hook.js' }],
        UnrelatedEvent: [{ command: 'totally-unrelated-hook' }],
      },
    });

    const result = await new LegacyMigrator().migrate();
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.someUnrelatedSetting).toBe('keep-me');
    expect(written.hooks.SessionStart).toEqual([{ command: 'some-other-tool --on-start' }]);
    expect(written.hooks.PreCompact).toBeUndefined(); // fully emptied, so key is dropped
    expect(written.hooks.UnrelatedEvent).toEqual([{ command: 'totally-unrelated-hook' }]);
  });

  it('preserves unknown/future top-level fields it does not understand', async () => {
    writeSettings({
      hooks: { PreCompact: [{ command: 'clauderelay-oss.claude-relay hook' }] },
      someFutureField: { nested: { data: [1, 2, 3] } },
    });
    await new LegacyMigrator().migrate();
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.someFutureField).toEqual({ nested: { data: [1, 2, 3] } });
  });

  it('drops the hooks key entirely when every hook was Relay-owned', async () => {
    writeSettings({ hooks: { PreCompact: [{ command: 'clauderelay-oss.claude-relay hook' }] } });
    await new LegacyMigrator().migrate();
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.hooks).toBeUndefined();
  });

  it('creates a timestamped backup before writing', async () => {
    writeSettings({ hooks: { PreCompact: [{ command: 'clauderelay-oss.claude-relay hook' }] } });
    const originalContent = fs.readFileSync(settingsPath, 'utf-8');

    await new LegacyMigrator().migrate();

    const backups = fs.readdirSync(configDir).filter(f => f.startsWith('settings.json.backup-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(configDir, backups[0]), 'utf-8')).toBe(originalContent);
  });

  it('fails safely (does not throw, does not corrupt the file) on malformed JSON', async () => {
    fs.writeFileSync(settingsPath, '{not valid json', 'utf-8');
    const before = fs.readFileSync(settingsPath, 'utf-8');

    const result = await new LegacyMigrator().migrate();

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // The original (malformed) file is untouched — atomic write means a
    // failed migration never partially overwrites it.
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(before);
  });

  it('writes atomically: no leftover .tmp file after a successful migration', async () => {
    writeSettings({ hooks: { PreCompact: [{ command: 'clauderelay-oss.claude-relay hook' }] } });
    await new LegacyMigrator().migrate();
    const leftoverTemp = fs.readdirSync(configDir).filter(f => f.includes('.tmp.'));
    expect(leftoverTemp).toHaveLength(0);
  });

  it('is idempotent: running twice on already-clean settings changes nothing further', async () => {
    writeSettings({ hooks: { SessionStart: [{ command: 'unrelated-hook' }] } });
    await new LegacyMigrator().migrate();
    const afterFirst = fs.readFileSync(settingsPath, 'utf-8');
    await new LegacyMigrator().migrate();
    const afterSecond = fs.readFileSync(settingsPath, 'utf-8');
    expect(afterSecond).toBe(afterFirst);
  });
});

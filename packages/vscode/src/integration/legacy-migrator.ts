import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export class LegacyMigrator {
  private getSettingsPath(): string {
    return process.env.CLAUDE_CONFIG_DIR 
      ? path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
      : path.join(os.homedir(), '.claude', 'settings.json');
  }

  public async migrate(): Promise<{ success: boolean; error?: string }> {
    const settingsPath = this.getSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return { success: true };
    }

    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      
      // Backup
      const backupPath = `${settingsPath}.backup-${Date.now()}`;
      fs.writeFileSync(backupPath, content, 'utf8');

      const settings = JSON.parse(content);
      if (!settings.hooks) return { success: true };

      const newHooks: any = {};
      const hooksToMigrate = ['SessionStart', 'PreCompact', 'PostCompact', 'Stop', 'StopFailure', 'SessionEnd'];

      for (const [hookName, hookEntries] of Object.entries(settings.hooks)) {
        if (!hooksToMigrate.includes(hookName) || !Array.isArray(hookEntries)) {
          newHooks[hookName] = hookEntries;
          continue;
        }

        const filteredEntries = hookEntries.filter((entry: any) => {
          const entryStr = JSON.stringify(entry);
          // Only remove entries injected by our VS Code extension
          return !(entryStr.includes('anthropic.claude-relay') || entryStr.includes('clauderelay-oss.claude-relay'));
        });

        if (filteredEntries.length > 0) {
          newHooks[hookName] = filteredEntries;
        }
      }

      if (Object.keys(newHooks).length === 0) {
        delete settings.hooks;
      } else {
        settings.hooks = newHooks;
      }

      // Atomic write: settings.json is a shared file owned by the user (not
      // just Relay), so a crash mid-write must never leave it truncated or
      // corrupted. Write to a temp file in the same directory, then rename.
      const tempPath = `${settingsPath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), 'utf8');
      fs.renameSync(tempPath, settingsPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}

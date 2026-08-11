import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class LegacyDetector {
  private getSettingsPath(): string {
    return process.env.CLAUDE_CONFIG_DIR 
      ? path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
      : path.join(os.homedir(), '.claude', 'settings.json');
  }

  public detectLegacyHooks(): boolean {
    const settingsPath = this.getSettingsPath();
    if (!fs.existsSync(settingsPath)) return false;

    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(content);
      if (!settings.hooks) return false;
      
      // Look for hooks that contain the old VS Code extension hook runner execution
      const hooksStr = JSON.stringify(settings.hooks);
      if (hooksStr.includes('anthropic.claude-relay') || hooksStr.includes('clauderelay-oss.claude-relay')) {
         return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
}

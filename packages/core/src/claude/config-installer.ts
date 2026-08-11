import * as fs from 'fs';
import * as path from 'path';

export class ClaudeConfigInstaller {
  private readonly settingsPath: string;
  private readonly relayHomeDir: string;

  constructor(private readonly userHomeDir: string) {
    this.settingsPath = path.join(userHomeDir, '.claude', 'settings.json');
    this.relayHomeDir = path.join(userHomeDir, '.claude', 'relay');
  }

  async installIntegration(runnerSourcePath: string, skillSourcePath: string): Promise<boolean> {
    const runtimeDir = path.join(this.relayHomeDir, 'runtime');
    const skillDir = path.join(this.relayHomeDir, 'skill');
    
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });

    const runnerDest = path.join(runtimeDir, 'hook-runner-standalone.js');
    fs.copyFileSync(runnerSourcePath, runnerDest);
    fs.copyFileSync(skillSourcePath, path.join(skillDir, 'SKILL.md'));

    return this.mergeSettings(runnerDest);
  }

  private async mergeSettings(runnerDest: string): Promise<boolean> {
    if (!fs.existsSync(this.settingsPath)) {
      return false;
    }

    const backupPath = `${this.settingsPath}.backup-${Date.now()}`;
    const tempPath = `${this.settingsPath}.tmp`;

    try {
      fs.copyFileSync(this.settingsPath, backupPath);
      const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));

      if (!settings.hooks) settings.hooks = {};

      const hooksToInstall = ['SessionStart', 'PreCompact', 'PostCompact', 'Stop', 'StopFailure', 'SessionEnd'];
      const commandPath = process.platform === 'win32' ? `node "${runnerDest}"` : `node '${runnerDest}'`;

      for (const hook of hooksToInstall) {
        if (!settings.hooks[hook]) settings.hooks[hook] = [];
        
        // Remove existing relay hooks first to ensure idempotency
        settings.hooks[hook] = settings.hooks[hook].filter((h: any) => {
          return !(h.hooks && h.hooks.some((sub: any) => sub.command && sub.command.includes('hook-runner.cjs')));
        });

        // Add the new relay hook
        settings.hooks[hook].push({
          matcher: "",
          hooks: [{ type: "command", command: commandPath, timeout: 10000 }]
        });
      }

      fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.settingsPath);
      return true;
    } catch (e) {
      if (fs.existsSync(backupPath) && fs.existsSync(this.settingsPath)) {
        fs.copyFileSync(backupPath, this.settingsPath);
      }
      return false;
    }
  }

  async uninstallIntegration(): Promise<boolean> {
    if (!fs.existsSync(this.settingsPath)) return true;
    
    const tempPath = `${this.settingsPath}.tmp`;
    try {
      const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
      if (settings.hooks) {
        for (const hook of Object.keys(settings.hooks)) {
          settings.hooks[hook] = settings.hooks[hook].filter((h: any) => {
            return !(h.hooks && h.hooks.some((sub: any) => sub.command && sub.command.includes('hook-runner.cjs')));
          });
        }
      }
      fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.settingsPath);

      // Clean up runtime files
      fs.rmSync(path.join(this.relayHomeDir, 'runtime'), { recursive: true, force: true });
      fs.rmSync(path.join(this.relayHomeDir, 'skill'), { recursive: true, force: true });
      
      return true;
    } catch {
      return false;
    }
  }
}


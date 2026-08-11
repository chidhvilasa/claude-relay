import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type ClaudePluginStatus = 
  | 'NOT_INSTALLED'
  | 'INSTALLED'
  | 'INSTALLED_DISABLED'
  | 'LEGACY_INTEGRATION'
  | 'PLUGIN_AND_LEGACY_CONFLICT'
  | 'BROKEN'
  | 'UNKNOWN';

export interface ClaudePluginDetector {
  detect(): Promise<ClaudePluginStatus>;
}

interface ClaudePluginData {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
}

export class CLIPluginDetector implements ClaudePluginDetector {
  async detect(): Promise<ClaudePluginStatus> {
    try {
      const { stdout } = await execAsync('claude plugin list --json');
      const plugins: ClaudePluginData[] = JSON.parse(stdout);
      
      const relayPlugin = plugins.find(p => p.id === 'claude-relay@clauderelay-oss' || p.id.startsWith('claude-relay@'));
      if (relayPlugin) {
        return relayPlugin.enabled ? 'INSTALLED' : 'INSTALLED_DISABLED';
      }
      return 'NOT_INSTALLED';
    } catch (e) {
      // If CLI fails, we cannot reliably detect via JSON.
      return 'UNKNOWN';
    }
  }
}

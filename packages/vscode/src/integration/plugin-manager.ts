import { ClaudePluginStatus, CLIPluginDetector } from './plugin-detector';
import { LegacyDetector } from './legacy-detector';

export class PluginManager {
  private pluginDetector = new CLIPluginDetector();
  private legacyDetector = new LegacyDetector();

  public async getOverallStatus(): Promise<ClaudePluginStatus> {
    const pluginStatus = await this.pluginDetector.detect();
    const hasLegacy = this.legacyDetector.detectLegacyHooks();

    if (hasLegacy) {
      if (pluginStatus === 'INSTALLED' || pluginStatus === 'INSTALLED_DISABLED') {
        return 'PLUGIN_AND_LEGACY_CONFLICT';
      }
      return 'LEGACY_INTEGRATION';
    }

    return pluginStatus;
  }

  /** Call after migration, plugin install/uninstall, or a manual refresh so the next status check re-queries the CLI. */
  public invalidate(): void {
    this.pluginDetector.invalidate();
  }
}

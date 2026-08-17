import { ClaudePluginStatus, CLIPluginDetector } from './plugin-detector';
import { LegacyDetector } from './legacy-detector';
import { classifyPluginHealth, PluginHealthStatus } from './plugin-version';

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

  /** Version-aware health on top of getOverallStatus() — is the installed Plugin new enough, not just present (Part 20/25). */
  public async getPluginHealth(): Promise<{ health: PluginHealthStatus; version?: string }> {
    const overall = await this.getOverallStatus();
    // getOverallStatus() folds legacy-conflict states in; re-query the raw
    // detail only when that hasn't already produced a distinct legacy
    // status, so a legacy conflict is never misreported as an outdated
    // (or healthy) plugin version.
    if (overall === 'LEGACY_INTEGRATION' || overall === 'PLUGIN_AND_LEGACY_CONFLICT') {
      return { health: 'PLUGIN_UNKNOWN' };
    }
    const detail = await this.pluginDetector.detectDetailed();
    return { health: classifyPluginHealth(detail.status, detail.version), version: detail.version };
  }

  /** Call after migration, plugin install/uninstall, or a manual refresh so the next status check re-queries the CLI. */
  public invalidate(): void {
    this.pluginDetector.invalidate();
  }
}

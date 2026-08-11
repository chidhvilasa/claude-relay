import { UsageProvider, UsageSnapshot } from '../models/types';

export class NullUsageProvider implements UsageProvider {
  readonly id = 'NullUsageProvider';

  async isAvailable(): Promise<boolean> {
    return true; // Always available as a fallback
  }

  async getUsage(): Promise<UsageSnapshot | null> {
    // Exact percentage is unavailable, return null to avoid fabricating data
    return {
      contextPercent: null,
      fiveHourPercent: null,
      provider: this.id
    };
  }
}

export class HookMetadataProvider implements UsageProvider {
  readonly id = 'HookMetadataProvider';
  private latestSnapshot: UsageSnapshot | null = null;

  async isAvailable(): Promise<boolean> {
    // In a real scenario, this might check if the hook has ever fired
    return true;
  }

  async getUsage(): Promise<UsageSnapshot | null> {
    return this.latestSnapshot;
  }

  updateSnapshot(snapshot: UsageSnapshot) {
    this.latestSnapshot = snapshot;
  }
}

export class CompositeUsageProvider implements UsageProvider {
  readonly id = 'CompositeUsageProvider';

  constructor(private readonly providers: UsageProvider[]) {}

  async isAvailable(): Promise<boolean> {
    return this.providers.length > 0;
  }

  async getUsage(): Promise<UsageSnapshot | null> {
    for (const provider of this.providers) {
      if (await provider.isAvailable()) {
        const usage = await provider.getUsage();
        if (usage && (usage.contextPercent !== null || usage.fiveHourPercent !== null)) {
          return usage;
        }
      }
    }
    // Fallback if none provide valid data
    return {
      contextPercent: null,
      fiveHourPercent: null,
      provider: 'None'
    };
  }
}

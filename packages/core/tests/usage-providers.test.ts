import { describe, it, expect } from 'vitest';
import { NullUsageProvider } from '../src/usage/providers';

describe('Usage Providers', () => {
  it('NullUsageProvider safely degrades and returns nulls', async () => {
    const provider = new NullUsageProvider();
    expect(await provider.isAvailable()).toBe(true);
    
    const usage = await provider.getUsage();
    expect(usage?.contextPercent).toBeNull();
    expect(usage?.fiveHourPercent).toBeNull();
  });
});

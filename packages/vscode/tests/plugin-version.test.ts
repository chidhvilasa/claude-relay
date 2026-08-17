import { describe, it, expect } from 'vitest';
import { isVersionAtLeast, classifyPluginHealth, MINIMUM_HEALTHY_PLUGIN_VERSION } from '../src/integration/plugin-version';

describe('isVersionAtLeast', () => {
  it('true for an exact match', () => {
    expect(isVersionAtLeast('0.2.2', '0.2.2')).toBe(true);
  });

  it('true for a higher patch version', () => {
    expect(isVersionAtLeast('0.2.3', '0.2.2')).toBe(true);
  });

  it('true for a higher minor version', () => {
    expect(isVersionAtLeast('0.3.0', '0.2.2')).toBe(true);
  });

  it('false for a lower patch version (the exact real-world case: 0.2.1 vs required 0.2.2)', () => {
    expect(isVersionAtLeast('0.2.1', '0.2.2')).toBe(false);
  });

  it('false for a lower minor version even with a higher patch (0.1.9 vs 0.2.2)', () => {
    expect(isVersionAtLeast('0.1.9', '0.2.2')).toBe(false);
  });

  it('does not use naive string comparison (0.10.0 must beat 0.2.2 numerically, not lexicographically)', () => {
    // "0.10.0" < "0.2.2" as strings, but 10 > 2 numerically -- this is
    // exactly the naive-string-comparison bug Part 20 explicitly warns
    // against, pinned as a real regression test rather than just described.
    expect(isVersionAtLeast('0.10.0', '0.2.2')).toBe(true);
  });

  it('false for an unparseable version string, never throws', () => {
    expect(isVersionAtLeast('not-a-version', '0.2.2')).toBe(false);
    expect(isVersionAtLeast('', '0.2.2')).toBe(false);
  });

  it('tolerates a pre-release suffix by comparing the numeric prefix', () => {
    expect(isVersionAtLeast('0.3.0-dev', '0.2.2')).toBe(true);
  });
});

describe('classifyPluginHealth', () => {
  it('PLUGIN_MISSING when not installed', () => {
    expect(classifyPluginHealth('NOT_INSTALLED', undefined)).toBe('PLUGIN_MISSING');
  });

  it('PLUGIN_DISABLED when installed but disabled, regardless of version', () => {
    expect(classifyPluginHealth('INSTALLED_DISABLED', '0.2.2')).toBe('PLUGIN_DISABLED');
  });

  it('PLUGIN_OUTDATED for the exact real-world case: installed 0.2.1', () => {
    expect(classifyPluginHealth('INSTALLED', '0.2.1')).toBe('PLUGIN_OUTDATED');
  });

  it('PLUGIN_OUTDATED for 0.2.0 too', () => {
    expect(classifyPluginHealth('INSTALLED', '0.2.0')).toBe('PLUGIN_OUTDATED');
  });

  it('PLUGIN_HEALTHY for the minimum healthy version itself', () => {
    expect(classifyPluginHealth('INSTALLED', MINIMUM_HEALTHY_PLUGIN_VERSION)).toBe('PLUGIN_HEALTHY');
  });

  it('PLUGIN_HEALTHY for a newer version', () => {
    expect(classifyPluginHealth('INSTALLED', '0.3.0')).toBe('PLUGIN_HEALTHY');
  });

  it('PLUGIN_UNKNOWN when installed but no version could be determined -- never assumes healthy', () => {
    expect(classifyPluginHealth('INSTALLED', undefined)).toBe('PLUGIN_UNKNOWN');
  });

  it('PLUGIN_UNKNOWN for CLI-unknown/broken status', () => {
    expect(classifyPluginHealth('UNKNOWN', undefined)).toBe('PLUGIN_UNKNOWN');
    expect(classifyPluginHealth('BROKEN', undefined)).toBe('PLUGIN_UNKNOWN');
  });

  it('PLUGIN_UNKNOWN (not a false PLUGIN_HEALTHY/PLUGIN_OUTDATED) for legacy-integration states', () => {
    expect(classifyPluginHealth('LEGACY_INTEGRATION', undefined)).toBe('PLUGIN_UNKNOWN');
    expect(classifyPluginHealth('PLUGIN_AND_LEGACY_CONFLICT', '0.2.1')).toBe('PLUGIN_UNKNOWN');
  });

  it('accepts a custom minimum-healthy version', () => {
    expect(classifyPluginHealth('INSTALLED', '0.2.2', '0.3.0')).toBe('PLUGIN_OUTDATED');
    expect(classifyPluginHealth('INSTALLED', '0.3.0', '0.3.0')).toBe('PLUGIN_HEALTHY');
  });
});

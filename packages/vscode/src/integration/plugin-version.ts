import { ClaudePluginStatus } from './plugin-detector';

/**
 * Companion-facing classification of the installed Plugin's health, distinct
 * from the raw `ClaudePluginStatus` the CLI detector reports — this layer
 * adds the version-compatibility question ("is 0.2.1 good enough?") on top
 * of the presence question ("is it installed at all?"). Part 20.
 */
export type PluginHealthStatus =
  | 'PLUGIN_MISSING'
  | 'PLUGIN_OUTDATED'
  | 'PLUGIN_HEALTHY'
  | 'PLUGIN_DISABLED'
  | 'PLUGIN_UNKNOWN';

/** The lowest Plugin version this Companion release considers healthy — the hook_event_name fix landed in 0.2.2. */
export const MINIMUM_HEALTHY_PLUGIN_VERSION = '0.2.2';

/**
 * Parses a `major.minor.patch` version string. Deliberately not a general
 * semver library (no dependency added for three numbers) — returns `null`
 * for anything that doesn't parse cleanly, so a malformed/future version
 * string never gets silently coerced into a wrong comparison result.
 */
function parseVersion(v: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True if `version` is >= `minimum`, using numeric (not string) comparison. Returns `false` (never throws) for an unparseable version — conservatively treated as not meeting the bar. */
export function isVersionAtLeast(version: string, minimum: string): boolean {
  const v = parseVersion(version);
  const m = parseVersion(minimum);
  if (!v || !m) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] > m[i]) return true;
    if (v[i] < m[i]) return false;
  }
  return true; // exactly equal
}

/**
 * Classifies overall Plugin health from the raw CLI-detected status plus its
 * version string. Never claims HEALTHY on a guess — an installed-but-
 * unparseable version is treated as OUTDATED (fail closed, don't assume a
 * weird version string is fine).
 */
export function classifyPluginHealth(status: ClaudePluginStatus, version: string | undefined, minimumHealthy: string = MINIMUM_HEALTHY_PLUGIN_VERSION): PluginHealthStatus {
  switch (status) {
    case 'NOT_INSTALLED':
      return 'PLUGIN_MISSING';
    case 'INSTALLED_DISABLED':
      return 'PLUGIN_DISABLED';
    case 'UNKNOWN':
    case 'BROKEN':
      return 'PLUGIN_UNKNOWN';
    case 'LEGACY_INTEGRATION':
    case 'PLUGIN_AND_LEGACY_CONFLICT':
      // Not a version question — a distinct migration concern the existing
      // legacy-migration UX already owns. Reported as unknown here rather
      // than misclassified as outdated/healthy.
      return 'PLUGIN_UNKNOWN';
    case 'INSTALLED':
      if (!version) return 'PLUGIN_UNKNOWN';
      return isVersionAtLeast(version, minimumHealthy) ? 'PLUGIN_HEALTHY' : 'PLUGIN_OUTDATED';
    default:
      return 'PLUGIN_UNKNOWN';
  }
}

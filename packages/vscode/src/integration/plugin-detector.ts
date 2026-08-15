import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const CLAUDE_CLI_TIMEOUT_MS = 5000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024; // 2 MB

// The exact, fully-literal command this module ever runs. No argument here
// is ever built from user input, repo content, or anything else outside
// this file, so there is nothing to inject — the same property the original
// pre-hardening exec('claude plugin list --json') already had.
const CLAUDE_PLUGIN_LIST_COMMAND = 'claude plugin list --json';

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
  invalidate(): void;
}

interface ClaudePluginData {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
}

// Short-lived cache so rapid, back-to-back refreshes (e.g. VS Code re-rendering
// the dashboard tree view) don't each spawn a fresh `claude` process. Any
// action that could change plugin status (manual refresh, migration, install)
// must call invalidate().
const CACHE_TTL_MS = 3000;

export class CLIPluginDetector implements ClaudePluginDetector {
  private cached: { status: ClaudePluginStatus; expiresAt: number } | null = null;

  invalidate(): void {
    this.cached = null;
  }

  async detect(): Promise<ClaudePluginStatus> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.status;
    }

    const status = await this.detectUncached();
    this.cached = { status, expiresAt: Date.now() + CACHE_TTL_MS };
    return status;
  }

  private async detectUncached(): Promise<ClaudePluginStatus> {
    try {
      // Deliberately exec() with a static string, not execFile() with an
      // args array. Two things were tried and rejected first:
      //   - execFile('claude', [...], { shell: false }): fails with ENOENT
      //     on Windows for any `claude` installed via `npm install -g`,
      //     which produces a `.cmd` shim — Win32 CreateProcess (what
      //     execFile uses under shell:false) doesn't do PATHEXT resolution
      //     the way a shell does. Reproduced directly.
      //   - execFile('claude', [...], { shell: true }): "fixes" the above,
      //     but Node's own DEP0190 warning flags array-args-with-shell:true
      //     as unescaped/concatenated, not safely quoted — the opposite of
      //     what an earlier version of this comment claimed. Node also
      //     hard-rejects execFile('claude.cmd', [...], { shell: false })
      //     with EINVAL (the CVE-2024-27980 mitigation), so there's no
      //     shell:false path that reaches a .cmd shim at all.
      // exec() with a single command string sidesteps all of it and is
      // exactly as safe as before: CLAUDE_PLUGIN_LIST_COMMAND is a fixed
      // literal, never built from user/repo input, so there is nothing to
      // inject regardless of platform or shell.
      const { stdout } = await execAsync(CLAUDE_PLUGIN_LIST_COMMAND, {
        timeout: CLAUDE_CLI_TIMEOUT_MS,
        maxBuffer: MAX_STDOUT_BYTES,
      });
      const plugins: unknown = JSON.parse(stdout);

      if (!Array.isArray(plugins)) {
        // Unexpected shape (e.g. a future/older CLI version) — we cannot
        // reliably conclude the plugin is absent, so report UNKNOWN rather
        // than NOT_INSTALLED.
        return 'UNKNOWN';
      }

      const relayPlugin = (plugins as ClaudePluginData[]).find(
        p => typeof p?.id === 'string' && (p.id === 'claude-relay@clauderelay-oss' || p.id.startsWith('claude-relay@'))
      );
      if (relayPlugin) {
        return relayPlugin.enabled ? 'INSTALLED' : 'INSTALLED_DISABLED';
      }
      return 'NOT_INSTALLED';
    } catch (e) {
      // CLI missing, timed out, or returned unparseable output — we cannot
      // reliably detect either way.
      return 'UNKNOWN';
    }
  }
}

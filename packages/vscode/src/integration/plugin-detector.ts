import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const CLAUDE_CLI_TIMEOUT_MS = 5000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024; // 2 MB

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
      const { stdout } = await execFileAsync('claude', ['plugin', 'list', '--json'], {
        timeout: CLAUDE_CLI_TIMEOUT_MS,
        maxBuffer: MAX_STDOUT_BYTES,
        // Windows-installed CLIs (e.g. `npm install -g`) commonly resolve to
        // a `.cmd`/`.bat` shim, and Win32's CreateProcess — what execFile
        // uses under shell:false — does not do PATHEXT resolution the way
        // cmd.exe does, so shell:false here produces a plain ENOENT even
        // when `claude` is genuinely installed and on PATH (reproduced: a
        // real `claude.cmd` npm shim fails to spawn with shell:false).
        // shell:true is required on Windows for that resolution to happen.
        // This remains safe from injection: every argument here is a fixed
        // literal (never user/repo-controlled), and Node quotes array
        // arguments passed to a Windows shell rather than concatenating a
        // raw string, unlike the original exec('claude plugin list --json').
        shell: process.platform === 'win32',
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

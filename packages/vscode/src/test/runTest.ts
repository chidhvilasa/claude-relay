import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // In some sandboxed/headless dev environments (this one included),
    // ELECTRON_RUN_AS_NODE=1 is set globally so that any Electron binary a
    // tool spawns runs as plain Node instead of launching its GUI shell.
    // That's usually the right default, but it silently breaks the
    // downloaded VS Code test binary: `Code.exe` runs as bare Node, prints a
    // Node version for `--version`, and rejects every VS Code CLI flag
    // ("bad option: --user-data-dir") instead of launching VS Code at all.
    // The extension-host test process specifically needs the real thing.
    delete process.env.ELECTRON_RUN_AS_NODE;

    // Download cache lives in a *stable* OS-temp location, outside the repo,
    // so it survives across runs (re-downloading VS Code every run would be
    // slow) while sidestepping the real failure mode seen with a repo-local
    // .vscode-test/ cache: it got locked ("Device or resource busy") by an
    // unrelated already-running Code.exe process — plausibly even the
    // developer's own editor — and every subsequent run failed with no clear
    // signal why. A path outside the repo, not shared with anything else,
    // is far less likely to collide with another process's open handle.
    //
    // user-data-dir/extensions-dir are still fresh per run (cheap to create)
    // so no state leaks between test runs, and are cleaned up on exit.
    const cachePath = path.join(os.tmpdir(), 'claude-relay-vscode-test-cache');
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-relay-vscode-test-profile-'));
    const userDataDir = path.join(runRoot, 'user-data');
    const extensionsDir = path.join(runRoot, 'extensions');

    try {
      await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        cachePath,
        launchArgs: [
          '--user-data-dir', userDataDir,
          '--extensions-dir', extensionsDir,
        ],
      });
    } finally {
      // The extension host process can hold its own log file open for a
      // moment after runTests() resolves, so an immediate rmSync can hit a
      // transient EBUSY/EPERM on Windows. maxRetries/retryDelay absorb that;
      // if cleanup still fails, it must never be reported as a test failure
      // — a leftover temp profile dir is a tidiness issue, not a correctness
      // one (this was caught for real: a passing 4/4 run was previously
      // reported as failed solely because cleanup raced a log file handle).
      try {
        fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (cleanupErr) {
        console.warn('Warning: could not fully clean up test profile dir:', runRoot, cleanupErr);
      }
    }
  } catch (err) {
    console.error('Failed to run tests:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();

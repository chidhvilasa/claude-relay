import * as fs from 'fs';
import * as path from 'path';

/**
 * Ensures `<workspacePath>/.relay/.gitignore` exists with `*`, so Relay's own
 * checkpoints/handoffs/WAKEUP.md never show up in `git status`.
 *
 * This matters beyond tidiness: StaleDetector compares dirty-file *counts*
 * between the moment a handoff was created and the moment it's evaluated for
 * freshness. Without this, the act of writing a checkpoint or handoff adds a
 * new untracked entry (git reports untracked directories as a single `??
 * .relay/` line) — so a handoff could be reported POSSIBLY_STALE seconds
 * after being created, in any project that hasn't manually gitignored
 * `.relay/`, purely because Relay's own write changed the count. Self-
 * gitignoring removes Relay's own writes from git's status output entirely,
 * so only real user changes affect freshness.
 */
export function ensureRelayGitignore(workspacePath: string): void {
  const relayDir = path.join(workspacePath, '.relay');
  const gitignorePath = path.join(relayDir, '.gitignore');
  try {
    if (!fs.existsSync(relayDir)) {
      fs.mkdirSync(relayDir, { recursive: true });
    }
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '*\n', 'utf-8');
    }
  } catch {
    // Best-effort: if this fails (e.g. read-only filesystem), the caller's
    // own directory creation will surface the real error.
  }
}

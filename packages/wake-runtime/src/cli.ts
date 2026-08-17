import { WakeController, defaultGetGitDir } from './wake-controller';
import { realGitSnapshot } from './real-git';

/**
 * Standalone entrypoint: `node wake-runtime-cli.js <workspaceRoot> <sessionId>`.
 * No UI, no HTTP, no interactive prompts — prints one JSON line describing
 * what happened and exits. This is what a Level 3 (VS Code Companion
 * activation) or a future opt-in Level 4 scheduler would invoke; neither is
 * wired up to actually call this automatically yet in this pass (see the
 * final report — Level 3/4 triggering remains undone; this CLI is the
 * complete, tested Level 2 engine those levels would eventually call into).
 */
async function main() {
  const [workspaceRoot, sessionId] = process.argv.slice(2);
  if (!workspaceRoot || !sessionId) {
    process.stdout.write(JSON.stringify({ action: 'noop', reason: 'usage: wake-runtime-cli <workspaceRoot> <sessionId>' }) + '\n');
    process.exit(1);
  }

  const controller = new WakeController(workspaceRoot, {
    getCurrentGit: realGitSnapshot,
    getGitDir: defaultGetGitDir,
  });

  try {
    const outcome = await controller.run(sessionId);
    process.stdout.write(JSON.stringify(outcome) + '\n');
    process.exit(outcome.action === 'blocked' ? 1 : 0);
  } catch (e) {
    process.stdout.write(JSON.stringify({ action: 'noop', reason: `error: ${e instanceof Error ? e.message : String(e)}` }) + '\n');
    process.exit(1);
  }
}

main();

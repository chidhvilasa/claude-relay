import { spawnSync } from 'child_process';
import { GitSnapshot } from '@claude-relay/core';

/**
 * Real (non-injected) git-state reader for production use — mirrors the same
 * `spawnSync(..., { shell: false, timeout })` pattern already used in
 * hook-runtime's index.ts, deliberately not reusing a shared "shell out to
 * git" helper across packages so each stays independently auditable.
 */
export function realGitSnapshot(workspaceRoot: string): GitSnapshot {
  const run = (args: string[]) => spawnSync('git', args, { cwd: workspaceRoot, stdio: 'pipe', encoding: 'utf-8', timeout: 5000, shell: false });

  const headRes = run(['rev-parse', 'HEAD']);
  const branchRes = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const statusRes = run(['status', '--porcelain']);

  const head = headRes.stdout ? headRes.stdout.trim() : 'unknown';
  const branch = branchRes.stdout ? branchRes.stdout.trim() : 'unknown';
  const statusLines = statusRes.stdout ? statusRes.stdout.split('\n').filter((l) => l.trim().length > 0) : [];

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  for (const line of statusLines) {
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code === '??') untracked.push(file);
    else {
      if (code[0] !== ' ') staged.push(file);
      if (code[1] !== ' ') unstaged.push(file);
    }
  }

  return {
    branch,
    head,
    isDetached: branch === 'HEAD',
    isDirty: statusLines.length > 0,
    staged,
    unstaged,
    untracked,
  };
}

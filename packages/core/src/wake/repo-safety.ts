import * as fs from 'fs';
import { GitSnapshot } from '../models/types';
import { RepoSafetyClassification, WakeRecord } from './wake-types';

export interface RepoSafetyResult {
  classification: RepoSafetyClassification;
  reason: string;
}

/**
 * Classifies whether it is safe to autonomously continue a wake record against the repository's
 * current state (Part 16). Conservative by design: any condition this function cannot positively
 * confirm as safe falls to a more restrictive classification, never a more permissive one.
 *
 *   CURRENT  — continue directly, no extra reconciliation needed
 *   STALE    — continue is allowed, but the resumed session must reconcile (git changed since arm)
 *   DIVERGED — do not launch autonomous continuation (branch changed — different line of work)
 *   UNSAFE   — cancel the wake entirely (wrong project, repo identity mismatch, or workspace gone)
 */
export function classifyRepoSafety(
  record: WakeRecord,
  currentWorkspacePath: string,
  currentGitDir: string | undefined,
  currentGit: GitSnapshot
): RepoSafetyResult {
  if (!fs.existsSync(currentWorkspacePath)) {
    return { classification: 'UNSAFE', reason: 'Workspace path no longer exists on disk' };
  }

  if (record.project.path !== currentWorkspacePath) {
    return { classification: 'UNSAFE', reason: `Project path mismatch (armed for "${record.project.path}", currently "${currentWorkspacePath}")` };
  }

  if (record.project.gitDir && currentGitDir && record.project.gitDir !== currentGitDir) {
    return { classification: 'UNSAFE', reason: 'Git repository identity mismatch (.git directory differs) — path was reused for a different repository' };
  }

  if (record.savedGit.branch !== currentGit.branch) {
    return { classification: 'DIVERGED', reason: `Branch changed since wake was armed (was "${record.savedGit.branch}", now "${currentGit.branch}")` };
  }

  const currentDirtyCount = (currentGit.staged?.length ?? 0) + (currentGit.unstaged?.length ?? 0) + (currentGit.untracked?.length ?? 0);

  if (record.savedGit.head !== currentGit.head) {
    return { classification: 'STALE', reason: `HEAD changed since wake was armed (was ${record.savedGit.head.slice(0, 12)}, now ${currentGit.head.slice(0, 12)})` };
  }

  if (record.savedGit.dirtyCount !== currentDirtyCount) {
    return { classification: 'STALE', reason: `Working tree dirty-file count changed since wake was armed (was ${record.savedGit.dirtyCount}, now ${currentDirtyCount})` };
  }

  return { classification: 'CURRENT', reason: 'Repository state matches exactly what was recorded when the wake was armed' };
}

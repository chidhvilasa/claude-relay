import { Handoff, GitSnapshot, HandoffFreshness } from '../models/types';

export class StaleDetector {
  static evaluate(handoff: Handoff, currentGit: GitSnapshot, currentWorkspacePath: string): HandoffFreshness {
    if (handoff.workspace.path !== currentWorkspacePath) {
      return "INVALID";
    }

    if (handoff.git.head !== currentGit.head) {
      return "STALE"; // Commit changed
    }

    if (handoff.git.branch !== currentGit.branch) {
      return "STALE"; // Branch changed
    }

    // Check if dirty state changed significantly
    // For a strict approach, if the lengths of modified files don't match, it's possibly stale.
    // staged/unstaged/untracked are not required by the handoff JSON schema, so a schema-valid
    // handoff may not carry them — guard against undefined rather than crashing resume/staleness checks.
    const handoffDirtyCount = (handoff.git.staged?.length ?? 0) + (handoff.git.unstaged?.length ?? 0) + (handoff.git.untracked?.length ?? 0);
    const currentDirtyCount = (currentGit.staged?.length ?? 0) + (currentGit.unstaged?.length ?? 0) + (currentGit.untracked?.length ?? 0);

    if (handoffDirtyCount !== currentDirtyCount) {
      return "POSSIBLY_STALE";
    }

    // Check age (e.g. > 24 hours is stale)
    const ageMs = Date.now() - new Date(handoff.createdAt).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      return "STALE";
    }

    return "FRESH";
  }
}

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
    // For a strict approach, if the lengths of modified files don't match, it's possibly stale
    const handoffDirtyCount = handoff.git.staged.length + handoff.git.unstaged.length + handoff.git.untracked.length;
    const currentDirtyCount = currentGit.staged.length + currentGit.unstaged.length + currentGit.untracked.length;

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

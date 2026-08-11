import { Handoff, GitSnapshot } from '../models/types';
import { StaleDetector } from '../state/stale-detector';

export class ResumeReconciler {
  static reconcile(handoff: Handoff, currentGit: GitSnapshot, currentWorkspacePath: string): string {
    const freshness = StaleDetector.evaluate(handoff, currentGit, currentWorkspacePath);

    let instruction = `## Resume Instruction\n\n`;
    instruction += `You are continuing a session from a saved handoff.\n`;
    instruction += `Status: ${freshness}\n\n`;

    if (freshness === 'STALE' || freshness === 'POSSIBLY_STALE') {
      instruction += `> [!WARNING]\n`;
      instruction += `> The workspace state has changed since this handoff was created. You MUST verify the current code before making any edits.\n\n`;
      instruction += `Expected HEAD: ${handoff.git.head}\n`;
      instruction += `Current HEAD: ${currentGit.head}\n\n`;
    }

    instruction += `### Original Objective\n${handoff.semantic.objective}\n\n`;
    instruction += `### Completed Work\n${handoff.semantic.completed.map(c => `- ${c}`).join('\n')}\n\n`;
    instruction += `### Exact Next Action\n${handoff.semantic.nextAction}\n\n`;

    if (handoff.semantic.verifyOnResume.length > 0) {
      instruction += `### Verify Before Continuing\n${handoff.semantic.verifyOnResume.map(v => `- ${v}`).join('\n')}\n\n`;
    }

    instruction += `### Do Not Repeat\n${handoff.semantic.doNotRepeat.map(d => `- ${d}`).join('\n')}\n\n`;

    instruction += `**CRITICAL**: Treat this handoff as a lead, not unquestionable truth. Inspect the repository before editing. Do not redo completed work unless verification shows it is necessary.\n`;

    return instruction;
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { Handoff } from '../models/types';

export class WakeupGenerator {
  static generate(handoff: Handoff, workspacePath: string): void {
    let content = `# Claude Relay Handoff\n\n`;
    
    content += `**Project**: ${handoff.workspace.name || handoff.workspace.path}\n`;
    content += `**Created**: ${handoff.createdAt}\n`;
    content += `**Trigger reason**: ${handoff.reason}\n\n`;

    content += `## Objective\n${handoff.semantic.objective}\n\n`;

    if (handoff.semantic.completed.length > 0) {
      content += `## Completed\n`;
      handoff.semantic.completed.forEach(c => content += `- [x] ${c}\n`);
      content += `\n`;
    }

    content += `## Current Work\n${handoff.semantic.currentWork}\n\n`;

    if (handoff.semantic.decisions.length > 0) {
      content += `## Important Decisions\n`;
      handoff.semantic.decisions.forEach(d => content += `- ${d}\n`);
      content += `\n`;
    }

    if (handoff.semantic.rejectedApproaches.length > 0) {
      content += `## Failed Approaches\n`;
      handoff.semantic.rejectedApproaches.forEach(a => content += `- ${a}\n`);
      content += `\n`;
    }

    if (handoff.semantic.constraints.length > 0) {
      content += `## Constraints\n`;
      handoff.semantic.constraints.forEach(c => content += `- ${c}\n`);
      content += `\n`;
    }

    content += `## Git State\n`;
    content += `- **Branch**: \`${handoff.git.branch}\`\n`;
    content += `- **HEAD**: \`${handoff.git.head}\`\n`;
    content += `- **Dirty**: ${handoff.git.isDirty ? 'Yes' : 'No'}\n\n`;

    if (handoff.semantic.verifyOnResume.length > 0) {
      content += `## Verify Before Continuing\n`;
      handoff.semantic.verifyOnResume.forEach(v => content += `- ${v}\n`);
      content += `\n`;
    }

    if (handoff.semantic.blockers.length > 0) {
      content += `## Current Blocker\n`;
      handoff.semantic.blockers.forEach(b => content += `- ${b}\n`);
      content += `\n`;
    }

    if (handoff.semantic.doNotRepeat.length > 0) {
      content += `## Do Not Repeat\n`;
      handoff.semantic.doNotRepeat.forEach(d => content += `- ${d}\n`);
      content += `\n`;
    }

    content += `## Exact Next Action\n${handoff.semantic.nextAction}\n\n`;

    const outputPath = path.join(workspacePath, '.relay', 'WAKEUP.md');
    fs.writeFileSync(outputPath, content, 'utf-8');
  }
}

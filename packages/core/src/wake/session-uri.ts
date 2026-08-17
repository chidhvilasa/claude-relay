import { WakeRecord } from './wake-types';

/**
 * Level 3 building block (Parts 19–22): constructs the official VS Code
 * session-resume URI, confirmed this pass by fetching
 * code.claude.com/docs/en/vs-code.md directly — `vscode://anthropic.claude-code/open`
 * with an optional `session` query parameter. Per that same page, the handler
 * itself only resumes a session that "belongs to the workspace currently open
 * in VS Code" and falls back to a fresh conversation otherwise — that
 * cross-workspace safety property is provided by Claude Code's own handler,
 * not something Relay has to implement here (Part 21).
 *
 * This module only builds the URI and decides *whether it's appropriate to
 * offer reopening at all* (Part 19: "only reopening for a valid armed wake
 * condition — never for every old checkpoint"). It does not open anything
 * itself, register a VS Code command, or run automatically — no Level 3
 * trigger is wired up in this pass. See the final report.
 */

const SESSION_URI_BASE = 'vscode://anthropic.claude-code/open';

export function buildSessionResumeUri(sessionId: string, prompt?: string): string {
  const params = new URLSearchParams();
  params.set('session', sessionId);
  if (prompt) params.set('prompt', prompt);
  return `${SESSION_URI_BASE}?${params.toString()}`;
}

/**
 * A wake record is only worth offering a Level 3 reopen for if it's actually
 * still an active, unexpired wake condition — never for an arbitrary old
 * checkpoint or a record that already reached a terminal outcome.
 */
export function shouldOfferSessionReopen(record: WakeRecord, now: Date = new Date()): boolean {
  const reopenableStates: WakeRecord['state'][] = ['ARMED', 'WAITING_NATIVE', 'RECOVERY_AVAILABLE'];
  if (!reopenableStates.includes(record.state)) return false;
  return new Date(record.expiresAt).getTime() > now.getTime();
}

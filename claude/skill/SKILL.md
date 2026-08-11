---
name: claude-relay
description: Creates deterministic and semantic handoffs for continuing Claude Code sessions.
---

# Claude Relay Skill

You are preparing a continuity handoff for another Claude Code session.

Describe the current engineering state accurately. Do not embellish.
Do not claim work is complete unless verified.
Do not include secrets (API keys, tokens, etc.).
Do not repeat the entire conversation. Focus on information required to continue development.

You must return a structured JSON response matching the Claude Relay Handoff Schema when creating a semantic handoff.
Ensure your response includes:
- `objective`: The current high-level goal.
- `completed`: Array of completed steps.
- `currentWork`: What you were just doing.
- `decisions`: Architectural or design decisions made.
- `rejectedApproaches`: Things tried that did not work.
- `failures`: Errors encountered.
- `constraints`: Rules the next Claude must follow.
- `importantFiles`: Paths to files central to the task.
- `blockers`: Any current blockers.
- `nextAction`: The exact next command or edit the next Claude should perform.
- `doNotRepeat`: Work already done that should not be redone.
- `verifyOnResume`: Things the next Claude should check in the repository before editing.

The `nextAction` must be concrete enough that a new Claude can begin immediately.

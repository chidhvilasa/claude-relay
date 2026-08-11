---
name: relay
description: "Trigger this skill to prepare a Relay handoff before a session ends, to resume an unfinished task from a Relay state, or to reconcile stale state after Claude compacts context."
---

# Claude Relay

This skill manages semantic state handoffs and recovery for the Claude Relay continuity engine.

## Preparing a Handoff
If the user asks to "prepare a Relay handoff before this session ends" or similar:
1. Summarize the exact current task, the remaining open problems, and any necessary context for the next session.
2. Format the response clearly. 
3. The Claude Relay hooks will automatically intercept and save this state upon session stop.

## Resuming
If the user asks to "resume the unfinished task from Claude Relay" or similar:
1. Read the most recent checkpoint and handoff instructions.
2. Formulate a plan to continue exactly where the previous session left off.

For detailed schemas and behavior, refer to the Relay core documentation.

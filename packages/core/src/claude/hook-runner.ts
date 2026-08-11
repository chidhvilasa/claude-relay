import * as fs from 'fs';
import { LocalCheckpointStore } from '../storage/checkpoint-store';
import { DefaultGitProvider } from '../git/git-provider';
import { Checkpoint } from '../models/types';
import * as crypto from 'crypto';

async function main() {
  const stdinBuffer = fs.readFileSync(0); // Synchronously read all of stdin
  if (stdinBuffer.length === 0) {
    process.exit(0);
  }

  let eventPayload: any;
  try {
    eventPayload = JSON.parse(stdinBuffer.toString('utf-8'));
  } catch (e) {
    // Malformed JSON, fail safely
    console.error('Relay Hook Runner: Malformed JSON payload');
    process.exit(0);
  }

  // Expect Claude hook payload schema (assuming something like { type: "PreCompact", cwd: "..." })
  const eventType = eventPayload.type || eventPayload.event;
  const workspacePath = eventPayload.cwd || process.cwd();

  if (!eventType) {
    process.exit(0); // Safely ignore unknown payloads
  }

  // We care about PreCompact, StopFailure, SessionStart, PostCompact, Stop, SessionEnd
  const relevantEvents = ['PreCompact', 'StopFailure', 'Stop', 'SessionEnd', 'SessionStart', 'PostCompact'];
  if (!relevantEvents.includes(eventType)) {
    process.exit(0);
  }

  // Handle deterministic checkpointing for exit/compact events
  if (['PreCompact', 'StopFailure', 'Stop', 'SessionEnd'].includes(eventType)) {
    try {
      const git = new DefaultGitProvider(workspacePath);
      const gitSnapshot = await git.getSnapshot();

      const checkpoint: Checkpoint = {
        schemaVersion: '1.0',
        id: crypto.randomBytes(8).toString('hex'),
        createdAt: new Date().toISOString(),
        type: eventType === 'PreCompact' || eventType === 'StopFailure' ? 'recovery' : 'lightweight',
        reason: eventType,
        workspace: {
          path: workspacePath,
          name: path.basename(workspacePath)
        },
        git: gitSnapshot
      };

      const store = new LocalCheckpointStore(workspacePath);
      await store.save(checkpoint);
    } catch (e) {
      console.error(`Relay Hook Runner: Error saving checkpoint - ${e instanceof Error ? e.message : 'Unknown error'}`);
      process.exit(0); // Never fail the Claude session
    }
  }

  process.exit(0);
}

// Node specific path logic
import * as path from 'path';

main().catch(() => process.exit(0));

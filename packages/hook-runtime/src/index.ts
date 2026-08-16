import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';

const MAX_STDIN_BYTES = 256 * 1024; // 256 KB max for hook payload

async function main() {
  const stdinBuffer = Buffer.alloc(MAX_STDIN_BYTES);
  let bytesRead = 0;
  
  try {
    // eslint-disable-next-line no-constant-condition -- intentional read loop, exited via break/process.exit below
    while (true) {
      const chunk = fs.readFileSync(0); // sync read from stdin
      if (chunk.length === 0) break; // EOF
      if (bytesRead + chunk.length > MAX_STDIN_BYTES) {
        process.exit(0); // oversized payload, reject safely
      }
      chunk.copy(stdinBuffer, bytesRead);
      bytesRead += chunk.length;
    }
  } catch (e: any) {
    if (e.code === 'EOF' || e.code === 'EAGAIN') {
      // standard end of stream
    } else {
      process.exit(0);
    }
  }

  if (bytesRead === 0) process.exit(0);

  const payloadStr = stdinBuffer.subarray(0, bytesRead).toString('utf-8');
  let eventPayload: any;
  try {
    eventPayload = JSON.parse(payloadStr);
  } catch (e) {
    process.exit(0); // malformed JSON
  }

  if (typeof eventPayload !== 'object' || eventPayload === null) process.exit(0);

  const eventType = eventPayload.type || eventPayload.event;
  if (typeof eventType !== 'string' || eventType.length > 64) process.exit(0);

  const workspaceInput = eventPayload.cwd || process.cwd();
  if (typeof workspaceInput !== 'string' || workspaceInput.length > 1024) process.exit(0);

  // Hook minimization: Only keep PreCompact, StopFailure, and SessionStart
  const handlers: Record<string, boolean> = {
    'SessionStart': true,
    'PreCompact': true,
    'StopFailure': true
  };

  if (!handlers[eventType]) process.exit(0); // unknown or removed event

  // Secure path resolution
  let workspaceRoot: string;
  try {
    workspaceRoot = fs.realpathSync(path.resolve(workspaceInput));
  } catch (e) {
    process.exit(0); // invalid or inaccessible cwd
  }

  const relayDir = path.join(workspaceRoot, '.relay');
  const checkpointsDir = path.join(relayDir, 'checkpoints');

  // Directory traversal and symlink escape defense
  if (!checkpointsDir.startsWith(workspaceRoot)) {
    process.exit(0);
  }

  try {
    // Execution bounding: spawnSync with shell: false and strict timeouts
    const headRes = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, stdio: 'pipe', encoding: 'utf-8', timeout: 5000, shell: false });
    const branchRes = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspaceRoot, stdio: 'pipe', encoding: 'utf-8', timeout: 5000, shell: false });
    const statusRes = spawnSync('git', ['status', '--porcelain'], { cwd: workspaceRoot, stdio: 'pipe', encoding: 'utf-8', timeout: 5000, shell: false });

    const head = headRes.stdout ? headRes.stdout.trim() : 'unknown';
    const branch = branchRes.stdout ? branchRes.stdout.trim() : 'unknown';
    const isDirty = statusRes.stdout ? statusRes.stdout.trim().length > 0 : false;

    const checkpoint = {
      schemaVersion: '1.0',
      id: crypto.randomBytes(8).toString('hex'),
      createdAt: new Date().toISOString(),
      type: eventType === 'PreCompact' || eventType === 'StopFailure' ? 'recovery' : 'lightweight',
      reason: eventType,
      workspace: {
        path: workspaceRoot,
        name: path.basename(workspaceRoot)
      },
      git: { head, branch, isDirty }
    };

    if (!fs.existsSync(checkpointsDir)) {
      fs.mkdirSync(checkpointsDir, { recursive: true });
    }

    // Research instrumentation only — not a user-facing feature, and not the
    // basis of any automatic-continuation behavior yet. See
    // docs/AUTOMATIC_WAKE_ARCHITECTURE.md: it is currently unconfirmed
    // whether StopFailure fires at all when a plan-level usage/session limit
    // blocks a session (as opposed to a transient per-request rate limit),
    // and if it does, what its error-classification field is actually
    // called. This appends a small, allowlisted, local-only observation the
    // next time StopFailure fires for real, so that question can be
    // answered from real data instead of guessed at. It changes no
    // behavior — checkpoint creation above is identical either way.
    if (eventType === 'StopFailure') {
      try {
        const candidateFields = ['error', 'error_type', 'errorType', 'reason', 'matcher', 'subtype'];
        const observedContext: Record<string, string> = {};
        for (const field of candidateFields) {
          const value = (eventPayload as Record<string, unknown>)[field];
          if (typeof value === 'string' && value.length > 0 && value.length <= 128) {
            observedContext[field] = value;
          }
        }
        const observation = {
          observedAt: new Date().toISOString(),
          eventType,
          sessionId: typeof eventPayload.sessionId === 'string' ? eventPayload.sessionId.slice(0, 128) : undefined,
          context: observedContext,
        };
        const obsPath = path.join(relayDir, 'wake-observations.jsonl');
        const existingSize = fs.existsSync(obsPath) ? fs.statSync(obsPath).size : 0;
        if (existingSize < 2 * 1024 * 1024) { // 2 MB cap; stop appending past that rather than growing unbounded
          fs.appendFileSync(obsPath, JSON.stringify(observation) + '\n', 'utf-8');
        }
      } catch {
        // best-effort; never fatal to checkpoint creation
      }
    }

    // Self-gitignore .relay/ so Relay's own writes never show up in `git
    // status` — otherwise a freshly-written checkpoint changes the dirty-file
    // count and can make StaleDetector immediately misreport POSSIBLY_STALE
    // in any project that hasn't manually gitignored .relay/.
    const gitignorePath = path.join(relayDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      try {
        fs.writeFileSync(gitignorePath, '*\n', 'utf-8');
      } catch {
        // best-effort; not fatal to checkpoint creation
      }
    }

    // Verify .relay directory didn't resolve to a symlink pointing outside!
    const realCheckpointsDir = fs.realpathSync(checkpointsDir);
    if (!realCheckpointsDir.startsWith(workspaceRoot)) {
      process.exit(0); // refused recovery write due to symlink escape!
    }

    const filePath = path.join(realCheckpointsDir, `${checkpoint.id}.json`);
    const tempPath = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    
    fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    process.exit(0);
  }
}

main().catch(() => process.exit(0));

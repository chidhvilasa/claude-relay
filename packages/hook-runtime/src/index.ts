import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawnSync, spawn } from 'child_process';
import {
  captureSessionId,
  WakeStateStore,
  AutomaticWakeConfigManager,
  DEFAULT_MAX_AGE_MS,
  WakeRecord,
  WAKE_SCHEMA_VERSION,
} from '@claude-relay/core';

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

  // BUG FIX (found during v0.3 automatic-wake work, verified by decompiling the
  // actual installed claude.exe 2.1.233): every real Claude Code hook payload
  // identifies its event via `hook_event_name` (confirmed both in current public
  // docs at code.claude.com/docs/en/hooks.md and directly in the shipped binary's
  // own hook-payload-construction code, e.g. `{...py(session,...), hook_event_name:
  // "StopFailure", error:i, ...}`). This file previously read `eventPayload.type ||
  // eventPayload.event`, which is never present on a real payload -- every
  // genuine hook invocation from a real Claude Code process silently hit the
  // `process.exit(0)` early-out below and never wrote a checkpoint. The 20
  // pre-existing tests all passed because their fixture (`makePayload()`)
  // constructed the same wrong shape the code expected, so the mismatch was
  // self-consistent and invisible until checked against the real payload shape.
  // hooks.json also passes the event name as argv[2] (a value Relay's own
  // manifest hardcodes, not attacker-influenced), which is kept here as a
  // fallback for robustness, with the real payload field preferred as the
  // authoritative source since it comes directly from Claude Code itself.
  const argvEventType = typeof process.argv[2] === 'string' ? process.argv[2] : undefined;
  const eventType = eventPayload.hook_event_name || argvEventType || eventPayload.type || eventPayload.event;
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
    const statusLines = statusRes.stdout ? statusRes.stdout.split('\n').filter((l) => l.trim().length > 0) : [];
    const isDirty = statusLines.length > 0;

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
        // Real StopFailure payload fields, confirmed by decompiling claude.exe 2.1.233:
        // hook_event_name:"StopFailure", error:<string>, error_details:<unknown>,
        // last_assistant_message:<string|undefined>. `error_type`/`errorType`/`reason`/
        // `matcher`/`subtype` were prior guesses that don't appear in the real payload;
        // kept in the allowlist anyway since capturing them if present is harmless and
        // costs nothing, in case a future Claude Code version adds one of them.
        const candidateFields = ['error', 'error_details', 'error_type', 'errorType', 'reason', 'matcher', 'subtype'];
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
          // Real field name is `session_id` (snake_case), confirmed the same way.
          sessionId: typeof eventPayload.session_id === 'string' ? eventPayload.session_id.slice(0, 128) : undefined,
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

    // Automatic Wake session-identity capture (Part 5). Best-effort, never
    // fatal to checkpoint creation (own try/catch, same pattern as the
    // wake-observations block above). Deliberately does NOT create any
    // `.relay/wake/` state for a user who hasn't opted in to Automatic
    // Wake -- `configured` is checked first, and nothing below runs at all
    // if it's false, so a user who never enabled the feature gets exactly
    // the same `.relay/` contents as before this existed.
    try {
      const wakeConfig = new AutomaticWakeConfigManager();
      const workspaceWake = wakeConfig.getStatus('workspace', workspaceRoot);
      const userWake = wakeConfig.getStatus('user');
      if (workspaceWake.configured || userWake.configured) {
        const sessionId = captureSessionId(eventPayload);
        if (sessionId) {
          const wakeStore = new WakeStateStore(workspaceRoot);
          const now = new Date().toISOString();
          const savedGit = { branch, head, dirtyCount: statusLines.length };
          const existing = wakeStore.get(sessionId);

          if (!existing) {
            const record: WakeRecord = {
              schemaVersion: WAKE_SCHEMA_VERSION,
              recordId: crypto.randomBytes(8).toString('hex'),
              state: 'IDLE',
              sessionId,
              project: { path: workspaceRoot },
              createdAt: now,
              updatedAt: now,
              reason: eventType,
              savedGit,
              attemptCount: 0,
              expiresAt: new Date(Date.now() + DEFAULT_MAX_AGE_MS).toISOString(),
              ownerIdentity: os.userInfo().username,
            };
            wakeStore.save(record);
          } else if (existing.state === 'IDLE') {
            // Only refresh identity/git fields while nothing has armed this
            // record yet -- once ARMED (or beyond), a hook firing again for
            // the same session must not silently overwrite state a wake
            // attempt may be relying on.
            wakeStore.save({ ...existing, sessionId, savedGit, updatedAt: now });
          }

          // Arming signal: a StopFailure whose error text looks like a usage/rate
          // limit, on a record that's still IDLE (never re-arms an
          // already-armed/in-flight/terminal record). This is deliberately a
          // narrow, observable trigger -- not a guess about task completion,
          // per the task's "Do not guess task completion semantically" rule
          // applied symmetrically to arming as well as disarming.
          //
          // Deliberately excludes (Part 25's false-positive list, so these
          // never arm an unattended fallback attempt):
          //   authentication_failed -> handled downstream as BLOCKED_AUTH if
          //     ever reached, but arming for it here would just spawn a
          //     fallback process that immediately fails the same way -- noise,
          //     not recovery.
          //   billing_error / invalid_request / model_not_found /
          //     max_output_tokens / oauth_org_not_allowed -> none of these
          //     resolve themselves by waiting; arming would never help.
          //   overloaded -> explicitly native-retry territory (Level 1's
          //     CLAUDE_CODE_RETRY_WATCHDOG), not a Level 2 trigger, unless a
          //     future design explicitly extends this.
          if (eventType === 'StopFailure') {
            const errorValue = typeof (eventPayload as Record<string, unknown>).error === 'string' ? (eventPayload as Record<string, unknown>).error as string : '';
            const looksLikeUsageLimit = /rate.?limit|usage.?limit|quota|\b429\b|\b529\b/i.test(errorValue);
            const current = wakeStore.get(sessionId);
            if (looksLikeUsageLimit && current && current.state === 'IDLE') {
              const configuredMaxAge = Number(workspaceWake.values.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS ?? userWake.values.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS);
              const maxAgeMs = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0 ? configuredMaxAge : DEFAULT_MAX_AGE_MS;
              wakeStore.transition(sessionId, 'ARMED', {
                reason: `StopFailure: ${errorValue.slice(0, 128)}`,
                expiresAt: new Date(Date.now() + maxAgeMs).toISOString(),
              });

              // Part 17-24: "Do NOT merely create wake.json and hope something
              // eventually reads it. A real actor must exist." -- the actor is
              // wake-runner.cjs, this hook's own sibling build artifact (a
              // path relative to this file's own location, resolved via
              // __dirname -- never CLAUDE_PLUGIN_ROOT, never a repo-relative
              // or hardcoded absolute dev path, so a clean plugin install
              // always has it, per Part 48). Spawned detached and unref'd so
              // it survives this hook process exiting, which happens almost
              // immediately after this line -- that survival is exactly what
              // makes this a real trigger instead of inert state.
              try {
                const wakeRunnerPath = path.join(__dirname, 'wake-runner.cjs');
                // Test-only escape hatch (default: spawn enabled, i.e. real
                // production behavior) -- lets the test suite exercise arming
                // in isolation without a real detached child process racing
                // every such test, while a dedicated test explicitly re-enables
                // this to prove the real trigger end-to-end.
                const spawnSuppressed = process.env.CLAUDE_RELAY_SUPPRESS_WAKE_SPAWN === '1';
                if (!spawnSuppressed && fs.existsSync(wakeRunnerPath)) {
                  const child = spawn(process.execPath, [wakeRunnerPath, workspaceRoot, sessionId], {
                    detached: true,
                    stdio: 'ignore',
                    shell: false,
                    windowsHide: true,
                  });
                  child.unref();
                }
              } catch {
                // Best-effort: the wake record is still armed and remains
                // manually recoverable even if the detached spawn itself
                // fails for some reason (e.g. this exact build was installed
                // without the wake-runner.cjs sibling artifact).
              }
            }
          }
        }
      }
    } catch {
      // best-effort; never fatal to checkpoint creation
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

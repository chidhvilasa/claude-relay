import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

async function main() {
  const stdinBuffer = fs.readFileSync(0);
  if (stdinBuffer.length === 0) process.exit(0);

  let eventPayload: any;
  try {
    eventPayload = JSON.parse(stdinBuffer.toString('utf-8'));
  } catch (e) {
    process.exit(0);
  }

  const eventType = eventPayload.type || eventPayload.event;
  const workspacePath = eventPayload.cwd || process.cwd();
  if (!eventType) process.exit(0);

  const relevantEvents = ['PreCompact', 'StopFailure', 'Stop', 'SessionEnd', 'SessionStart', 'PostCompact'];
  if (!relevantEvents.includes(eventType)) process.exit(0);

  if (['PreCompact', 'StopFailure', 'Stop', 'SessionEnd'].includes(eventType)) {
    try {
      // Inline Git Snapshot logic
      const head = execSync('git rev-parse HEAD', { cwd: workspacePath, stdio: 'pipe' }).toString().trim();
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, stdio: 'pipe' }).toString().trim();
      const status = execSync('git status --porcelain', { cwd: workspacePath, stdio: 'pipe' }).toString().trim();
      const isDirty = status.length > 0;

      const checkpoint = {
        schemaVersion: '1.0',
        id: crypto.randomBytes(8).toString('hex'),
        createdAt: new Date().toISOString(),
        type: eventType === 'PreCompact' || eventType === 'StopFailure' ? 'recovery' : 'lightweight',
        reason: eventType,
        workspace: {
          path: workspacePath,
          name: path.basename(workspacePath)
        },
        git: { head, branch, isDirty }
      };

      // Inline Save logic
      const dir = path.join(workspacePath, '.relay', 'checkpoints');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const filePath = path.join(dir, `${checkpoint.id}.json`);
      const tempPath = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch (e) {
      process.exit(0);
    }
  }
  process.exit(0);
}

main().catch(() => process.exit(0));

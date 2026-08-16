import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ensureRelayGitignore } from '../src/storage/relay-dir';
import { LocalCheckpointStore } from '../src/storage/checkpoint-store';
import { LocalHandoffStore } from '../src/storage/handoff-store';

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpWorkspace(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `relay-dir-${name}-`));
  cleanup.push(dir);
  return dir;
}

describe('ensureRelayGitignore', () => {
  it('creates .relay/.gitignore containing "*"', () => {
    const ws = tmpWorkspace('direct');
    ensureRelayGitignore(ws);
    const gi = path.join(ws, '.relay', '.gitignore');
    expect(fs.existsSync(gi)).toBe(true);
    expect(fs.readFileSync(gi, 'utf-8').trim()).toBe('*');
  });

  it('is idempotent and does not clobber an existing .gitignore', () => {
    const ws = tmpWorkspace('idempotent');
    ensureRelayGitignore(ws);
    fs.writeFileSync(path.join(ws, '.relay', '.gitignore'), '*\n# custom note\n');
    ensureRelayGitignore(ws);
    expect(fs.readFileSync(path.join(ws, '.relay', '.gitignore'), 'utf-8')).toContain('# custom note');
  });
});

describe('LocalCheckpointStore / LocalHandoffStore self-gitignore', () => {
  it('LocalCheckpointStore construction ensures .relay/.gitignore exists', () => {
    const ws = tmpWorkspace('checkpoint-store');
    new LocalCheckpointStore(ws);
    expect(fs.existsSync(path.join(ws, '.relay', '.gitignore'))).toBe(true);
  });

  it('LocalHandoffStore construction ensures .relay/.gitignore exists', () => {
    const ws = tmpWorkspace('handoff-store');
    new LocalHandoffStore(ws);
    expect(fs.existsSync(path.join(ws, '.relay', '.gitignore'))).toBe(true);
  });
});

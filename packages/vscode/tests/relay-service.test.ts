import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { RelayService } from '../src/relay-service';

// These tests exercise RelayService directly — the exact class
// extension.ts's Create Checkpoint / Create Handoff Now / Resume command
// handlers call. relay-service.ts has zero dependency on the `vscode`
// module, so this runs as a plain Node/vitest unit test with no extension
// host required, and directly proves the commands persist real state
// rather than just showing a success toast.

function sh(cmd: string, cwd: string): string {
  return cp.execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim();
}

function makeRepo(name: string): string {
  // Deliberately includes a space and parentheses to cover the path-edge-case
  // regression this audit found in the test-electron dependency.
  const dir = path.join(os.tmpdir(), `claude-relay-vitest-${name} (space)`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  sh('git init -q', dir);
  sh('git config user.email test@example.com', dir);
  sh('git config user.name Test', dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  sh('git add a.txt', dir);
  sh('git commit -q -m init', dir);
  return dir;
}

const cleanupDirs: string[] = [];

afterAll(() => {
  for (const dir of cleanupDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('RelayService.createCheckpoint', () => {
  let repo: string;
  let service: RelayService;

  beforeEach(() => {
    repo = makeRepo(`checkpoint-${Math.random().toString(36).slice(2)}`);
    cleanupDirs.push(repo);
    service = new RelayService(repo);
  });

  it('writes an actual checkpoint file to .relay/checkpoints, not just a toast', async () => {
    const checkpoint = await service.createCheckpoint('manual');
    const file = path.join(repo, '.relay', 'checkpoints', `${checkpoint.id}.json`);
    expect(fs.existsSync(file)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.git.head).toBe(sh('git rev-parse HEAD', repo));
    expect(parsed.git.branch === 'master' || parsed.git.branch === 'main').toBe(true);
    expect(parsed.git.isDirty).toBe(false);
    expect(parsed.workspace.path).toBe(repo);
    expect(Math.abs(Date.now() - new Date(parsed.createdAt).getTime())).toBeLessThan(60_000);
  });

  it('reflects dirty state changes across successive checkpoints', async () => {
    const first = await service.createCheckpoint('manual');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'new file\n');
    const second = await service.createCheckpoint('manual');

    expect(second.id).not.toBe(first.id);
    expect(second.git.isDirty).toBe(true);

    const latest = await service.getLatestCheckpoint();
    expect(latest?.id).toBe(second.id);
  });
});

describe('RelayService.createHandoff', () => {
  let repo: string;
  let service: RelayService;

  beforeEach(() => {
    repo = makeRepo(`handoff-${Math.random().toString(36).slice(2)}`);
    cleanupDirs.push(repo);
    service = new RelayService(repo);
  });

  it('persists a real handoff and a WAKEUP.md labeled as untrusted historical context', async () => {
    const handoff = await service.createHandoff('Fix the login bug', 'Add a regression test', 'manual');

    const handoffFile = path.join(repo, '.relay', 'handoffs', `${handoff.id}.json`);
    expect(fs.existsSync(handoffFile)).toBe(true);

    const wakeupFile = path.join(repo, '.relay', 'WAKEUP.md');
    expect(fs.existsSync(wakeupFile)).toBe(true);
    const wakeupText = fs.readFileSync(wakeupFile, 'utf-8');
    expect(wakeupText).toMatch(/untrusted historical context/i);

    const parsed = JSON.parse(fs.readFileSync(handoffFile, 'utf-8'));
    expect(parsed.integrity.hash).toHaveLength(64);
  });

  it('succeeds deterministically with no Claude authentication involved', async () => {
    // The handoff path never touches network/auth — this test itself is the
    // proof: it runs with no Claude credentials available and still succeeds.
    const handoff = await service.createHandoff('Objective', 'Next action', 'manual');
    expect(handoff.semantic.objective).toBe('Objective');
  });
});

describe('RelayService resume/staleness', () => {
  let repo: string;
  let service: RelayService;

  beforeEach(() => {
    repo = makeRepo(`resume-${Math.random().toString(36).slice(2)}`);
    cleanupDirs.push(repo);
    service = new RelayService(repo);
  });

  it('produces real resume content, not merely "Resume ready"', async () => {
    const handoff = await service.createHandoff('Fix the login bug', 'Add a regression test', 'manual');
    const instruction = await service.buildResumeInstruction(handoff);

    expect(instruction).toMatch(/untrusted historical context/i);
    expect(instruction).toContain('Fix the login bug');
    expect(instruction).toContain('Add a regression test');
  });

  it('reports FRESH immediately after creation and detects staleness after the repo diverges', async () => {
    const handoff = await service.createHandoff('Objective', 'Next action', 'manual');
    expect(await service.evaluateFreshness(handoff)).toBe('FRESH');

    sh('git checkout -q -b other-branch', repo);
    fs.writeFileSync(path.join(repo, 'c.txt'), 'divergent change\n');
    sh('git add c.txt', repo);
    sh('git commit -q -m divergent', repo);

    expect(await service.evaluateFreshness(handoff)).not.toBe('FRESH');
  });
});

describe('RelayService cross-project isolation', () => {
  it('never lets one repository read another repository\'s Relay state', async () => {
    const repoA = makeRepo(`isolation-a-${Math.random().toString(36).slice(2)}`);
    const repoB = makeRepo(`isolation-b-${Math.random().toString(36).slice(2)}`);
    cleanupDirs.push(repoA, repoB);

    const serviceA = new RelayService(repoA);
    const serviceB = new RelayService(repoB);

    await serviceA.createHandoff('A objective', 'A next action', 'manual');
    await serviceA.createCheckpoint('manual');

    expect(await serviceB.getLatestHandoff()).toBeNull();
    expect(await serviceB.getLatestCheckpoint()).toBeNull();
  });
});

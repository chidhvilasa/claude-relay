import { spawn } from 'child_process';
import { GitSnapshot, GitProvider } from '../models/types';

const GIT_TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MB bound on stdout/stderr accumulation

export class DefaultGitProvider implements GitProvider {
  constructor(private readonly workspacePath: string) {}

  private async execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: this.workspacePath, env: process.env, shell: false });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`));
      }, GIT_TIMEOUT_MS);

      child.stdout.on('data', (data) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += data;
      });
      child.stderr.on('data', (data) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += data;
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0 && code !== 1) { // git status can return 1 on some operations, but we'll accept 0
          // Sometimes git fails if not a repo.
          if (stderr.includes('not a git repository')) {
            return reject(new Error('Not a git repository'));
          }
          if (stdout.trim().length === 0) {
            return reject(new Error(`git ${args[0]} failed: ${stderr.trim() || `exit code ${code}`}`));
          }
        }
        resolve(stdout.trim());
      });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async getSnapshot(): Promise<GitSnapshot> {
    try {
      const branch = await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD']);
      const head = await this.execGit(['rev-parse', 'HEAD']);
      if (!head) {
        // e.g. a freshly-initialized repository with zero commits: rev-parse
        // succeeds with empty output rather than erroring. Degrade safely
        // instead of reporting a blank HEAD as if it were valid.
        throw new Error('HEAD is unresolvable (repository likely has no commits yet)');
      }
      const statusRaw = await this.execGit(['status', '--porcelain']);

      const lines = statusRaw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      let isDirty = false;

      for (const line of lines) {
        isDirty = true;
        const x = line[0];
        const y = line[1];
        const file = line.substring(3);

        if (x === '?' && y === '?') {
          untracked.push(file);
        } else {
          if (x !== ' ' && x !== '?') staged.push(file);
          if (y !== ' ' && y !== '?') unstaged.push(file);
        }
      }

      const isDetached = branch === 'HEAD';

      return {
        branch: isDetached ? head : branch,
        head,
        isDetached,
        isDirty,
        staged,
        unstaged,
        untracked,
      };
    } catch (e) {
      // Return a blank/default state if git fails (e.g., no git repo)
      return {
        branch: 'unknown',
        head: 'unknown',
        isDetached: false,
        isDirty: false,
        staged: [],
        unstaged: [],
        untracked: []
      };
    }
  }
}

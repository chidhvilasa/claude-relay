import { spawn } from 'child_process';
import { GitSnapshot, GitProvider } from '../models/types';

export class DefaultGitProvider implements GitProvider {
  constructor(private readonly workspacePath: string) {}

  private async execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: this.workspacePath, env: process.env });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => (stdout += data));
      child.stderr.on('data', (data) => (stderr += data));

      child.on('close', (code) => {
        if (code !== 0 && code !== 1) { // git status can return 1 on some operations, but we'll accept 0
          // Sometimes git fails if not a repo.
          if (stderr.includes('not a git repository')) {
            return reject(new Error('Not a git repository'));
          }
        }
        resolve(stdout.trim());
      });
      child.on('error', (err) => reject(err));
    });
  }

  async getSnapshot(): Promise<GitSnapshot> {
    try {
      const branch = await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD']);
      const head = await this.execGit(['rev-parse', 'HEAD']);
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

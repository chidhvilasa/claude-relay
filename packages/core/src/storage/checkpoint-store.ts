import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Checkpoint, CheckpointStore } from '../models/types';
import { SchemaValidator } from '../schema/validator';
import { ensureRelayGitignore } from './relay-dir';

export class LocalCheckpointStore implements CheckpointStore {
  private readonly dir: string;

  constructor(private readonly workspacePath: string) {
    this.dir = path.join(workspacePath, '.relay', 'checkpoints');
    this.init();
  }

  private init() {
    ensureRelayGitignore(this.workspacePath);
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    if (!SchemaValidator.validateCheckpoint(checkpoint)) {
      throw new Error('Invalid Checkpoint schema');
    }

    const filePath = path.join(this.dir, `${checkpoint.id}.json`);
    const tempPath = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    
    fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  }

  async loadLatest(): Promise<Checkpoint | null> {
    if (!fs.existsSync(this.dir)) return null;

    const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return null;

    const sorted = files
      .map(file => {
        const fullPath = path.join(this.dir, file);
        return { file: fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const { file } of sorted) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const data = JSON.parse(content) as Checkpoint;
        if (SchemaValidator.validateCheckpoint(data)) {
          return data;
        }
      } catch (e) {
        // Skip invalid file
      }
    }
    return null;
  }
}

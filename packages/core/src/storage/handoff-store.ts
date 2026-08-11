import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Handoff, HandoffStore } from '../models/types';
import { SchemaValidator } from '../schema/validator';

export class LocalHandoffStore implements HandoffStore {
  private readonly dir: string;
  private readonly historyDir: string;

  constructor(workspacePath: string) {
    this.dir = path.join(workspacePath, '.relay', 'handoffs');
    this.historyDir = path.join(workspacePath, '.relay', 'history');
    this.init();
  }

  private init() {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.historyDir)) fs.mkdirSync(this.historyDir, { recursive: true });
  }

  private hashHandoff(handoff: Omit<Handoff, 'integrity'>): string {
    const payload = JSON.stringify({
      id: handoff.id,
      semantic: handoff.semantic,
      git: handoff.git
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  async save(handoff: Handoff): Promise<void> {
    if (!SchemaValidator.validateHandoff(handoff)) {
      throw new Error('Invalid Handoff schema');
    }
    
    const expectedHash = this.hashHandoff(handoff);
    if (handoff.integrity.hash !== expectedHash) {
      handoff.integrity.hash = expectedHash;
    }

    const filePath = path.join(this.dir, `${handoff.id}.json`);
    const tempPath = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    
    fs.writeFileSync(tempPath, JSON.stringify(handoff, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  }

  async loadLatest(): Promise<Handoff | null> {
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
        const data = JSON.parse(content) as Handoff;
        
        if (SchemaValidator.validateHandoff(data)) {
          const expectedHash = this.hashHandoff(data);
          if (data.integrity.hash === expectedHash) {
            return data;
          }
        }
      } catch (e) {
        // Skip corrupted or invalid file and try next
      }
    }
    return null;
  }

  async markResolved(id: string): Promise<void> {
    const filePath = path.join(this.dir, `${id}.json`);
    const historyPath = path.join(this.historyDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, historyPath);
    }
  }
}

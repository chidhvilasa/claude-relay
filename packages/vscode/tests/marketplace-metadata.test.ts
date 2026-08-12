import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const pkgDir = path.resolve(__dirname, '..');

describe('Marketplace manifest', () => {
  it('keeps the required public identity fields', () => {
    expect(pkg.name).toBe('claude-relay');
    expect(pkg.displayName).toBe('Claude Relay');
    expect(pkg.publisher).toBe('clauderelay-oss');
  });

  it('has a non-empty, accurate description mentioning the product and Claude Code', () => {
    expect(typeof pkg.description).toBe('string');
    expect(pkg.description.length).toBeGreaterThan(10);
    expect(pkg.description).toMatch(/claude code/i);
  });

  it('declares a focused keyword list (present, deduplicated, within a sane count)', () => {
    expect(Array.isArray(pkg.keywords)).toBe(true);
    expect(pkg.keywords.length).toBeGreaterThanOrEqual(8);
    expect(pkg.keywords.length).toBeLessThanOrEqual(30);
    expect(new Set(pkg.keywords).size).toBe(pkg.keywords.length);
  });

  it('declares repository/bugs/homepage/license', () => {
    expect(pkg.repository?.url).toContain('github.com/chidhvilasa/claude-relay');
    expect(pkg.bugs?.url).toContain('github.com/chidhvilasa/claude-relay/issues');
    expect(pkg.homepage).toBeTruthy();
    expect(pkg.license).toBe('MIT');
  });

  it('declares an icon field, and the referenced file actually exists', () => {
    expect(pkg.icon).toBeTruthy();
    expect(fs.existsSync(path.join(pkgDir, pkg.icon))).toBe(true);
  });

  it('declares only real, currently-supported VS Code Marketplace categories', () => {
    const supported = new Set([
      'Azure', 'Data Science', 'Debuggers', 'Extension Packs', 'Education', 'Formatters', 'Keymaps',
      'Language Packs', 'Linters', 'Machine Learning', 'Notebooks', 'Other', 'Programming Languages',
      'SCM Providers', 'Snippets', 'Testing', 'Themes', 'Visualization', 'Chat',
    ]);
    expect(Array.isArray(pkg.categories)).toBe(true);
    expect(pkg.categories.length).toBeGreaterThan(0);
    for (const c of pkg.categories) expect(supported.has(c)).toBe(true);
  });

  it('every activity-bar/view icon path referenced in contributes actually exists in the package', () => {
    const containers = pkg.contributes?.viewsContainers?.activitybar ?? [];
    for (const c of containers) {
      if (c.icon) expect(fs.existsSync(path.join(pkgDir, c.icon))).toBe(true);
    }
  });

  it('every contributed command has both an id and a title', () => {
    const commands = pkg.contributes?.commands ?? [];
    expect(commands.length).toBeGreaterThan(0);
    for (const c of commands) {
      expect(typeof c.command).toBe('string');
      expect(c.command.length).toBeGreaterThan(0);
      expect(typeof c.title).toBe('string');
      expect(c.title).toMatch(/^Claude Relay: /);
    }
  });

  it('declares engines.vscode and a matching pinned @types/vscode floor', () => {
    expect(pkg.engines?.vscode).toBeTruthy();
    const floor = pkg.engines.vscode.replace(/^\^/, '');
    expect(pkg.devDependencies?.['@types/vscode']).toBe(floor);
  });

  it('LICENSE and README exist in the package (not just the repo root)', () => {
    expect(fs.existsSync(path.join(pkgDir, 'LICENSE'))).toBe(true);
    expect(fs.existsSync(path.join(pkgDir, 'README.md'))).toBe(true);
  });

  it('.vscodeignore excludes source, tests, and dev config from the packaged VSIX', () => {
    const ignore = fs.readFileSync(path.join(pkgDir, '.vscodeignore'), 'utf-8');
    for (const pattern of ['src/**', 'tests/**', 'tsconfig.json']) {
      expect(ignore).toContain(pattern);
    }
  });
});

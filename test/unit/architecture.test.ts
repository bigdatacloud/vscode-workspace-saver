import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PURE_DIRS = ['manifest', 'git', 'agent', 'events', 'index'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('hàng rào kiến trúc', () => {
  it('các module core không được import vscode', () => {
    const offenders: string[] = [];
    for (const dir of PURE_DIRS) {
      for (const file of walk(join('src', dir))) {
        const src = readFileSync(file, 'utf8');
        if (/from\s+['"]vscode['"]/.test(src) || /require\(['"]vscode['"]\)/.test(src)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

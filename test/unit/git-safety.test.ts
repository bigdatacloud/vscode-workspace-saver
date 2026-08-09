import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BANNED = [
  'reset', 'clean', 'checkout', 'stash', 'rebase', 'merge',
  'worktree remove', 'worktree prune', 'branch -d', 'branch -D', 'push --force',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('an toàn git', () => {
  it('mã nguồn không chứa lệnh git phá trạng thái', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      for (const banned of BANNED) {
        if (src.includes(`'${banned}'`) || src.includes(`"${banned}"`)) {
          offenders.push(`${file}: ${banned}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

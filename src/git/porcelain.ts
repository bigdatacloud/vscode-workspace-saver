export interface WorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
}

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;

  const flush = (): void => {
    if (current) entries.push(current);
    current = null;
  };

  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') { flush(); continue; }

    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);

    switch (key) {
      case 'worktree':
        flush();
        current = { path: value, head: null, branch: null, detached: false, bare: false };
        break;
      case 'HEAD': if (current) current.head = value; break;
      case 'branch': if (current) current.branch = value; break;
      case 'detached': if (current) current.detached = true; break;
      case 'bare': if (current) current.bare = true; break;
      default: break;
    }
  }
  flush();
  return entries;
}

export function shortBranch(ref: string | null): string | null {
  if (ref === null) return null;
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

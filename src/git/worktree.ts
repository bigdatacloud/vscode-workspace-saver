import * as path from 'node:path';
import { parseWorktreeList, shortBranch, type WorktreeEntry } from './porcelain';
import type { GitRunner } from './exec';

interface Common { path: string; expectedBranch: string }

export type WorktreeStatus =
  | (Common & { kind: 'ok' })
  | (Common & { kind: 'missing' })
  | (Common & { kind: 'not-registered' })
  | (Common & { kind: 'branch-mismatch'; actual: string | null });

function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

export function classifyWorktree(args: {
  expectedPath: string;
  expectedBranch: string;
  entries: WorktreeEntry[];
  pathExists: boolean;
}): WorktreeStatus {
  const common: Common = { path: args.expectedPath, expectedBranch: args.expectedBranch };
  if (!args.pathExists) return { ...common, kind: 'missing' };

  const entry = args.entries.find((e) => samePath(e.path, args.expectedPath));
  if (!entry) return { ...common, kind: 'not-registered' };

  const actual = shortBranch(entry.branch);
  if (actual !== args.expectedBranch) return { ...common, kind: 'branch-mismatch', actual };
  return { ...common, kind: 'ok' };
}

export function buildAddWorktreeArgs(absPath: string, branch: string, branchExists: boolean): string[] {
  return branchExists
    ? ['worktree', 'add', absPath, branch]
    : ['worktree', 'add', '-b', branch, absPath];
}

export class GitClient {
  constructor(private readonly runner: GitRunner) {}

  async isRepo(dir: string): Promise<boolean> {
    const r = await this.runner.run(dir, ['rev-parse', '--git-dir']);
    return r.code === 0;
  }

  async listWorktrees(repoRoot: string): Promise<WorktreeEntry[]> {
    const r = await this.runner.run(repoRoot, ['worktree', 'list', '--porcelain']);
    if (r.code !== 0) throw new Error(`git worktree list thất bại: ${r.stderr.trim()}`);
    return parseWorktreeList(r.stdout);
  }

  async branchExists(repoRoot: string, branch: string): Promise<boolean> {
    const r = await this.runner.run(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return r.code === 0;
  }

  /** Chỉ TẠO. Không bao giờ gỡ, dọn hay ghi đè worktree đang có. */
  async addWorktree(repoRoot: string, absPath: string, branch: string): Promise<void> {
    const exists = await this.branchExists(repoRoot, branch);
    const args = buildAddWorktreeArgs(absPath, branch, exists);
    const r = await this.runner.run(repoRoot, args);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} thất bại: ${r.stderr.trim()}`);
  }
}

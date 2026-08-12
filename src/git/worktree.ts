import type { GitRunner } from './exec';

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

  /** Thư mục gốc của repo chứa `dir`; không phải repo → null. */
  async repoRoot(dir: string): Promise<string | null> {
    const r = await this.runner.run(dir, ['rev-parse', '--show-toplevel']);
    const duongDan = r.stdout.trim();
    return r.code === 0 && duongDan !== '' ? duongDan : null;
  }

  /**
   * Thư mục `.git` DÙNG CHUNG của repo (khác `--git-dir` khi đang đứng trong một worktree).
   * Cần để ghi `info/exclude` — nơi bỏ qua thư mục worktree mà không đụng `.gitignore` đang
   * được theo dõi của người dùng.
   */
  async gitCommonDir(dir: string): Promise<string | null> {
    const r = await this.runner.run(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const duongDan = r.stdout.trim();
    return r.code === 0 && duongDan !== '' ? duongDan : null;
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

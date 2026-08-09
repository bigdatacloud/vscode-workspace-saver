import { describe, it, expect } from 'vitest';
import { classifyWorktree, buildAddWorktreeArgs, GitClient } from '../../src/git/worktree';
import type { WorktreeEntry } from '../../src/git/porcelain';
import type { GitRunner, GitResult } from '../../src/git/exec';

const entry = (path: string, branch: string | null): WorktreeEntry =>
  ({ path, head: 'abc', branch, detached: branch === null, bare: false });

describe('classifyWorktree', () => {
  const entries = [
    entry('/projects/erp', 'refs/heads/main'),
    entry('/projects/erp-prod', 'refs/heads/feature/production'),
  ];

  it('ok khi thư mục tồn tại, đã đăng ký và đúng branch', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-prod', expectedBranch: 'feature/production',
      entries, pathExists: true,
    });
    expect(r.kind).toBe('ok');
  });

  it('missing khi thư mục không tồn tại', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-qc', expectedBranch: 'feature/qc',
      entries, pathExists: false,
    });
    expect(r.kind).toBe('missing');
    expect(r.expectedBranch).toBe('feature/qc');
  });

  it('not-registered khi thư mục có nhưng git không biết', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-qc', expectedBranch: 'feature/qc',
      entries, pathExists: true,
    });
    expect(r.kind).toBe('not-registered');
  });

  it('branch-mismatch khi đã đăng ký nhưng branch khác', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-prod', expectedBranch: 'feature/other',
      entries, pathExists: true,
    });
    expect(r.kind).toBe('branch-mismatch');
    if (r.kind === 'branch-mismatch') expect(r.actual).toBe('feature/production');
  });

  it('branch-mismatch với detached HEAD, actual là null', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/det', expectedBranch: 'main',
      entries: [entry('/projects/det', null)], pathExists: true,
    });
    expect(r.kind).toBe('branch-mismatch');
    if (r.kind === 'branch-mismatch') expect(r.actual).toBeNull();
  });

  it('so sánh đường dẫn không phân biệt dấu gạch chéo và dấu chéo cuối', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-prod/', expectedBranch: 'feature/production',
      entries, pathExists: true,
    });
    expect(r.kind).toBe('ok');
  });
});

describe('buildAddWorktreeArgs', () => {
  it('dùng branch có sẵn khi branch đã tồn tại', () => {
    expect(buildAddWorktreeArgs('/projects/erp-qc', 'feature/qc', true))
      .toEqual(['worktree', 'add', '/projects/erp-qc', 'feature/qc']);
  });

  it('tạo branch mới bằng -b khi branch chưa tồn tại', () => {
    expect(buildAddWorktreeArgs('/projects/erp-qc', 'feature/qc', false))
      .toEqual(['worktree', 'add', '-b', 'feature/qc', '/projects/erp-qc']);
  });

  it('không bao giờ sinh cờ --force', () => {
    const args = buildAddWorktreeArgs('/p', 'b', true).concat(buildAddWorktreeArgs('/p', 'b', false));
    expect(args).not.toContain('--force');
    expect(args).not.toContain('-f');
  });
});

/** Runner giả: không gọi git thật, không đụng đĩa. Ghi lại mọi lời gọi để assert. */
function fakeRunner(results: GitResult[]): GitRunner & { calls: string[][] } {
  const queue = [...results];
  const calls: string[][] = [];
  return {
    calls,
    async run(_cwd: string, args: string[]): Promise<GitResult> {
      calls.push(args);
      return queue.shift() ?? { stdout: '', stderr: '', code: 0 };
    },
  };
}

describe('GitClient với runner giả', () => {
  it('isRepo trả true khi runner trả code 0', async () => {
    const runner = fakeRunner([{ stdout: '.git', stderr: '', code: 0 }]);
    const client = new GitClient(runner);
    expect(await client.isRepo('/repo')).toBe(true);
    expect(runner.calls).toEqual([['rev-parse', '--git-dir']]);
  });

  it('isRepo trả false khi runner trả code khác 0', async () => {
    const runner = fakeRunner([{ stdout: '', stderr: 'not a git repository', code: 128 }]);
    const client = new GitClient(runner);
    expect(await client.isRepo('/khong-phai-repo')).toBe(false);
  });

  it('listWorktrees trả về danh sách đã parse khi code 0', async () => {
    const stdout = 'worktree /projects/erp\nHEAD abc\nbranch refs/heads/main\n';
    const runner = fakeRunner([{ stdout, stderr: '', code: 0 }]);
    const client = new GitClient(runner);
    const entries = await client.listWorktrees('/projects/erp');
    expect(entries).toEqual([
      { path: '/projects/erp', head: 'abc', branch: 'refs/heads/main', detached: false, bare: false },
    ]);
  });

  it('listWorktrees ném lỗi chứa stderr khi runner trả code khác 0', async () => {
    const runner = fakeRunner([{ stdout: '', stderr: 'fatal: không phải repo git', code: 1 }]);
    const client = new GitClient(runner);
    await expect(client.listWorktrees('/repo')).rejects.toThrow(/không phải repo git/);
  });

  it('branchExists trả true/false theo exit code', async () => {
    const runnerTrue = fakeRunner([{ stdout: 'abc123', stderr: '', code: 0 }]);
    expect(await new GitClient(runnerTrue).branchExists('/repo', 'main')).toBe(true);

    const runnerFalse = fakeRunner([{ stdout: '', stderr: '', code: 1 }]);
    expect(await new GitClient(runnerFalse).branchExists('/repo', 'khong-ton-tai')).toBe(false);
  });

  it('addWorktree dùng buildAddWorktreeArgs khi branch đã tồn tại', async () => {
    const runner = fakeRunner([
      { stdout: 'abc123', stderr: '', code: 0 }, // branchExists -> true
      { stdout: '', stderr: '', code: 0 }, // worktree add
    ]);
    const client = new GitClient(runner);
    await client.addWorktree('/repo', '/projects/erp-qc', 'feature/qc');
    expect(runner.calls[1]).toEqual(['worktree', 'add', '/projects/erp-qc', 'feature/qc']);
  });

  it('addWorktree dùng buildAddWorktreeArgs khi branch chưa tồn tại', async () => {
    const runner = fakeRunner([
      { stdout: '', stderr: '', code: 1 }, // branchExists -> false
      { stdout: '', stderr: '', code: 0 }, // worktree add -b
    ]);
    const client = new GitClient(runner);
    await client.addWorktree('/repo', '/projects/erp-qc', 'feature/qc');
    expect(runner.calls[1]).toEqual(['worktree', 'add', '-b', 'feature/qc', '/projects/erp-qc']);
  });

  it('addWorktree ném lỗi khi runner trả code khác 0', async () => {
    const runner = fakeRunner([
      { stdout: '', stderr: '', code: 1 }, // branchExists -> false
      { stdout: '', stderr: 'fatal: đường dẫn đã tồn tại', code: 128 }, // worktree add thất bại
    ]);
    const client = new GitClient(runner);
    await expect(client.addWorktree('/repo', '/projects/erp-qc', 'feature/qc')).rejects.toThrow(/thất bại/);
  });
});

import { describe, it, expect } from 'vitest';
import { classifyWorktree, buildAddWorktreeArgs } from '../../src/git/worktree';
import type { WorktreeEntry } from '../../src/git/porcelain';

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

import { describe, it, expect } from 'vitest';
import { parseWorktreeList, shortBranch } from '../../src/git/porcelain';

const SAMPLE = [
  'worktree /projects/erp',
  'HEAD abc1230000000000000000000000000000000000',
  'branch refs/heads/main',
  '',
  'worktree /projects/erp-production',
  'HEAD def4560000000000000000000000000000000000',
  'branch refs/heads/feature/production',
  '',
  'worktree /projects/erp-detached',
  'HEAD 789abc0000000000000000000000000000000000',
  'detached',
  '',
].join('\n');

describe('parseWorktreeList', () => {
  it('đọc được nhiều worktree', () => {
    const entries = parseWorktreeList(SAMPLE);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.path).toBe('/projects/erp');
    expect(entries[0]!.branch).toBe('refs/heads/main');
    expect(entries[0]!.detached).toBe(false);
  });

  it('nhận diện detached HEAD', () => {
    const entries = parseWorktreeList(SAMPLE);
    expect(entries[2]!.detached).toBe(true);
    expect(entries[2]!.branch).toBeNull();
  });

  it('nhận diện bare repository', () => {
    const entries = parseWorktreeList('worktree /repo.git\nbare\n\n');
    expect(entries[0]!.bare).toBe(true);
  });

  it('trả mảng rỗng với chuỗi rỗng', () => {
    expect(parseWorktreeList('')).toEqual([]);
    expect(parseWorktreeList('\n\n')).toEqual([]);
  });

  it('chịu được khối cuối không có dòng trắng kết thúc', () => {
    const entries = parseWorktreeList('worktree /a\nHEAD abc\nbranch refs/heads/x');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.branch).toBe('refs/heads/x');
  });

  it('chịu được đường dẫn Windows có khoảng trắng', () => {
    const entries = parseWorktreeList('worktree D:\\My Projects\\erp\nHEAD abc\nbranch refs/heads/main\n');
    expect(entries[0]!.path).toBe('D:\\My Projects\\erp');
  });
});

describe('shortBranch', () => {
  it('cắt tiền tố refs/heads/', () => {
    expect(shortBranch('refs/heads/feature/order-api')).toBe('feature/order-api');
  });
  it('giữ nguyên chuỗi không có tiền tố', () => {
    expect(shortBranch('main')).toBe('main');
  });
  it('trả null với null', () => {
    expect(shortBranch(null)).toBeNull();
  });
});

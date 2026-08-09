import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  manifestDir, manifestFilePath, stateFilePath,
  resolveProjectRoot, resolveWorktreePath, toStoredPath,
} from '../../src/manifest/paths';

const ROOT = path.resolve('/projects/erp');

describe('đường dẫn manifest', () => {
  it('manifestDir nằm trong .ai-workspace', () => {
    expect(manifestDir(ROOT)).toBe(path.join(ROOT, '.ai-workspace'));
  });

  it('manifestFilePath và stateFilePath', () => {
    expect(manifestFilePath(ROOT)).toBe(path.join(ROOT, '.ai-workspace', 'workspace.yaml'));
    expect(stateFilePath(ROOT)).toBe(path.join(ROOT, '.ai-workspace', 'state.json'));
  });

  it('resolveProjectRoot giải "." thành thư mục cha của .ai-workspace', () => {
    const file = path.join(ROOT, '.ai-workspace', 'workspace.yaml');
    expect(resolveProjectRoot(file, '.')).toBe(ROOT);
  });

  it('resolveProjectRoot giải root tương đối lên trên', () => {
    const file = path.join(ROOT, 'sub', '.ai-workspace', 'workspace.yaml');
    expect(resolveProjectRoot(file, '..')).toBe(ROOT);
  });
});

describe('đường dẫn worktree', () => {
  it('giải đường dẫn tương đối ra tuyệt đối', () => {
    expect(resolveWorktreePath(ROOT, '../erp-coordinator'))
      .toBe(path.resolve(ROOT, '../erp-coordinator'));
  });

  it('giữ nguyên đường dẫn tuyệt đối đã lưu', () => {
    const abs = path.resolve('/elsewhere/wt');
    expect(resolveWorktreePath(ROOT, abs)).toBe(abs);
  });

  it('toStoredPath luôn dùng dấu gạch chéo xuôi', () => {
    const abs = path.resolve(ROOT, '../erp-coordinator');
    expect(toStoredPath(ROOT, abs)).toBe('../erp-coordinator');
  });

  it('toStoredPath cho thư mục con', () => {
    const abs = path.join(ROOT, 'worktrees', 'qc');
    expect(toStoredPath(ROOT, abs)).toBe('worktrees/qc');
  });

  it('toStoredPath rơi về tuyệt đối khi khác ổ đĩa hoặc quá xa', () => {
    const abs = path.resolve('/totally/other/place');
    const stored = toStoredPath(ROOT, abs);
    expect(path.isAbsolute(stored.replace(/\//g, path.sep)) || stored.startsWith('..')).toBe(true);
  });

  it('round-trip: toStoredPath rồi resolveWorktreePath ra lại đúng chỗ cũ', () => {
    const abs = path.resolve(ROOT, '../erp-coordinator');
    expect(resolveWorktreePath(ROOT, toStoredPath(ROOT, abs))).toBe(abs);
  });
});

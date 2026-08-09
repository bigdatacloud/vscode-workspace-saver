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

  it('resolveWorktreePath với "." trả về project root', () => {
    expect(resolveWorktreePath(ROOT, '.')).toBe(ROOT);
  });

  it('toStoredPath luôn dùng dấu gạch chéo xuôi', () => {
    const abs = path.resolve(ROOT, '../erp-coordinator');
    expect(toStoredPath(ROOT, abs)).toBe('../erp-coordinator');
  });

  it('toStoredPath cho thư mục con', () => {
    const abs = path.join(ROOT, 'worktrees', 'qc');
    expect(toStoredPath(ROOT, abs)).toBe('worktrees/qc');
  });

  it('toStoredPath cho đường dẫn xa nhưng cùng ổ đĩa', () => {
    const abs = path.resolve(ROOT, '../..', 'totally', 'other');
    const stored = toStoredPath(ROOT, abs);
    expect(stored.startsWith('..')).toBe(true);
    expect(stored.replace(/\//g, path.sep)).not.toContain('/');
  });

  it.runIf(process.platform === 'win32')('toStoredPath khác ổ đĩa trả về tuyệt đối với dấu /', () => {
    const rootDrive = path.resolve(ROOT)[0];
    const otherDrive = rootDrive === 'C' || rootDrive === 'c' ? 'D' : 'C';
    const abs = path.resolve(`${otherDrive}:\\totally\\other\\place`);

    const stored = toStoredPath(ROOT, abs);

    // Kiểm tra: trả về tuyệt đối và dùng dấu /
    expect(path.isAbsolute(stored.replace(/\//g, path.sep))).toBe(true);
    expect(stored).not.toContain('\\');

    // Kiểm tra round-trip
    expect(resolveWorktreePath(ROOT, stored)).toBe(abs);
  });

  it('round-trip: toStoredPath rồi resolveWorktreePath ra lại đúng chỗ cũ', () => {
    const abs = path.resolve(ROOT, '../erp-coordinator');
    expect(resolveWorktreePath(ROOT, toStoredPath(ROOT, abs))).toBe(abs);
  });
});

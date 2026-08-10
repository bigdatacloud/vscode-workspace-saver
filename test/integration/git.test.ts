import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitClient } from '../../src/git/worktree';
import { realGitRunner } from '../../src/git/exec';

let root: string;
const git = new GitClient(realGitRunner);
// Worktree được tạo là THƯ MỤC ANH EM của `root` (nằm ngoài root), nên phải
// tự đăng ký đường dẫn ở đây để afterEach dọn dẹp — kể cả khi test đỏ giữa chừng
// và không bao giờ chạy tới dòng rmSync ở cuối thân test.
let worktreesToClean: string[] = [];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'wss-git-'));
  worktreesToClean = [];
  await realGitRunner.run(root, ['init', '-b', 'main']);
  await realGitRunner.run(root, ['config', 'user.email', 'test@example.com']);
  await realGitRunner.run(root, ['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), '# test\n');
  await realGitRunner.run(root, ['add', '.']);
  await realGitRunner.run(root, ['commit', '-m', 'init']);
});
afterEach(() => {
  for (const wt of worktreesToClean) rmSync(wt, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe('GitClient trên repo thật', () => {
  it('isRepo phân biệt được repo và thư mục thường', async () => {
    expect(await git.isRepo(root)).toBe(true);
    const plain = mkdtempSync(join(tmpdir(), 'wss-plain-'));
    expect(await git.isRepo(plain)).toBe(false);
    rmSync(plain, { recursive: true, force: true });
  });

  it('branchExists phân biệt branch có và không có', async () => {
    expect(await git.branchExists(root, 'main')).toBe(true);
    expect(await git.branchExists(root, 'khong-ton-tai')).toBe(false);
  });

  it('addWorktree tạo branch mới khi branch chưa có', async () => {
    const wt = join(root, '..', `wt-${Date.now()}`);
    worktreesToClean.push(wt);
    await git.addWorktree(root, wt, 'feature/qc');
    expect(existsSync(wt)).toBe(true);
    expect(await git.branchExists(root, 'feature/qc')).toBe(true);
  });

  it('addWorktree dùng lại branch đã tồn tại', async () => {
    await realGitRunner.run(root, ['branch', 'feature/existing']);
    const wt = join(root, '..', `wt2-${Date.now()}`);
    worktreesToClean.push(wt);
    await git.addWorktree(root, wt, 'feature/existing');
    expect(existsSync(wt)).toBe(true);
  });

  it('addWorktree ném lỗi rõ ràng khi đường dẫn đã bị chiếm', async () => {
    const wt = join(root, '..', `wt3-${Date.now()}`);
    worktreesToClean.push(wt);
    await git.addWorktree(root, wt, 'feature/a');
    await expect(git.addWorktree(root, wt, 'feature/b')).rejects.toThrow(/thất bại/);
  });
});

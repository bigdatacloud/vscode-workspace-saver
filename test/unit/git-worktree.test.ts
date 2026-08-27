import { describe, it, expect } from 'vitest';
import {
  buildAddWorktreeArgs,
  GitClient,
  ghepTenWorktree,
  laWorktreeCuaExtension,
  parseWorktreeList,
  phanLoaiWorktree,
} from '../../src/git/worktree';
import type { GitRunner, GitResult } from '../../src/git/exec';

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

describe('ghepTenWorktree', () => {
  it('ghép việc với vai bằng dấu gạch', () => {
    expect(ghepTenWorktree('fix-login', 'claude')).toBe('fix-login-claude');
  });

  it('không ghép hai lần khi người dùng đã tự gõ sẵn đuôi vai', () => {
    expect(ghepTenWorktree('fix-login-claude', 'claude')).toBe('fix-login-claude');
  });

  it('cắt khoảng trắng thừa hai đầu', () => {
    expect(ghepTenWorktree('  hotfix-csv  ', 'codex')).toBe('hotfix-csv-codex');
  });
});

describe('parseWorktreeList', () => {
  const MAU = [
    'worktree D:/Coding/erp',
    'HEAD aaa111',
    'branch refs/heads/main',
    '',
    'worktree D:/Coding/erp-worktrees/fix-login-claude',
    'HEAD bbb222',
    'branch refs/heads/fix-login-claude',
    '',
    'worktree D:/Coding/erp-worktrees/tach-roi',
    'HEAD ccc333',
    'detached',
    '',
  ].join('\n');

  it('đọc được đường dẫn và nhánh của từng worktree', () => {
    const ds = parseWorktreeList(MAU);
    expect(ds).toHaveLength(3);
    expect(ds[0]).toEqual({ path: 'D:/Coding/erp', branch: 'main', bare: false, detached: false });
    expect(ds[1]?.branch).toBe('fix-login-claude');
  });

  it('worktree detached không có nhánh', () => {
    const ds = parseWorktreeList(MAU);
    expect(ds[2]).toEqual({ path: 'D:/Coding/erp-worktrees/tach-roi', branch: null, bare: false, detached: true });
  });

  it('nhận diện repo bare', () => {
    const ds = parseWorktreeList('worktree D:/Coding/erp.git\nbare\n');
    expect(ds[0]?.bare).toBe(true);
    expect(ds[0]?.branch).toBeNull();
  });

  it('bỏ qua khoá lạ và khối không có dòng worktree', () => {
    const ds = parseWorktreeList('locked\nprunable gitdir file khong ton tai\n\nworktree /a\nbranch refs/heads/b\n');
    expect(ds).toEqual([{ path: '/a', branch: 'b', bare: false, detached: false }]);
  });

  it('stdout rỗng trả mảng rỗng', () => {
    expect(parseWorktreeList('')).toEqual([]);
    expect(parseWorktreeList('   \n\n')).toEqual([]);
  });
});

describe('laWorktreeCuaExtension', () => {
  const REPO = 'D:/Coding/erp';

  it('nhận worktree nằm trong <repo>-worktrees/', () => {
    expect(laWorktreeCuaExtension('D:/Coding/erp-worktrees/fix-login-claude', REPO)).toBe(true);
  });

  it('từ chối chính worktree gốc của repo', () => {
    expect(laWorktreeCuaExtension(REPO, REPO)).toBe(false);
  });

  it('từ chối thư mục chỉ TRÙNG TIỀN TỐ chứ không nằm trong', () => {
    // 'erp-worktrees-khac' bắt đầu bằng 'erp-worktrees' — so sánh chuỗi trần sẽ nhận nhầm,
    // và nhận nhầm ở đây nghĩa là lệnh dọn xoá worktree của người khác.
    expect(laWorktreeCuaExtension('D:/Coding/erp-worktrees-khac/x', REPO)).toBe(false);
  });

  it('từ chối worktree người dùng tự tạo ở chỗ khác', () => {
    expect(laWorktreeCuaExtension('D:/tmp/thu-nghiem', REPO)).toBe(false);
  });

  it('không phân biệt hoa thường và dấu phân cách (Windows)', () => {
    expect(laWorktreeCuaExtension(String.raw`d:\coding\ERP-WORKTREES\fix-login-claude`, REPO)).toBe(true);
  });
});

describe('phanLoaiWorktree', () => {
  it('đang có terminal mở thì thắng mọi phân loại khác', () => {
    expect(phanLoaiWorktree({ dangDung: true, sachGit: false, daMerge: false })).toBe('dangDung');
  });

  it('còn thay đổi chưa commit', () => {
    expect(phanLoaiWorktree({ dangDung: false, sachGit: false, daMerge: true })).toBe('banThayDoi');
  });

  it('sạch nhưng nhánh chưa merge', () => {
    expect(phanLoaiWorktree({ dangDung: false, sachGit: true, daMerge: false })).toBe('chuaMerge');
  });

  it('sạch và đã merge thì gỡ được', () => {
    expect(phanLoaiWorktree({ dangDung: false, sachGit: true, daMerge: true })).toBe('sach');
  });
});

describe('GitClient — các lệnh cho việc dọn worktree', () => {
  it('listWorktrees gọi đúng lệnh porcelain và parse kết quả', async () => {
    const runner = fakeRunner([
      { stdout: 'worktree /a\nbranch refs/heads/main\n', stderr: '', code: 0 },
    ]);
    const ds = await new GitClient(runner).listWorktrees('/repo');
    expect(runner.calls[0]).toEqual(['worktree', 'list', '--porcelain']);
    expect(ds).toEqual([{ path: '/a', branch: 'main', bare: false, detached: false }]);
  });

  it('listWorktrees trả mảng rỗng khi git lỗi, không ném', async () => {
    const runner = fakeRunner([{ stdout: '', stderr: 'fatal', code: 128 }]);
    await expect(new GitClient(runner).listWorktrees('/repo')).resolves.toEqual([]);
  });

  it('isClean: stdout rỗng là sạch, có dòng nào là bẩn', async () => {
    expect(await new GitClient(fakeRunner([{ stdout: '', stderr: '', code: 0 }])).isClean('/w')).toBe(true);
    expect(await new GitClient(fakeRunner([{ stdout: ' M src/a.ts\n', stderr: '', code: 0 }])).isClean('/w')).toBe(false);
  });

  it('isClean coi worktree là BẨN khi không kiểm tra được', async () => {
    // Không đọc nổi trạng thái mà báo "sạch" thì lệnh dọn sẽ tích sẵn nó để xoá — đoán sai
    // theo chiều đó là mất việc chưa commit.
    expect(await new GitClient(fakeRunner([{ stdout: '', stderr: 'fatal', code: 128 }])).isClean('/w')).toBe(false);
  });

  it('mergedBranches liệt kê nhánh đã merge vào base', async () => {
    const runner = fakeRunner([{ stdout: 'main\nfix-login-claude\n', stderr: '', code: 0 }]);
    const ds = await new GitClient(runner).mergedBranches('/repo', 'main');
    expect(runner.calls[0]).toEqual(['branch', '--merged', 'main', '--format=%(refname:short)']);
    expect(ds).toEqual(['main', 'fix-login-claude']);
  });

  it('defaultBranch đọc từ origin/HEAD và bỏ tiền tố origin/', async () => {
    const runner = fakeRunner([{ stdout: 'origin/main\n', stderr: '', code: 0 }]);
    expect(await new GitClient(runner).defaultBranch('/repo')).toBe('main');
  });

  it('defaultBranch thử main rồi master khi không có origin/HEAD', async () => {
    const runner = fakeRunner([
      { stdout: '', stderr: '', code: 128 }, // symbolic-ref hỏng
      { stdout: '', stderr: '', code: 1 }, // main không có
      { stdout: 'abc', stderr: '', code: 0 }, // master có
    ]);
    expect(await new GitClient(runner).defaultBranch('/repo')).toBe('master');
  });

  it('defaultBranch trả null khi không xác định được', async () => {
    const runner = fakeRunner([
      { stdout: '', stderr: '', code: 128 },
      { stdout: '', stderr: '', code: 1 },
      { stdout: '', stderr: '', code: 1 },
    ]);
    expect(await new GitClient(runner).defaultBranch('/repo')).toBeNull();
  });

  it('removeWorktree KHÔNG BAO GIỜ dùng --force và báo lại stderr thay vì ném', async () => {
    const runner = fakeRunner([{ stdout: '', stderr: 'fatal: còn thay đổi\n', code: 128 }]);
    const r = await new GitClient(runner).removeWorktree('/repo', '/repo-worktrees/x');
    expect(runner.calls[0]).toEqual(['worktree', 'remove', '/repo-worktrees/x']);
    expect(r).toEqual({ ok: false, stderr: 'fatal: còn thay đổi' });
  });

  it('deleteBranch KHÔNG BAO GIỜ dùng -D', async () => {
    const runner = fakeRunner([{ stdout: '', stderr: '', code: 0 }]);
    const r = await new GitClient(runner).deleteBranch('/repo', 'fix-login-claude');
    expect(runner.calls[0]).toEqual(['branch', '-d', 'fix-login-claude']);
    expect(r.ok).toBe(true);
  });
});

import type { GitRunner } from './exec';

/** Worktree do extension tạo nằm CẠNH repo: `<repo>-worktrees/<tên>`, không nằm trong repo. */
export const HAU_TO_WORKTREE = '-worktrees';

export function buildAddWorktreeArgs(absPath: string, branch: string, branchExists: boolean): string[] {
  return branchExists
    ? ['worktree', 'add', absPath, branch]
    : ['worktree', 'add', '-b', branch, absPath];
}

/**
 * Ghép tên worktree từ VIỆC và VAI: `fix-login` + `reviewer` → `fix-login-reviewer`.
 *
 * Phẳng chứ không phân cấp (`fix-login/reviewer`): tên phẳng vẫn nhóm theo việc khi `git
 * branch` sắp xếp chữ cái, nhưng không sinh thư mục lồng và không để lại thư mục cha rỗng
 * sau khi gỡ worktree.
 *
 * Bỏ qua bước ghép nếu người dùng đã tự gõ sẵn đuôi vai — gõ `fix-login-claude` mà nhận về
 * `fix-login-claude-claude` là kiểu bất ngờ vô nghĩa.
 */
export function ghepTenWorktree(viec: string, vai: string): string {
  const v = viec.trim();
  return v.endsWith(`-${vai}`) ? v : `${v}-${vai}`;
}

export interface WorktreeInfo {
  path: string;
  /** Tên nhánh đã bỏ `refs/heads/`; null khi detached hoặc bare. */
  branch: string | null;
  bare: boolean;
  detached: boolean;
}

/**
 * Đọc `git worktree list --porcelain`. Mỗi khối bắt đầu bằng dòng `worktree <path>`, sau đó
 * là các khoá `HEAD`, `branch`, `bare`, `detached`, `locked`, `prunable`.
 *
 * Bỏ qua khoá lạ thay vì ném: git thêm khoá mới theo phiên bản, mà một khoá chưa biết không
 * phải lý do để cả lệnh dọn worktree ngừng hoạt động.
 */
export function parseWorktreeList(stdout: string): WorktreeInfo[] {
  const ra: WorktreeInfo[] = [];
  for (const dongTho of stdout.split('\n')) {
    const dong = dongTho.trim();
    if (dong === '') continue;
    const cach = dong.indexOf(' ');
    const khoa = cach === -1 ? dong : dong.slice(0, cach);
    const gia = cach === -1 ? '' : dong.slice(cach + 1).trim();
    if (khoa === 'worktree') {
      ra.push({ path: gia, branch: null, bare: false, detached: false });
      continue;
    }
    const cuoi = ra[ra.length - 1];
    if (cuoi === undefined) continue; // khoá lạc trước bất kỳ dòng `worktree` nào
    if (khoa === 'branch') cuoi.branch = gia.replace(/^refs\/heads\//, '');
    else if (khoa === 'bare') cuoi.bare = true;
    else if (khoa === 'detached') cuoi.detached = true;
  }
  return ra;
}

/**
 * Worktree này có phải do extension tạo (nằm trong `<repo>-worktrees/`) không.
 *
 * Đây là ranh giới an toàn quan trọng nhất của lệnh dọn: worktree người dùng tự tạo ở chỗ
 * khác, worktree chính của repo, và worktree của công cụ khác đều không bao giờ lọt vào danh
 * sách xoá. Yêu cầu dấu phân cách ngay sau hậu tố nên `erp-worktrees-khac/` KHÔNG khớp —
 * so sánh chuỗi trần sẽ nhận nhầm, mà nhận nhầm ở đây nghĩa là xoá worktree của người khác.
 *
 * Thường hoá hoa/thường cho Windows. Trên hệ tệp phân biệt hoa thường thì về lý là nới lỏng,
 * nhưng vẫn phải nằm trong một thư mục tên `<repo>-worktrees` mới khớp.
 */
export function laWorktreeCuaExtension(duongDan: string, repoRoot: string): boolean {
  const cha = `${chuanHoaDuongDan(repoRoot)}${HAU_TO_WORKTREE}`;
  // Chính thư mục `<repo>-worktrees` KHÔNG phải worktree — phải nằm BÊN TRONG nó.
  return chuanHoaDuongDan(duongDan) !== cha && trongThuMuc(duongDan, cha);
}

/**
 * Đưa đường dẫn về một dạng so sánh được: gạch xuôi, không gạch cuối, chữ thường.
 *
 * Hạ chữ thường cho Windows. Trên hệ tệp phân biệt hoa thường thì về lý là nới lỏng, nhưng
 * hai thư mục chỉ khác nhau hoa/thường trong cùng một repo là chuyện không ai làm.
 */
export function chuanHoaDuongDan(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * `con` có bằng `cha` hoặc nằm trong `cha` không.
 *
 * Đòi dấu phân cách ngay sau `cha` nên `/a/bc` KHÔNG nằm trong `/a/b` — so sánh tiền tố trần
 * sẽ nhận nhầm, mà nhận nhầm ở đây nghĩa là đụng vào thư mục của người khác.
 */
export function trongThuMuc(con: string, cha: string): boolean {
  const c = chuanHoaDuongDan(con);
  const g = chuanHoaDuongDan(cha);
  return c === g || c.startsWith(`${g}/`);
}

export type LoaiWorktree = 'dangDung' | 'banThayDoi' | 'chuaMerge' | 'sach';

/** Chỉ `sach` mới được tích sẵn để xoá; ba loại kia đòi người dùng tự quyết. */
export function phanLoaiWorktree(dau: {
  dangDung: boolean;
  sachGit: boolean;
  daMerge: boolean;
}): LoaiWorktree {
  if (dau.dangDung) return 'dangDung';
  if (!dau.sachGit) return 'banThayDoi';
  if (!dau.daMerge) return 'chuaMerge';
  return 'sach';
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

  /** Chỉ TẠO. Việc gỡ nằm ở `removeWorktree`, chỉ lệnh dọn có xác nhận mới được gọi. */
  async addWorktree(repoRoot: string, absPath: string, branch: string): Promise<void> {
    const exists = await this.branchExists(repoRoot, branch);
    const args = buildAddWorktreeArgs(absPath, branch, exists);
    const r = await this.runner.run(repoRoot, args);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} thất bại: ${r.stderr.trim()}`);
  }

  /** Git lỗi → mảng rỗng, không ném: đây là lệnh đọc phụ, không đáng làm hỏng cả luồng. */
  async listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
    const r = await this.runner.run(repoRoot, ['worktree', 'list', '--porcelain']);
    return r.code === 0 ? parseWorktreeList(r.stdout) : [];
  }

  /**
   * Không còn thay đổi chưa commit. KHÔNG đọc nổi trạng thái → trả `false` (coi là bẩn):
   * đoán "sạch" ở đây là tích sẵn worktree đó cho lệnh xoá, tức mất việc chưa commit.
   */
  async isClean(dir: string): Promise<boolean> {
    const r = await this.runner.run(dir, ['status', '--porcelain']);
    if (r.code !== 0) return false;
    return r.stdout.trim() === '';
  }

  async mergedBranches(repoRoot: string, base: string): Promise<string[]> {
    const r = await this.runner.run(repoRoot, ['branch', '--merged', base, '--format=%(refname:short)']);
    if (r.code !== 0) return [];
    return r.stdout.split('\n').map((d) => d.trim()).filter((d) => d !== '');
  }

  /**
   * Nhánh mặc định của repo. `origin/HEAD` là nguồn đúng nhất; không có thì thử `main` rồi
   * `master`. Không xác định được → null, và bên gọi PHẢI coi mọi nhánh là chưa merge.
   */
  async defaultBranch(repoRoot: string): Promise<string | null> {
    const r = await this.runner.run(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const ten = r.stdout.trim();
    if (r.code === 0 && ten !== '') return ten.replace(/^origin\//, '');
    for (const ung of ['main', 'master']) {
      if (await this.branchExists(repoRoot, ung)) return ung;
    }
    return null;
  }

  /**
   * Gỡ worktree. KHÔNG BAO GIỜ `--force`: git từ chối vì còn thay đổi chưa commit là lưới an
   * toàn đang làm việc, không phải lỗi cần vượt qua. Trả kết quả thay vì ném vì lệnh dọn xử
   * lý nhiều mục một lượt và phải báo cáo từng cái.
   */
  async removeWorktree(repoRoot: string, absPath: string): Promise<{ ok: boolean; stderr: string }> {
    const r = await this.runner.run(repoRoot, ['worktree', 'remove', absPath]);
    return { ok: r.code === 0, stderr: r.stderr.trim() };
  }

  /** Xoá nhánh. KHÔNG BAO GIỜ `-D` — git từ chối nhánh chưa merge là đúng việc của nó. */
  async deleteBranch(repoRoot: string, branch: string): Promise<{ ok: boolean; stderr: string }> {
    const r = await this.runner.run(repoRoot, ['branch', '-d', branch]);
    return { ok: r.code === 0, stderr: r.stderr.trim() };
  }
}

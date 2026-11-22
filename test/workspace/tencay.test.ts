import { describe, expect, it } from 'vitest';
import { duongDanCay } from '../../src/git/worktree';
import { type EntryDaCo, xetTenCay } from '../../src/workspace/tencay';

function entry(p: Partial<EntryDaCo> & { name: string }): EntryDaCo {
  return {
    id: p.id ?? `id-${p.name}`,
    name: p.name,
    cwd: p.cwd ?? String.raw`D:\khac`,
    tenWorkspace: p.tenWorkspace ?? 'Working',
    ...(p.worktree === undefined ? {} : { worktree: p.worktree }),
  };
}

const REPO = String.raw`D:\Coding\vscode-workspace-saver`;

describe('tên cây cho một phiên agent mới', () => {
  it('ghép đuôi vai và tính đường dẫn cây cạnh repo', () => {
    const kq = xetTenCay({ viec: 'fix-login', vai: 'claude', repoGoc: REPO, daCo: [] });
    expect(kq).toEqual({
      loai: 'ok',
      tenCay: 'fix-login-claude',
      duongDanCay: duongDanCay(REPO, 'fix-login-claude'),
    });
  });

  it('bỏ trống KHÔNG còn là câu trả lời hợp lệ — mỗi phiên phải có cây riêng', () => {
    // Trước 22/11/2026 để trống nghĩa là "chạy thẳng trên checkout chính", và đó chính là
    // đường sinh ra hai phiên dùng chung một thư mục.
    expect(xetTenCay({ viec: '   ', vai: 'claude', repoGoc: REPO, daCo: [] })).toEqual({
      loai: 'rong',
    });
  });

  it('tên đi vào nhánh git và đường dẫn nên chặn cú pháp ngay ở cửa nhập', () => {
    for (const xau of ['-bat-dau-bang-gach', 'co..di-lui', 'co khoang trang', 'dau?hoi']) {
      expect(xetTenCay({ viec: xau, vai: 'claude', repoGoc: REPO, daCo: [] }).loai, xau).toBe(
        'cuPhap',
      );
    }
    expect(xetTenCay({ viec: 'nhom/viec_1.2', vai: 'claude', repoGoc: REPO, daCo: [] }).loai).toBe(
      'ok',
    );
  });

  it('người dùng tự gõ sẵn đuôi vai thì không ghép thêm lần nữa', () => {
    const kq = xetTenCay({ viec: 'fix-login-claude', vai: 'claude', repoGoc: REPO, daCo: [] });
    expect(kq.loai === 'ok' && kq.tenCay).toBe('fix-login-claude');
  });

  it('TRÙNG TÊN với một phiên ở workspace KHÁC cũng bị chặn — kể cả repo khác', () => {
    // Đúng câu anh Ý nói 22/11/2026: "dù trên cùng một project hay nhiều project khác nhau,
    // thư mục khác nhau, thì mỗi phiên vẫn phải một cây" — tên trùng là chỗ người dùng lộn.
    const kq = xetTenCay({
      viec: 'Fix-Login',
      vai: 'claude',
      repoGoc: REPO,
      daCo: [entry({ name: 'fix-login-claude', tenWorkspace: 'Dự án khác', cwd: String.raw`E:\kia` })],
    });
    expect(kq).toEqual({
      loai: 'trungTen',
      tenWorkspace: 'Dự án khác',
      tenEntry: 'fix-login-claude',
    });
  });

  it('TRÙNG CHỖ: cây đã có entry khác trỏ vào thì không được dùng lại im lặng', () => {
    // `hoiWorktree` cũ dùng lại thư mục có sẵn mà không hỏi ai đang giữ nó. Hai entry cùng
    // trỏ một worktree là hai agent sửa đè lên nhau.
    const cay = duongDanCay(REPO, 'fix-login-claude');
    const kq = xetTenCay({
      viec: 'fix-login',
      vai: 'claude',
      repoGoc: REPO,
      daCo: [
        entry({
          name: 'tên khác hẳn',
          tenWorkspace: 'Working',
          cwd: cay.toUpperCase(),
          worktree: { path: cay.toUpperCase() },
        }),
      ],
    });
    expect(kq).toEqual({ loai: 'trungCho', tenWorkspace: 'Working', tenEntry: 'tên khác hẳn' });
  });

  it('bỏ qua chính entry đang xét: đổi tên mà giữ nguyên tên cũ không phải trùng với bản thân', () => {
    const cay = duongDanCay(REPO, 'fix-login-claude');
    const kq = xetTenCay({
      viec: 'fix-login',
      vai: 'claude',
      repoGoc: REPO,
      boQuaId: 'toi',
      daCo: [entry({ id: 'toi', name: 'fix-login-claude', cwd: cay, worktree: { path: cay } })],
    });
    expect(kq.loai).toBe('ok');
  });

  it('ngoài repo git: vẫn phải có tên, nhưng tên là nhãn nên cho cả khoảng trắng', () => {
    // Quyết của anh Ý 22/11/2026: thư mục không tạo được cây thì VẪN hỏi tên — tên đó đặt cho
    // tab terminal và cho phiên Claude, và vẫn phải không trùng ai.
    const kq = xetTenCay({ viec: 'dọn kho ảnh', vai: 'claude', repoGoc: null, daCo: [] });
    expect(kq).toEqual({ loai: 'ok', tenCay: 'dọn kho ảnh', duongDanCay: null });
    expect(xetTenCay({ viec: '', vai: 'claude', repoGoc: null, daCo: [] }).loai).toBe('rong');
    expect(
      xetTenCay({
        viec: 'dọn kho ảnh',
        vai: 'claude',
        repoGoc: null,
        daCo: [entry({ name: 'Dọn kho ảnh' })],
      }).loai,
    ).toBe('trungTen');
  });
});

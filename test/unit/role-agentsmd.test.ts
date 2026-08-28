import { describe, expect, it } from 'vitest';
import {
  bamNoiDung,
  chenKhoiRole,
  conCanKhoi,
  dungKhoiRole,
  goKhoiRole,
} from '../../src/role/agentsmd';

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('bamNoiDung', () => {
  it('cùng nội dung cho cùng hash, khác nội dung cho khác hash', () => {
    expect(bamNoiDung('xin chào')).toBe(bamNoiDung('xin chào'));
    expect(bamNoiDung('xin chào')).not.toBe(bamNoiDung('xin chào!'));
  });

  it('hash ngắn và chỉ gồm hex — nó nằm trong một comment HTML', () => {
    expect(bamNoiDung('gì đó')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('dungKhoiRole', () => {
  it('mốc mở mang tên, id và hash; mốc đóng mang id', () => {
    const khoi = dungKhoiRole('Bạn là người rà soát.', 'reviewer', ID_A);
    expect(khoi).toContain(`id=${ID_A}`);
    expect(khoi).toContain(`hash=${bamNoiDung('Bạn là người rà soát.')}`);
    expect(khoi).toContain('reviewer');
    expect(khoi).toContain(`<!-- /ai-workspace:role id=${ID_A} -->`);
    expect(khoi).toContain('Bạn là người rà soát.');
  });
});

describe('chenKhoiRole', () => {
  it('file rỗng → thêm khối mới', () => {
    const r = chenKhoiRole('', 'Vai A', 'reviewer', ID_A);
    expect(r.ketQua).toBe('them');
    expect(r.noiDung).toContain('Vai A');
  });

  it('GIỮ NGUYÊN nội dung sẵn có của repo, chỉ nối khối vào sau', () => {
    // Đây là lời hứa quan trọng nhất: AGENTS.md của repo không được mất một ký tự nào.
    const cu = '# Quy ước repo\n\nDùng tab, không dùng space.\n';
    const r = chenKhoiRole(cu, 'Vai A', 'reviewer', ID_A);
    expect(r.noiDung.startsWith(cu.trimEnd())).toBe(true);
    expect(r.noiDung).toContain('Dùng tab, không dùng space.');
  });

  it('gọi lại với cùng nội dung → khongDoi, không đụng file', () => {
    const sau = chenKhoiRole('# Repo\n', 'Vai A', 'reviewer', ID_A).noiDung;
    const lai = chenKhoiRole(sau, 'Vai A', 'reviewer', ID_A);
    expect(lai.ketQua).toBe('khongDoi');
    expect(lai.noiDung).toBe(sau);
  });

  it('nội dung vai đổi → thay đúng khối, phần ngoài khối nguyên vẹn', () => {
    const sau = chenKhoiRole('# Repo\n\nGhi chú của tôi.\n', 'Vai A', 'reviewer', ID_A).noiDung;
    const lai = chenKhoiRole(sau, 'Vai B đã sửa', 'reviewer', ID_A);
    expect(lai.ketQua).toBe('thay');
    expect(lai.noiDung).toContain('Vai B đã sửa');
    expect(lai.noiDung).not.toContain('Vai A');
    expect(lai.noiDung).toContain('Ghi chú của tôi.');
  });

  it('có người sửa TAY bên trong khối → nguoiDungDaSua, KHÔNG đè', () => {
    const sau = chenKhoiRole('', 'Vai A', 'reviewer', ID_A).noiDung;
    const bịSuaTay = sau.replace('Vai A', 'Vai A (tôi tự thêm dòng này)');
    const lai = chenKhoiRole(bịSuaTay, 'Vai C', 'reviewer', ID_A);
    expect(lai.ketQua).toBe('nguoiDungDaSua');
    expect(lai.noiDung).toBe(bịSuaTay);
  });

  it('hai vai khác id cùng sống trong một file, không giẫm lên nhau', () => {
    const b1 = chenKhoiRole('', 'Vai A', 'reviewer', ID_A).noiDung;
    const b2 = chenKhoiRole(b1, 'Vai B', 'impl', ID_B).noiDung;
    expect(b2).toContain('Vai A');
    expect(b2).toContain('Vai B');

    const suaA = chenKhoiRole(b2, 'Vai A2', 'reviewer', ID_A);
    expect(suaA.ketQua).toBe('thay');
    expect(suaA.noiDung).toContain('Vai A2');
    expect(suaA.noiDung).toContain('Vai B');
  });

  it('nội dung vai nhiều dòng đi qua nguyên vẹn', () => {
    const nhieuDong = 'Dòng 1\n\nDòng 3 có `code`\n- gạch đầu dòng';
    const r = chenKhoiRole('', nhieuDong, 'reviewer', ID_A);
    const lai = chenKhoiRole(r.noiDung, nhieuDong, 'reviewer', ID_A);
    expect(lai.ketQua).toBe('khongDoi');
  });
});

describe('goKhoiRole', () => {
  it('gỡ khối và giữ nguyên phần còn lại', () => {
    const cu = '# Repo\n\nGhi chú.\n';
    const sau = chenKhoiRole(cu, 'Vai A', 'reviewer', ID_A).noiDung;
    expect(goKhoiRole(sau, ID_A)).toBe(cu);
  });

  it('file chỉ có mỗi khối → rỗng hẳn', () => {
    const sau = chenKhoiRole('', 'Vai A', 'reviewer', ID_A).noiDung;
    expect(goKhoiRole(sau, ID_A)).toBe('');
  });

  it('không có khối của id đó thì không đụng gì', () => {
    const cu = '# Repo\n';
    expect(goKhoiRole(cu, ID_A)).toBe(cu);
  });

  it('gỡ một vai không đụng vai kia', () => {
    const b1 = chenKhoiRole('', 'Vai A', 'reviewer', ID_A).noiDung;
    const b2 = chenKhoiRole(b1, 'Vai B', 'impl', ID_B).noiDung;
    const con = goKhoiRole(b2, ID_A);
    expect(con).not.toContain('Vai A');
    expect(con).toContain('Vai B');
  });
});

describe('conCanKhoi', () => {
  const wt = 'D:/repo-worktrees/fix-login-reviewer';

  it('không còn entry nào dùng vai đó ở thư mục đó → gỡ được', () => {
    expect(conCanKhoi(ID_A, wt, [])).toBe(false);
    expect(conCanKhoi(ID_A, wt, [{ roleId: ID_B, thuMuc: wt }])).toBe(false);
    expect(conCanKhoi(ID_A, wt, [{ roleId: ID_A, thuMuc: 'D:/khac' }])).toBe(false);
  });

  it('còn entry KHÁC cùng vai cùng thư mục → KHÔNG gỡ', () => {
    // Hai terminal chia nhau một worktree với cùng vai là chuyện có thật; gỡ khối vì một cái
    // bị bỏ đi là rút vai khỏi cái còn lại.
    expect(conCanKhoi(ID_A, wt, [{ roleId: ID_A, thuMuc: wt }])).toBe(true);
  });

  it('so thư mục không phân biệt hoa thường và dấu phân cách', () => {
    expect(conCanKhoi(ID_A, wt, [{ roleId: ID_A, thuMuc: 'd:/REPO-worktrees/fix-login-reviewer/' }])).toBe(true);
  });

  it('entry không có vai thì không tính', () => {
    expect(conCanKhoi(ID_A, wt, [{ thuMuc: wt }])).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { moTaKichHoat, phamViKichHoat } from '../../src/workspace/kichhoat';

const DS = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];

describe('phamViKichHoat', () => {
  it('không chỉ định terminal nào thì phạm vi là cả workspace', () => {
    expect(phamViKichHoat(DS)).toEqual(DS);
  });

  it('giữ nguyên thứ tự trong cây khi mở cả workspace', () => {
    expect(phamViKichHoat(DS).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('chỉ định một terminal thì phạm vi chỉ có ĐÚNG nó', () => {
    // Đây là điểm mấu chốt của "kích hoạt đơn lẻ": lọt thêm một entry nào khác là mở nhầm
    // một phiên agent người dùng không yêu cầu.
    expect(phamViKichHoat(DS, 't2')).toEqual([{ id: 't2' }]);
  });

  it('id không thuộc workspace thì phạm vi RỖNG, không rơi về mở cả workspace', () => {
    expect(phamViKichHoat(DS, 'khong-co')).toEqual([]);
  });
});

describe('moTaKichHoat — dòng nói rõ bấm vào sẽ mở gì, để hộp xác nhận không chung chung', () => {
  const goc = { id: 't1', name: 'x', cwd: 'D:/r' } as const;

  it('Claude đã có id phiên → nối lại hội thoại (có thể tốn token)', () => {
    expect(moTaKichHoat({ ...goc, kind: 'claude', claudeSessionId: 'abc' })).toMatch(/nối lại hội thoại Claude/);
  });

  it('Claude chưa có id phiên → mở phiên Claude mới', () => {
    expect(moTaKichHoat({ ...goc, kind: 'claude' })).toMatch(/phiên Claude mới/);
  });

  it('Codex → mở phiên Codex, nói rõ là agent', () => {
    expect(moTaKichHoat({ ...goc, kind: 'plain', agentId: 'codex' })).toMatch(/Codex/);
  });

  it('shell có lệnh khởi động → nêu đúng lệnh sẽ chạy', () => {
    expect(moTaKichHoat({ ...goc, kind: 'plain', startCommand: 'npm run dev' })).toContain('npm run dev');
  });

  it('shell trần → chỉ nói mở shell, không doạ token', () => {
    const d = moTaKichHoat({ ...goc, kind: 'plain' });
    expect(d).toMatch(/shell/);
    expect(d).not.toMatch(/token/i);
  });

  it('agent nào cũng cảnh báo token — đó là lý do cần xác nhận', () => {
    expect(moTaKichHoat({ ...goc, kind: 'claude', claudeSessionId: 'abc' })).toMatch(/token/i);
    expect(moTaKichHoat({ ...goc, kind: 'plain', agentId: 'codex' })).toMatch(/token/i);
  });
});

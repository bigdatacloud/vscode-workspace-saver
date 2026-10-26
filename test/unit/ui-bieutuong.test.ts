import { describe, expect, it } from 'vitest';
import { bieuTuongTerminal, MAU_NHA_CUNG_CAP } from '../../src/ui/bieutuong';

describe('bieuTuongTerminal — màu theo nhà cung cấp, xoay = đang làm', () => {
  it('terminal Claude đang chạy: vòng XOAY màu Anthropic', () => {
    expect(bieuTuongTerminal('busy', 'claude')).toEqual({ id: 'loading~spin', color: MAU_NHA_CUNG_CAP.claude });
  });

  it('terminal Codex đang chạy: vòng xoay màu OpenAI', () => {
    expect(bieuTuongTerminal('busy', 'codex')).toEqual({ id: 'loading~spin', color: MAU_NHA_CUNG_CAP.openai });
  });

  it('shell thường: màu trung tính, không mượn màu của nhà cung cấp nào', () => {
    const shell = bieuTuongTerminal('idle', undefined);
    expect(shell.color).toBe(MAU_NHA_CUNG_CAP.shell);
    expect(shell.color).not.toBe(MAU_NHA_CUNG_CAP.claude);
  });

  it('rảnh và đang mở: chấm ĐỨNG YÊN màu nhà cung cấp — không xoay nghĩa là không làm', () => {
    expect(bieuTuongTerminal('idle', 'claude')).toEqual({ id: 'circle-filled', color: MAU_NHA_CUNG_CAP.claude });
    expect(bieuTuongTerminal('open', 'codex')).toEqual({ id: 'circle-filled', color: MAU_NHA_CUNG_CAP.openai });
  });

  it('đang tải phiên: xoay nhưng màu mờ — extension đang bật nó, không phải agent đang làm', () => {
    const tai = bieuTuongTerminal('loading', 'claude');
    expect(tai.id).toMatch(/~spin$/);
    expect(tai.id).not.toBe('loading~spin');
    expect(tai.color).not.toBe(MAU_NHA_CUNG_CAP.claude);
  });

  it('chưa mở: chấm gạch chéo màu mờ', () => {
    expect(bieuTuongTerminal('closed', 'claude')).toEqual({ id: 'circle-slash', color: 'disabledForeground' });
  });

  it('vỏ trống (phiên đã thoát, shell còn sống): KHÁC hẳn "đang mở" và mất màu nhà cung cấp', () => {
    // Đây là toàn bộ lý do có trạng thái này: trước 0.2.4 nó vẽ y hệt "đang mở" — chấm đầy
    // màu Anthropic — nên người dùng nhìn một phiên đã chết mà tưởng nó đang chạy.
    const vo = bieuTuongTerminal('voTrong', 'claude');
    expect(vo.id).not.toBe('circle-filled');
    expect(vo.id).not.toMatch(/~spin$/);
    expect(vo.color).not.toBe(MAU_NHA_CUNG_CAP.claude);
    // Cũng không được trùng "chưa mở": hai thứ này dọn bằng hai cách khác nhau.
    expect(vo.id).not.toBe('circle-slash');
  });

  it('CHỜ BẠN TRẢ LỜI: chấm VÀNG đứng yên; lỗi: ĐỎ — hai màu này đè lên màu nhà cung cấp', () => {
    expect(bieuTuongTerminal('blocked', 'claude')).toEqual({ id: 'circle-filled', color: 'charts.yellow' });
    expect(bieuTuongTerminal('error', 'codex')).toEqual({ id: 'error', color: 'charts.red' });
  });

  it('chỉ trạng thái đang chạy mới xoay bằng màu nhà cung cấp', () => {
    for (const s of ['idle', 'open', 'blocked', 'closed', 'error'] as const) {
      expect(bieuTuongTerminal(s, 'claude').id).not.toMatch(/~spin$/);
    }
  });

  it('id màu nhà cung cấp là màu do extension khai (aiWorkspace.*) để người dùng đè được trong settings', () => {
    expect(MAU_NHA_CUNG_CAP.claude).toMatch(/^aiWorkspace\./);
    expect(MAU_NHA_CUNG_CAP.openai).toMatch(/^aiWorkspace\./);
  });
});

import { describe, expect, it } from 'vitest';
import { bieuTuongTerminal, MAU_NHA_CUNG_CAP } from '../../src/ui/bieutuong';

describe('bieuTuongTerminal — màu theo nhà cung cấp, hình theo trạng thái', () => {
  it('terminal Claude đang chạy: chấm ĐẶC màu Anthropic', () => {
    expect(bieuTuongTerminal('busy', 'claude')).toEqual({ id: 'circle-filled', color: MAU_NHA_CUNG_CAP.claude });
  });

  it('terminal Codex đang chạy: chấm đặc màu OpenAI', () => {
    expect(bieuTuongTerminal('busy', 'codex')).toEqual({ id: 'circle-filled', color: MAU_NHA_CUNG_CAP.openai });
  });

  it('shell thường: chấm màu trung tính, không mượn màu của nhà cung cấp nào', () => {
    const shell = bieuTuongTerminal('busy', undefined);
    expect(shell.color).toBe(MAU_NHA_CUNG_CAP.shell);
    expect(shell.color).not.toBe(MAU_NHA_CUNG_CAP.claude);
  });

  it('rảnh và đang mở: chấm RỖNG, vẫn giữ màu nhà cung cấp', () => {
    expect(bieuTuongTerminal('idle', 'claude')).toEqual({ id: 'circle-outline', color: MAU_NHA_CUNG_CAP.claude });
    expect(bieuTuongTerminal('open', 'codex')).toEqual({ id: 'circle-outline', color: MAU_NHA_CUNG_CAP.openai });
  });

  it('đang tải phiên: vòng xoay mang màu nhà cung cấp', () => {
    expect(bieuTuongTerminal('loading', 'claude')).toEqual({ id: 'loading~spin', color: MAU_NHA_CUNG_CAP.claude });
  });

  it('chưa mở: chấm gạch chéo màu mờ — không phải màu nhà cung cấp, để "tắt" nhìn khác hẳn "rảnh"', () => {
    const dong = bieuTuongTerminal('closed', 'claude');
    expect(dong.id).toBe('circle-slash');
    expect(dong.color).not.toBe(MAU_NHA_CUNG_CAP.claude);
  });

  it('CHỜ BẠN TRẢ LỜI và lỗi giữ màu cảnh báo riêng, KHÔNG bị màu nhà cung cấp che mất', () => {
    expect(bieuTuongTerminal('blocked', 'claude')).toEqual({ id: 'question', color: 'charts.yellow' });
    expect(bieuTuongTerminal('error', 'codex')).toEqual({ id: 'error', color: 'charts.red' });
  });

  it('id màu nhà cung cấp là màu do extension khai (aiWorkspace.*) để người dùng đè được trong settings', () => {
    expect(MAU_NHA_CUNG_CAP.claude).toMatch(/^aiWorkspace\./);
    expect(MAU_NHA_CUNG_CAP.openai).toMatch(/^aiWorkspace\./);
  });
});

import { describe, expect, it } from 'vitest';
import { khiKetThucLenh, nenBatLenh } from '../../src/capture/rules';

describe('nenBatLenh', () => {
  it('chỉ bắt cho terminal plain, không bắt lệnh agent, không bắt lệnh rỗng', () => {
    expect(nenBatLenh('plain', false, 'npm run dev')).toBe(true);
    expect(nenBatLenh('claude', false, 'npm run dev')).toBe(false);
    expect(nenBatLenh('plain', true, 'claude --resume abc')).toBe(false);
    expect(nenBatLenh('plain', false, '   ')).toBe(false);
  });
});

describe('khiKetThucLenh', () => {
  const p = { lenh: 'npm run dev', luuTruoc: 'lệnh cũ', batDauLuc: 1000, token: {} };

  it('lệnh chạy đủ lâu → giữ lệnh đó làm startCommand', () => {
    expect(khiKetThucLenh(p, 1000 + 15_000)).toBe('npm run dev');
  });

  it('lệnh vặt (chạy ngắn) → trả lại giá trị trước', () => {
    expect(khiKetThucLenh(p, 1000 + 14_999)).toBe('lệnh cũ');
  });

  it('lệnh vặt mà trước đó chưa có gì → undefined (xóa)', () => {
    expect(khiKetThucLenh({ ...p, luuTruoc: undefined }, 1000 + 3_000)).toBeUndefined();
  });

  it('ngưỡng tùy biến được', () => {
    expect(khiKetThucLenh(p, 1000 + 500, 400)).toBe('npm run dev');
  });
});

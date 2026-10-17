import { describe, expect, it } from 'vitest';
import { lenhDoiTenPhienClaude } from '../../src/agent/claude';

describe('lenhDoiTenPhienClaude — gõ /rename vào phiên đang chạy', () => {
  it('dựng đúng slash command của Claude Code', () => {
    expect(lenhDoiTenPhienClaude('fix-login')).toBe('/rename fix-login');
  });

  it('tên nhiều dòng bị gộp về một dòng', () => {
    // Mỗi xuống dòng trong TUI là một lần Enter: tên hai dòng thành lệnh /rename cụt cộng
    // một lượt chat rác.
    expect(lenhDoiTenPhienClaude('fix\nlogin')).toBe('/rename fix login');
  });

  it('cắt khoảng trắng thừa hai đầu và ở giữa', () => {
    expect(lenhDoiTenPhienClaude('  fix   login  ')).toBe('/rename fix login');
  });

  it('tên rỗng hoặc chỉ khoảng trắng → null, KHÔNG gửi gì', () => {
    // `/rename` trần bảo Claude tự nghĩ ra một cái tên — đổi tên trong extension mà phiên
    // mang tên do AI đặt thì đúng là thứ không ai yêu cầu.
    expect(lenhDoiTenPhienClaude('')).toBeNull();
    expect(lenhDoiTenPhienClaude('   \n  ')).toBeNull();
  });

  it('tên dài bị cắt thay vì gửi cả đoạn văn', () => {
    const kq = lenhDoiTenPhienClaude('a'.repeat(300));
    expect(kq).not.toBeNull();
    expect((kq as string).length).toBeLessThanOrEqual('/rename '.length + 120);
  });
});

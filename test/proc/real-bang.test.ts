import { describe, expect, it } from 'vitest';
import { conSong, docBangTienTrinhDayDu } from '../../src/proc/real';

/**
 * Hai ca này chạy THẬT trên máy đang chạy test, không mock.
 *
 * Lý do: chỗ hay vỡ nhất của luồng này không phải logic mà là định dạng — đổi chuỗi
 * PowerShell một chút là bảng parse ra rỗng, và rỗng lại đúng bằng "đọc hỏng" nên hàng rào
 * sẽ lặng lẽ từ chối đóng mọi phiên. Unit test với chuỗi tự chế không bắt được điều đó.
 */
describe('docBangTienTrinhDayDu — đọc bảng thật của hệ điều hành', () => {
  it('thấy chính tiến trình test này, và thấy đúng cha của nó', async () => {
    const bang = await docBangTienTrinhDayDu();
    expect(bang.size).toBeGreaterThan(10);
    const toi = bang.get(process.pid);
    expect(toi).toBeDefined();
    expect(toi!.cha).toBe(process.ppid);
    expect(toi!.lenh.toLowerCase()).toContain('node');
  }, 30_000);
});

describe('conSong — pid còn sống không, hỏi rẻ', () => {
  // Thay cho việc quét lại cả bảng tiến trình (1,4–1,8 giây mỗi lần lúc máy tải) chỉ để
  // xem một pid đã chết chưa.
  it('tiến trình đang chạy thì còn sống', () => {
    expect(conSong(process.pid)).toBe(true);
  });

  it('pid không tồn tại thì không', () => {
    // pid vượt mọi giá trị hệ điều hành cấp phát trong thực tế.
    expect(conSong(0x7ffffff0)).toBe(false);
  });

  it('pid vô nghĩa thì không, và không được ném', () => {
    expect(conSong(0)).toBe(false);
    expect(conSong(-1)).toBe(false);
    expect(conSong(1.5)).toBe(false);
  });
});

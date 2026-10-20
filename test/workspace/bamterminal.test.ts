import { describe, expect, it } from 'vitest';
import { phanXuBamTerminal } from '../../src/workspace/bamterminal';

/**
 * Bấm vào một terminal trong cây mà KHÔNG có gì xảy ra là lỗi tệ nhất trong nhóm này: người
 * dùng không biết nên bấm lại, bấm chỗ khác, hay extension hỏng. Bảng dưới khoá đúng một
 * điều: không nhánh nào được phép im lặng.
 */
describe('phân xử cú bấm vào terminal trong cây', () => {
  it('terminal đang mở và hiện được → coi như xong, không báo gì', () => {
    expect(phanXuBamTerminal({ dangMo: true, hienDuoc: true, coEntry: true })).toEqual({
      loai: 'daHien',
    });
  });

  it('terminal đang mở nhưng không đưa ra trước được → báo, KHÔNG hỏi kích hoạt', () => {
    // Hỏi "kích hoạt?" ở đây là sai: entry đã có tiến trình đang chạy, mở lại là nhân đôi phiên.
    expect(phanXuBamTerminal({ dangMo: true, hienDuoc: false, coEntry: true })).toEqual({
      loai: 'khongHienDuoc',
    });
  });

  it('terminal chưa mở nhưng entry còn trong store → hỏi kích hoạt', () => {
    expect(phanXuBamTerminal({ dangMo: false, hienDuoc: false, coEntry: true })).toEqual({
      loai: 'hoiKichHoat',
    });
  });

  it('entry không còn trong workspace đó → báo cây lạc hậu', () => {
    // Xảy ra khi terminal vừa bị kéo sang workspace khác mà item trong tay người dùng còn
    // giữ workspaceId cũ. Trước đây nhánh này `return` không nói gì.
    expect(phanXuBamTerminal({ dangMo: false, hienDuoc: false, coEntry: false })).toEqual({
      loai: 'entryLacHau',
    });
  });

  it('entry đã mất nhưng terminal vẫn đang chạy: vẫn hiện nó, không báo lạc hậu', () => {
    expect(phanXuBamTerminal({ dangMo: true, hienDuoc: true, coEntry: false })).toEqual({
      loai: 'daHien',
    });
  });
});

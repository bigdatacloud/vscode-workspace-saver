import { describe, expect, it } from 'vitest';
import { canBatWordWrap } from '../../src/voice/wrap';

describe('canBatWordWrap', () => {
  it('đang tắt wrap → cần bật', () => {
    expect(canBatWordWrap('off')).toBe(true);
  });

  it('không đọc được setting → coi như mặc định của VS Code (off) nên cần bật', () => {
    expect(canBatWordWrap(undefined)).toBe(true);
    expect(canBatWordWrap('')).toBe(true);
  });

  it('người dùng đã bật wrap rồi → KHÔNG đụng vào, vì lệnh của VS Code là toggle hai chiều', () => {
    // Đây là điểm mấu chốt: `editor.action.toggleWordWrap` đang wrap thì nó TẮT. Gọi vô điều
    // kiện nghĩa là ai đã bật wrap sẽ bị extension tắt mất — đúng thứ họ không yêu cầu.
    expect(canBatWordWrap('on')).toBe(false);
  });

  it('các kiểu wrap theo cột cũng đã là wrap → không đụng', () => {
    expect(canBatWordWrap('wordWrapColumn')).toBe(false);
    expect(canBatWordWrap('bounded')).toBe(false);
  });

  it('giá trị lạ (setting gõ tay) → không đụng, thà không wrap còn hơn tắt wrap của người ta', () => {
    expect(canBatWordWrap('linh-tinh')).toBe(false);
  });
});

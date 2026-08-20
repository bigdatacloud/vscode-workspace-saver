import { describe, expect, it, vi } from 'vitest';
import { decideTerminalRemoval } from '../../src/workspace/remove';

describe('decideTerminalRemoval', () => {
  it('terminal đang mở phải hỏi; chọn đóng thì vừa bỏ vừa đóng', async () => {
    const ask = vi.fn(async () => 'close' as const);
    await expect(decideTerminalRemoval(true, ask)).resolves.toBe('remove-and-close');
    expect(ask).toHaveBeenCalledOnce();
  });

  it('terminal đang mở: có thể chỉ bỏ khỏi workspace hoặc hủy toàn bộ', async () => {
    await expect(decideTerminalRemoval(true, async () => 'keep')).resolves.toBe('remove-only');
    await expect(decideTerminalRemoval(true, async () => undefined)).resolves.toBe('cancel');
  });

  it('terminal đã đóng thì bỏ trực tiếp, không hỏi câu vô nghĩa', async () => {
    const ask = vi.fn(async () => 'close' as const);
    await expect(decideTerminalRemoval(false, ask)).resolves.toBe('remove-only');
    expect(ask).not.toHaveBeenCalled();
  });
});

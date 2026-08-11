import { describe, expect, it } from 'vitest';
import { parseBangTienTrinh, timTerminalTheoToTien } from '../../src/proc/tree';

describe('parseBangTienTrinh', () => {
  it('parse định dạng Windows (pid,ppid) và POSIX (pid ppid), bỏ qua rác', () => {
    const win = parseBangTienTrinh('4,0\n123,4\nrác không parse\n\n999,123\n');
    expect(win.get(123)).toBe(4);
    expect(win.get(999)).toBe(123);
    expect(win.size).toBe(3);

    const posix = parseBangTienTrinh('    1     0\n  400   1\n  500   400\n');
    expect(posix.get(500)).toBe(400);
  });
});

describe('timTerminalTheoToTien', () => {
  // shell(100) → wrapper(200) → claude(300); shell khác(110) đứng ngoài
  const parentOf = new Map<number, number>([
    [300, 200],
    [200, 100],
    [100, 1],
    [110, 1],
  ]);
  const shells = new Map<number, string>([
    [100, 'term-a'],
    [110, 'term-b'],
  ]);

  it('đi ngược qua tiến trình trung gian tới đúng shell', () => {
    expect(timTerminalTheoToTien(300, parentOf, shells)).toBe('term-a');
  });

  it('không có tổ tiên nào là shell → null', () => {
    expect(timTerminalTheoToTien(110, parentOf, new Map([[100, 'term-a']]))).toBeNull();
  });

  it('chính pid con là shell thì KHÔNG tính (session không tự chứa mình)', () => {
    expect(timTerminalTheoToTien(100, parentOf, shells)).toBeNull();
  });

  it('chu trình dữ liệu không làm treo', () => {
    const vong = new Map<number, number>([
      [1, 2],
      [2, 1],
    ]);
    expect(timTerminalTheoToTien(1, vong, new Map([[99, 'x']]))).toBeNull();
  });
});

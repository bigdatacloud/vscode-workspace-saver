import { describe, expect, it } from 'vitest';
import { nhayTerminal } from '../../src/workspace/nhay';

describe('nhayTerminal — Ctrl+Tab nhảy qua terminal kế tiếp', () => {
  const ds = ['a', 'b', 'c'];

  it('tiến một bước theo thứ tự trong cây', () => {
    expect(nhayTerminal(ds, 'a', 'toi')).toBe('b');
  });

  it('lùi một bước', () => {
    expect(nhayTerminal(ds, 'b', 'lui')).toBe('a');
  });

  it('ở cuối bấm tiếp thì VÒNG về đầu — vòng mới là thứ người ta mong ở Ctrl+Tab', () => {
    expect(nhayTerminal(ds, 'c', 'toi')).toBe('a');
  });

  it('ở đầu bấm lùi thì vòng xuống cuối', () => {
    expect(nhayTerminal(ds, 'a', 'lui')).toBe('c');
  });

  it('không biết đang đứng ở đâu (focus ngoài terminal) → vào cái đầu danh sách', () => {
    expect(nhayTerminal(ds, null, 'toi')).toBe('a');
    expect(nhayTerminal(ds, 'khong-thuoc-ds', 'toi')).toBe('a');
  });

  it('chỉ một terminal thì ở nguyên đó, không nhấp nháy', () => {
    expect(nhayTerminal(['a'], 'a', 'toi')).toBe('a');
  });

  it('không có terminal nào đang mở → null, lớp UI báo cho người dùng', () => {
    expect(nhayTerminal([], null, 'toi')).toBeNull();
    expect(nhayTerminal([], 'a', 'lui')).toBeNull();
  });
});

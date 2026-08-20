import { describe, expect, it } from 'vitest';
import {
  classifyTerminal,
  pickCwd,
  pickUniqueMatch,
} from '../../src/adopt/filter';

describe('classifyTerminal', () => {
  it('terminal pty của extension khác → suggest', () => {
    expect(classifyTerminal({ isPty: true, creationName: undefined })).toBe('suggest');
    expect(classifyTerminal({ isPty: true, creationName: 'My Ext' })).toBe('suggest');
  });
  it('terminal có tên do task/extension đặt → suggest', () => {
    expect(classifyTerminal({ isPty: false, creationName: 'npm: build' })).toBe('suggest');
  });
  it('tên rỗng/toàn khoảng trắng coi như không tên → auto', () => {
    expect(classifyTerminal({ isPty: false, creationName: '' })).toBe('auto');
    expect(classifyTerminal({ isPty: false, creationName: '   ' })).toBe('auto');
  });
  it('người dùng Ctrl+Shift+` (không tên) → auto', () => {
    expect(classifyTerminal({ isPty: false, creationName: undefined })).toBe('auto');
  });
});

describe('pickCwd', () => {
  it('ưu tiên shellCwd > creationCwd > folderCwd; không có gì → null', () => {
    expect(pickCwd('C:\\a', 'C:\\b', 'C:\\c')).toBe('C:\\a');
    expect(pickCwd(undefined, 'C:\\b', 'C:\\c')).toBe('C:\\b');
    expect(pickCwd(undefined, undefined, 'C:\\c')).toBe('C:\\c');
    expect(pickCwd(undefined, undefined, undefined)).toBeNull();
  });
  it('chuỗi rỗng là giá trị đã xác định — vẫn thắng (chỉ bỏ qua undefined)', () => {
    expect(pickCwd('', 'C:\\b', 'C:\\c')).toBe('');
  });
});

describe('pickUniqueMatch', () => {
  it('trả đúng phần tử khi chỉ có một kết quả', () => {
    expect(pickUniqueMatch([1, 2, 3], (x) => x === 2)).toBe(2);
  });

  it('không đoán khi không có hoặc có nhiều kết quả', () => {
    expect(pickUniqueMatch([1, 2], (x) => x === 3)).toBeUndefined();
    expect(pickUniqueMatch([1, 2, 2], (x) => x === 2)).toBeUndefined();
  });
});

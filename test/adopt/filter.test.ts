import { describe, expect, it } from 'vitest';
import { classifyTerminal, pickCwd } from '../../src/adopt/filter';

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
});

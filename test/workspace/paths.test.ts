import { describe, expect, it } from 'vitest';
import { gopGoiYDuongDan } from '../../src/workspace/paths';

describe('gopGoiYDuongDan', () => {
  it('giữ thứ tự ưu tiên giữa các nhóm và trong từng nhóm', () => {
    expect(
      gopGoiYDuongDan([['D:\\a', 'D:\\b'], ['D:\\c']], true),
    ).toEqual(['D:\\a', 'D:\\b', 'D:\\c']);
  });

  it('win32: trùng không phân biệt hoa thường và kiểu dấu chéo, giữ dạng xuất hiện ĐẦU', () => {
    expect(
      gopGoiYDuongDan([['D:\\Coding\\ERP'], ['d:/coding/erp', 'D:\\Coding\\Khac']], true),
    ).toEqual(['D:\\Coding\\ERP', 'D:\\Coding\\Khac']);
  });

  it('win32: bỏ dấu chéo thừa ở cuối khi so trùng', () => {
    expect(gopGoiYDuongDan([['D:\\a'], ['D:\\a\\']], true)).toEqual(['D:\\a']);
  });

  it('posix: phân biệt hoa thường', () => {
    expect(gopGoiYDuongDan([['/a/B'], ['/a/b']], false)).toEqual(['/a/B', '/a/b']);
  });

  it('bỏ chuỗi rỗng và chuỗi chỉ có khoảng trắng', () => {
    expect(gopGoiYDuongDan([['', '   ', 'D:\\a']], true)).toEqual(['D:\\a']);
  });

  it('cắt khoảng trắng thừa hai đầu', () => {
    expect(gopGoiYDuongDan([['  D:\\a  ']], true)).toEqual(['D:\\a']);
  });
});

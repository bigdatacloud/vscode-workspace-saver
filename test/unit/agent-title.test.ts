import { describe, expect, it } from 'vitest';
import { boKyHieuTrangThai } from '../../src/agent/title';

describe('boKyHieuTrangThai', () => {
  it('cắt ký hiệu trạng thái Claude ghi vào tiêu đề tab', () => {
    expect(boKyHieuTrangThai('✳ longvanai-office-2b')).toBe('longvanai-office-2b');
    expect(boKyHieuTrangThai('◐ work-lsx-dodang')).toBe('work-lsx-dodang');
    expect(boKyHieuTrangThai('◓  vscode-workspace-saver-a6')).toBe('vscode-workspace-saver-a6');
  });

  it('giữ nguyên tên bình thường và tên có emoji khác', () => {
    expect(boKyHieuTrangThai('backend')).toBe('backend');
    expect(boKyHieuTrangThai('🚀 deploy')).toBe('🚀 deploy');
    expect(boKyHieuTrangThai('  dev  ')).toBe('dev');
  });

  it('không bao giờ trả chuỗi rỗng (schema đòi tên tối thiểu 1 ký tự)', () => {
    expect(boKyHieuTrangThai('✳')).toBe('✳');
    expect(boKyHieuTrangThai('◐ ')).toBe('◐');
  });
});

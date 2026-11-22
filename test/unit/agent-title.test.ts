import { describe, expect, it } from 'vitest';
import { boKyHieuTrangThai, khopTenTab } from '../../src/agent/title';

describe('boKyHieuTrangThai', () => {
  it('cắt ký hiệu trạng thái Claude ghi vào tiêu đề tab', () => {
    expect(boKyHieuTrangThai('✳ longvanai-office-2b')).toBe('longvanai-office-2b');
    expect(boKyHieuTrangThai('◐ work-lsx-dodang')).toBe('work-lsx-dodang');
    expect(boKyHieuTrangThai('◓  vscode-workspace-saver-a6')).toBe('vscode-workspace-saver-a6');
  });

  it('cắt spinner Braille của Codex', () => {
    expect(boKyHieuTrangThai('⠏ quality-glance-report-builder')).toBe('quality-glance-report-builder');
    expect(boKyHieuTrangThai('⠹ codex')).toBe('codex');
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

describe('khopTenTab — nhãn tab có phải của terminal này', () => {
  it('khớp dù agent đã ghi ký hiệu trạng thái vào tiêu đề tab', () => {
    // Đây là nợ #002 (anh Ý 26/10/2026): "Terminal đang chạy nhưng không đưa ra trước được".
    // Đường tìm tab so `tab.label === t.name` NGUYÊN VĂN, mà Claude ghi tiêu đề tab thành
    // "<ký hiệu> <tên phiên>" và đổi liên tục — một bên có ký hiệu, bên kia không, nên phép
    // so không bao giờ đúng và vòng xoay tab bỏ qua đúng cái tab cần tìm.
    expect(khopTenTab('✳ fix-login-claude', 'fix-login-claude')).toBe(true);
    expect(khopTenTab('fix-login-claude', '✳ fix-login-claude')).toBe(true);
    expect(khopTenTab('◐ work-a', '⠏ work-a')).toBe(true);
  });

  it('không phân biệt hoa thường và lề trắng', () => {
    expect(khopTenTab('  Fix-Login  ', 'fix-login')).toBe(true);
  });

  it('nhãn rỗng KHÔNG khớp với bất cứ gì', () => {
    // `tab.label` rỗng với tab terminal chưa từng được hiện (đo 25/10/2026) — coi rỗng là
    // khớp thì mọi tab chưa hiện đều thành "đúng cái đang tìm", và lệnh dời sẽ ném tab lạ.
    expect(khopTenTab('', 'fix-login')).toBe(false);
    expect(khopTenTab('   ', 'fix-login')).toBe(false);
    expect(khopTenTab('✳', 'fix-login')).toBe(false);
  });

  it('tên khác thì không khớp', () => {
    expect(khopTenTab('✳ fix-login-claude', 'fix-login-reviewer')).toBe(false);
    expect(khopTenTab('Untitled-1', 'fix-login')).toBe(false);
  });
});

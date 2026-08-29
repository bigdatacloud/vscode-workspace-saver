import { describe, expect, it } from 'vitest';
import { docYeuCau, kiemTraTeam, TOI_DA_THANH_VIEN } from '../../src/orch/bus';

const tv = (role: string, description = 'làm việc gì đó') => ({ role, kind: 'worker' as const, description });

const goi = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: '1', from: 'sep', at: 1, type: 'team', text: 'lập tổ',
    viec: 'dang-nhap',
    thanhVien: [tv('impl'), tv('reviewer')],
    ...over,
  });

describe('đọc yêu cầu lập tổ', () => {
  it('đọc được đề xuất hợp lệ', () => {
    const r = docYeuCau(goi());
    expect(r?.type).toBe('team');
    if (r?.type !== 'team') throw new Error('phải là team');
    expect(r.viec).toBe('dang-nhap');
    expect(r.thanhVien.map((m) => m.role)).toEqual(['impl', 'reviewer']);
  });

  it('thiếu danh sách thành viên → null', () => {
    expect(docYeuCau(goi({ thanhVien: undefined }))).toBeNull();
  });

  it('thành viên thiếu mô tả → null', () => {
    expect(docYeuCau(goi({ thanhVien: [{ role: 'impl', kind: 'worker' }] }))).toBeNull();
  });

  it('phần tử rác trong danh sách làm hỏng cả đề xuất, KHÔNG lọc bỏ im lặng', () => {
    // Khác `files` của report_done: ở đó mất một đường dẫn là chuyện nhỏ, còn ở đây mỗi phần
    // tử là một terminal + một nhánh git sắp được tạo — lọc im lặng là tạo sai số lượng.
    expect(docYeuCau(goi({ thanhVien: [tv('impl'), 7] }))).toBeNull();
  });
});

describe('kiemTraTeam', () => {
  const team = (over: Record<string, unknown> = {}) => ({
    viec: 'dang-nhap',
    thanhVien: [tv('impl'), tv('reviewer')],
    ...over,
  }) as Parameters<typeof kiemTraTeam>[0];

  it('đề xuất hợp lệ thì không có lỗi', () => {
    expect(kiemTraTeam(team())).toBeNull();
  });

  it('danh sách rỗng bị từ chối', () => {
    expect(kiemTraTeam(team({ thanhVien: [] }))).toMatch(/ít nhất/i);
  });

  it('quá nhiều thành viên bị từ chối', () => {
    // Trần cứng: một đề xuất 20 người gần như luôn là mô hình hiểu sai việc, và cái giá là
    // 20 worktree + 20 nhánh git trên máy người dùng.
    const nhieu = Array.from({ length: TOI_DA_THANH_VIEN + 1 }, (_, i) => tv(`vai${i}`));
    expect(kiemTraTeam(team({ thanhVien: nhieu }))).toMatch(/tối đa/i);
  });

  it('tên vai trùng nhau (không phân biệt hoa thường) bị từ chối', () => {
    expect(kiemTraTeam(team({ thanhVien: [tv('impl'), tv('IMPL')] }))).toMatch(/trùng/i);
  });

  it('tên vai không hợp lệ cho nhánh git bị từ chối', () => {
    expect(kiemTraTeam(team({ thanhVien: [tv('người viết')] }))).toMatch(/tên vai/i);
    expect(kiemTraTeam(team({ thanhVien: [tv('-xau')] }))).toMatch(/tên vai/i);
  });

  it('tên việc không hợp lệ cho nhánh git bị từ chối', () => {
    expect(kiemTraTeam(team({ viec: 'đăng nhập' }))).toMatch(/tên việc/i);
    expect(kiemTraTeam(team({ viec: '' }))).toMatch(/tên việc/i);
    expect(kiemTraTeam(team({ viec: 'a/../b' }))).toMatch(/tên việc/i);
  });

  it('mô tả rỗng bị từ chối — vai không mô tả là vai vô dụng', () => {
    expect(kiemTraTeam(team({ thanhVien: [tv('impl', '   ')] }))).toMatch(/mô tả/i);
  });
});

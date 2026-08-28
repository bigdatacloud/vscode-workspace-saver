import { describe, expect, it } from 'vitest';
import { chuyenViTri, vaiTuongUng } from '../../src/workspace/sapxep';
import type { Role } from '../../src/model/schema';

const o = (id: string) => ({ id });
const ten = (ds: { id: string }[]) => ds.map((x) => x.id).join('');

describe('chuyenViTri', () => {
  const ds = [o('a'), o('b'), o('c'), o('d')];

  it('kéo một mục lên chèn TRƯỚC mục đích', () => {
    expect(ten(chuyenViTri(ds, ['d'], 'b'))).toBe('adbc');
  });

  it('kéo xuống cũng chèn trước mục đích', () => {
    expect(ten(chuyenViTri(ds, ['a'], 'd'))).toBe('bcad');
  });

  it('thả ra vùng trống (đích null) thì xuống cuối', () => {
    expect(ten(chuyenViTri(ds, ['a'], null))).toBe('bcda');
  });

  it('thả lên CHÍNH NÓ thì không đổi gì', () => {
    expect(ten(chuyenViTri(ds, ['b'], 'b'))).toBe('abcd');
  });

  it('kéo nhiều mục giữ nguyên thứ tự tương đối giữa chúng', () => {
    expect(ten(chuyenViTri(ds, ['a', 'c'], 'd'))).toBe('bacd');
  });

  it('kéo nhiều mục, thả lên một mục ĐANG BỊ KÉO thì không đổi', () => {
    expect(ten(chuyenViTri(ds, ['a', 'c'], 'c'))).toBe('abcd');
  });

  it('đích không tồn tại thì nối vào cuối, không ném', () => {
    expect(ten(chuyenViTri(ds, ['a'], 'khong-co'))).toBe('bcda');
  });

  it('id kéo không có trong danh sách thì bị bỏ qua', () => {
    expect(ten(chuyenViTri(ds, ['la-hoac'], 'b'))).toBe('abcd');
  });

  it('không đụng vào mảng gốc', () => {
    const goc = [o('a'), o('b')];
    chuyenViTri(goc, ['b'], 'a');
    expect(ten(goc)).toBe('ab');
  });
});

describe('vaiTuongUng', () => {
  const r = (id: string, name: string, kind: Role['kind'] = 'worker'): Role => ({ id, name, kind });
  const REVIEWER = r('r1', 'reviewer');
  const DICH = [r('r9', 'Reviewer'), r('r8', 'impl')];

  it('không có vai thì sang workspace mới cũng không có vai', () => {
    expect(vaiTuongUng(undefined, DICH, false)).toEqual({ loai: 'bo', lyDo: 'khongCoVai' });
  });

  it('workspace đích có vai TRÙNG TÊN thì giữ vai, trỏ sang vai của đích', () => {
    // Vai thuộc về workspace, nên id khác nhau; khớp theo tên là cách duy nhất có nghĩa.
    const kq = vaiTuongUng(REVIEWER, DICH, false);
    expect(kq).toEqual({ loai: 'giu', role: DICH[0] });
  });

  it('khớp tên KHÔNG phân biệt hoa thường', () => {
    expect(vaiTuongUng(r('r1', 'IMPL'), DICH, false)).toEqual({ loai: 'giu', role: DICH[1] });
  });

  it('đích không có vai cùng tên thì bỏ vai', () => {
    expect(vaiTuongUng(r('r1', 'tester'), DICH, false)).toEqual({ loai: 'bo', lyDo: 'dichKhongCoTen' });
  });

  it('vai điều phối mà đích ĐÃ CÓ người điều phối thì bỏ vai', () => {
    // Hai sếp trong một workspace là thứ ràng buộc một-điều-phối sinh ra để chặn; chuyển
    // terminal không được phép là đường vòng qua nó.
    const dich = [r('r9', 'lead', 'orchestrator')];
    expect(vaiTuongUng(r('r1', 'lead', 'orchestrator'), dich, true))
      .toEqual({ loai: 'bo', lyDo: 'dichDaCoDieuPhoi' });
  });

  it('vai điều phối mà đích chưa có ai thì giữ', () => {
    const dich = [r('r9', 'lead', 'orchestrator')];
    expect(vaiTuongUng(r('r1', 'lead', 'orchestrator'), dich, false))
      .toEqual({ loai: 'giu', role: dich[0] });
  });

  it('workspace đích chưa có vai nào', () => {
    expect(vaiTuongUng(REVIEWER, [], false)).toEqual({ loai: 'bo', lyDo: 'dichKhongCoTen' });
  });
});

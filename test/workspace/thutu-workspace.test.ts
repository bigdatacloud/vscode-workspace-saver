import { describe, expect, it } from 'vitest';
import { doiChoHangXom, ghimSauKhiKeo, sapXepWorkspace, type MucSapXep } from '../../src/workspace/sapxep';

const ten = (ds: readonly { id: string }[]) => ds.map((x) => x.id).join(' ');

const m = (id: string, p: { order?: number; lastActiveAt?: string | null; name?: string } = {}): MucSapXep => ({
  id,
  name: p.name ?? id,
  lastActiveAt: p.lastActiveAt ?? null,
  ...(p.order === undefined ? {} : { order: p.order }),
});

describe('sapXepWorkspace — ghim tay nằm trên, phần còn lại vẫn tự sắp theo lần dùng', () => {
  it('không ai ghim thì y như cũ: mới dùng lên đầu, chưa dùng bao giờ xuống cuối', () => {
    const ds = [
      m('cu', { lastActiveAt: '2026-10-01T00:00:00Z' }),
      m('chuadung'),
      m('moi', { lastActiveAt: '2026-10-16T00:00:00Z' }),
    ];
    expect(ten(sapXepWorkspace(ds))).toBe('moi cu chuadung');
  });

  it('cùng mốc thời gian (kể cả cùng null) thì theo tên', () => {
    expect(ten(sapXepWorkspace([m('beta'), m('alpha')]))).toBe('alpha beta');
  });

  it('cái đã ghim đứng TRÊN mọi cái chưa ghim, dù lâu không dùng', () => {
    const ds = [
      m('moi-toanh', { lastActiveAt: '2026-10-16T00:00:00Z' }),
      m('ghim-cu', { order: 0, lastActiveAt: '2024-01-01T00:00:00Z' }),
    ];
    expect(ten(sapXepWorkspace(ds))).toBe('ghim-cu moi-toanh');
  });

  it('nhiều cái ghim thì theo đúng số thứ tự đã ghim, không theo lần dùng', () => {
    const ds = [
      m('b', { order: 1, lastActiveAt: '2026-10-16T00:00:00Z' }),
      m('a', { order: 0, lastActiveAt: '2020-01-01T00:00:00Z' }),
      m('c', { order: 2 }),
    ];
    expect(ten(sapXepWorkspace(ds))).toBe('a b c');
  });

  it('order trùng nhau (file của hai cửa sổ ghi lệch) thì tie-break theo tên, không nhảy loạn', () => {
    const ds = [m('zeta', { order: 0 }), m('alpha', { order: 0 })];
    expect(ten(sapXepWorkspace(ds))).toBe('alpha zeta');
  });

  it('không đụng mảng gốc', () => {
    const goc = [m('b', { order: 1 }), m('a', { order: 0 })];
    sapXepWorkspace(goc);
    expect(ten(goc)).toBe('b a');
  });
});

describe('ghimSauKhiKeo — kéo tới đâu thì ghim tới đó', () => {
  const hienTai = ['a', 'b', 'c', 'd'];

  it('kéo mục cuối lên chèn trước b: thứ tự mới đúng, và CHỈ phần đứng trên bị ghim', () => {
    // Ghim cả tiền tố là cố ý: để "d" thực sự nằm sau "a", "a" cũng phải cố định — nếu "a"
    // còn tự sắp theo lần dùng thì lần kích hoạt kế tiếp của một ws khác là vị trí của "d" đổi.
    const kq = ghimSauKhiKeo(hienTai, ['d'], 'b');
    expect(kq.thuTu).toEqual(['a', 'd', 'b', 'c']);
    expect(kq.ghim).toEqual(['a', 'd']);
  });

  it('kéo lên đầu thì chỉ ghim đúng một mình nó', () => {
    const kq = ghimSauKhiKeo(hienTai, ['c'], 'a');
    expect(kq.thuTu).toEqual(['c', 'a', 'b', 'd']);
    expect(kq.ghim).toEqual(['c']);
  });

  it('thả ra vùng trống (xuống cuối) thì ghim toàn bộ — không còn gì ở dưới để tự sắp', () => {
    const kq = ghimSauKhiKeo(hienTai, ['a'], null);
    expect(kq.thuTu).toEqual(['b', 'c', 'd', 'a']);
    expect(kq.ghim).toEqual(['b', 'c', 'd', 'a']);
  });

  it('kéo nhiều mục: ghim tới mục bị kéo nằm dưới cùng', () => {
    const kq = ghimSauKhiKeo(['a', 'b', 'c', 'd'], ['a', 'c'], 'd');
    expect(kq.thuTu).toEqual(['b', 'a', 'c', 'd']);
    expect(kq.ghim).toEqual(['b', 'a', 'c']);
  });

  it('thả lên chính nó thì không ghim gì — người dùng chỉ nhấc lên đặt xuống chỗ cũ', () => {
    const kq = ghimSauKhiKeo(hienTai, ['b'], 'b');
    expect(kq.thuTu).toEqual(['a', 'b', 'c', 'd']);
    expect(kq.ghim).toEqual([]);
  });

  it('id kéo không có trong danh sách thì không đổi gì và không ghim', () => {
    const kq = ghimSauKhiKeo(hienTai, ['khong-co'], 'b');
    expect(kq.thuTu).toEqual(hienTai);
    expect(kq.ghim).toEqual([]);
  });
});

describe('doiChoHangXom — nút Lên / Xuống', () => {
  const ds = ['a', 'b', 'c'];

  it('lên: đổi chỗ với cái ngay trên', () => {
    expect(doiChoHangXom(ds, 'c', 'len')).toEqual(['a', 'c', 'b']);
  });

  it('xuống: đổi chỗ với cái ngay dưới', () => {
    expect(doiChoHangXom(ds, 'a', 'xuong')).toEqual(['b', 'a', 'c']);
  });

  it('đã ở đầu mà bấm lên thì giữ nguyên, không vòng xuống cuối', () => {
    expect(doiChoHangXom(ds, 'a', 'len')).toEqual(ds);
  });

  it('đã ở cuối mà bấm xuống thì giữ nguyên', () => {
    expect(doiChoHangXom(ds, 'c', 'xuong')).toEqual(ds);
  });

  it('id lạ thì giữ nguyên', () => {
    expect(doiChoHangXom(ds, 'z', 'len')).toEqual(ds);
  });

  it('không đụng mảng gốc', () => {
    const goc = ['a', 'b'];
    doiChoHangXom(goc, 'b', 'len');
    expect(goc).toEqual(['a', 'b']);
  });
});

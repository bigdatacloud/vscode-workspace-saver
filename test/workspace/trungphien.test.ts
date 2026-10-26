import { describe, expect, it } from 'vitest';
import {
  choLamViec,
  phanXuTrungPhien,
  pidDangChay,
  timTerminalTrungCho,
  type PhienDangChay,
  type TerminalDangGiu,
} from '../../src/workspace/trungphien';

const P = (sessionId: string, pid: number | null): PhienDangChay => ({ sessionId, pid });

describe('phanXuTrungPhien — có nên resume phiên này không', () => {
  it('entry chưa có phiên nào thì cứ mở bình thường', () => {
    expect(phanXuTrungPhien(undefined, [], new Map())).toEqual({ loai: 'mo' });
  });

  it('phiên không chạy ở đâu cả → mở bình thường', () => {
    expect(phanXuTrungPhien('s1', [P('s2', 100)], new Map())).toEqual({ loai: 'mo' });
  });

  it('phiên đang chạy trong một terminal của CỬA SỔ NÀY → nhận nuôi, không resume lần hai', () => {
    // Ca thật: hai entry ở hai workspace khác nhau cùng trỏ một sessionId. Kích hoạt cái thứ
    // hai mà cứ resume là sinh ra hai tiến trình ghi chung một file hội thoại.
    const chu = new Map([['s1', 'term-cu']]);
    expect(phanXuTrungPhien('s1', [P('s1', 100)], chu)).toEqual({
      loai: 'daCoChu',
      terminalId: 'term-cu',
    });
  });

  it('có chủ trong cửa sổ này thì KHÔNG cần phiên xuất hiện trong registry', () => {
    // Registry có thể đọc hỏng hoặc chậm một nhịp; terminal ta đang giữ là bằng chứng mạnh hơn.
    expect(phanXuTrungPhien('s1', [], new Map([['s1', 'term-cu']]))).toEqual({
      loai: 'daCoChu',
      terminalId: 'term-cu',
    });
  });

  it('phiên đang chạy nhưng không thuộc terminal nào của cửa sổ này → đang chạy ở NƠI KHÁC', () => {
    expect(phanXuTrungPhien('s1', [P('s1', 100)], new Map())).toEqual({
      loai: 'ngoai',
      soTienTrinh: 1,
    });
  });

  it('đếm đúng số tiến trình đang bám cùng hội thoại — di chứng của những lần resume chồng', () => {
    const kq = phanXuTrungPhien('s1', [P('s1', 100), P('s1', 200), P('s2', 300)], new Map());
    expect(kq).toEqual({ loai: 'ngoai', soTienTrinh: 2 });
  });

  it('hàng registry KHÔNG có pid thì không tính là đang chạy — đó là phiên đã thoát', () => {
    expect(phanXuTrungPhien('s1', [P('s1', null)], new Map())).toEqual({ loai: 'mo' });
  });

  it('chủ trong cửa sổ này thắng cả khi registry còn liệt kê tiến trình ngoài', () => {
    // Ưu tiên nhận nuôi: có terminal sờ được thì dùng nó, đừng hỏi người dùng một câu mà
    // extension tự trả lời được.
    const chu = new Map([['s1', 'term-cu']]);
    expect(phanXuTrungPhien('s1', [P('s1', 1), P('s1', 2)], chu)).toEqual({
      loai: 'daCoChu',
      terminalId: 'term-cu',
    });
  });
});

describe('choLamViec — chỗ làm việc thật của một entry', () => {
  it('không có worktree thì là cwd', () => {
    expect(choLamViec({ cwd: 'D:/Coding/abc' })).toBe('d:/coding/abc');
  });

  it('có worktree thì worktree thắng cwd', () => {
    expect(choLamViec({ cwd: 'D:/Coding/abc', worktree: { path: 'D:/wt/abc-dev' } })).toBe(
      'd:/wt/abc-dev',
    );
  });

  it('bỏ qua khác biệt về dấu gạch, hoa thường và gạch thừa ở cuối', () => {
    expect(choLamViec({ cwd: 'D:\\Coding\\ABC\\' })).toBe(choLamViec({ cwd: 'd:/coding/abc' }));
  });
});

describe('timTerminalTrungCho — phiên trùng tên và trùng chỗ làm việc', () => {
  const G = (terminalId: string, name: string, cwd: string, wt?: string): TerminalDangGiu => ({
    terminalId,
    name,
    cwd,
    ...(wt === undefined ? {} : { worktree: { path: wt } }),
  });
  const E = (id: string, name: string, cwd: string, wt?: string) => ({
    id,
    name,
    cwd,
    ...(wt === undefined ? {} : { worktree: { path: wt } }),
  });

  it('trùng cả tên lẫn thư mục → trả terminal đang giữ', () => {
    expect(timTerminalTrungCho(E('e1', 'kubova-cd', 'D:/Coding/kubova'), [
      G('t9', 'kubova-cd', 'D:/Coding/kubova'),
    ])).toBe('t9');
  });

  it('trùng tên nhưng khác thư mục → không coi là trùng', () => {
    expect(timTerminalTrungCho(E('e1', 'kubova-cd', 'D:/Coding/kubova'), [
      G('t9', 'kubova-cd', 'D:/Coding/khac'),
    ])).toBeNull();
  });

  it('cùng thư mục nhưng khác tên → không coi là trùng', () => {
    expect(timTerminalTrungCho(E('e1', 'kubova-cd', 'D:/Coding/kubova'), [
      G('t9', 'kubova-review', 'D:/Coding/kubova'),
    ])).toBeNull();
  });

  it('chính entry đó đang giữ terminal thì không tự báo trùng với mình', () => {
    expect(timTerminalTrungCho(E('e1', 'kubova-cd', 'D:/Coding/kubova'), [
      G('e1', 'kubova-cd', 'D:/Coding/kubova'),
    ])).toBeNull();
  });

  it('so theo worktree chứ không theo cwd khi entry có worktree riêng', () => {
    // Cùng cwd gốc nhưng hai worktree khác nhau = hai chỗ làm việc khác nhau.
    expect(timTerminalTrungCho(E('e1', 'vof', 'D:/Coding/vof', 'D:/wt/vof-a'), [
      G('t9', 'vof', 'D:/Coding/vof', 'D:/wt/vof-b'),
    ])).toBeNull();
    expect(timTerminalTrungCho(E('e1', 'vof', 'D:/Coding/vof', 'D:/wt/vof-a'), [
      G('t9', 'vof', 'D:/khac', 'D:/wt/vof-a'),
    ])).toBe('t9');
  });

  it('khác hoa thường và kiểu dấu gạch vẫn là một chỗ', () => {
    expect(timTerminalTrungCho(E('e1', 'Kubova-CD', 'D:\\Coding\\kubova'), [
      G('t9', 'kubova-cd', 'd:/coding/Kubova/'),
    ])).toBe('t9');
  });

  it('nhiều cái trùng thì lấy cái đầu, không ném', () => {
    expect(timTerminalTrungCho(E('e1', 'x', 'D:/a'), [G('t1', 'x', 'D:/a'), G('t2', 'x', 'D:/a')])).toBe(
      't1',
    );
  });
});

describe('pidDangChay — tiến trình phải đóng khi giành lại hội thoại', () => {
  it('gom mọi pid sống của đúng hội thoại đó', () => {
    // Một hội thoại có thể đang bị nhiều tiến trình bám (đo trên máy thật 17/10/2026: 2–3
    // cái). Đóng mỗi cái đầu tiên là vẫn còn kẻ ghi chung file phiên.
    expect(pidDangChay('s1', [P('s1', 10), P('s2', 20), P('s1', 30)])).toEqual([10, 30]);
  });

  it('hàng registry đã thoát (pid null) thì không có gì để đóng', () => {
    expect(pidDangChay('s1', [P('s1', null)])).toEqual([]);
  });

  it('registry liệt kê trùng pid thì chỉ đóng một lần', () => {
    expect(pidDangChay('s1', [P('s1', 10), P('s1', 10)])).toEqual([10]);
  });
});

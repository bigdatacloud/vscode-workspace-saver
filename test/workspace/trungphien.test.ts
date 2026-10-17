import { describe, expect, it } from 'vitest';
import { phanXuTrungPhien, type PhienDangChay } from '../../src/workspace/trungphien';

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

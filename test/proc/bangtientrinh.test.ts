import { describe, expect, it } from 'vitest';
import {
  dongLenhTu,
  parseBangTienTrinhDayDu,
  terminalChuaPid,
} from '../../src/proc/dongphien';

const CLAUDE = String.raw`"C:\Users\u\.local\bin\claude.exe" --resume abc`;

describe('parseBangTienTrinhDayDu — một lần quét lấy cả cha lẫn dòng lệnh', () => {
  // Vì sao gộp: mỗi lần `Get-CimInstance Win32_Process` đo trên máy thật 26/10/2026 mất
  // 1,44–1,77 giây lúc máy đang tải. Đọc hai lần (một cho dòng lệnh, một cho phả hệ) là
  // trả giá hai lần cho cùng một bảng.
  it('đọc định dạng Windows (pid|ppid|dòng lệnh)', () => {
    const bang = parseBangTienTrinhDayDu(`30132|5568|${CLAUDE}\r\n5568|15980|pwsh.exe\r\n`);
    expect(bang.get(30132)).toEqual({ cha: 5568, lenh: CLAUDE });
    expect(bang.get(5568)).toEqual({ cha: 15980, lenh: 'pwsh.exe' });
  });

  it('đọc định dạng POSIX (ps -eo pid=,ppid=,args=)', () => {
    const bang = parseBangTienTrinhDayDu('  412   77 node cli.js --resume abc\n   77    1 -bash\n');
    expect(bang.get(412)).toEqual({ cha: 77, lenh: 'node cli.js --resume abc' });
    expect(bang.get(77)).toEqual({ cha: 1, lenh: '-bash' });
  });

  it('tiến trình hệ thống không cho đọc dòng lệnh vẫn phải CÓ MẶT', () => {
    // Vắng mặt mang nghĩa "đã chết", mà nó đang sống. Để trống thì nó rơi vào rổ "người
    // khác" và ta không đụng tới — đúng ý.
    const bang = parseBangTienTrinhDayDu('4|0|\n');
    expect(bang.get(4)).toEqual({ cha: 0, lenh: '' });
  });

  it('dòng rác, dòng trống, header thì bỏ qua', () => {
    const bang = parseBangTienTrinhDayDu('ProcessId|ParentProcessId|CommandLine\n\nrac rac\n7|1|x\n');
    expect([...bang.keys()]).toEqual([7]);
  });

  it('dongLenhTu rút ra đúng bảng mà locPidDongDuoc cần', () => {
    const bang = parseBangTienTrinhDayDu(`10|5|${CLAUDE}\n5|1|pwsh.exe\n`);
    expect(dongLenhTu(bang)).toEqual(new Map([[10, CLAUDE], [5, 'pwsh.exe']]));
  });
});

describe('terminalChuaPid — terminal nào phải đóng theo sau tiến trình vừa bị đóng', () => {
  // Đo trên máy thật 26/10/2026: cả 7 shell pwsh của cửa sổ này đều là con của cùng một
  // pid (15980), nên terminal giữ phiên "ở nơi khác" hoá ra nằm NGAY trong cửa sổ này —
  // `taskkill /T` đi xuống nên claude chết mà vỏ shell ở lại, thành cột rác trong lưới.
  const bang = parseBangTienTrinhDayDu(
    [
      `30132|5568|${CLAUDE}`,
      '5568|15980|pwsh.exe',
      `2676|17728|${CLAUDE}`,
      '17728|15980|pwsh.exe',
      '15980|999|ptyhost',
    ].join('\n'),
  );

  it('truy từ pid claude ngược lên tới shell của terminal', () => {
    expect(terminalChuaPid([30132], bang, new Map([[5568, 'tA'], [17728, 'tB']]))).toEqual(['tA']);
  });

  it('nhiều pid rơi vào nhiều terminal thì trả đủ, không trùng', () => {
    const shell = new Map([[5568, 'tA'], [17728, 'tB']]);
    expect(terminalChuaPid([30132, 2676], bang, shell).sort()).toEqual(['tA', 'tB']);
  });

  it('pid thuộc terminal ta không giữ thì bỏ qua, không đoán bừa', () => {
    expect(terminalChuaPid([30132], bang, new Map([[17728, 'tB']]))).toEqual([]);
  });

  it('KHÔNG leo quá shell để đụng tới ptyhost chung của cả cửa sổ', () => {
    // 15980 là cha của MỌI shell trong cửa sổ. Nhận nó làm "terminal" thì đóng một phiên
    // sẽ kéo sập toàn bộ terminal của cửa sổ.
    const shell = new Map([[5568, 'tA'], [15980, 'CA-CUA-SO']]);
    expect(terminalChuaPid([30132], bang, shell)).toEqual(['tA']);
  });

  it('pid đã biến mất khỏi bảng thì không có terminal nào để đóng', () => {
    expect(terminalChuaPid([99999], bang, new Map([[5568, 'tA']]))).toEqual([]);
  });
});

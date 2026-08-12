import { describe, it, expect } from 'vitest';
import { quoteArg, detectShellKind } from '../../src/agent/quote';

describe('quoteArg powershell', () => {
  it('bọc nháy đơn', () => {
    expect(quoteArg('Coordinator', 'powershell')).toBe("'Coordinator'");
  });
  it('giữ nguyên khoảng trắng và tiếng Việt', () => {
    expect(quoteArg('Tên có dấu', 'powershell')).toBe("'Tên có dấu'");
  });
  it('nhân đôi nháy đơn bên trong', () => {
    expect(quoteArg("it's", 'powershell')).toBe("'it''s'");
  });
  it('không diễn giải $ vì nháy đơn PowerShell là literal', () => {
    expect(quoteArg('$env:PATH', 'powershell')).toBe("'$env:PATH'");
  });
});

describe('quoteArg posix', () => {
  it('bọc nháy đơn', () => {
    expect(quoteArg('Coordinator', 'posix')).toBe("'Coordinator'");
  });
  it('thoát nháy đơn bên trong theo kiểu posix', () => {
    expect(quoteArg("it's", 'posix')).toBe("'it'\\''s'");
  });
  it('không diễn giải $', () => {
    expect(quoteArg('$HOME', 'posix')).toBe("'$HOME'");
  });
});

describe('quoteArg cmd', () => {
  it('bọc nháy kép', () => {
    expect(quoteArg('Coordinator', 'cmd')).toBe('"Coordinator"');
  });
  it('bỏ ký tự nháy kép vì cmd không thoát được an toàn', () => {
    expect(quoteArg('a"b', 'cmd')).toBe('"ab"');
  });
});

describe('detectShellKind', () => {
  it('mặc định powershell trên windows', () => {
    expect(detectShellKind('win32', undefined)).toBe('powershell');
  });
  it('nhận diện pwsh theo đường dẫn', () => {
    expect(detectShellKind('win32', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell');
  });
  it('nhận diện sh.exe (Git for Windows) là posix', () => {
    expect(detectShellKind('win32', 'C:\\Program Files\\Git\\usr\\bin\\sh.exe')).toBe('posix');
  });
  it('nhận diện cmd.exe', () => {
    expect(detectShellKind('win32', 'C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
  });
  it('nhận diện git bash trên windows là posix', () => {
    expect(detectShellKind('win32', 'C:\\Program Files\\Git\\bin\\bash.exe')).toBe('posix');
  });
  it('mặc định posix trên linux và darwin', () => {
    expect(detectShellKind('linux', undefined)).toBe('posix');
    expect(detectShellKind('darwin', '/bin/zsh')).toBe('posix');
  });
});

describe('quoteArg — nháy đơn Unicode (PowerShell coi chúng như dấu nháy thật)', () => {
  // Đo trên PowerShell 7: `Write-Output 'abc’; Write-Output PWNED; ‘x'` chạy thành BA lệnh.
  // Chỉ escape U+0027 là để hở đường chèn lệnh — và một tên copy từ Word cũng đủ làm hỏng lệnh.
  it('nhân đôi cả bốn ký tự nháy đơn mà PowerShell chấp nhận', () => {
    expect(quoteArg('a’b', 'powershell')).toBe("'a’’b'");
    expect(quoteArg('a‘b', 'powershell')).toBe("'a‘‘b'");
    expect(quoteArg('a‚b', 'powershell')).toBe("'a‚‚b'");
    expect(quoteArg('a‛b', 'powershell')).toBe("'a‛‛b'");
  });

  it('chặn được chuỗi chèn lệnh dùng nháy cong', () => {
    const doc = "x’; Write-Output PWNED; ‘y";
    const ra = quoteArg(doc, 'powershell');
    // Sau khi escape, không còn cặp nháy nào ĐƠN LẺ để đóng chuỗi giữa chừng.
    const than = ra.slice(1, -1);
    expect(than.replace(/(['‘’‚‛])\1/g, '')).not.toMatch(/['‘’‚‛]/);
  });

  it('posix chỉ cần lo U+0027, nháy cong là ký tự thường', () => {
    expect(quoteArg('a’b', 'posix')).toBe("'a’b'");
  });
});

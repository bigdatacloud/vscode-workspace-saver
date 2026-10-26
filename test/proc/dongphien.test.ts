import { describe, expect, it } from 'vitest';
import { locPidDongDuoc, parseBangDongLenh } from '../../src/proc/dongphien';

const CLAUDE = String.raw`"C:\Program Files\nodejs\node.exe" "C:\Users\u\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js" --resume abc`;

describe('locPidDongDuoc — pid nào được phép đóng', () => {
  it('pid vẫn đang là một tiến trình claude thì đóng', () => {
    const bang = new Map([[10, CLAUDE], [11, 'explorer.exe']]);
    expect(locPidDongDuoc([10], bang)).toEqual({
      docDuoc: true, dong: [10], daChet: [], laNguoiKhac: [],
    });
  });

  it('pid không còn trong bảng = tiến trình đã chết, không phải lỗi', () => {
    // Registry claude có hàng CŨ của tiến trình đã thoát; gặp hàng như thế thì coi như
    // đã đóng rồi, đừng bắt người dùng chịu một thông báo lỗi vô nghĩa.
    const bang = new Map([[11, 'explorer.exe']]);
    expect(locPidDongDuoc([10], bang)).toEqual({
      docDuoc: true, dong: [], daChet: [10], laNguoiKhac: [],
    });
  });

  it('pid đã bị hệ điều hành cấp lại cho chương trình khác thì KHÔNG đóng', () => {
    // Đây là lý do phải soi dòng lệnh chứ không tin thẳng registry: hàng cũ + pid tái sử
    // dụng = ta giết nhầm chương trình của người dùng.
    const bang = new Map([[10, String.raw`C:\Windows\System32\notepad.exe`]]);
    expect(locPidDongDuoc([10], bang)).toEqual({
      docDuoc: true, dong: [], daChet: [], laNguoiKhac: [10],
    });
  });

  it('bảng rỗng = đọc hỏng, không dám đóng gì', () => {
    // Máy nào cũng có tiến trình, nên rỗng chỉ có thể là lỗi đọc. Coi nó như "mọi pid đã
    // chết" thì ta vừa không đóng được gì vừa báo thành công — rồi resume chồng.
    expect(locPidDongDuoc([10], new Map())).toEqual({
      docDuoc: false, dong: [], daChet: [], laNguoiKhac: [],
    });
  });

  it('nhiều pid thì chia đúng từng rổ', () => {
    const bang = new Map([[10, CLAUDE], [12, 'notepad.exe']]);
    expect(locPidDongDuoc([10, 11, 12], bang)).toEqual({
      docDuoc: true, dong: [10], daChet: [11], laNguoiKhac: [12],
    });
  });
});

describe('parseBangDongLenh — đọc bảng pid → dòng lệnh của hệ điều hành', () => {
  it('đọc định dạng Windows (pid|dòng lệnh)', () => {
    const bang = parseBangDongLenh(['4|', '10|node cli.js --resume abc', '11|notepad.exe'].join('\n'));
    expect(bang.get(10)).toBe('node cli.js --resume abc');
    expect(bang.get(11)).toBe('notepad.exe');
  });

  it('tiến trình hệ thống không cho đọc dòng lệnh vẫn phải CÓ MẶT trong bảng', () => {
    // Vắng mặt nghĩa là "đã chết" — mà nó đang sống. Để trống thì nó rơi vào rổ "người
    // khác" và ta không đụng tới, đúng ý.
    expect(parseBangDongLenh('4|').get(4)).toBe('');
  });

  it('đọc định dạng POSIX (ps -eo pid=,args=)', () => {
    const bang = parseBangDongLenh('  10 /usr/bin/node cli.js --resume abc\n  11 /usr/bin/vim');
    expect(bang.get(10)).toBe('/usr/bin/node cli.js --resume abc');
    expect(bang.get(11)).toBe('/usr/bin/vim');
  });

  it('dòng rác, dòng trống, header thì bỏ qua', () => {
    expect(parseBangDongLenh('\nPID CMD\nlung tung\n').size).toBe(0);
  });
});

describe('nhận diện tiến trình claude — đo trên máy thật 26/10/2026', () => {
  const laClaude = (lenh: string): boolean => locPidDongDuoc([1], new Map([[1, lenh]])).dong.length === 1;

  it('nhận đủ các dạng khởi chạy thật', () => {
    expect(laClaude(String.raw`"C:\Users\LAPTOP\.local\bin\claude.exe" --dangerously-skip-permissions`)).toBe(true);
    expect(laClaude(String.raw`node C:\npm\node_modules\@anthropic-ai\claude-code\cli.js --resume x`)).toBe(true);
    expect(laClaude('/usr/local/bin/claude --resume x')).toBe(true);
    expect(laClaude(String.raw`C:\npm\claude.cmd --resume x`)).toBe(true);
  });

  it('KHÔNG nhận tiến trình chỉ vì đường dẫn có thư mục .claude', () => {
    // Đo thật trên máy này: MCP server và hook đều nằm dưới ~/.claude/plugins/... Lọc bằng
    // "có chữ claude" là coi mọi MCP server là phiên claude — pid tái sử dụng rơi trúng một
    // cái là ta giết nhầm.
    expect(
      laClaude('node C:/Users/LAPTOP/.claude/plugins/cache/superpowers-chrome/mcp/dist/index.js'),
    ).toBe(false);
    expect(laClaude(String.raw`node C:\Users\LAPTOP\.claude\hooks\paste-image.js`)).toBe(false);
  });

  it('KHÔNG nhận cửa sổ editor mở thư mục tên claude-gì-đó', () => {
    expect(laClaude(String.raw`Code.exe D:\Coding\claude-plugins`)).toBe(false);
  });
});

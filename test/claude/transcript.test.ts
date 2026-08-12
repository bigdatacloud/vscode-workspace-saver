import { describe, expect, it } from 'vitest';
import { dangChoNguoiDung, duongDanTranscript } from '../../src/claude/transcript';

const dong = (o: unknown) => JSON.stringify(o);
const assistant = (...blocks: unknown[]) =>
  dong({ type: 'assistant', message: { role: 'assistant', content: blocks } });
const user = (...blocks: unknown[]) =>
  dong({ type: 'user', message: { role: 'user', content: blocks } });
const hoi = { type: 'tool_use', name: 'AskUserQuestion', id: 't1' };
const chayBash = { type: 'tool_use', name: 'Bash', id: 't2' };
const ketQua = { type: 'tool_result', tool_use_id: 't1' };
const chu = { type: 'text', text: 'xong rồi' };
const nghi = { type: 'thinking', thinking: '…' };

describe('dangChoNguoiDung', () => {
  it('AskUserQuestion chưa có tool_result → đang chờ (kể cả registry nói busy)', () => {
    const t = [user(chu), assistant(nghi), assistant(hoi)].join('\n');
    expect(dangChoNguoiDung(t, true)).toBe(true);
    expect(dangChoNguoiDung(t, false)).toBe(true);
  });

  it('đã có tool_result sau đó → KHÔNG còn chờ', () => {
    const t = [assistant(hoi), user(ketQua)].join('\n');
    expect(dangChoNguoiDung(t, true)).toBe(false);
  });

  it('lượt kết thúc bằng văn bản → rảnh thật, không phải chờ', () => {
    const t = [assistant(hoi), user(ketQua), assistant(chu)].join('\n');
    expect(dangChoNguoiDung(t, true)).toBe(false);
  });

  it('tool thường dangling: chờ khi tiến trình RẢNH (chờ duyệt quyền), không chờ khi đang BẬN', () => {
    const t = [user(chu), assistant(chayBash)].join('\n');
    expect(dangChoNguoiDung(t, true)).toBe(true); // idle + tool chưa xong = đang hỏi quyền
    expect(dangChoNguoiDung(t, false)).toBe(false); // busy = tool đang chạy thật
  });

  it('bỏ qua bản ghi metadata ở đuôi file (custom-title, mode…) và dòng cụt/rác', () => {
    const t = [
      '{"type":"mode","mode":"default"}',
      assistant(hoi),
      '{"type":"custom-title","title":"x"}',
      '{ dòng cụt không phải json',
    ].join('\n');
    expect(dangChoNguoiDung(t, true)).toBe(true);
  });

  it('đuôi file rỗng / không có message nào → không kết luận đang chờ', () => {
    expect(dangChoNguoiDung('', true)).toBe(false);
    expect(dangChoNguoiDung('{"type":"summary"}', true)).toBe(false);
  });
});

describe('duongDanTranscript', () => {
  it('đổi ổ đĩa và dấu chéo thành gạch ngang đúng như Claude Code đặt tên thư mục', () => {
    expect(duongDanTranscript('/home/.claude', 'D:\\Coding\\longvanai-office', 'abc', '/')).toBe(
      '/home/.claude/projects/D--Coding-longvanai-office/abc.jsonl',
    );
  });

  it('đường dẫn posix cũng đổi dấu chéo', () => {
    expect(duongDanTranscript('/h/.claude', '/a/b', 's1', '/')).toBe(
      '/h/.claude/projects/-a-b/s1.jsonl',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { dangChoNguoiDung, duongDanTranscript, tomTatTranscript } from '../../src/claude/transcript';

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

describe('tomTatTranscript', () => {
  const dong = (o: unknown) => JSON.stringify(o);
  const user = (text: string) => dong({ message: { role: 'user', content: [{ type: 'text', text }] } });
  const assistant = (khoi: unknown[]) => dong({ message: { role: 'assistant', content: khoi } });

  it('tóm tắt lượt user và assistant theo đúng thứ tự', () => {
    const file = [user('sửa login đi'), assistant([{ type: 'text', text: 'ok làm ngay' }])].join('\n');
    const r = tomTatTranscript(file, 10);
    expect(r).toContain('sửa login đi');
    expect(r).toContain('ok làm ngay');
    expect(r.indexOf('sửa login đi')).toBeLessThan(r.indexOf('ok làm ngay'));
  });

  it('nêu tool đã gọi kèm file bị đụng — đây là thứ người kiểm tra cần nhất', () => {
    const file = assistant([
      { type: 'tool_use', name: 'Edit', input: { file_path: 'src/auth.ts' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
    ]);
    const r = tomTatTranscript(file, 10);
    expect(r).toContain('Edit');
    expect(r).toContain('src/auth.ts');
    expect(r).toContain('Bash');
    expect(r).toContain('npm test');
  });

  it('chỉ giữ số lượt cuối được yêu cầu', () => {
    const file = [user('một'), user('hai'), user('ba')].join('\n');
    const r = tomTatTranscript(file, 1);
    expect(r).toContain('ba');
    expect(r).not.toContain('một');
  });

  it('dòng cụt hoặc rác bị bỏ qua, không ném', () => {
    expect(() => tomTatTranscript('{cut giua chung\nrac\n' + user('ok'), 5)).not.toThrow();
    expect(tomTatTranscript('{cut\n' + user('ok'), 5)).toContain('ok');
  });

  it('văn bản rất dài bị cắt để không nuốt hết cửa sổ ngữ cảnh của người điều phối', () => {
    const r = tomTatTranscript(user('x'.repeat(5000)), 5);
    expect(r.length).toBeLessThan(1200);
  });

  it('transcript rỗng trả chuỗi rỗng', () => {
    expect(tomTatTranscript('', 10)).toBe('');
  });
});

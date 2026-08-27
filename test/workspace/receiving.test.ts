import { describe, expect, it } from 'vitest';
import { chonWorkspaceNhan } from '../../src/workspace/receiving';

const A = 'ws-a';
const B = 'ws-b';

/** Bảng tra "terminal key -> workspace" đóng vai TerminalManager + store thật. */
const tra = (bang: Record<string, string>) => (key: string): string | null => bang[key] ?? null;

describe('chonWorkspaceNhan', () => {
  it('terminal đang focus thuộc workspace nào thì nhận vào workspace đó', () => {
    // B mở SAU A, nhưng đang gõ trong terminal của A -> phải là A.
    expect(chonWorkspaceNhan('t1', tra({ t1: A }), [A, B])).toBe(A);
  });

  it('không focus terminal nào thì rơi về workspace mở gần nhất', () => {
    expect(chonWorkspaceNhan(null, tra({ t1: A }), [A, B])).toBe(B);
  });

  it('terminal đang focus không thuộc workspace nào thì rơi về workspace mở gần nhất', () => {
    expect(chonWorkspaceNhan('la-hoac', tra({ t1: A }), [A, B])).toBe(B);
  });

  it('terminal đang focus thuộc workspace ĐÃ ĐÓNG thì rơi về workspace mở gần nhất', () => {
    // Terminal vẫn còn sống sau khi workspace của nó bị đóng là chuyện có thật (adopt rồi
    // release). Nhận terminal mới vào một workspace không mở là làm nó biến mất khỏi tầm mắt.
    expect(chonWorkspaceNhan('t1', tra({ t1: 'ws-da-dong' }), [A, B])).toBe(B);
  });

  it('không có workspace nào đang mở thì không nhận vào đâu cả', () => {
    expect(chonWorkspaceNhan('t1', tra({ t1: A }), [])).toBeNull();
  });
});

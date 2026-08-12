import { describe, expect, it } from 'vitest';
import type { RunningSession } from '../../src/agent/types';
import { chonSessionChoTerminal, gomSessionTheoTerminal } from '../../src/claude/ancestry';

const SID1 = '11111111-1111-4111-8111-111111111111';
const SID2 = '22222222-2222-4222-8222-222222222222';

const s = (over: Partial<RunningSession>): RunningSession => ({
  sessionId: SID1, name: 'a', cwd: 'D:\\x', pid: 100, kind: 'interactive', status: 'idle', ...over,
});

// Dựng theo cấu trúc tiến trình THẬT đo được trên Windows: claude.exe là con trực tiếp của
// pwsh.exe (shell của terminal), pwsh là con của Code.exe.
const CODE = 16188;
const parentOf = new Map<number, number>([
  [23676, 24684], [24684, CODE], // claude → shell A
  [23700, 23676], // claude con, do claude ở trên gọi ra (vẫn thuộc shell A)
  [27008, 31724], [31724, CODE], // claude → shell B
  [29516, 30624], [30624, CODE], // claude → shell C
  [CODE, 8920],
]);
const shellPids = new Map<number, string>([[24684, 'tA'], [31724, 'tB'], [30624, 'tC']]);

describe('gomSessionTheoTerminal', () => {
  it('quy từng session về đúng terminal theo tổ tiên, không cần cwd khớp', () => {
    const a = s({ pid: 23676, cwd: 'D:\\repo-khac' });
    const b = s({ sessionId: SID2, pid: 27008 });
    const { theoTerminal, pidNgoai } = gomSessionTheoTerminal([a, b], parentOf, shellPids);
    expect(theoTerminal.get('tA')).toEqual([a]);
    expect(theoTerminal.get('tB')).toEqual([b]);
    expect(pidNgoai).toEqual([]);
  });

  it('pid không thuộc terminal nào → vào pidNgoai, không gán bừa', () => {
    const ngoai = s({ pid: 99999 });
    const { theoTerminal, pidNgoai } = gomSessionTheoTerminal([ngoai], parentOf, shellPids);
    expect(theoTerminal.size).toBe(0);
    expect(pidNgoai).toEqual([99999]);
  });

  it('hai tiến trình CÙNG sessionId (resume hai lần) → chỉ tính tiến trình đầu', () => {
    const dau = s({ pid: 23676 });
    const sau = s({ pid: 29516 }); // cùng SID1, terminal khác
    const { theoTerminal } = gomSessionTheoTerminal([dau, sau], parentOf, shellPids);
    expect(theoTerminal.get('tA')).toEqual([dau]);
    expect(theoTerminal.has('tC')).toBe(false);
  });

  it('không terminal nào có pid shell (chưa kịp đọc processId) → không gán gì', () => {
    const { theoTerminal, pidNgoai } = gomSessionTheoTerminal(
      [s({ pid: 23676 })], parentOf, new Map(),
    );
    expect(theoTerminal.size).toBe(0);
    expect(pidNgoai).toEqual([23676]);
  });

  it('bảng tiến trình rỗng (đọc hỏng) → không gán bừa cho ai', () => {
    const { theoTerminal } = gomSessionTheoTerminal([s({ pid: 23676 })], new Map(), shellPids);
    expect(theoTerminal.size).toBe(0);
  });

  it('hàng CHẾT xếp trước hàng sống của cùng session → hàng sống vẫn được nhận', () => {
    // Registry từng trả hai dòng cùng sessionId; nếu khử trùng trước khi phân giải thì dòng
    // chết (pid không còn trong bảng tiến trình) đốt mất id và terminal thật không bao giờ nhận.
    const chet = s({ pid: 99999 });
    const song = s({ pid: 23676 });
    const { theoTerminal, pidNgoai } = gomSessionTheoTerminal([chet, song], parentOf, shellPids);
    expect(theoTerminal.get('tA')).toEqual([song]);
    expect(pidNgoai).toEqual([]); // pid chết không bị ghi là "ngoài cửa sổ này"
  });

  it('session không có pid bị bỏ qua, không suy đoán', () => {
    const { theoTerminal, pidNgoai } = gomSessionTheoTerminal(
      [s({ pid: null })], parentOf, shellPids,
    );
    expect(theoTerminal.size).toBe(0);
    expect(pidNgoai).toEqual([]);
  });

  it('nhiều claude trong CÙNG một terminal (claude gọi claude) → gom vào một danh sách', () => {
    const cha = s({ pid: 23676 });
    const con = s({ sessionId: SID2, pid: 23700 }); // con của claude trên, cùng tổ tiên shell A
    const { theoTerminal } = gomSessionTheoTerminal([cha, con], parentOf, shellPids);
    expect(theoTerminal.get('tA')).toEqual([cha, con]);
  });
});

describe('chonSessionChoTerminal', () => {
  const x = s({ pid: 1 });
  const y = s({ sessionId: SID2, pid: 2 });

  it('giữ nguyên session đang ôm nếu nó còn trong danh sách (không nhấp nháy)', () => {
    expect(chonSessionChoTerminal([x, y], SID2)).toBe(y);
  });

  it('chưa ôm gì / id đang ôm đã chết → lấy cái đầu', () => {
    expect(chonSessionChoTerminal([x, y], undefined)).toBe(x);
    expect(chonSessionChoTerminal([x, y], 'khong-ton-tai')).toBe(x);
  });

  it('danh sách rỗng → null', () => {
    expect(chonSessionChoTerminal([], SID1)).toBeNull();
  });
});

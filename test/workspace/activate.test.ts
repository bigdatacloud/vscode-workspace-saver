import { describe, expect, it, vi } from 'vitest';
import type { AgentAdapter, LaunchSpec } from '../../src/agent/types';
import type { TerminalEntry, Workspace } from '../../src/model/schema';
import { activateWorkspace, type ActivatePorts } from '../../src/workspace/activate';

const U = (n: string) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

const fakeAgent = (minted: string): AgentAdapter => ({
  id: 'fake',
  newSessionId: () => minted,
  buildLaunchCommand: (spec: LaunchSpec) =>
    spec.mode.kind === 'continue'
      ? `LAUNCH continue AS ${spec.name}`
      : `LAUNCH ${spec.mode.kind} ${spec.mode.sessionId} AS ${spec.name}`,
  listRunning: async () => [],
  ownsCommand: () => false,
  buildLaunchOptions: () => [],
});

function ws(terminals: TerminalEntry[]): Workspace {
  return { id: U('1'), name: 'X', lastActiveAt: null, activeWindowId: null, terminals };
}

function makePorts(over: Partial<ActivatePorts> = {}) {
  const sent = new Map<string, string[]>();
  const calls: string[] = [];
  const ports: ActivatePorts = {
    createTerminal: (e) => {
      calls.push(`create:${e.id}`);
      const box: string[] = [];
      sent.set(e.id, box);
      return { sendText: (t) => { calls.push(`send:${e.id}`); box.push(t); } };
    },
    agent: fakeAgent(U('9')),
    fsExists: () => true,
    isTrusted: () => true,
    confirmTrust: async () => true,
    // Bằng chứng theo ENTRY, không theo chuỗi lệnh (xem ghi chú ở ActivatePorts).
    laLenhAgent: (e) => e.kind === 'claude' || e.agentId === 'codex',
    lenhTiepTucAgent: () => null,
    coPhienDangChayNgoai: () => false,
    onMinted: async () => { calls.push('minted'); },
    warn: () => {},
    ...over,
  };
  return { ports, sent, calls };
}

const claudeNew: TerminalEntry = { id: U('2'), name: 'agent-a', cwd: 'D:\\x', kind: 'claude' };
const claudeResume: TerminalEntry = { ...claudeNew, id: U('3'), claudeSessionId: U('5'), claudeName: 'peer-b' };
const plainCmd: TerminalEntry = { id: U('4'), name: 'dev', cwd: 'D:\\x', kind: 'plain', startCommand: 'npm run dev' };

describe('activateWorkspace', () => {
  // Khôi phục KHÔNG BAO GIỜ được mở một hội thoại trắng: người dùng mở lại workspace là để
  // làm tiếp chỗ dở. Có id thì --resume đúng hội thoại đó; chưa bắt được id thì nối lại hội
  // thoại gần nhất của thư mục (`continue`), tuyệt đối không mint phiên mới.
  it('claude có sessionId → resume; CHƯA có id → continue, không mint phiên mới', async () => {
    const { ports, sent, calls } = makePorts();
    const r = await activateWorkspace(ws([claudeResume, claudeNew]), ports);
    expect(r.opened).toEqual([claudeResume.id, claudeNew.id]);
    expect(sent.get(claudeResume.id)).toEqual([`LAUNCH resume ${U('5')} AS peer-b`]);
    expect(sent.get(claudeNew.id)).toEqual(['LAUNCH continue AS agent-a']);
    expect(calls).not.toContain('minted');
  });

  it('entry codex chưa có id phiên → nối lại phiên gần nhất thay vì chạy lại lệnh khởi chạy', async () => {
    const codexMoi: TerminalEntry = {
      id: U('8'), name: 'cdx', cwd: 'D:\\x', kind: 'plain', agentId: 'codex', startCommand: 'codex',
    };
    const { ports, sent } = makePorts({
      lenhTiepTucAgent: (e) => (e.agentId === 'codex' && e.agentSessionId === undefined
        ? 'codex resume --last'
        : null),
    });
    await activateWorkspace(ws([codexMoi]), ports);
    expect(sent.get(codexMoi.id)).toEqual(['codex resume --last']);
  });

  it('plain có startCommand + đã trust → gửi lệnh; không startCommand → chỉ mở', async () => {
    const { ports, sent } = makePorts();
    const bare: TerminalEntry = { id: U('6'), name: 'sh', cwd: 'D:\\x', kind: 'plain' };
    await activateWorkspace(ws([plainCmd, bare]), ports);
    expect(sent.get(plainCmd.id)).toEqual(['npm run dev']);
    expect(sent.get(U('6'))).toEqual([]);
  });

  it('chưa trust + người dùng từ chối → mở shell không chạy lệnh, claude vẫn chạy', async () => {
    const { ports, sent } = makePorts({ isTrusted: () => false, confirmTrust: async () => false });
    await activateWorkspace(ws([plainCmd, claudeResume]), ports);
    expect(sent.get(plainCmd.id)).toEqual([]);
    expect(sent.get(claudeResume.id)).toHaveLength(1);
  });

  it('lệnh agent (codex resume) chạy mà KHÔNG qua cổng trust, kể cả khi người dùng từ chối', async () => {
    // Entry codex là `plain` + startCommand do extension dựng: người dùng đã chủ động tạo nó,
    // còn trust sinh ra để chặn lệnh tự bắt được hoặc gõ tay.
    const confirmTrust = vi.fn(async () => false);
    const { ports, sent } = makePorts({ isTrusted: () => false, confirmTrust });
    const codex: TerminalEntry = {
      id: U('8'), name: 'codex', cwd: 'D:\\x', kind: 'plain',
      agentId: 'codex', agentSessionId: U('5'), startCommand: `codex resume '${U('5')}'`,
    };
    await activateWorkspace(ws([codex, plainCmd]), ports);
    expect(sent.get(U('8'))).toEqual([`codex resume '${U('5')}'`]);
    // Lệnh thường vẫn bị chặn vì người dùng từ chối.
    expect(sent.get(plainCmd.id)).toEqual([]);
    // Và lệnh agent KHÔNG lọt vào danh sách xin tin cậy.
    expect(confirmTrust).toHaveBeenCalledWith(['npm run dev']);
  });

  it('không có startCommand nào → không hỏi trust', async () => {
    const isTrusted = vi.fn(() => true);
    const confirmTrust = vi.fn(async () => true);
    const { ports } = makePorts({ isTrusted, confirmTrust });
    await activateWorkspace(ws([claudeResume]), ports);
    expect(isTrusted).not.toHaveBeenCalled();
    expect(confirmTrust).not.toHaveBeenCalled();
  });

  it('cwd mất → failed nêu đường dẫn, entry khác vẫn chạy', async () => {
    const { ports, sent } = makePorts({ fsExists: (p) => p !== 'D:\\mat' });
    const gone: TerminalEntry = { ...plainCmd, id: U('7'), cwd: 'D:\\mat' };
    const r = await activateWorkspace(ws([gone, claudeResume]), ports);
    expect(r.failed).toEqual([{ id: U('7'), reason: expect.stringContaining('D:\\mat') }]);
    expect(sent.get(claudeResume.id)).toHaveLength(1);
  });

  it('createTerminal ném → cô lập vào failed, không văng ra ngoài', async () => {
    const { ports, sent } = makePorts();
    const boom = ports.createTerminal;
    ports.createTerminal = (e) => {
      if (e.id === claudeResume.id) throw new Error('nổ');
      return boom(e);
    };
    const r = await activateWorkspace(ws([claudeResume, plainCmd]), ports);
    expect(r.failed).toEqual([{ id: claudeResume.id, reason: 'nổ' }]);
    expect(sent.get(plainCmd.id)).toEqual(['npm run dev']);
  });
});

describe('activateWorkspace — không bao giờ nối `-c` vào hội thoại đang có tiến trình khác', () => {
  const claudeA: TerminalEntry = { id: U('a'), name: 'a', cwd: 'D:\\x', kind: 'claude' };
  const claudeB: TerminalEntry = { id: U('b'), name: 'b', cwd: 'D:\\x', kind: 'claude' };

  it('thư mục còn phiên đang chạy mà ta không nhận nuôi được → mint phiên MỚI, không `-c`', async () => {
    const { ports, sent, calls } = makePorts({ coPhienDangChayNgoai: () => true });
    await activateWorkspace(ws([claudeA]), ports);
    expect(sent.get(claudeA.id)).toEqual([`LAUNCH new ${U('9')} AS a`]);
    expect(calls).toContain('minted');
  });

  it('hai entry CÙNG thư mục: chỉ cái đầu được `-c`, cái sau mint mới', async () => {
    const { ports, sent } = makePorts();
    await activateWorkspace(ws([claudeA, claudeB]), ports);
    expect(sent.get(claudeA.id)).toEqual(['LAUNCH continue AS a']);
    expect(sent.get(claudeB.id)).toEqual([`LAUNCH new ${U('9')} AS b`]);
  });

  it('id mint phải nằm trên đĩa TRƯỚC khi lệnh chạy (chống mồ côi hội thoại)', async () => {
    const { ports, calls } = makePorts({ coPhienDangChayNgoai: () => true });
    await activateWorkspace(ws([claudeA]), ports);
    expect(calls.indexOf('minted')).toBeLessThan(calls.indexOf(`send:${claudeA.id}`));
  });
});

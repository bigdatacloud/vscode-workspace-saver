import { describe, expect, it, vi } from 'vitest';
import type { AgentAdapter, LaunchSpec } from '../../src/agent/types';
import type { TerminalEntry, Workspace } from '../../src/model/schema';
import { activateWorkspace, type ActivatePorts } from '../../src/workspace/activate';

const U = (n: string) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

const fakeAgent = (minted: string): AgentAdapter => ({
  id: 'fake',
  newSessionId: () => minted,
  buildLaunchCommand: (spec: LaunchSpec) => `LAUNCH ${spec.mode.kind} ${spec.mode.sessionId} AS ${spec.name}`,
  listRunning: async () => [],
  isAvailable: async () => true,
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
  it('claude có sessionId → resume với claudeName; thiếu → mint, onMinted TRƯỚC sendText', async () => {
    const { ports, sent, calls } = makePorts();
    const r = await activateWorkspace(ws([claudeResume, claudeNew]), ports);
    expect(r.opened).toEqual([claudeResume.id, claudeNew.id]);
    expect(sent.get(claudeResume.id)).toEqual([`LAUNCH resume ${U('5')} AS peer-b`]);
    expect(sent.get(claudeNew.id)).toEqual([`LAUNCH new ${U('9')} AS agent-a`]);
    const mintedIdx = calls.indexOf('minted');
    const sendIdx = calls.indexOf(`send:${claudeNew.id}`);
    expect(mintedIdx).toBeGreaterThanOrEqual(0);
    expect(mintedIdx).toBeLessThan(sendIdx);
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

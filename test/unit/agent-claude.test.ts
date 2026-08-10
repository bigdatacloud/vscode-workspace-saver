import { describe, it, expect } from 'vitest';
import { ClaudeCodeAdapter, type CommandRunner } from '../../src/agent/claude';

const UUID = '639a2ba8-e4f0-4e0b-917c-6ab773c8a922';

const stubRunner = (stdout: string, code = 0): CommandRunner => ({
  run: async () => ({ stdout, code }),
});

describe('buildLaunchCommand', () => {
  const adapter = new ClaudeCodeAdapter('powershell', stubRunner('[]'), () => UUID);

  it('session mới dùng --session-id và -n', () => {
    const cmd = adapter.buildLaunchCommand({ name: 'Coordinator', mode: { kind: 'new', sessionId: UUID } });
    expect(cmd).toBe(`claude --session-id '${UUID}' -n 'Coordinator'`);
  });

  it('resume dùng --resume và -n', () => {
    const cmd = adapter.buildLaunchCommand({ name: 'Coordinator', mode: { kind: 'resume', sessionId: UUID } });
    expect(cmd).toBe(`claude --resume '${UUID}' -n 'Coordinator'`);
  });

  it('quote tên có khoảng trắng và tiếng Việt', () => {
    const cmd = adapter.buildLaunchCommand({ name: 'Tổ Backend', mode: { kind: 'new', sessionId: UUID } });
    expect(cmd).toContain("-n 'Tổ Backend'");
  });

  it('dùng quoting của posix khi shell là posix', () => {
    const posix = new ClaudeCodeAdapter('posix', stubRunner('[]'), () => UUID);
    const cmd = posix.buildLaunchCommand({ name: "Bob's team", mode: { kind: 'new', sessionId: UUID } });
    expect(cmd).toBe(`claude --session-id '${UUID}' -n 'Bob'\\''s team'`);
  });
});

describe('newSessionId', () => {
  it('trả uuid từ hàm được tiêm vào', () => {
    const adapter = new ClaudeCodeAdapter('posix', stubRunner('[]'), () => UUID);
    expect(adapter.newSessionId()).toBe(UUID);
  });
});

describe('listRunning', () => {
  it('trả danh sách khi lệnh chạy được', async () => {
    const out = JSON.stringify([
      { pid: 1, cwd: '/a', kind: 'interactive', sessionId: UUID, name: 'X', status: 'idle' },
    ]);
    const adapter = new ClaudeCodeAdapter('posix', stubRunner(out), () => UUID);
    expect(await adapter.listRunning()).toHaveLength(1);
  });

  it('trả mảng rỗng khi lệnh lỗi thay vì ném', async () => {
    const adapter = new ClaudeCodeAdapter('posix', stubRunner('', 127), () => UUID);
    expect(await adapter.listRunning()).toEqual([]);
  });
});


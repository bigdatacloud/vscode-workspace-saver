import { describe, it, expect } from 'vitest';
import { ClaudeCodeAdapter, type CommandRunner } from '../../src/agent/claude';

const UUID = '639a2ba8-e4f0-4e0b-917c-6ab773c8a922';

const stubRunner = (stdout: string, code = 0): CommandRunner => ({
  run: async () => ({ stdout, code }),
});

describe('ownsCommand', () => {
  const adapter = new ClaudeCodeAdapter('powershell', stubRunner('[]'), () => UUID);

  it('nhận diện lệnh claude (trần, có cờ, có khoảng trắng đầu, hoa thường lẫn lộn)', () => {
    expect(adapter.ownsCommand('claude')).toBe(true);
    expect(adapter.ownsCommand('claude --resume abc -n x')).toBe(true);
    expect(adapter.ownsCommand('  claude')).toBe(true);
    expect(adapter.ownsCommand('CLAUDE --resume x')).toBe(true);
  });

  it('nhận diện qua đường dẫn và phần mở rộng Windows', () => {
    expect(adapter.ownsCommand('claude.cmd --resume x')).toBe(true);
    expect(adapter.ownsCommand('claude.exe')).toBe(true);
    expect(adapter.ownsCommand('C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd -n a')).toBe(true);
    expect(adapter.ownsCommand('"C:\\Program Files\\claude.cmd" --resume x')).toBe(true);
    expect(adapter.ownsCommand('./claude')).toBe(true);
    expect(adapter.ownsCommand('/usr/local/bin/claude --resume x')).toBe(true);
  });

  it('nhận diện qua runner npm: npx/bunx/pnpm dlx/yarn dlx, kể cả cờ của runner và version', () => {
    expect(adapter.ownsCommand('npx claude')).toBe(true);
    expect(adapter.ownsCommand('npx -y claude --resume abc')).toBe(true);
    expect(adapter.ownsCommand('bunx claude')).toBe(true);
    expect(adapter.ownsCommand('pnpm dlx claude')).toBe(true);
    expect(adapter.ownsCommand('yarn dlx claude')).toBe(true);
    expect(adapter.ownsCommand('npx claude@latest')).toBe(true);
    expect(adapter.ownsCommand('npx @anthropic-ai/claude-code')).toBe(true);
    expect(adapter.ownsCommand('npx -y @anthropic-ai/claude-code@2.1.0 --resume x')).toBe(true);
  });

  it('không nhận nhầm lệnh khác', () => {
    expect(adapter.ownsCommand('claudette --help')).toBe(false);
    expect(adapter.ownsCommand('claude2')).toBe(false);
    expect(adapter.ownsCommand('npm run claude')).toBe(false);
    expect(adapter.ownsCommand('pnpm claude')).toBe(false); // pnpm không dlx = chạy script tên claude
    expect(adapter.ownsCommand('npx create-claude-app')).toBe(false);
    expect(adapter.ownsCommand('echo claude')).toBe(false);
    expect(adapter.ownsCommand('npx @other/claude-code')).toBe(false);
    expect(adapter.ownsCommand('npx')).toBe(false);
    expect(adapter.ownsCommand('npx -y')).toBe(false);
    expect(adapter.ownsCommand('')).toBe(false);
  });
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


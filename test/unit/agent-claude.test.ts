import { describe, it, expect } from 'vitest';
import { ClaudeCodeAdapter, type CommandRunner } from '../../src/agent/claude';

const UUID = '639a2ba8-e4f0-4e0b-917c-6ab773c8a922';

const stubRunner = (stdout: string, code = 0): CommandRunner => ({
  run: async () => ({ stdout, code }),
});

describe('buildLaunchOptions', () => {
  const adapter = new ClaudeCodeAdapter('powershell', stubRunner('[]'), () => UUID);
  const options = adapter.buildLaunchOptions('erp');

  it('đủ 6 biến thể: 2 phiên mới (mint) + 4 tiếp tục/resume', () => {
    expect(options).toHaveLength(6);
    expect(options.filter((o) => o.sessionId !== undefined)).toHaveLength(2);
  });

  it('phiên mới mint id, quote id và tên peer, kèm cờ tùy chọn', () => {
    expect(options[0]?.command).toBe(`claude --session-id '${UUID}' -n 'erp'`);
    expect(options[0]?.sessionId).toBe(UUID);
    expect(options[1]?.command).toBe(
      `claude --session-id '${UUID}' -n 'erp' --dangerously-skip-permissions`,
    );
  });

  it('biến thể tiếp tục/resume là lệnh thô đúng cờ, không sessionId', () => {
    expect(options.map((o) => o.command)).toEqual(
      expect.arrayContaining([
        'claude -c',
        'claude --dangerously-skip-permissions -c',
        'claude -r',
        'claude --dangerously-skip-permissions -r',
      ]),
    );
    expect(options[2]?.sessionId).toBeUndefined();
  });

  it('mọi command đều được ownsCommand nhận (capture sẽ bỏ qua, không nhớ lệnh thô)', () => {
    for (const o of options) expect(adapter.ownsCommand(o.command)).toBe(true);
  });
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


describe('cờ thêm cho vai và điều phối', () => {
  const adapter = new ClaudeCodeAdapter('powershell', { run: async () => ({ stdout: '', code: 0 }) }, () => '11111111-1111-4111-8111-111111111111');

  it('phiên mới kèm file vai và cấu hình MCP', () => {
    const cmd = adapter.buildLaunchCommand({
      name: 'x',
      mode: { kind: 'new', sessionId: '11111111-1111-4111-8111-111111111111' },
      coThem: { fileVai: 'C:/gs/roles/w/r.md', cauHinhMcp: 'C:/gs/orch/w/mcp-t.json' },
    });
    expect(cmd).toContain('--append-system-prompt-file');
    expect(cmd).toContain('--mcp-config');
    expect(cmd).toContain('C:/gs/roles/w/r.md');
  });

  it('đường dẫn có khoảng trắng vẫn được bọc nháy', () => {
    const cmd = adapter.buildLaunchCommand({
      name: 'x',
      mode: { kind: 'continue' },
      coThem: { fileVai: "C:/My Files/vai's.md" },
    });
    expect(cmd).toContain("'C:/My Files/vai''s.md'");
  });

  it('không có cờ thêm thì lệnh giữ nguyên như cũ', () => {
    expect(adapter.buildLaunchCommand({ name: 'x', mode: { kind: 'continue' } })).toBe('claude -c');
  });

  it('mọi biến thể trong buildLaunchOptions đều mang cờ thêm', () => {
    const ds = adapter.buildLaunchOptions('peer', { fileVai: 'C:/r.md' });
    expect(ds.length).toBeGreaterThan(0);
    for (const o of ds) expect(o.command).toContain('--append-system-prompt-file');
  });
});

describe('cờ bỏ hỏi quyền', () => {
  const adapter = new ClaudeCodeAdapter('powershell', { run: async () => ({ stdout: '', code: 0 }) }, () => '11111111-1111-4111-8111-111111111111');

  it('boHoiQuyen thêm --dangerously-skip-permissions', () => {
    const cmd = adapter.buildLaunchCommand({
      name: 'x',
      mode: { kind: 'new', sessionId: '11111111-1111-4111-8111-111111111111' },
      coThem: { boHoiQuyen: true },
    });
    expect(cmd).toContain('--dangerously-skip-permissions');
  });

  it('không bật thì KHÔNG có cờ đó — quyết định này là của người dùng, không phải mặc định', () => {
    const cmd = adapter.buildLaunchCommand({
      name: 'x',
      mode: { kind: 'new', sessionId: '11111111-1111-4111-8111-111111111111' },
      coThem: { fileVai: 'C:/r.md' },
    });
    expect(cmd).not.toContain('--dangerously-skip-permissions');
  });
});

describe('cờ chọn mô hình', () => {
  const adapter = new ClaudeCodeAdapter('powershell', { run: async () => ({ stdout: '', code: 0 }) }, () => '11111111-1111-4111-8111-111111111111');
  const lenh = (coThem: Record<string, unknown>) =>
    adapter.buildLaunchCommand({ name: 'x', mode: { kind: 'new', sessionId: '11111111-1111-4111-8111-111111111111' }, coThem });

  it('model được truyền qua --model', () => {
    // Giá trị được BỌC NHÁY: tên mô hình có thể do người dùng tự gõ, nên nó là dữ liệu chứ
    // không phải cờ tin cậy được.
    expect(lenh({ model: 'opus' })).toContain("--model 'opus'");
  });

  it('tên mô hình có ký tự lạ vẫn được bọc nháy', () => {
    expect(lenh({ model: "a'b" })).toContain("'a''b'");
  });

  it('không chọn mô hình thì KHÔNG có cờ --model', () => {
    expect(lenh({ fileVai: 'C:/r.md' })).not.toContain('--model');
  });
});

import { describe, it, expect } from 'vitest';
import { parseAgentsJson, uniqueSessionName } from '../../src/agent/registry';

const REAL_OUTPUT = JSON.stringify([
  { id: '44027166', cwd: 'D:\\Coding\\3D Load Calculator', kind: 'background',
    startedAt: 1781664932079, sessionId: '44027166-59ba-4380-92ab-a496f8271b03',
    name: 'kubova-test-suite-automation', state: 'blocked' },
  { pid: 12028, cwd: 'D:\\Coding\\vscode-workspace-saver', kind: 'interactive',
    startedAt: 1786253359151, sessionId: '639a2ba8-e4f0-4e0b-917c-6ab773c8a922',
    name: 'vscode-workspace-saver-87', status: 'busy' },
]);

describe('parseAgentsJson', () => {
  it('đọc được cả bản ghi interactive lẫn background', () => {
    const sessions = parseAgentsJson(REAL_OUTPUT);
    expect(sessions).toHaveLength(2);
  });

  it('lấy status từ trường state với bản ghi background', () => {
    const bg = parseAgentsJson(REAL_OUTPUT)[0]!;
    expect(bg.kind).toBe('background');
    expect(bg.status).toBe('blocked');
    expect(bg.pid).toBeNull();
  });

  it('lấy status từ trường status với bản ghi interactive', () => {
    const it0 = parseAgentsJson(REAL_OUTPUT)[1]!;
    expect(it0.status).toBe('busy');
    expect(it0.pid).toBe(12028);
    expect(it0.cwd).toBe('D:\\Coding\\vscode-workspace-saver');
  });

  it('trả mảng rỗng khi output rỗng hoặc không phải JSON', () => {
    expect(parseAgentsJson('')).toEqual([]);
    expect(parseAgentsJson('claude: command not found')).toEqual([]);
  });

  it('trả mảng rỗng khi JSON hợp lệ nhưng không phải mảng', () => {
    expect(parseAgentsJson('{"a":1}')).toEqual([]);
  });

  it('bỏ qua bản ghi thiếu sessionId thay vì ném lỗi', () => {
    const out = JSON.stringify([{ cwd: '/a', kind: 'interactive', status: 'idle' }]);
    expect(parseAgentsJson(out)).toEqual([]);
  });

  it('quy status lạ về idle', () => {
    const out = JSON.stringify([
      { sessionId: '639a2ba8-e4f0-4e0b-917c-6ab773c8a922', cwd: '/a', kind: 'interactive', status: 'khong-ro' },
    ]);
    expect(parseAgentsJson(out)[0]!.status).toBe('idle');
  });
});

describe('uniqueSessionName', () => {
  it('giữ nguyên tên khi chưa bị chiếm', () => {
    expect(uniqueSessionName('Backend', new Set())).toBe('Backend');
  });
  it('thêm hậu tố -2 khi trùng', () => {
    expect(uniqueSessionName('Backend', new Set(['Backend']))).toBe('Backend-2');
  });
  it('tăng hậu tố tới khi hết trùng', () => {
    expect(uniqueSessionName('Backend', new Set(['Backend', 'Backend-2', 'Backend-3'])))
      .toBe('Backend-4');
  });
});

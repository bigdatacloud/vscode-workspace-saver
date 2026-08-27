import { describe, expect, it } from 'vitest';
import { StoreFileSchema, WorkspaceSchema, emptyStore } from '../../src/model/schema';

const uuid1 = '11111111-1111-4111-8111-111111111111';
const uuid2 = '22222222-2222-4222-8222-222222222222';
const uuid3 = '33333333-3333-4333-8333-333333333333';

const termClaude = {
  id: uuid2, name: 'erp-agent', cwd: 'D:\\Coding\\erp', kind: 'claude',
  claudeSessionId: uuid3, claudeName: 'erp-agent',
};
const wsValid = {
  id: uuid1, name: 'ERP', lastActiveAt: null, activeWindowId: null,
  terminals: [termClaude, { id: uuid3, name: 'dev', cwd: 'D:\\Coding\\erp', kind: 'plain', startCommand: 'npm run dev' }],
};

describe('StoreFileSchema', () => {
  it('chấp nhận store hợp lệ và emptyStore()', () => {
    expect(() => StoreFileSchema.parse({ version: 2, workspaces: [wsValid] })).not.toThrow();
    expect(StoreFileSchema.parse(emptyStore())).toEqual({ version: 2, workspaces: [] });
  });

  it('từ chối version khác 2', () => {
    expect(() => StoreFileSchema.parse({ version: 1, workspaces: [] })).toThrow();
  });

  it('từ chối hai workspace trùng tên không phân biệt hoa thường, path trỏ đúng phần tử', () => {
    const dup = { ...wsValid, id: uuid2, name: 'erp' };
    const r = StoreFileSchema.safeParse({ version: 2, workspaces: [wsValid, dup] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.').includes('workspaces.1'))).toBe(true);
    }
  });

  it('từ chối hai workspace trùng id', () => {
    const dup = { ...wsValid, name: 'Khác' };
    expect(StoreFileSchema.safeParse({ version: 2, workspaces: [wsValid, dup] }).success).toBe(false);
  });
});

describe('WorkspaceSchema', () => {
  it('từ chối hai terminal trùng id trong một workspace', () => {
    const ws = { ...wsValid, terminals: [termClaude, { ...termClaude, name: 'khác' }] };
    const r = WorkspaceSchema.safeParse(ws);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.').includes('terminals.1'))).toBe(true);
    }
  });

  it('từ chối id không phải uuid và name rỗng', () => {
    expect(WorkspaceSchema.safeParse({ ...wsValid, id: 'abc' }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...wsValid, name: '' }).success).toBe(false);
  });

  it('terminalLocation: nhận editor/panel/vắng mặt, từ chối giá trị lạ', () => {
    expect(WorkspaceSchema.safeParse({ ...wsValid, terminalLocation: 'editor' }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...wsValid, terminalLocation: 'panel' }).success).toBe(true);
    expect(WorkspaceSchema.safeParse(wsValid).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...wsValid, terminalLocation: 'window' }).success).toBe(false);
  });

  it('agentSessionId không được bắt đầu bằng dấu gạch để khỏi bị CLI hiểu thành option', () => {
    const codex = {
      id: uuid2, name: 'codex', cwd: 'D:\\Coding\\erp', kind: 'plain', agentId: 'codex',
      agentSessionId: '--dangerously-bypass-approvals-and-sandbox', startCommand: 'codex',
    };
    expect(WorkspaceSchema.safeParse({ ...wsValid, terminals: [codex] }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...wsValid, terminals: [{ ...codex, agentSessionId: 'session-name' }] }).success).toBe(true);
  });
});

describe('TerminalEntry.worktree', () => {
  const base = { id: uuid2, name: 'fix-login-claude', cwd: 'D:/Coding/erp-worktrees/fix-login-claude', kind: 'plain' as const };
  const ws = (t: unknown) => ({ id: uuid1, name: 'ERP', lastActiveAt: null, activeWindowId: null, terminals: [t] });

  it('chấp nhận entry có worktree đủ path và branch', () => {
    const t = { ...base, worktree: { path: 'D:/Coding/erp-worktrees/fix-login-claude', branch: 'fix-login-claude' } };
    expect(WorkspaceSchema.parse(ws(t)).terminals[0]?.worktree?.branch).toBe('fix-login-claude');
  });

  it('worktree là tùy chọn — entry không có nó vẫn hợp lệ', () => {
    expect(() => WorkspaceSchema.parse(ws(base))).not.toThrow();
  });

  it('từ chối worktree thiếu branch hoặc có trường rỗng', () => {
    expect(WorkspaceSchema.safeParse(ws({ ...base, worktree: { path: '/a' } })).success).toBe(false);
    expect(WorkspaceSchema.safeParse(ws({ ...base, worktree: { path: '', branch: 'b' } })).success).toBe(false);
  });

  it('KHÔNG ép bộ ký tự tên nhánh: worktree dùng lại có thể mang tên do người khác đặt', () => {
    const t = { ...base, worktree: { path: '/a', branch: 'feat/áo-dài' } };
    expect(WorkspaceSchema.safeParse(ws(t)).success).toBe(true);
  });
});

describe('roles', () => {
  const ws = (extra: Record<string, unknown>) => ({
    id: uuid1, name: 'ERP', lastActiveAt: null, activeWindowId: null, terminals: [], ...extra,
  });
  const role = (over: Record<string, unknown> = {}) => ({
    id: uuid2, name: 'reviewer', kind: 'worker', ...over,
  });

  it('chấp nhận workspace có danh sách vai', () => {
    expect(() => WorkspaceSchema.parse(ws({ roles: [role()] }))).not.toThrow();
  });

  it('roles là tùy chọn', () => {
    expect(() => WorkspaceSchema.parse(ws({}))).not.toThrow();
  });

  it('tên vai đi vào tên nhánh git nên phải hợp lệ cho git', () => {
    expect(WorkspaceSchema.safeParse(ws({ roles: [role({ name: 'người rà soát' })] })).success).toBe(false);
    expect(WorkspaceSchema.safeParse(ws({ roles: [role({ name: '-bat-dau-bang-gach' })] })).success).toBe(false);
    expect(WorkspaceSchema.safeParse(ws({ roles: [role({ name: 'code.reviewer-2' })] })).success).toBe(true);
  });

  it('từ chối loại vai lạ', () => {
    expect(WorkspaceSchema.safeParse(ws({ roles: [role({ kind: 'sep-tong' })] })).success).toBe(false);
  });

  it('từ chối hai vai trùng tên không phân biệt hoa thường', () => {
    const r = WorkspaceSchema.safeParse(ws({ roles: [role(), role({ id: uuid3, name: 'Reviewer' })] }));
    expect(r.success).toBe(false);
  });

  it('từ chối hai vai trùng id', () => {
    expect(WorkspaceSchema.safeParse(ws({ roles: [role(), role({ name: 'impl' })] })).success).toBe(false);
  });

  it('terminal mang roleId', () => {
    const t = { id: uuid3, name: 't', cwd: 'D:/a', kind: 'plain', roleId: uuid2 };
    expect(WorkspaceSchema.parse(ws({ roles: [role()], terminals: [t] })).terminals[0]?.roleId).toBe(uuid2);
  });

  it('roleId TRỎ VÀO VAI ĐÃ XOÁ vẫn parse được', () => {
    // Ép toàn vẹn tham chiếu ở đây là tự bắn vào chân: xoá một vai sẽ làm CẢ shard hỏng
    // schema → backup + khởi tạo rỗng → mất nguyên workspace. Vai treo được coi là "không
    // có vai" lúc đọc và dọn dần.
    const t = { id: uuid3, name: 't', cwd: 'D:/a', kind: 'plain', roleId: uuid2 };
    expect(WorkspaceSchema.safeParse(ws({ terminals: [t] })).success).toBe(true);
  });
});

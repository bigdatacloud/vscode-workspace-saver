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
});

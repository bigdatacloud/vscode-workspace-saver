import { describe, it, expect } from 'vitest';
import { ManifestSchema, StateSchema } from '../../src/manifest/schema';

const VALID = {
  version: 1,
  workspace: { name: 'ERP Development Team' },
  project: { root: '.' },
  sessions: [
    {
      key: 'coordinator',
      name: 'ERP-Coordinator',
      role: 'coordinator',
      worktree: { path: '../erp-coordinator', branch: 'main' },
      terminal: { name: 'Coordinator' },
      startupCommand: null,
      agent: 'claude',
    },
  ],
};

describe('ManifestSchema', () => {
  it('chấp nhận manifest hợp lệ', () => {
    expect(ManifestSchema.parse(VALID).sessions[0]!.key).toBe('coordinator');
  });

  it('điền mặc định cho các trường vắng mặt', () => {
    const parsed = ManifestSchema.parse({
      version: 1,
      workspace: { name: 'W' },
      sessions: [{ key: 'a', name: 'A', terminal: { name: 'A' } }],
    });
    expect(parsed.project.root).toBe('.');
    expect(parsed.sessions[0]!.role).toBe('developer');
    expect(parsed.sessions[0]!.worktree).toBeNull();
    expect(parsed.sessions[0]!.startupCommand).toBeNull();
    expect(parsed.sessions[0]!.agent).toBe('claude');
  });

  it('từ chối key trùng nhau', () => {
    const bad = { ...VALID, sessions: [VALID.sessions[0], VALID.sessions[0]] };
    expect(() => ManifestSchema.parse(bad)).toThrow(/key bị trùng/);
  });

  it('từ chối name trùng nhau', () => {
    const bad = {
      ...VALID,
      sessions: [VALID.sessions[0], { ...VALID.sessions[0], key: 'other' }],
    };
    expect(() => ManifestSchema.parse(bad)).toThrow(/name bị trùng/);
  });

  it('từ chối key không phải slug', () => {
    const bad = { ...VALID, sessions: [{ ...VALID.sessions[0], key: 'Có Dấu' }] };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  it('từ chối version khác 1', () => {
    expect(() => ManifestSchema.parse({ ...VALID, version: 2 })).toThrow();
  });
});

describe('StateSchema', () => {
  it('chấp nhận state hợp lệ', () => {
    const parsed = StateSchema.parse({
      version: 1,
      sessions: {
        coordinator: {
          sessionId: '639a2ba8-e4f0-4e0b-917c-6ab773c8a922',
          pid: 12028,
          lastStatus: 'idle',
          lastActiveAt: 1786254024591,
        },
      },
    });
    expect(parsed.sessions.coordinator!.pid).toBe(12028);
  });

  it('mặc định sessions rỗng', () => {
    expect(StateSchema.parse({ version: 1 }).sessions).toEqual({});
  });

  it('từ chối sessionId không phải uuid', () => {
    expect(() =>
      StateSchema.parse({
        version: 1,
        sessions: { a: { sessionId: 'khong-phai-uuid', lastActiveAt: 1 } },
      }),
    ).toThrow();
  });
});

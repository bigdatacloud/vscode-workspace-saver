import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import { restoreWorkspace, type RestorePorts, type TerminalHandle } from '../../src/workspace/restore';
import type { Manifest, WorkspaceState } from '../../src/manifest/schema';
import type { WorktreeEntry } from '../../src/git/porcelain';

const ROOT = path.resolve('/projects/erp');
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const manifest = (over: Partial<Manifest> = {}): Manifest => ({
  version: 1,
  workspace: { name: 'ERP' },
  project: { root: '.' },
  sessions: [
    { key: 'coordinator', name: 'ERP-Coordinator', role: 'coordinator',
      worktree: { path: '../erp-coordinator', branch: 'main' },
      terminal: { name: 'Coordinator' }, startupCommand: null, agent: 'claude' },
    { key: 'backend', name: 'ERP-Backend', role: 'developer',
      worktree: { path: '../erp-backend', branch: 'feature/order-api' },
      terminal: { name: 'Backend' }, startupCommand: null, agent: 'claude' },
  ],
  ...over,
});

const wtEntry = (p: string, branch: string): WorktreeEntry =>
  ({ path: path.resolve(ROOT, p), head: 'abc', branch: `refs/heads/${branch}`, detached: false, bare: false });

interface Harness {
  ports: RestorePorts;
  terminals: { opts: unknown; sent: string[] }[];
  added: { path: string; branch: string }[];
}

function harness(over: Partial<RestorePorts> = {}, opts: {
  entries?: WorktreeEntry[];
  existing?: string[];
  running?: { sessionId: string; name: string }[];
  runningAfter?: { sessionId: string; name: string }[];
} = {}): Harness {
  const terminals: Harness['terminals'] = [];
  const added: Harness['added'] = [];
  const entries = opts.entries ?? [wtEntry('../erp-coordinator', 'main'), wtEntry('../erp-backend', 'feature/order-api')];
  const existing = new Set((opts.existing ?? ['../erp-coordinator', '../erp-backend']).map((p) => path.resolve(ROOT, p)));

  let uuidN = 0;
  const uuids = [UUID_A, UUID_B];
  let listRunningCalls = 0;

  const ports: RestorePorts = {
    projectRoot: ROOT,
    git: {
      isRepo: async () => true,
      listWorktrees: async () => entries,
      addWorktree: async (_root, p, branch) => { added.push({ path: p, branch }); existing.add(path.resolve(p)); },
    },
    fs: { exists: async (p) => existing.has(path.resolve(p)) },
    agent: {
      id: 'claude',
      newSessionId: () => uuids[uuidN++] ?? UUID_A,
      buildLaunchCommand: (s) => `claude ${s.mode.kind} ${s.mode.sessionId} -n ${s.name}`,
      // Registry thật đổi theo thời gian: lần gọi đầu là để tính tên đã bị chiếm
      // (chỉ có session lạ đang chạy), các lần sau là vòng chờ (session của ta đã lên).
      listRunning: async () => {
        const rows = listRunningCalls++ === 0
          ? (opts.running ?? [])
          : (opts.runningAfter ?? opts.running ?? []);
        return rows.map((r) => ({
          sessionId: r.sessionId, name: r.name, cwd: '', pid: 1,
          kind: 'interactive' as const, status: 'idle' as const,
        }));
      },
      isAvailable: async () => true,
    },
    terminals: {
      create: (o): TerminalHandle => {
        const rec = { opts: o, sent: [] as string[] };
        terminals.push(rec);
        return { sendText: (t) => rec.sent.push(t), show: () => {} };
      },
    },
    confirm: { worktrees: async () => true, trust: async () => true },
    clock: { now: () => 1000 },
    sleep: async () => {},
    waitAttempts: 1,
    ...over,
  };
  return { ports, terminals, added };
}

const emptyState: WorkspaceState = { version: 1, sessions: {} };

describe('restoreWorkspace — đường hạnh phúc', () => {
  it('tạo một terminal cho mỗi session, đúng thứ tự manifest', async () => {
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(h.terminals).toHaveLength(2);
    expect(report.started.map((s) => s.key)).toEqual(['coordinator', 'backend']);
  });

  it('đặt cwd của terminal đúng worktree', async () => {
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect((h.terminals[0]!.opts as { cwd: string }).cwd).toBe(path.resolve(ROOT, '../erp-coordinator'));
  });

  it('chỉ session role coordinator mới nhận CLAUDE_CODE_COORDINATOR_MODE', async () => {
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect((h.terminals[0]!.opts as { env: Record<string, string> }).env.CLAUDE_CODE_COORDINATOR_MODE).toBe('1');
    expect((h.terminals[1]!.opts as { env: Record<string, string> }).env.CLAUDE_CODE_COORDINATOR_MODE).toBeUndefined();
  });

  it('dùng --resume khi state đã có sessionId', async () => {
    const state: WorkspaceState = {
      version: 1,
      sessions: { coordinator: { sessionId: UUID_A, pid: null, lastStatus: 'offline', lastActiveAt: 1 } },
    };
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), state, h.ports);
    expect(h.terminals[0]!.sent.join('\n')).toContain(`resume ${UUID_A}`);
    expect(h.terminals[1]!.sent.join('\n')).toContain('new ');
  });

  it('chạy startupCommand trước dòng lệnh claude', async () => {
    const m = manifest();
    m.sessions[1]!.startupCommand = 'npm run dev';
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(m, emptyState, h.ports);
    expect(h.terminals[1]!.sent[0]).toBe('npm run dev');
    expect(h.terminals[1]!.sent[1]).toContain('claude ');
  });
});

describe('restoreWorkspace — worktree', () => {
  it('hỏi một lần cho tất cả worktree thiếu rồi tạo', async () => {
    const confirmWorktrees = vi.fn(async () => true);
    const h = harness({ confirm: { worktrees: confirmWorktrees, trust: async () => true } },
      { existing: ['../erp-coordinator'], entries: [wtEntry('../erp-coordinator', 'main')],
        running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(confirmWorktrees).toHaveBeenCalledOnce();
    expect(h.added).toEqual([{ path: path.resolve(ROOT, '../erp-backend'), branch: 'feature/order-api' }]);
  });

  it('từ chối tạo worktree thì bỏ qua session đó, các session khác vẫn chạy', async () => {
    const h = harness({ confirm: { worktrees: async () => false, trust: async () => true } },
      { existing: ['../erp-coordinator'], entries: [wtEntry('../erp-coordinator', 'main')],
        running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }] });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started.map((s) => s.key)).toEqual(['coordinator']);
    expect(report.skippedWorktrees).toEqual(['backend']);
    expect(h.added).toEqual([]);
  });

  it('branch lệch thì vẫn chạy và không gọi git nào khác ngoài list', async () => {
    const h = harness({}, {
      entries: [wtEntry('../erp-coordinator', 'main'), wtEntry('../erp-backend', 'feature/khac')],
      running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }],
    });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started).toHaveLength(2);
    expect(h.added).toEqual([]);
    expect(report.started[1]!.warnings.join(' ')).toContain('branch');
  });

  it('không phải git repo thì chạy mọi session ở project root', async () => {
    const h = harness({ git: {
      isRepo: async () => false,
      listWorktrees: async () => { throw new Error('không được gọi'); },
      addWorktree: async () => { throw new Error('không được gọi'); },
    } }, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect((h.terminals[0]!.opts as { cwd: string }).cwd).toBe(ROOT);
  });
});

describe('restoreWorkspace — trust và lỗi', () => {
  it('không hỏi trust khi không session nào có startupCommand', async () => {
    const trust = vi.fn(async () => true);
    const h = harness({ confirm: { worktrees: async () => true, trust } },
      { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(trust).not.toHaveBeenCalled();
  });

  it('từ chối trust thì không chạy startupCommand nhưng vẫn mở session', async () => {
    const m = manifest();
    m.sessions[0]!.startupCommand = 'rm -rf /';
    const h = harness({ confirm: { worktrees: async () => true, trust: async () => false } },
      { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(m, emptyState, h.ports);
    expect(h.terminals[0]!.sent.some((t) => t.includes('rm -rf'))).toBe(false);
    expect(h.terminals[0]!.sent.some((t) => t.includes('claude '))).toBe(true);
  });

  it('claude không có trong PATH thì báo lỗi toàn cục và không tạo terminal', async () => {
    const h = harness({}, {});
    h.ports.agent.isAvailable = async () => false;
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started).toEqual([]);
    expect(report.failed.map((f) => f.reason).join(' ')).toContain('claude');
    expect(h.terminals).toHaveLength(0);
  });

  it('tên trùng session đang chạy thì tự thêm hậu tố', async () => {
    const h = harness({}, {
      // Trước khi launch: chỉ một session LẠ đang chiếm tên 'ERP-Coordinator'.
      running: [
        { sessionId: '99999999-9999-4999-8999-999999999999', name: 'ERP-Coordinator' },
      ],
      // Sau khi launch: session của ta đã lên registry, mang tên đã được thêm hậu tố.
      runningAfter: [
        { sessionId: '99999999-9999-4999-8999-999999999999', name: 'ERP-Coordinator' },
        { sessionId: UUID_A, name: 'ERP-Coordinator-2' },
        { sessionId: UUID_B, name: 'ERP-Backend' },
      ],
    });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started[0]!.name).toBe('ERP-Coordinator-2');
    const canhBao = report.started[0]!.warnings.join(' ');
    // Cảnh báo phải nói rõ hai điều: tên cũ đã bị chiếm, và tên nào được dùng thay thế.
    expect(canhBao).toContain('đã bị một session khác chiếm');
    expect(canhBao).toContain('ERP-Coordinator-2');
  });

  it('tạo terminal thất bại ở một session thì các session khác vẫn mở', async () => {
    const h = harness({}, {
      running: [],
      runningAfter: [
        { sessionId: UUID_A, name: 'ERP-Coordinator' },
        { sessionId: UUID_B, name: 'ERP-Backend' },
      ],
    });
    // Session đầu tiên ném khi tạo terminal (vd VS Code từ chối vì cwd không truy cập được).
    const goc = h.ports.terminals.create;
    let lanGoi = 0;
    h.ports.terminals.create = (options) => {
      if (lanGoi++ === 0) throw new Error('không tạo được terminal');
      return goc(options);
    };

    const report = await restoreWorkspace(manifest(), emptyState, h.ports);

    expect(report.failed.map((f) => f.key)).toEqual(['coordinator']);
    expect(report.failed[0]!.reason).toContain('không tạo được terminal');
    expect(report.started.map((s) => s.key)).toEqual(['backend']);
    expect(h.terminals).toHaveLength(1);
  });

  it('session không xuất hiện trong registry sau khi chờ thì bị tính là thất bại', async () => {
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }] });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started.map((s) => s.key)).toEqual(['coordinator']);
    expect(report.failed.map((f) => f.key)).toEqual(['backend']);
  });
});

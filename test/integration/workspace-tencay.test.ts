import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => ({
  window: {
    terminals: [] as unknown[],
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() })),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: vi.fn(() => ({ get: vi.fn((_k: string, d?: unknown) => d) })),
  },
  commands: { executeCommand: vi.fn() },
  TerminalLocation: { Panel: 1, Editor: 2 },
  Disposable: class {},
  EventEmitter: class {
    readonly event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('vscode', () => vscodeMock);

import * as path from 'node:path';
import type { StoreFile, TerminalEntry, Workspace } from '../../src/model/schema';
import { WorkspaceManager } from '../../src/workspace/manager';

// Đường dẫn CỐ Ý không tồn tại trên máy nào: `taoCay` gọi `existsSync` thật, nên một đường dẫn
// có thật (vd chính repo này, và `…-worktrees\fix-login-claude` là ví dụ trong checklist tay) sẽ
// khiến ca test đổi kết quả theo thứ ở trên đĩa.
const REPO = String.raw`D:\khong-co-thuc-ai-workspaces\duan`;
const CAY = path.join(path.dirname(REPO), `${path.basename(REPO)}-worktrees`, 'fix-login-claude');
const WS = '22222222-2222-4222-8222-222222222222';

interface MayDo {
  manager: Record<string, unknown>;
  ws: Workspace;
  nhatKy: string[];
  lenhDaGui: string[];
  tenTerminal: string[];
}

/**
 * Dựng manager không qua constructor (hệt `workspace-votrong.test.ts`) và chỉ gán những mảnh
 * mà đường "tạo phiên mới" đụng tới.
 *
 * `hoiDuongDan` / `hoiVai` bị thay vì chúng là hộp thoại của bước TRƯỚC; mọi thứ thuộc phần
 * tên cây (hỏi, kiểm trùng, tạo cây) đều chạy mã thật — đó là thứ ca này đo.
 */
function dungManager(opts: { repoGoc: string | null; daCo?: TerminalEntry[] }): MayDo {
  const ws: Workspace = {
    id: WS,
    name: 'Working',
    lastActiveAt: null,
    activeWindowId: null,
    terminals: opts.daCo ?? [],
  };
  const store: StoreFile = { version: 2, workspaces: [ws] };
  const nhatKy: string[] = [];
  const lenhDaGui: string[] = [];
  const tenTerminal: string[] = [];

  const manager = Object.create(WorkspaceManager.prototype) as Record<string, unknown>;
  Object.assign(manager, {
    store,
    terminals: {
      create: vi.fn((_id: string, o: { name: string }) => {
        tenTerminal.push(o.name);
        return { sendText: vi.fn((l: string) => lenhDaGui.push(l)) };
      }),
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
    },
    agent: {
      id: 'claude',
      newSessionId: () => '33333333-3333-4333-8333-333333333333',
      buildLaunchOptions: vi.fn((peer: string) => {
        nhatKy.push(`dungLenh:${peer}`);
        return [
          {
            label: 'Phiên mới',
            description: 'claude',
            command: `claude --session-id abc -n "${peer}"`,
            sessionId: '44444444-4444-4444-8444-444444444444',
          },
        ];
      }),
    },
    codex: {
      id: 'codex',
      buildLaunchOptions: vi.fn(() => {
        nhatKy.push('dungLenh:codex');
        return [{ label: 'codex', command: 'codex' }];
      }),
    },
    git: {
      repoRoot: vi.fn(async () => opts.repoGoc),
      addWorktree: vi.fn(async (_goc: string, duongDan: string) => {
        nhatKy.push(`taoCay:${path.basename(duongDan)}`);
      }),
      listWorktrees: vi.fn(async () => []),
    },
    statuses: new Map(),
    loadingIds: new Set(),
    errorIds: new Set(),
    daThayPhien: new Set(),
    shellPids: new Map(),
    dangChayLenh: new Set(),
    touch: vi.fn(),
    scheduleSave: vi.fn(),
    flush: vi.fn(),
    onChanged: { fire: vi.fn() },
    hoiDuongDan: vi.fn(async () => REPO),
    hoiVai: vi.fn(async () => undefined),
    coThemChoRole: vi.fn(() => undefined),
    ghiKhoiVaiChoEntry: vi.fn(),
    ghiNhanShellPid: vi.fn(),
    batDauLoading: vi.fn(),
    nhoCwd: vi.fn(async () => {}),
    khamPhaSessionCodex: vi.fn(async () => {}),
  });
  return { manager, ws, nhatKy, lenhDaGui, tenTerminal };
}

function entry(p: { id: string; name: string; cwd: string }): TerminalEntry {
  return { id: p.id, name: p.name, cwd: p.cwd, kind: 'claude' };
}

/** Chuỗi mà hộp nhập tên nhận được, cùng hàm kiểm của nó. */
function hopNhap(): { prompt: string; validate: (v: string) => string | undefined } {
  const goi = vscodeMock.window.showInputBox.mock.calls.at(-1)?.[0] as {
    prompt?: string;
    title?: string;
    validateInput?: (v: string) => string | undefined;
  };
  return {
    prompt: `${goi?.title ?? ''} ${goi?.prompt ?? ''}`,
    validate: (v) => goi?.validateInput?.(v) ?? undefined,
  };
}

describe('mỗi phiên agent mới một cây riêng, tên cây = tên terminal = tên phiên', () => {
  beforeEach(() => {
    vscodeMock.window.showInputBox.mockReset();
    vscodeMock.window.showQuickPick.mockReset();
    vscodeMock.window.showWarningMessage.mockReset();
    vscodeMock.window.showQuickPick.mockImplementation(async (ds: unknown) =>
      Array.isArray(ds) ? ds[0] : undefined,
    );
  });

  it('hỏi tên cây TRƯỚC khi dựng lệnh, tạo cây SAU CÙNG, và tên đi vào cả ba chỗ', async () => {
    // Trước 22/11/2026 lệnh được dựng từ tên repo gốc (`basename(duongDan)`) rồi mới hỏi
    // worktree, nên `claude -n` mang tên repo còn tab terminal mang tên cây — lệch mỗi lần.
    // Thứ tự ngược lại cũng không được: tạo cây phải nằm sau mọi hộp thoại có thể bị Esc.
    const { manager, ws, nhatKy, lenhDaGui, tenTerminal } = dungManager({ repoGoc: REPO });
    vscodeMock.window.showInputBox.mockImplementation(async () => {
      nhatKy.push('hoiTen');
      return 'fix-login';
    });

    const f = manager['newClaudeTerminal'] as (id: string) => Promise<void>;
    await f.call(manager, WS);

    expect(nhatKy).toEqual(['hoiTen', 'dungLenh:fix-login-claude', 'taoCay:fix-login-claude']);
    const e = ws.terminals[0];
    expect(e?.name).toBe('fix-login-claude');
    expect(e?.claudeName).toBe('fix-login-claude');
    expect(e?.cwd).toBe(CAY);
    expect(tenTerminal).toEqual(['fix-login-claude']);
    expect(lenhDaGui[0]).toContain('-n "fix-login-claude"');
  });

  it('cây mới thì biến thể "nối tiếp hội thoại" được dán nhãn là vô nghĩa ở đó', async () => {
    // Claude lưu hội thoại theo thư mục. Cây vừa tạo là thư mục chưa từng có phiên nào, nên
    // `-c` / `-r` ở đó không có gì để nối — mà cây bắt buộc thì ca này nay là ca thường gặp.
    const { manager } = dungManager({ repoGoc: REPO });
    (manager['agent'] as { buildLaunchOptions: unknown }).buildLaunchOptions = vi.fn(() => [
      { label: 'Phiên mới', command: 'claude --session-id abc -n "x"', sessionId: 'abc' },
      { label: 'Tiếp tục hội thoại gần nhất', command: 'claude -c' },
    ]);
    vscodeMock.window.showInputBox.mockResolvedValue('fix-login');

    const f = manager['newClaudeTerminal'] as (id: string) => Promise<void>;
    await f.call(manager, WS);

    const ds = vscodeMock.window.showQuickPick.mock.calls[0]?.[0] as { label: string; detail?: string }[];
    expect(ds[0]?.detail).toBeUndefined();
    expect(ds[1]?.detail).toMatch(/cây mới|chưa có hội thoại/i);
  });

  it('để TRỐNG tên không còn mở được phiên: hộp nhập từ chối ngay', async () => {
    // Đây là mệnh đề anh Ý chốt 22/11/2026 — "chặn hẳn, phải có cây". Mở phiên trên checkout
    // chính thì dùng lệnh "Tạo terminal mới" (shell thường).
    const { manager } = dungManager({ repoGoc: REPO });
    vscodeMock.window.showInputBox.mockResolvedValue(undefined);

    const f = manager['newClaudeTerminal'] as (id: string) => Promise<void>;
    await f.call(manager, WS);

    const hop = hopNhap();
    expect(hop.validate('')).toMatch(/Nhập tên việc/);
    expect(hop.prompt).not.toContain('Để TRỐNG');
    // Esc ở hộp tên là huỷ cả lệnh: không cây, không terminal.
    expect((manager['terminals'] as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
    expect((manager['git'] as { addWorktree: ReturnType<typeof vi.fn> }).addWorktree).not.toHaveBeenCalled();
  });

  it('tên trùng một phiên ở workspace KHÁC bị từ chối ngay trong ô nhập', async () => {
    const { manager } = dungManager({ repoGoc: REPO });
    (manager['store'] as StoreFile).workspaces.push({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Dự án khác',
      lastActiveAt: null,
      activeWindowId: null,
      terminals: [entry({ id: '66666666-6666-4666-8666-666666666666', name: 'fix-login-claude', cwd: String.raw`E:\kia` })],
    });
    vscodeMock.window.showInputBox.mockResolvedValue(undefined);

    const f = manager['newClaudeTerminal'] as (id: string) => Promise<void>;
    await f.call(manager, WS);

    const loi = hopNhap().validate('fix-login');
    expect(loi).toContain('Dự án khác');
    expect(hopNhap().validate('fix-login-khac')).toBeUndefined();
  });

  it('cây đã có entry khác trỏ vào thì không được dùng lại im lặng', async () => {
    const { manager, ws } = dungManager({ repoGoc: REPO });
    ws.terminals.push(entry({ id: '77777777-7777-4777-8777-777777777777', name: 'tên khác hẳn', cwd: CAY }));
    vscodeMock.window.showInputBox.mockResolvedValue(undefined);

    const f = manager['newClaudeTerminal'] as (id: string) => Promise<void>;
    await f.call(manager, WS);

    expect(hopNhap().validate('fix-login')).toContain('tên khác hẳn');
  });

  it('ngoài repo git: VẪN hỏi tên, không tạo cây, và nói rõ thư mục bị dùng chung', async () => {
    // Quyết của anh Ý 22/11/2026. Tên vẫn phải có vì nó là tên tab terminal và tên phiên Claude.
    const { manager, ws, nhatKy, tenTerminal } = dungManager({ repoGoc: null });
    vscodeMock.window.showInputBox.mockImplementation(async () => {
      nhatKy.push('hoiTen');
      return 'dọn kho ảnh';
    });

    const f = manager['newClaudeTerminal'] as (id: string) => Promise<void>;
    await f.call(manager, WS);

    expect(nhatKy).toEqual(['hoiTen', 'dungLenh:dọn kho ảnh']);
    expect(hopNhap().prompt).toMatch(/không nằm trong repo git|dùng chung/i);
    expect(ws.terminals[0]?.name).toBe('dọn kho ảnh');
    expect(ws.terminals[0]?.cwd).toBe(REPO);
    expect(tenTerminal).toEqual(['dọn kho ảnh']);
  });

  it('ĐỔI TÊN cũng không được đặt trùng tên một phiên khác', async () => {
    // Chặn ở cửa tạo mà bỏ ngỏ cửa đổi tên thì vẫn lộn được, chỉ chậm hơn một bước.
    const { manager, ws } = dungManager({ repoGoc: REPO });
    ws.terminals.push(entry({ id: '88888888-8888-4888-8888-888888888888', name: 'phiên A', cwd: REPO }));
    ws.terminals.push(entry({ id: '99999999-9999-4999-8999-999999999999', name: 'phiên B', cwd: REPO }));
    vscodeMock.window.showInputBox.mockResolvedValue(undefined);

    const f = manager['renameTerminal'] as (w: string, t: string) => Promise<void>;
    await f.call(manager, WS, '88888888-8888-4888-8888-888888888888');

    const hop = hopNhap();
    expect(hop.validate('phiên B')).toContain('phiên B');
    // Giữ nguyên tên của chính nó không phải là trùng với bản thân.
    expect(hop.validate('phiên A')).toBeUndefined();
    expect(hop.validate('phiên C')).toBeUndefined();
  });

  it('LẬP TỔ: thành viên mang tên đã có bị từ chối trước khi tạo thư mục hay file vai nào', async () => {
    // Tổ đặt tên theo `<việc>-<vai>`, nên hai lần lập tổ cùng tên việc sinh ra đúng những cái
    // tên đã có. Phải chặn TRƯỚC `addWorktree` và trước khi ghi file vai, không thì để lại rác.
    const { manager, ws } = dungManager({ repoGoc: REPO });
    ws.terminals.push(entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'fix-login-reviewer', cwd: REPO }));

    const f = manager['taoThanhVienTeam'] as (
      w: string,
      goc: string,
      viec: string,
      tv: { role: string; description: string },
      boHoiQuyen: boolean,
    ) => Promise<{ ten: string; id: string } | { loi: string }>;
    const kq = await f.call(manager, WS, REPO, 'fix-login', { role: 'reviewer', description: 'soi mã' }, false);

    expect('loi' in kq && kq.loi).toContain('fix-login-reviewer');
    expect((manager['git'] as { addWorktree: ReturnType<typeof vi.fn> }).addWorktree).not.toHaveBeenCalled();
  });

  it('LẬP TỔ từ một điều phối đang ở TRONG cây: cây thành viên vẫn cạnh repo chính', async () => {
    // Từ 0.2.5 mọi phiên agent nằm trong một cây, nên terminal điều phối cũng vậy — và gốc của
    // nó (`--show-toplevel`) là chính cái cây đó. Không chuẩn hoá về cây chính thì tổ sinh ra
    // `…-worktrees\dieu-phoi-claude-worktrees\viec-reviewer`.
    const { manager, ws } = dungManager({ repoGoc: CAY });
    // Vai có SẴN: nhánh "tạo vai mới" ghi file thật bằng `mkdirSync`/`writeFileSync`, và ca test
    // không được đẻ thư mục ra ổ đĩa (lần đầu viết ca này nó đã tạo `D:\khong-co-thuc-…` thật,
    // làm hai ca khác đổi kết quả vì `existsSync` hoá true).
    ws.roles = [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'reviewer', kind: 'worker' }];
    (manager['git'] as { listWorktrees: unknown }).listWorktrees = vi.fn(async () => [
      { path: REPO, branch: 'main', bare: false, detached: false },
      { path: CAY, branch: 'fix-login-claude', bare: false, detached: false },
    ]);
    Object.assign(manager, {
      coThemChoRole: vi.fn(() => ({})),
      ghiKhoiVaiChoEntry: vi.fn(),
      agent: {
        ...(manager['agent'] as object),
        buildLaunchCommand: vi.fn(() => 'claude'),
      },
    });

    const f = manager['taoThanhVienTeam'] as (
      w: string,
      goc: string,
      viec: string,
      tv: { role: string; description: string },
      boHoiQuyen: boolean,
    ) => Promise<{ ten: string; id: string } | { loi: string }>;
    // `goc` truyền vào là CÂY (đúng những gì caller đọc được từ cwd của điều phối).
    await f.call(manager, WS, CAY, 'viec', { role: 'reviewer', description: 'soi mã' }, false);

    const goi = (manager['git'] as { addWorktree: ReturnType<typeof vi.fn> }).addWorktree.mock.calls[0];
    expect(goi?.[0]).toBe(REPO);
    expect(goi?.[1]).toBe(
      path.join(path.dirname(REPO), `${path.basename(REPO)}-worktrees`, 'viec-reviewer'),
    );
  });

  it('terminal Codex cũng đi đúng đường đó, và cũng không nhận tên trống', async () => {
    const { manager, ws, nhatKy } = dungManager({ repoGoc: REPO });
    vscodeMock.window.showInputBox.mockImplementation(async () => {
      nhatKy.push('hoiTen');
      return 'fix-login';
    });

    const f = manager['newCodexTerminal'] as (id: string) => Promise<void>;
    await f.call(manager, WS);

    // Thứ tự phải là hỏi tên → chọn lệnh → tạo cây, hệt đường Claude.
    expect(nhatKy).toEqual(['hoiTen', 'dungLenh:codex', 'taoCay:fix-login-codex']);
    expect(ws.terminals[0]?.name).toBe('fix-login-codex');
    expect(hopNhap().validate('')).toMatch(/Nhập tên việc/);
  });

  it('mở phiên mới từ TRONG một cây: cây mới nằm cạnh repo chính, không lồng vào nhau', async () => {
    // `git rev-parse --show-toplevel` trong một linked worktree trả về chính worktree (đo trên
    // máy thật 22/11/2026), mà `nhoCwd` lưu đường cây vào lịch sử gợi ý đường dẫn — nên đây là
    // ca thường gặp. Lấy số đó làm gốc sẽ ra `…-worktrees\a-claude-worktrees\b-claude`.
    const { manager, ws } = dungManager({ repoGoc: CAY });
    (manager['hoiDuongDan'] as unknown) = vi.fn(async () => CAY);
    (manager['git'] as { listWorktrees: unknown }).listWorktrees = vi.fn(async () => [
      { path: REPO, branch: 'main', bare: false, detached: false },
      { path: CAY, branch: 'fix-login-claude', bare: false, detached: false },
    ]);
    vscodeMock.window.showInputBox.mockResolvedValue('viec-sau');

    const f = manager['newClaudeTerminal'] as (id: string) => Promise<void>;
    await f.call(manager, WS);

    expect(ws.terminals[0]?.cwd).toBe(
      path.join(path.dirname(REPO), `${path.basename(REPO)}-worktrees`, 'viec-sau-claude'),
    );
    expect(ws.terminals[0]?.cwd).not.toContain('-worktrees\\fix-login-claude-worktrees');
  });
});

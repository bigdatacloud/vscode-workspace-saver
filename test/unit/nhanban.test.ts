import { describe, expect, it } from 'vitest';
import {
  dungEntryNhanBan,
  duocNhanBan,
  lenhCodexChoBanSao,
  vaiChoTenWorktree,
  type NguonNhanBan,
} from '../../src/workspace/nhanban';
import type { Role, TerminalEntry } from '../../src/model/schema';

const U = (n: string): string => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const ID_GOC = U('1');
const ID_MOI = U('2');
const ID_VAI = U('3');
const ID_PHIEN = U('4');

const claudeEntry = (over: Partial<TerminalEntry> = {}): TerminalEntry => ({
  id: ID_GOC,
  name: 'fix-login-impl',
  cwd: 'D:/repo-worktrees/fix-login-impl',
  kind: 'claude',
  claudeSessionId: ID_PHIEN,
  claudeName: 'fix-login-impl',
  worktree: { path: 'D:/repo-worktrees/fix-login-impl', branch: 'fix-login-impl' },
  ...over,
});

const nguon = (entry: TerminalEntry, roles: Role[] = []): NguonNhanBan => ({ entry, roles });

describe('duocNhanBan', () => {
  it('terminal Claude đã có id phiên → nhân bản được, và fork được hội thoại', () => {
    const kq = duocNhanBan(claudeEntry());
    expect(kq.duoc).toBe(true);
    if (kq.duoc) expect(kq.forkDuoc).toBe(true);
  });

  it('terminal Claude CHƯA bắt được id phiên → vẫn nhân bản được nhưng KHÔNG fork được', () => {
    const kq = duocNhanBan(claudeEntry({ claudeSessionId: undefined }));
    expect(kq.duoc).toBe(true);
    if (kq.duoc) expect(kq.forkDuoc).toBe(false);
  });

  it('terminal Codex → nhân bản được, không fork (Codex không có cờ fork)', () => {
    const kq = duocNhanBan({ id: ID_GOC, name: 'x', cwd: 'D:/r', kind: 'plain', agentId: 'codex', agentSessionId: 'abc' });
    expect(kq.duoc).toBe(true);
    if (kq.duoc) expect(kq.forkDuoc).toBe(false);
  });

  it('shell thường → nhân bản được, không fork', () => {
    const kq = duocNhanBan({ id: ID_GOC, name: 'dev', cwd: 'D:/r', kind: 'plain', startCommand: 'npm run dev' });
    expect(kq.duoc).toBe(true);
    if (kq.duoc) expect(kq.forkDuoc).toBe(false);
  });
});

describe('vaiChoTenWorktree', () => {
  const vai: Role = { id: ID_VAI, name: 'impl', kind: 'worker' };

  it('có vai → lấy tên vai, để bản sao nằm cùng nhóm nhánh với bản gốc', () => {
    expect(vaiChoTenWorktree(nguon(claudeEntry({ roleId: ID_VAI }), [vai]), 'claude')).toBe('impl');
  });

  it('vai treo (trỏ vào vai đã xoá) → rơi về tên agent, không ném', () => {
    expect(vaiChoTenWorktree(nguon(claudeEntry({ roleId: U('9') }), [vai]), 'claude')).toBe('claude');
  });

  it('không vai → tên agent mặc định', () => {
    expect(vaiChoTenWorktree(nguon(claudeEntry()), 'claude')).toBe('claude');
    expect(vaiChoTenWorktree(nguon({ id: ID_GOC, name: 'x', cwd: 'D:/r', kind: 'plain', agentId: 'codex' }), 'codex')).toBe('codex');
  });
});

describe('dungEntryNhanBan', () => {
  const dich = { id: ID_MOI, cwd: 'D:/repo-worktrees/them-otp-impl', ten: 'them-otp-impl' };

  it('KHÔNG BAO GIỜ chép id phiên của bản gốc — hai terminal cùng resume một hội thoại là hỏng', () => {
    const e = dungEntryNhanBan(claudeEntry(), dich);
    expect(e.claudeSessionId).not.toBe(ID_PHIEN);
    expect(e.claudeSessionId).toBeUndefined();
  });

  it('id, tên, cwd lấy từ đích; worktree cũ không được mang theo', () => {
    const e = dungEntryNhanBan(claudeEntry(), dich);
    expect(e.id).toBe(ID_MOI);
    expect(e.name).toBe('them-otp-impl');
    expect(e.cwd).toBe('D:/repo-worktrees/them-otp-impl');
    expect(e.worktree).toBeUndefined();
  });

  it('có worktree mới thì gắn worktree mới', () => {
    const e = dungEntryNhanBan(claudeEntry(), { ...dich, worktree: { path: dich.cwd, branch: 'them-otp-impl' } });
    expect(e.worktree).toEqual({ path: dich.cwd, branch: 'them-otp-impl' });
  });

  it('giữ vai của bản gốc — bản sao làm cùng loại việc, chỉ khác nhánh', () => {
    const e = dungEntryNhanBan(claudeEntry({ roleId: ID_VAI }), dich);
    expect(e.roleId).toBe(ID_VAI);
  });

  it('bản sao Claude ra đời dưới dạng plain: id phiên fork chỉ biết SAU khi claude chạy', () => {
    const e = dungEntryNhanBan(claudeEntry(), dich);
    expect(e.kind).toBe('plain');
    expect(e.claudeName).toBeUndefined();
  });

  it('bản sao Claude có id phiên mint sẵn thì là entry claude đầy đủ', () => {
    const e = dungEntryNhanBan(claudeEntry(), { ...dich, sessionIdMoi: ID_PHIEN });
    expect(e.kind).toBe('claude');
    expect(e.claudeSessionId).toBe(ID_PHIEN);
    expect(e.claudeName).toBe('them-otp-impl');
  });

  it('bản sao Codex giữ agentId nhưng KHÔNG giữ id phiên Codex', () => {
    const e = dungEntryNhanBan({ id: ID_GOC, name: 'x', cwd: 'D:/r', kind: 'plain', agentId: 'codex', agentSessionId: 'phien-cu' }, dich);
    expect(e.agentId).toBe('codex');
    expect(e.agentSessionId).toBeUndefined();
  });

  it('lệnh khởi động mới đè lên lệnh của bản gốc — Codex bản sao phải mở phiên MỚI', () => {
    const e = dungEntryNhanBan(
      { id: ID_GOC, name: 'x', cwd: 'D:/r', kind: 'plain', agentId: 'codex', startCommand: 'codex resume --last' },
      { ...dich, startCommandMoi: 'codex' },
    );
    expect(e.startCommand).toBe('codex');
  });

  it('bản sao shell giữ nguyên lệnh khởi động', () => {
    const e = dungEntryNhanBan({ id: ID_GOC, name: 'dev', cwd: 'D:/r', kind: 'plain', startCommand: 'npm run dev' }, dich);
    expect(e.startCommand).toBe('npm run dev');
  });
});

describe('lenhCodexChoBanSao', () => {
  it('luôn là phiên MỚI: bản sao ở worktree khác, resume --last sẽ vơ nhầm phiên của thư mục khác', () => {
    expect(lenhCodexChoBanSao('codex resume --last')).toBe('codex');
    expect(lenhCodexChoBanSao('codex resume')).toBe('codex');
  });

  it('giữ --yolo nếu bản gốc chạy với nó — bỏ quyền đã cấp là đổi ý người dùng', () => {
    expect(lenhCodexChoBanSao('codex --yolo')).toBe('codex --yolo');
    expect(lenhCodexChoBanSao('codex resume --last --yolo')).toBe('codex --yolo');
  });

  it('không có lệnh gốc → codex trần', () => {
    expect(lenhCodexChoBanSao(undefined)).toBe('codex');
  });
});

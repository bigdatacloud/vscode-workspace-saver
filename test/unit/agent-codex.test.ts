import { describe, expect, it } from 'vitest';
import { CodexAdapter, docSessionMeta, type CodexFs } from '../../src/agent/codex';

const SID = '019fe6fa-2254-7d70-a936-72c36a43a451';
const SID2 = '019fe6ce-8ff1-78a3-afa1-0a8e87d3854e';

/** Dòng session_meta thật lấy từ một file rollout của Codex (đã rút gọn payload). */
const metaDong = (sessionId: string, cwd: string, timestamp: string): string =>
  JSON.stringify({
    timestamp,
    ordinal: 0,
    type: 'session_meta',
    payload: { session_id: sessionId, id: sessionId, timestamp, cwd, originator: 'codex-tui' },
  });

/** `files`: đường dẫn → dòng session_meta. `mtime`: đường dẫn → lần ghi cuối (ms). */
function fakeFs(files: Record<string, string>, mtime: Record<string, number> = {}): CodexFs {
  return {
    liet: (duongDan) => {
      const tien = `${duongDan}/`;
      return Object.keys(files)
        .filter((p) => p.startsWith(tien) && !p.slice(tien.length).includes('/'))
        .map((p) => p.slice(tien.length));
    },
    docDongDau: (duongDan) => files[duongDan] ?? null,
    ghiCuoi: (duongDan) => mtime[duongDan] ?? null,
  };
}

const HOME = '/home/.codex';
const NGAY = '/home/.codex/sessions/2026/08/12';
const LUC = Date.parse('2026-08-12T10:00:00.000Z');

describe('docSessionMeta', () => {
  it('đọc được session_id, cwd và mốc thời gian', () => {
    const r = docSessionMeta(metaDong(SID, 'D:\\Coding\\erp', '2026-08-12T10:00:00.000Z'));
    expect(r).toEqual({ sessionId: SID, cwd: 'D:\\Coding\\erp', luc: LUC });
  });

  it('dòng không phải session_meta / rỗng / hỏng → null, không ném', () => {
    expect(docSessionMeta(JSON.stringify({ type: 'message' }))).toBeNull();
    expect(docSessionMeta('')).toBeNull();
    expect(docSessionMeta(null)).toBeNull();
    expect(docSessionMeta('{không phải json')).toBeNull();
  });

  it('session_id dạng lạ (ký tự shell) bị từ chối ngay ở cửa đọc', () => {
    const doc = (id: string) =>
      docSessionMeta(
        JSON.stringify({
          type: 'session_meta',
          payload: { session_id: id, cwd: 'D:\\x', timestamp: '2026-08-12T10:00:00.000Z' },
        }),
      );
    expect(doc(SID)?.sessionId).toBe(SID);
    expect(doc("x'; rm -rf /")).toBeNull();
    expect(doc('--dangerously-bypass-approvals-and-sandbox')).toBeNull();
    expect(doc('--last')).toBeNull();
    expect(doc('')).toBeNull();
  });

  it('thiếu timestamp → luc = 0 chứ không NaN (NaN làm mọi phép so sánh im lặng sai)', () => {
    const r = docSessionMeta(
      JSON.stringify({ type: 'session_meta', payload: { session_id: SID, cwd: 'D:\\x' } }),
    );
    expect(r?.luc).toBe(0);
  });
});

describe('CodexAdapter.timSessionMoi', () => {
  const adapter = (files: Record<string, string>, mtime: Record<string, number> = {}) =>
    new CodexAdapter('posix', fakeFs(files, mtime), HOME, '/');

  it('tìm phiên mới trong đúng cwd, bỏ phiên của thư mục khác', () => {
    const a = adapter({
      [`${NGAY}/rollout-2026-08-12T10-00-00-${SID}.jsonl`]: metaDong(
        SID, 'D:\\Coding\\erp', '2026-08-12T10:00:00.000Z',
      ),
      [`${NGAY}/rollout-2026-08-12T10-05-00-${SID2}.jsonl`]: metaDong(
        SID2, 'D:\\Coding\\khac', '2026-08-12T10:05:00.000Z',
      ),
    });
    const r = a.timSessionMoi('D:\\Coding\\erp', LUC - 1000, LUC + 60_000);
    expect(r?.sessionId).toBe(SID);
  });

  it('bỏ phiên bắt đầu TRƯỚC mốc (phiên cũ của chính thư mục đó không được nhận nhầm)', () => {
    const a = adapter({
      [`${NGAY}/rollout-cu-${SID}.jsonl`]: metaDong(
        SID, 'D:\\Coding\\erp', '2026-08-12T09:00:00.000Z',
      ),
    });
    expect(a.timSessionMoi('D:\\Coding\\erp', LUC, LUC + 60_000)).toBeNull();
  });

  it('HAI phiên mới cùng thư mục → không đoán, trả null', () => {
    const a = adapter({
      [`${NGAY}/rollout-1-${SID}.jsonl`]: metaDong(SID, 'D:\\x', '2026-08-12T10:01:00.000Z'),
      [`${NGAY}/rollout-2-${SID2}.jsonl`]: metaDong(SID2, 'D:\\x', '2026-08-12T10:09:00.000Z'),
    });
    expect(a.timSessionMoi('D:\\x', LUC, LUC + 600_000)).toBeNull();
  });

  // `codex resume` ghi TIẾP file cũ (đã kiểm trên kho phiên thật: mỗi file rollout mang đúng
  // một session_id, và file được ghi thêm rất lâu sau khi tạo) — nên phiên được resume chỉ lộ
  // ra qua lần ghi cuối, không có file mới nào cả.
  it('resume phiên cũ: nhận ra qua lần ghi cuối dù phiên tạo từ trước', () => {
    const f = `${NGAY}/rollout-cu-${SID}.jsonl`;
    const a = adapter(
      { [f]: metaDong(SID, 'D:\\x', '2026-08-12T09:00:00.000Z') },
      { [f]: LUC + 5_000 },
    );
    expect(
      a.timSessionMoi('D:\\x', LUC, LUC + 60_000, { chapNhanFileCu: true })?.sessionId,
    ).toBe(SID);
  });

  it('phiên MỚI: file cũ đang được ghi tiếp là của terminal khác → KHÔNG vơ vào', () => {
    // Không có cờ chapNhanFileCu: lệnh khởi chạy là `codex` (phiên mới) nên bắt buộc phải có
    // file rollout MỚI; file cũ đang được ghi thuộc về một terminal Codex khác cùng thư mục.
    const f = `${NGAY}/rollout-cu-${SID}.jsonl`;
    const a = adapter(
      { [f]: metaDong(SID, 'D:\\x', '2026-08-12T09:00:00.000Z') },
      { [f]: LUC + 5_000 },
    );
    expect(a.timSessionMoi('D:\\x', LUC, LUC + 60_000)).toBeNull();
  });

  it('bỏ qua phiên đã thuộc entry khác', () => {
    const f = `${NGAY}/rollout-moi-${SID}.jsonl`;
    const a = adapter({ [f]: metaDong(SID, 'D:\\x', '2026-08-12T10:01:00.000Z') }, { [f]: LUC + 60_000 });
    expect(a.timSessionMoi('D:\\x', LUC, LUC + 600_000)?.sessionId).toBe(SID);
    expect(
      a.timSessionMoi('D:\\x', LUC, LUC + 600_000, { boQua: new Set([SID]) }),
    ).toBeNull();
  });

  it('hai phiên cũ cùng thư mục đều đang được ghi → mơ hồ, không gắn bừa', () => {
    const f1 = `${NGAY}/rollout-a-${SID}.jsonl`;
    const f2 = `${NGAY}/rollout-b-${SID2}.jsonl`;
    const a = adapter(
      {
        [f1]: metaDong(SID, 'D:\\x', '2026-08-12T09:00:00.000Z'),
        [f2]: metaDong(SID2, 'D:\\x', '2026-08-12T09:30:00.000Z'),
      },
      { [f1]: LUC + 5_000, [f2]: LUC + 6_000 },
    );
    expect(a.timSessionMoi('D:\\x', LUC, LUC + 60_000)).toBeNull();
  });

  it('bỏ qua file không phải rollout và thư mục không tồn tại', () => {
    const a = adapter({ [`${NGAY}/ghi-chu.txt`]: metaDong(SID, 'D:\\x', '2026-08-12T10:01:00.000Z') });
    expect(a.timSessionMoi('D:\\x', LUC, LUC + 60_000)).toBeNull();
    expect(adapter({}).timSessionMoi('D:\\x', LUC, LUC + 60_000)).toBeNull();
  });
});

describe('CodexAdapter lệnh', () => {
  const a = new CodexAdapter('posix', fakeFs({}), HOME, '/');

  it('có đủ biến thể thường/yolo, không có biến thể nào đặt trước id (Codex không hỗ trợ)', () => {
    const ds = a.buildLaunchOptions();
    expect(ds.map((o) => o.command)).toEqual([
      'codex',
      'codex --yolo',
      'codex resume --last',
      'codex --yolo resume --last',
      'codex resume',
      'codex --yolo resume',
    ]);
    expect(ds.map((o) => o.mode)).toEqual(['new', 'new', 'last', 'last', 'picker', 'picker']);
    expect(ds.every((o) => o.sessionId === undefined)).toBe(true);
  });

  it('khôi phục mặc định đúng phiên đã lưu và giữ --yolo của lệnh ban đầu', () => {
    const ds = a.buildRestoreOptions('codex --yolo', SID);
    expect(ds.map((o) => [o.mode, o.command])).toEqual([
      ['exact', `codex --yolo resume '${SID}'`],
      ['last', 'codex --yolo resume --last'],
      ['picker', 'codex --yolo resume'],
      ['new', 'codex --yolo'],
    ]);
    expect(ds.every((o) => o.label.includes('bỏ qua phê duyệt và sandbox'))).toBe(true);
  });

  it('chưa có id phiên thì resume phiên cuối trong cwd là lựa chọn mặc định', () => {
    const ds = a.buildRestoreOptions('codex --yolo');
    expect(ds[0]).toMatchObject({ mode: 'last', command: 'codex --yolo resume --last' });
  });

  it('không chép phần đuôi tùy ý từ store vào lệnh khôi phục được miễn trust', () => {
    for (const command of [
      'codex --yolo; Write-Host pwn',
      'codex --yolo ; Write-Host pwn',
      'Write-Output --yolo',
      './codex --yolo',
      'C:\\tmp\\codex.exe --yolo',
      "codex '--yolo",
    ]) {
      const ds = a.buildRestoreOptions(command, SID);
      expect(ds.every((o) => !o.command.includes('Write-Host'))).toBe(true);
      expect(ds[0]?.command).toBe(`codex resume '${SID}'`);
    }
  });

  it('session id bắt đầu bằng dấu gạch không bao giờ thành option của Codex', () => {
    expect(a.buildRestoreOptions('codex', '--last')[0]).toMatchObject({ mode: 'last' });
    expect(() => a.buildResumeCommand('--dangerously-bypass-hook-trust')).toThrow(/session id/i);
  });

  it('resume trích dẫn id', () => {
    expect(a.buildResumeCommand(SID)).toBe(`codex resume '${SID}'`);
    expect(a.buildResumeCommand(SID, 'codex --yolo')).toBe(`codex --yolo resume '${SID}'`);
  });

  it('mọi lệnh sinh ra đều được ownsCommand nhận (capture bỏ qua, không nhớ lệnh thô)', () => {
    for (const o of a.buildLaunchOptions()) expect(a.ownsCommand(o.command)).toBe(true);
    expect(a.ownsCommand(a.buildResumeCommand(SID))).toBe(true);
  });

  it('nhận diện codex qua đường dẫn, đuôi Windows, npx và package spec', () => {
    expect(a.ownsCommand('codex')).toBe(true);
    expect(a.ownsCommand('CODEX resume --last')).toBe(true);
    expect(a.ownsCommand('C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd')).toBe(true);
    expect(a.ownsCommand('npx -y @openai/codex@1.2.3')).toBe(true);
    expect(a.ownsCommand('pnpm dlx codex')).toBe(true);
  });

  it('không nhận nhầm lệnh khác', () => {
    expect(a.ownsCommand('codexify')).toBe(false);
    expect(a.ownsCommand('npm run codex')).toBe(false);
    expect(a.ownsCommand('echo codex')).toBe(false);
    expect(a.ownsCommand('')).toBe(false);
  });
});

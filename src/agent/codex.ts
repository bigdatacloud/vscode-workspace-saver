import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { quoteArg, type ShellKind } from './quote';
import type { LaunchOption } from './types';

export const CODEX_BIN = 'codex';
/** Package npm chứa binary codex — `npx @openai/codex` chính là chạy codex. */
const CODEX_PKG = '@openai/codex';
const CODEX_SESSION_ID_RE = /^[A-Za-z0-9_][\w.:-]{0,127}$/;

export interface CodexRestoreOption extends LaunchOption {
  /** Nhánh được chọn khi khôi phục — manager dùng để biết có phải dò lại session id không. */
  mode: 'exact' | 'last' | 'picker' | 'new';
}

export interface CodexLaunchOption extends LaunchOption {
  /** Không suy mode từ vị trí trong mảng: mỗi mode có cả biến thể thường và --yolo. */
  mode: 'new' | 'last' | 'picker';
}

/** Đọc thư mục phiên của Codex. Tách ra port để test được mà không đụng đĩa thật. */
export interface CodexFs {
  /** Tên các mục con; thư mục không tồn tại → mảng rỗng, KHÔNG ném. */
  liet(duongDan: string): string[];
  /** Dòng đầu của file (bản ghi `session_meta`); đọc lỗi → null. */
  docDongDau(duongDan: string): string | null;
  /** Lần ghi cuối (ms). Cần vì `codex resume` GHI TIẾP file cũ chứ không tạo file mới. */
  ghiCuoi(duongDan: string): number | null;
}

export interface CodexSession {
  sessionId: string;
  cwd: string;
  /** Mốc thời gian trong `session_meta`, tính bằng ms. */
  luc: number;
  /** Lần ghi cuối vào file rollout (ms) — dấu hiệu phiên vẫn đang được dùng. */
  ghiCuoi: number;
  /** Đường dẫn file rollout — tiện hiện cho người dùng. */
  file: string;
}

/**
 * Adapter cho Codex CLI. Khác Claude ở hai chỗ quyết định cách làm:
 *  - KHÔNG có cờ đặt trước session id (Claude có `--session-id`), nên không thể "mint rồi
 *    chạy"; phải khám phá id SAU khi phiên đã bắt đầu.
 *  - KHÔNG có registry liệt kê phiên đang chạy kèm pid (Claude có `claude agents --json`),
 *    nên không có trạng thái bận/rảnh; bù lại Codex ghi mỗi phiên thành một file rollout
 *    `~/.codex/sessions/YYYY/MM/DD/rollout-<thời-điểm>-<uuid>.jsonl` mà dòng đầu chứa
 *    `session_meta` có `session_id` và `cwd` — đủ để khám phá id và resume sau này.
 */
export class CodexAdapter {
  readonly id = 'codex';

  constructor(
    private readonly shell: ShellKind,
    private readonly fs: CodexFs,
    /** Thư mục nhà của Codex (`CODEX_HOME` hoặc `~/.codex`). */
    private readonly codexHome: string,
    private readonly sep: string = '/',
  ) {}

  buildLaunchOptions(): CodexLaunchOption[] {
    return [
      {
        mode: 'new',
        label: 'Phiên mới',
        description: CODEX_BIN,
        command: CODEX_BIN,
      },
      {
        mode: 'new',
        label: 'Phiên mới — bỏ qua phê duyệt và sandbox',
        description: `${CODEX_BIN} --yolo`,
        command: `${CODEX_BIN} --yolo`,
      },
      {
        mode: 'last',
        label: 'Tiếp tục phiên gần nhất',
        description: `${CODEX_BIN} resume --last`,
        command: `${CODEX_BIN} resume --last`,
      },
      {
        mode: 'last',
        label: 'Tiếp tục phiên gần nhất — bỏ qua phê duyệt và sandbox',
        description: `${CODEX_BIN} --yolo resume --last`,
        command: `${CODEX_BIN} --yolo resume --last`,
      },
      {
        mode: 'picker',
        label: 'Chọn phiên để resume',
        description: `${CODEX_BIN} resume`,
        command: `${CODEX_BIN} resume`,
      },
      {
        mode: 'picker',
        label: 'Chọn phiên để resume — bỏ qua phê duyệt và sandbox',
        description: `${CODEX_BIN} --yolo resume`,
        command: `${CODEX_BIN} --yolo resume`,
      },
    ];
  }

  /**
   * Danh sách dùng khi MỞ LẠI một terminal Codex. Nếu đã bắt được id thì đúng phiên đó đứng
   * đầu; chưa có id thì `--last` (Codex tự giới hạn theo cwd hiện tại) đứng đầu. Chỉ giữ cờ
   * toàn quyền đã biết, tuyệt đối không nối nguyên chuỗi từ store vào lệnh được miễn trust.
   */
  buildRestoreOptions(commandBefore: string | undefined, sessionId?: string): CodexRestoreOption[] {
    const base = this.safeBaseCommand(commandBefore);
    const fullAccess = base !== CODEX_BIN;
    const suffix = fullAccess ? ' — bỏ qua phê duyệt và sandbox' : '';
    const exact: CodexRestoreOption[] = sessionId === undefined || !CODEX_SESSION_ID_RE.test(sessionId)
      ? []
      : [{
          mode: 'exact',
          label: `Tiếp tục đúng phiên đã lưu${suffix}`,
          description: `${base} resume ${sessionId}`,
          command: `${base} resume ${quoteArg(sessionId, this.shell)}`,
        }];
    return [
      ...exact,
      {
        mode: 'last',
        label: `Tiếp tục phiên gần nhất${suffix}`,
        description: `${base} resume --last`,
        command: `${base} resume --last`,
      },
      {
        mode: 'picker',
        label: `Chọn phiên để resume${suffix}`,
        description: `${base} resume`,
        command: `${base} resume`,
      },
      {
        mode: 'new',
        label: `Tạo phiên mới${suffix}`,
        description: base,
        command: base,
      },
    ];
  }

  buildResumeCommand(sessionId: string, commandBefore?: string): string {
    if (!CODEX_SESSION_ID_RE.test(sessionId)) throw new Error('Codex session id không hợp lệ');
    return `${this.safeBaseCommand(commandBefore)} resume ${quoteArg(sessionId, this.shell)}`;
  }

  /**
   * Chỉ giữ cờ toàn quyền khi TOÀN BỘ lệnh khớp grammar mà adapter tự sinh. Không được suy
   * quyền từ việc thấy token `--yolo` đâu đó trong text store không đáng tin.
   */
  private safeBaseCommand(commandBefore: string | undefined): string {
    const command = commandBefore?.trim() ?? '';
    for (const flag of ['--yolo', '--dangerously-bypass-approvals-and-sandbox']) {
      const base = `${CODEX_BIN} ${flag}`;
      if (command === base || command === `${base} resume` || command === `${base} resume --last`) {
        return base;
      }
      const prefix = `${base} resume `;
      if (!command.startsWith(prefix)) continue;
      const quoted = command.slice(prefix.length);
      const match = quoted.match(/^(['"])([A-Za-z0-9_][\w.:-]{0,127})\1$/);
      const sessionId = match?.[2];
      if (sessionId !== undefined && quoted === quoteArg(sessionId, this.shell)) return base;
    }
    return CODEX_BIN;
  }

  ownsCommand(command: string): boolean {
    const ts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    if (ts.length === 0) return false;
    const boNhay = (t: string) => t.replace(/^["']|["']$/g, '');
    const ten = (t: string) =>
      (boNhay(t).toLowerCase().split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd|bat|ps1)$/, '');

    const runner = ten(ts[0] ?? '');
    let idx = -1;
    if (runner === 'npx' || runner === 'bunx') idx = 1;
    else if ((runner === 'pnpm' || runner === 'yarn') && boNhay(ts[1] ?? '').toLowerCase() === 'dlx') idx = 2;
    if (idx > 0) {
      while (idx < ts.length && boNhay(ts[idx] ?? '').startsWith('-')) idx += 1;
      const muc = ts[idx];
      return muc !== undefined && laChuongTrinhCodex(muc);
    }
    return laChuongTrinhCodex(ts[0] ?? '');
  }

  /**
   * Tìm phiên Codex bắt đầu TRONG `cwd` kể từ mốc `tuLuc` (ms). Dùng để khám phá id của phiên
   * vừa mở — chỉ quét các thư mục ngày liên quan chứ không duyệt cả kho (kho có thể hàng nghìn
   * file). Nhiều phiên khớp thì lấy phiên MỚI NHẤT.
   */
  timSessionMoi(
    cwd: string,
    tuLuc: number,
    bayGio: number = Date.now(),
    tuyChon: { chapNhanFileCu?: boolean; boQua?: ReadonlySet<string> } = {},
  ): CodexSession | null {
    const boQua = tuyChon.boQua ?? new Set<string>();
    const ungVien = this.quetTheoNgay(tuLuc, bayGio, tuLuc).filter(
      (s) => cungThuMuc(s.cwd, cwd) && !boQua.has(s.sessionId),
    );

    // Phiên MỚI tạo sau khi ta chạy — trường hợp `codex` (phiên mới).
    const moi = ungVien.filter((s) => s.luc >= tuLuc);
    if (moi.length === 1) return moi[0] ?? null;
    if (moi.length > 1) return null; // hai phiên mới cùng thư mục: không đoán

    // `codex resume` GHI TIẾP file cũ (đã kiểm: mỗi file rollout mang đúng một session_id),
    // nên phiên được resume lộ diện qua lần ghi cuối chứ không qua file mới. CHỈ dùng nhánh
    // này khi lệnh khởi chạy đúng là biến thể resume — với phiên mới, một file cũ đang được
    // ghi tiếp là của terminal KHÁC trong cùng thư mục, vơ vào là gắn nhầm hội thoại.
    if (tuyChon.chapNhanFileCu !== true) return null;
    const dangGhi = ungVien.filter((s) => s.ghiCuoi >= tuLuc);
    return dangGhi.length === 1 ? dangGhi[0] ?? null : null;
  }

  /** Các phiên gần đây (mọi cwd) — dùng cho lệnh gắn session bằng tay. */
  lietKeGanDay(soNgay = 7, bayGio: number = Date.now()): CodexSession[] {
    const tuLuc = bayGio - soNgay * 86_400_000;
    return this.quetTheoNgay(tuLuc, bayGio).sort((a, b) => b.luc - a.luc);
  }

  /**
   * @param chiSauKhi Chỉ xét file có lần ghi cuối từ mốc này trở đi. Lọc bằng `stat` TRƯỚC khi
   *   đọc đầu file: kho phiên có thể hàng nghìn file mà vòng dò chạy mỗi 3 giây trên chính
   *   luồng extension host — đọc hết là giật UI.
   */
  private quetTheoNgay(tuLuc: number, bayGio: number, chiSauKhi?: number): CodexSession[] {
    const goc = [this.codexHome, 'sessions'].join(this.sep);
    const ra: CodexSession[] = [];
    // Bao cả một ngày đệm mỗi phía: file được đặt theo giờ ĐỊA PHƯƠNG còn mốc so sánh là UTC.
    for (let t = tuLuc - 86_400_000; t <= bayGio + 86_400_000; t += 86_400_000) {
      const d = new Date(t);
      const thuMuc = [
        goc,
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
      ].join(this.sep);
      for (const ten of this.fs.liet(thuMuc)) {
        if (!ten.startsWith('rollout-') || !ten.endsWith('.jsonl')) continue;
        const duongDan = [thuMuc, ten].join(this.sep);
        const ghiCuoi = this.fs.ghiCuoi(duongDan);
        if (chiSauKhi !== undefined && ghiCuoi !== null && ghiCuoi < chiSauKhi) continue;
        const meta = docSessionMeta(this.fs.docDongDau(duongDan));
        if (meta) ra.push({ ...meta, ghiCuoi: ghiCuoi ?? meta.luc, file: duongDan });
      }
    }
    return ra;
  }
}

/** Đọc bản ghi `session_meta` ở dòng đầu file rollout. Sai định dạng → null, không ném. */
export function docSessionMeta(
  dong: string | null,
): Omit<CodexSession, 'file' | 'ghiCuoi'> | null {
  if (dong === null || dong.trim() === '') return null;
  try {
    const o = JSON.parse(dong) as {
      type?: string;
      payload?: { session_id?: string; id?: string; cwd?: string; timestamp?: string };
    };
    if (o.type !== 'session_meta') return null;
    const p = o.payload;
    if (!p || typeof p.cwd !== 'string') return null;
    // Codex 0.147: với luồng subagent, `session_id` là id của luồng CHA còn `id` mới là id
    // của chính phiên này (trùng id trong tên file). Resume phải dùng id của chính nó; với
    // phiên thường hai trường bằng nhau nên ưu tiên `id` là an toàn cho cả hai.
    const sessionId = typeof p.id === 'string' && p.id !== '' ? p.id : p.session_id;
    if (typeof sessionId !== 'string') return null;
    // Id đi thẳng vào chuỗi lệnh shell. `quoteArg` đã escape, nhưng lọc ngay ở cửa ĐỌC là lớp
    // phòng thủ rẻ và không phụ thuộc vào việc trích dẫn của shell nào cũng kín.
    if (!CODEX_SESSION_ID_RE.test(sessionId)) return null;
    const luc = p.timestamp !== undefined ? Date.parse(p.timestamp) : Number.NaN;
    return { sessionId, cwd: p.cwd, luc: Number.isNaN(luc) ? 0 : luc };
  } catch {
    return null;
  }
}

/** So thư mục theo kiểu Windows: không phân biệt hoa thường, `\` và `/` như nhau. */
function cungThuMuc(a: string, b: string, win32: boolean = process.platform === 'win32'): boolean {
  // Dùng cùng quy tắc với `normalizeCwd` bên matcher của Claude: resolve trước (đường dẫn
  // tương đối, `..`), rồi mới bỏ phân biệt hoa thường và kiểu dấu chéo trên Windows.
  const chuan = (p: string) => {
    const bo = path.resolve(p.trim()).replace(/[\\/]+$/, '');
    return win32 ? bo.toLowerCase().replaceAll('\\', '/') : bo;
  };
  return chuan(a) === chuan(b);
}

export const realCodexFs: CodexFs = {
  liet(duongDan) {
    try {
      return nodeFs.readdirSync(duongDan);
    } catch {
      return [];
    }
  },
  ghiCuoi(duongDan) {
    try {
      return nodeFs.statSync(duongDan).mtimeMs;
    } catch {
      return null;
    }
  },
  docDongDau(duongDan) {
    // Chỉ đọc phần đầu: file rollout của một phiên dài có thể tới hàng chục MB, mà thứ ta
    // cần nằm ở dòng đầu tiên. NHƯNG dòng đầu không hề ngắn: Codex 0.147 nhét cả cấu hình
    // và chỉ dẫn vào `session_meta` nên nó cỡ 19 KB. Đọc cứng 16 KB như trước là cắt cụt
    // dòng → JSON hỏng → KHÔNG BAO GIỜ tìm thấy phiên nào (đo trên máy người dùng). Đọc lớn
    // dần tới khi gặp xuống dòng, có trần để một file không có `\n` nào không nuốt hết RAM.
    const KHOI = 64 * 1024;
    const TRAN = 4 * 1024 * 1024;
    let fd: number | null = null;
    try {
      fd = nodeFs.openSync(duongDan, 'r');
      const buf = Buffer.alloc(KHOI);
      let daDoc = '';
      let viTri = 0;
      for (;;) {
        const n = nodeFs.readSync(fd, buf, 0, buf.length, viTri);
        if (n <= 0) return daDoc === '' ? null : daDoc;
        viTri += n;
        daDoc += buf.subarray(0, n).toString('utf8');
        const i = daDoc.indexOf('\n');
        if (i >= 0) return daDoc.slice(0, i);
        if (daDoc.length >= TRAN) return daDoc.slice(0, TRAN);
      }
    } catch {
      return null;
    } finally {
      if (fd !== null) {
        try {
          nodeFs.closeSync(fd);
        } catch {
          /* đóng lỗi thì thôi, không có gì để làm thêm */
        }
      }
    }
  },
};

/** `CODEX_HOME` nếu có, ngược lại `~/.codex` (đúng mặc định của Codex CLI). */
export function codexHomeMacDinh(): string {
  const env = process.env.CODEX_HOME;
  return env !== undefined && env.trim() !== '' ? env : path.join(os.homedir(), '.codex');
}

function laChuongTrinhCodex(tokenTho: string): boolean {
  const token = tokenTho.replace(/^["']|["']$/g, '').toLowerCase();
  if (token.startsWith('@')) return token === CODEX_PKG || token.startsWith(`${CODEX_PKG}@`);
  let ten = (token.split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd|bat|ps1)$/, '');
  const viTriVersion = ten.indexOf('@');
  if (viTriVersion > 0) ten = ten.slice(0, viTriVersion);
  return ten === CODEX_BIN;
}

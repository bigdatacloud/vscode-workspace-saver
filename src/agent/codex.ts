import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { quoteArg, type ShellKind } from './quote';
import type { LaunchOption } from './types';

export const CODEX_BIN = 'codex';
/** Package npm chứa binary codex — `npx @openai/codex` chính là chạy codex. */
const CODEX_PKG = '@openai/codex';

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

  buildLaunchOptions(): LaunchOption[] {
    return [
      {
        label: 'Phiên mới',
        description: CODEX_BIN,
        command: CODEX_BIN,
      },
      {
        label: 'Tiếp tục phiên gần nhất',
        description: `${CODEX_BIN} resume --last`,
        command: `${CODEX_BIN} resume --last`,
      },
      {
        label: 'Chọn phiên để resume',
        description: `${CODEX_BIN} resume`,
        command: `${CODEX_BIN} resume`,
      },
    ];
  }

  buildResumeCommand(sessionId: string): string {
    return `${CODEX_BIN} resume ${quoteArg(sessionId, this.shell)}`;
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
      payload?: { session_id?: string; cwd?: string; timestamp?: string };
    };
    if (o.type !== 'session_meta') return null;
    const p = o.payload;
    if (!p || typeof p.session_id !== 'string' || typeof p.cwd !== 'string') return null;
    // Id đi thẳng vào chuỗi lệnh shell. `quoteArg` đã escape, nhưng lọc ngay ở cửa ĐỌC là lớp
    // phòng thủ rẻ và không phụ thuộc vào việc trích dẫn của shell nào cũng kín.
    if (!/^[\w.:-]{1,128}$/.test(p.session_id)) return null;
    const luc = p.timestamp !== undefined ? Date.parse(p.timestamp) : Number.NaN;
    return { sessionId: p.session_id, cwd: p.cwd, luc: Number.isNaN(luc) ? 0 : luc };
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
    // cần nằm ở dòng đầu tiên.
    let fd: number | null = null;
    try {
      fd = nodeFs.openSync(duongDan, 'r');
      const buf = Buffer.alloc(16 * 1024);
      const n = nodeFs.readSync(fd, buf, 0, buf.length, 0);
      const s = buf.subarray(0, n).toString('utf8');
      const i = s.indexOf('\n');
      return i >= 0 ? s.slice(0, i) : s;
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

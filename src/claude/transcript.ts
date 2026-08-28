/**
 * Nhận diện phiên Claude đang CHỜ NGƯỜI DÙNG trả lời.
 *
 * `claude agents --json` chỉ có `busy`/`idle` cho phiên interactive (đã đo trên máy thật), mà
 * "idle" gộp cả hai chuyện rất khác nhau: đã xong việc, và đang dừng giữa chừng chờ bạn bấm.
 * Tín hiệu phân biệt nằm trong transcript: khi Claude hỏi, bản ghi cuối là message của
 * `assistant` chứa `tool_use` mà CHƯA có `tool_result` tương ứng — người dùng trả lời xong
 * mới sinh ra `tool_result` (đo được: AskUserQuestion 14:13:29 → tool_result 14:16:32).
 */

import * as os from 'node:os';
import * as path from 'node:path';

/** `CLAUDE_CONFIG_DIR` nếu có, ngược lại `~/.claude`. */
export function claudeHomeMacDinh(): string {
  const env = process.env.CLAUDE_CONFIG_DIR;
  return env !== undefined && env.trim() !== '' ? env : path.join(os.homedir(), '.claude');
}

/** Tool chỉ kết thúc được bằng thao tác của người dùng — dangling là chắc chắn đang chờ. */
const TOOL_HOI_NGUOI_DUNG = new Set(['AskUserQuestion', 'ExitPlanMode']);

/** Số bản ghi cuối cần soi; đủ xa để bỏ qua các bản ghi metadata đuôi file. */
const SO_BAN_GHI_SOI = 40;

interface Khoi {
  type?: string;
  name?: string;
}

interface BanGhi {
  message?: { role?: string; content?: unknown };
}

/**
 * @param duoiFile Phần ĐUÔI của file transcript (jsonl). Dòng đầu có thể cụt do cắt giữa
 *   chừng — dòng nào parse hỏng thì bỏ, không ném.
 * @param dangIdle Registry có đang báo phiên này `idle` không. Tool thường (Bash, Edit…) mà
 *   dangling thì chỉ kết luận "đang chờ" khi tiến trình rảnh — bận nghĩa là tool đang chạy
 *   thật, không phải chờ bấm.
 */
export function dangChoNguoiDung(duoiFile: string, dangIdle: boolean): boolean {
  const banGhi: BanGhi[] = [];
  for (const dong of duoiFile.split('\n')) {
    const sach = dong.trim();
    if (!sach.startsWith('{')) continue;
    try {
      const o = JSON.parse(sach) as BanGhi;
      if (o.message && typeof o.message === 'object') banGhi.push(o);
    } catch {
      // dòng cụt hoặc rác — bỏ qua
    }
  }

  for (const o of banGhi.slice(-SO_BAN_GHI_SOI).reverse()) {
    const msg = o.message;
    const khoi: Khoi[] = Array.isArray(msg?.content) ? (msg?.content as Khoi[]) : [];
    if (msg?.role === 'user') {
      // Đã có tool_result → lời gọi trước đó được trả lời rồi, không phải đang chờ.
      if (khoi.some((b) => b?.type === 'tool_result')) return false;
      continue;
    }
    if (msg?.role !== 'assistant') continue;
    const goiTool = khoi.filter((b) => b?.type === 'tool_use');
    if (goiTool.length === 0) {
      // Lượt kết thúc bằng văn bản: Claude đã trả lời xong, đang rảnh thật.
      if (khoi.some((b) => b?.type === 'text')) return false;
      continue;
    }
    if (goiTool.some((b) => b.name !== undefined && TOOL_HOI_NGUOI_DUNG.has(b.name))) return true;
    return dangIdle;
  }
  return false;
}

/**
 * Đường dẫn transcript: `<home>/projects/<cwd đã thay ':' '\' '/' bằng '-'>/<sessionId>.jsonl`.
 * (Đã đối chiếu file thật: `D:\Coding\longvanai-office` → `D--Coding-longvanai-office`.)
 */
export function duongDanTranscript(
  home: string,
  cwd: string,
  sessionId: string,
  sep = '/',
): string {
  const thuMuc = cwd.replace(/[:\\/]/g, '-');
  return [home, 'projects', thuMuc, `${sessionId}.jsonl`].join(sep);
}

/** Cắt chuỗi dài, giữ đầu — phần đầu của một lượt gần như luôn là phần mang thông tin. */
function catNgan(s: string, toiDa: number): string {
  const sach = s.replace(/\s+/g, ' ').trim();
  return sach.length <= toiDa ? sach : `${sach.slice(0, toiDa)}…`;
}

/** Đường dẫn/lệnh đáng nêu trong input của một tool, theo tên khoá quen thuộc. */
function doiTuongCuaTool(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const o = input as Record<string, unknown>;
  for (const khoa of ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url']) {
    const v = o[khoa];
    if (typeof v === 'string' && v !== '') return catNgan(v, 120);
  }
  return '';
}

/**
 * Tóm tắt N lượt cuối của một transcript thành văn bản đọc được.
 *
 * Đây là thứ người điều phối dùng để KIỂM TRA BÀI LÀM, nên phải nêu rõ tool nào đã chạy và
 * đụng vào file nào — chỉ đọc lời agent tự thuật là đúng cái bẫy mà việc kiểm tra sinh ra để
 * tránh. Cắt ngắn từng lượt vì transcript đầy đủ sẽ nuốt hết cửa sổ ngữ cảnh của người
 * điều phối, mà nó còn phải theo dõi nhiều worker cùng lúc.
 */
export function tomTatTranscript(duoiFile: string, soLuot: number): string {
  const dong: string[] = [];
  for (const dongTho of duoiFile.split('\n')) {
    const sach = dongTho.trim();
    if (!sach.startsWith('{')) continue;
    let o: BanGhi;
    try {
      o = JSON.parse(sach) as BanGhi;
    } catch {
      continue; // dòng cụt hoặc rác
    }
    const msg = o.message;
    if (!msg || typeof msg !== 'object') continue;
    const vai = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : null;
    if (vai === null) continue;
    const khoi: Khoi[] = Array.isArray(msg.content) ? (msg.content as Khoi[]) : [];
    const phan: string[] = [];
    const chuoi = typeof msg.content === 'string' ? msg.content : '';
    if (chuoi !== '') phan.push(catNgan(chuoi, 300));
    for (const b of khoi) {
      if (b?.type === 'text') {
        const t = (b as { text?: unknown }).text;
        if (typeof t === 'string' && t.trim() !== '') phan.push(catNgan(t, 300));
      } else if (b?.type === 'tool_use') {
        const doiTuong = doiTuongCuaTool((b as { input?: unknown }).input);
        phan.push(`⟨${b.name ?? 'tool'}${doiTuong === '' ? '' : ` ${doiTuong}`}⟩`);
      } else if (b?.type === 'tool_result') {
        phan.push('⟨kết quả tool⟩');
      }
    }
    if (phan.length === 0) continue;
    dong.push(`[${vai}] ${catNgan(phan.join(' '), 400)}`);
  }
  return dong.slice(-Math.max(1, soLuot)).join('\n');
}

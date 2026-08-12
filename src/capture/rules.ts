/**
 * Luật bắt "app đang chạy" trong terminal để tự khôi phục lần sau — người dùng
 * không phải khai báo gì. Nguyên tắc: lệnh được ghi làm startCommand ngay khi
 * BẮT ĐẦU chạy (crash giữa chừng vẫn còn trên đĩa); khi lệnh KẾT THÚC, nếu nó
 * chạy quá ngắn (lệnh vặt kiểu `ls`, `git status`) thì trả lại giá trị trước đó.
 */

/** Lệnh phải sống ít nhất chừng này mới được coi là "app", không phải lệnh vặt. */
export const NGUONG_LENH_DANG_KE_MS = 15_000;

export interface LenhDangCho {
  lenh: string;
  /** startCommand trước khi lệnh này chiếm chỗ — để trả lại nếu lệnh hóa ra vặt. */
  luuTruoc: string | undefined;
  batDauLuc: number;
  /**
   * Token định danh execution (object `event.execution` của VS Code) — ghép cặp start/end
   * PHẢI so bằng identity: API nói rõ `commandLine.value` có thể được tinh chỉnh lại giữa
   * hai sự kiện, so chuỗi sẽ rớt cặp.
   */
  token: unknown;
}

/**
 * Dấu hiệu lệnh mang bí mật. startCommand được ghi thẳng xuống `workspaces.json` (file
 * thường, không mã hoá) và còn được CHẠY LẠI ở lần khôi phục sau — nhớ một lệnh có token là
 * vừa rò rỉ vừa lặp lại thao tác nhạy cảm sau lưng người dùng.
 */
const DAU_HIEU_BI_MAT = [
  /(^|\s)-p\S/i, //  mysql -pHunter2 (mật khẩu dính liền cờ)
  /--password[=\s]/i,
  /(^|\s)--token[=\s]/i,
  /\b(api[_-]?key|secret|passwd|password|access[_-]?token)\b\s*[:=]/i,
  /\bBearer\s+\S+/i,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /:\/\/[^/\s:@]+:[^/\s@]+@/, // https://user:pass@host
];

export function coVeChuaBiMat(lenh: string): boolean {
  return DAU_HIEU_BI_MAT.some((re) => re.test(lenh));
}

/** Có nên bắt lệnh này không: chỉ terminal 'plain', và không phải lệnh của agent (Claude có đường resume riêng, tốt hơn chạy lại lệnh thô). */
export function nenBatLenh(kind: 'claude' | 'plain', laLenhAgent: boolean, lenh: string): boolean {
  if (kind !== 'plain') return false;
  if (laLenhAgent) return false;
  if (coVeChuaBiMat(lenh)) return false;
  return lenh.trim() !== '';
}

/**
 * Lệnh kết thúc → startCommand nên là gì.
 * Chạy đủ lâu: giữ lệnh đó. Chạy ngắn: trả lại giá trị trước (có thể là undefined = xóa).
 */
export function khiKetThucLenh(
  p: LenhDangCho,
  ketThucLuc: number,
  nguongMs: number = NGUONG_LENH_DANG_KE_MS,
  exitCode?: number,
): string | undefined {
  // Lệnh THOÁT LỖI thì không đáng nhớ dù chạy lâu: một `npm run build` hỏng sau 20 giây mà
  // thành "app của terminal này" là lần mở lại nào cũng chạy lại đúng cái lỗi đó.
  // `undefined` = VS Code không báo mã thoát (shell integration không đủ) → không suy diễn.
  if (exitCode !== undefined && exitCode !== 0) return p.luuTruoc;
  return ketThucLuc - p.batDauLuc >= nguongMs ? p.lenh : p.luuTruoc;
}

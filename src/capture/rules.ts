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
}

/** Có nên bắt lệnh này không: chỉ terminal 'plain', và không phải lệnh của agent (Claude có đường resume riêng, tốt hơn chạy lại lệnh thô). */
export function nenBatLenh(kind: 'claude' | 'plain', laLenhAgent: boolean, lenh: string): boolean {
  if (kind !== 'plain') return false;
  if (laLenhAgent) return false;
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
): string | undefined {
  return ketThucLuc - p.batDauLuc >= nguongMs ? p.lenh : p.luuTruoc;
}

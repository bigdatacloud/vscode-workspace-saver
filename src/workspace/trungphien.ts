/**
 * Một hội thoại Claude chỉ được có MỘT tiến trình.
 *
 * `claude --resume <id>` không tự kiểm tra điều đó: gọi hai lần là hai tiến trình cùng ghi một
 * file phiên, và lịch sử bị xé đôi thì không cứu được. Nhánh `-c` của extension đã có hàng rào
 * (`coPhienDangChayNgoai`) từ trước; nhánh resume thì chưa — đo trên máy thật 17/10/2026 thấy
 * bốn hội thoại đang có 2–3 tiến trình, trong đó một hội thoại bị hai workspace khác nhau cùng
 * trỏ tới. Module này là phần quyết định của hàng rào còn thiếu, tách thuần để test được.
 */

export interface PhienDangChay {
  sessionId: string;
  /** `null` = hàng registry của một phiên đã thoát, không phải tiến trình sống. */
  pid: number | null;
}

export type PhanXuPhien =
  /** Không ai giữ hội thoại này — mở như bình thường. */
  | { loai: 'mo' }
  /** Đang chạy trong một terminal của CỬA SỔ NÀY: dùng lại nó, đừng resume lần hai. */
  | { loai: 'daCoChu'; terminalId: string }
  /** Đang chạy ở cửa sổ VS Code khác hoặc ngoài VS Code: ở đây không có terminal để mà dùng. */
  | { loai: 'ngoai'; soTienTrinh: number };

/**
 * @param sessionId Hội thoại mà entry sắp resume; `undefined` = entry chưa gắn phiên nào.
 * @param dangChay Các phiên registry báo đang chạy (xem `claude agents --json`).
 * @param chuTrongCuaSo sessionId → id terminal mà CỬA SỔ NÀY đang giữ và đang chạy hội thoại đó.
 */
export function phanXuTrungPhien(
  sessionId: string | undefined,
  dangChay: readonly PhienDangChay[],
  chuTrongCuaSo: ReadonlyMap<string, string>,
): PhanXuPhien {
  if (sessionId === undefined) return { loai: 'mo' };

  // Terminal ta đang sờ được là bằng chứng mạnh hơn registry (registry có thể đọc hỏng, hoặc
  // chậm một nhịp sau khi terminal vừa khởi động) — và nó còn là lối ra tốt hơn cho người
  // dùng: dùng lại cái đang chạy, không phải trả lời thêm câu hỏi nào.
  const chu = chuTrongCuaSo.get(sessionId);
  if (chu !== undefined) return { loai: 'daCoChu', terminalId: chu };

  const soTienTrinh = dangChay.filter((r) => r.sessionId === sessionId && r.pid !== null).length;
  return soTienTrinh > 0 ? { loai: 'ngoai', soTienTrinh } : { loai: 'mo' };
}

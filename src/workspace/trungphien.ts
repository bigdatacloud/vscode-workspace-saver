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
  | { loai: 'ngoai'; soTienTrinh: number }
  /**
   * Hội thoại KHÁC, nhưng cùng tên và cùng chỗ làm việc với một terminal đang mở.
   *
   * Khác `daCoChu` ở chỗ không có gì bị xé đôi — hai hội thoại riêng biệt chạy song song
   * trên cùng một thư mục là hợp lệ về kỹ thuật. Chỉ là gần như luôn luôn ngoài ý muốn:
   * người dùng có cùng một dự án nằm ở hai workspace, kích hoạt cái thứ hai là mọc thêm
   * một phiên agent y hệt. Nên hỏi, chứ không tự quyết.
   */
  | { loai: 'trungCho'; terminalId: string };

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

/**
 * Chỗ làm việc THẬT của một entry: worktree riêng nếu có, không thì `cwd`.
 *
 * Chuẩn hoá để hai cách viết cùng một thư mục vẫn so được với nhau. Hạ hoa-thường là đúng
 * cho Windows (nơi extension này chạy); trên hệ phân biệt hoa thường thì cùng lắm là hỏi
 * dư một câu, không bao giờ làm mất dữ liệu.
 */
export function choLamViec(e: { cwd: string; worktree?: { path: string } }): string {
  return (e.worktree?.path ?? e.cwd)
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Một terminal đang mở, mô tả đủ để biết nó có trùng chỗ với entry nào không. */
export interface TerminalDangGiu {
  /** Id entry đang giữ terminal này — cũng là key của `TerminalManager`. */
  terminalId: string;
  name: string;
  cwd: string;
  worktree?: { path: string };
}

/**
 * Terminal nào đang mở mà TRÙNG TÊN và TRÙNG CHỖ LÀM VIỆC với entry sắp mở.
 *
 * Hai điều kiện phải cùng đúng: trùng tên mà khác thư mục là hai việc khác nhau tình cờ đặt
 * tên giống; cùng thư mục mà khác tên là chủ ý chạy nhiều vai trên một dự án (đúng cái
 * extension này sinh ra để làm). Chỉ khi cả hai trùng mới gần như chắc chắn là nhân đôi.
 */
export function timTerminalTrungCho(
  entry: { id: string; name: string; cwd: string; worktree?: { path: string } },
  dangGiu: readonly TerminalDangGiu[],
): string | null {
  const cho = choLamViec(entry);
  const ten = entry.name.trim().toLowerCase();
  for (const t of dangGiu) {
    if (t.terminalId === entry.id) continue;
    if (t.name.trim().toLowerCase() !== ten) continue;
    if (choLamViec(t) !== cho) continue;
    return t.terminalId;
  }
  return null;
}

/**
 * Phạm vi của một lượt kích hoạt.
 *
 * Trước bản này chỉ có một mức: kích hoạt workspace = mở TẤT CẢ terminal của nó. Người dùng
 * chỉ muốn bật lại một phiên agent thì vẫn phải mở cả loạt — vừa tốn máy, vừa `--resume` hàng
 * loạt hội thoại không định đụng tới. Nên lượt kích hoạt nhận thêm phạm vi: một entry, hoặc
 * cả workspace.
 *
 * Tách ra khỏi manager vì đây là quy tắc thuần và là chỗ sai thì hỏng nặng nhất: lọt một entry
 * ngoài phạm vi nghĩa là mở thêm một phiên agent người dùng không yêu cầu.
 */

/**
 * Những entry mà lượt kích hoạt này được phép đụng tới.
 *
 * @param terminals Toàn bộ entry của workspace, theo thứ tự trong cây.
 * @param chiEntryId Chỉ kích hoạt đúng entry này; bỏ trống = cả workspace.
 * @returns Danh sách entry trong phạm vi, giữ nguyên thứ tự. Id không thuộc workspace thì trả
 *   RỖNG chứ không rơi về cả workspace: entry vừa bị xoá/chuyển đi mà lại mở cả loạt là hành
 *   vi tệ hơn hẳn việc không mở gì.
 */
export function phamViKichHoat<T extends { id: string }>(
  terminals: readonly T[],
  chiEntryId?: string,
): T[] {
  if (chiEntryId === undefined) return [...terminals];
  return terminals.filter((t) => t.id === chiEntryId);
}

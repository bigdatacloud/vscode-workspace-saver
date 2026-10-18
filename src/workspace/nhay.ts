/**
 * Nhảy qua lại giữa các terminal của một workspace (Ctrl+Tab / Ctrl+Shift+Tab).
 *
 * Vì sao cần, khi VS Code đã có `Ctrl+1/2/3` và `Ctrl+K Ctrl+→`: những phím đó nhảy theo VỊ
 * TRÍ Ô trên màn hình và không vòng lại. Ở đây thứ tự là thứ tự trong cây — thứ người dùng tự
 * sắp — nên nó giữ nguyên ý nghĩa cả khi chưa xếp lưới, và vòng vòng như Alt+Tab.
 */

/**
 * @param dsId Id các terminal ĐANG MỞ của workspace, theo đúng thứ tự trong cây.
 * @param hienTai Id terminal đang focus; `null` hoặc id lạ nghĩa là con trỏ đang ở chỗ khác.
 * @returns Id terminal phải hiện lên, hoặc `null` khi không có gì để nhảy tới.
 */
export function nhayTerminal(
  dsId: readonly string[],
  hienTai: string | null,
  huong: 'toi' | 'lui',
): string | null {
  if (dsId.length === 0) return null;
  const i = hienTai === null ? -1 : dsId.indexOf(hienTai);
  // Không đứng trong danh sách thì vào cái đầu: người dùng vừa bấm phím "sang terminal", câu
  // trả lời hợp lý nhất là terminal đầu tiên chứ không phải không làm gì.
  if (i === -1) return dsId[0] as string;
  const n = dsId.length;
  const j = huong === 'toi' ? (i + 1) % n : (i - 1 + n) % n;
  return dsId[j] as string;
}

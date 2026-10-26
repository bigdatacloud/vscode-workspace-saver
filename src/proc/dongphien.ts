/**
 * Chọn lọc pid nào được phép đóng khi người dùng giành lại một hội thoại đang chạy ở nơi khác.
 *
 * Vì sao phải lọc chứ không giết thẳng pid registry đưa: registry của claude có liệt kê hàng
 * CŨ của tiến trình đã thoát (xem ghi chú ở `claude/ancestry.ts`). Hàng cũ + hệ điều hành đã
 * cấp lại pid đó cho chương trình khác = ta giết nhầm việc của người dùng. Dòng lệnh là bằng
 * chứng thứ hai, độc lập với registry: chỉ đóng khi pid ĐANG thật sự là một tiến trình claude.
 */

export interface PhanLoaiPid {
  /** `false` = không đọc được bảng tiến trình; không biết gì thì không được đóng gì. */
  docDuoc: boolean;
  /** Vẫn là tiến trình claude → đóng được. */
  dong: number[];
  /** Không còn trong bảng → đã thoát từ trước, coi như xong. */
  daChet: number[];
  /** Còn sống nhưng là chương trình khác → registry có hàng cũ, TUYỆT ĐỐI không đụng. */
  laNguoiKhac: number[];
}

/**
 * Dòng lệnh có đúng là một tiến trình claude đang chạy không.
 *
 * KHÔNG được lọc bằng "có chứa chữ claude": đo trên máy thật 26/10/2026 thấy mọi MCP server
 * và hook đều nằm dưới `~/.claude/plugins/...`, nên luật lỏng ấy coi chúng là phiên claude —
 * pid tái sử dụng rơi trúng một cái là ta giết nhầm. Phải là TÊN CHƯƠNG TRÌNH:
 *  - `claude`, `claude.exe`, `claude.cmd`… đứng thành một từ (sau dấu phân cách đường dẫn,
 *    dấu nháy hay khoảng trắng) — bắt được `"…\.local\bin\claude.exe" --…` và `npx claude …`
 *    nhưng KHÔNG bắt `…\.claude\hooks\x.js` (trước chữ claude là dấu chấm).
 *  - hoặc chạy thẳng cli.js của gói: `node …\@anthropic-ai\claude-code\cli.js …`.
 */
function laTienTrinhClaude(lenh: string): boolean {
  return (
    /(^|[\\/"'\s])claude(\.(exe|cmd|bat|ps1|js))?(["'\s]|$)/i.test(lenh) ||
    /claude-code[\\/]cli\.js/i.test(lenh)
  );
}

export function locPidDongDuoc(
  pids: readonly number[],
  dongLenh: ReadonlyMap<number, string>,
): PhanLoaiPid {
  // Máy nào cũng có tiến trình, nên bảng RỖNG chỉ có thể là đọc hỏng (CIM timeout, lỗi
  // quyền). Coi nó như "mọi pid đã chết" thì ta vừa không đóng được gì vừa báo thành công,
  // rồi resume chồng lên tiến trình vẫn đang sống — đúng cái tai nạn hàng rào này ngăn.
  if (dongLenh.size === 0) return { docDuoc: false, dong: [], daChet: [], laNguoiKhac: [] };

  const ra: PhanLoaiPid = { docDuoc: true, dong: [], daChet: [], laNguoiKhac: [] };
  for (const pid of pids) {
    const lenh = dongLenh.get(pid);
    if (lenh === undefined) ra.daChet.push(pid);
    else if (laTienTrinhClaude(lenh)) ra.dong.push(pid);
    else ra.laNguoiKhac.push(pid);
  }
  return ra;
}

/**
 * Parse bảng pid → dòng lệnh. Nhận cả hai định dạng, như `parseBangTienTrinh` bên `tree.ts`:
 * - Windows (PowerShell/CIM): mỗi dòng `pid|dòng lệnh`
 * - POSIX (`ps -eo pid=,args=`): mỗi dòng `  pid  dòng lệnh`
 *
 * Tiến trình hệ thống không cho đọc dòng lệnh vẫn phải CÓ MẶT (chuỗi rỗng): vắng mặt mang
 * nghĩa "đã chết", mà nó đang sống — để trống thì nó rơi vào rổ "người khác" và ta không
 * đụng tới, đúng ý. Dòng không parse được (header, dòng trống, rác) thì bỏ qua.
 */
export function parseBangDongLenh(text: string): Map<number, string> {
  const bang = new Map<number, string>();
  for (const line of text.split('\n')) {
    const sach = line.replace(/\r$/, '');
    const win = sach.match(/^(\d+)\|(.*)$/);
    if (win) {
      bang.set(Number(win[1]), win[2]!.trim());
      continue;
    }
    const posix = sach.match(/^\s*(\d+)\s+(\S.*)$/);
    if (posix) bang.set(Number(posix[1]), posix[2]!.trim());
  }
  return bang;
}

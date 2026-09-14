import type { TerminalState } from '../workspace/manager';

/**
 * Icon của một terminal trong cây: MÀU nói nhà cung cấp, HÌNH nói trạng thái.
 *
 * Trước đây màu chấm nói trạng thái (xanh lá = chạy, xanh dương = rảnh). Đổi vì khi cây có sáu
 * agent, câu hỏi đầu tiên khi lướt là "cái nào là Claude, cái nào là Codex" — mà tên terminal
 * thì do người dùng đặt, không nói được điều đó. Trạng thái vẫn còn hai chỗ: hình chấm (đặc =
 * đang chạy, rỗng = rảnh, gạch chéo = chưa mở) và chữ trong mô tả.
 *
 * Module này KHÔNG import vscode để test được; `tree.ts` bọc kết quả thành ThemeIcon/ThemeColor.
 */

/** Id màu do extension khai trong `contributes.colors` — người dùng đè được bằng `workbench.colorCustomizations`. */
export const MAU_NHA_CUNG_CAP = {
  claude: 'aiWorkspace.mauAnthropic',
  openai: 'aiWorkspace.mauOpenAI',
  shell: 'aiWorkspace.mauShell',
} as const;

export interface BieuTuong {
  id: string;
  color: string;
}

function mauCua(agent: 'claude' | 'codex' | undefined): string {
  if (agent === 'claude') return MAU_NHA_CUNG_CAP.claude;
  if (agent === 'codex') return MAU_NHA_CUNG_CAP.openai;
  return MAU_NHA_CUNG_CAP.shell;
}

export function bieuTuongTerminal(state: TerminalState, agent: 'claude' | 'codex' | undefined): BieuTuong {
  switch (state) {
    case 'busy':
      return { id: 'circle-filled', color: mauCua(agent) };
    case 'idle':
    case 'open':
      return { id: 'circle-outline', color: mauCua(agent) };
    // `loading~spin` là codicon có animation xoay sẵn của VS Code — cây tự chạy animation.
    case 'loading':
      return { id: 'loading~spin', color: mauCua(agent) };
    // Chưa mở thì KHÔNG mang màu nhà cung cấp: một chấm rỗng màu Anthropic đã có nghĩa là
    // "Claude đang rảnh"; cái đã tắt phải trông khác hẳn, không chỉ khác một chút.
    case 'closed':
      return { id: 'circle-slash', color: 'disabledForeground' };
    // Hai trạng thái cần người dùng nhìn tới giữ màu cảnh báo riêng: đây là thứ duy nhất trong
    // cây được phép đè lên màu nhà cung cấp, vì "cần bạn" quan trọng hơn "của ai".
    case 'blocked':
      return { id: 'question', color: 'charts.yellow' };
    case 'error':
      return { id: 'error', color: 'charts.red' };
  }
}

import type { TerminalState } from '../workspace/manager';

/**
 * Icon của một terminal trong cây: MÀU nói nhà cung cấp, CHUYỂN ĐỘNG nói trạng thái.
 *
 * Quy ước (cùng ngôn ngữ với Orca): xoay = đang làm việc; đứng yên = không làm; vàng = đang chờ
 * bạn; đỏ = lỗi. Màu chấm là màu nhà cung cấp vì khi cây có sáu agent, câu hỏi đầu tiên khi lướt
 * là "cái nào là Claude, cái nào là Codex" — mà tên terminal thì do người dùng đặt, không nói
 * được điều đó. Chữ trong mô tả vẫn nêu trạng thái cho ai cần đọc kỹ.
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
    // `~spin` là codicon có animation xoay sẵn của VS Code — cây tự chạy animation. Chỉ trạng
    // thái này xoay bằng màu nhà cung cấp: nhìn lướt là biết agent nào đang cày.
    case 'busy':
      return { id: 'loading~spin', color: mauCua(agent) };
    case 'idle':
    case 'open':
      return { id: 'circle-filled', color: mauCua(agent) };
    // Cũng xoay, nhưng màu mờ và hình khác: đây là EXTENSION đang bật phiên, không phải agent
    // đang làm việc — tô màu nhà cung cấp là nói dối trong vài giây đầu.
    case 'loading':
      return { id: 'sync~spin', color: 'disabledForeground' };
    case 'closed':
      return { id: 'circle-slash', color: 'disabledForeground' };
    // Hai trạng thái cần người dùng nhìn tới đè lên màu nhà cung cấp: "cần bạn" quan trọng hơn
    // "của ai". Vàng đứng yên = đang chờ bạn bấm; đỏ = hỏng.
    case 'blocked':
      return { id: 'circle-filled', color: 'charts.yellow' };
    case 'error':
      return { id: 'error', color: 'charts.red' };
  }
}

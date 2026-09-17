import type { Role, TerminalEntry, WorktreeRef } from '../model/schema';

/**
 * Quy tắc THUẦN của việc nhân bản một terminal ra worktree riêng.
 *
 * Tách ra khỏi manager vì đây là chỗ sai thì hỏng nặng nhất: chép nhầm id phiên sang bản sao
 * nghĩa là HAI tiến trình agent cùng resume một hội thoại, cùng ghi một file phiên, và lịch sử
 * của người dùng bị xé làm đôi không cứu được. Hàm ở đây có test cho đúng ca đó.
 */

export interface NguonNhanBan {
  entry: TerminalEntry;
  /** Vai của workspace — để tra tên vai của entry gốc; vai treo coi như không có vai. */
  roles: readonly Role[];
}

export type KetQuaXet =
  | {
      duoc: true;
      /**
       * Có nối tiếp được hội thoại đang có không. Chỉ Claude, và chỉ khi extension đã bắt được
       * id phiên: `claude --resume <id> --fork-session` đẻ ra một hội thoại MỚI mang toàn bộ
       * lịch sử, nên hai bên chạy song song mà không giẫm nhau. Codex không có cờ tương đương.
       */
      forkDuoc: boolean;
    }
  | { duoc: false; lyDo: string };

export function duocNhanBan(entry: TerminalEntry): KetQuaXet {
  const laClaude = entry.kind === 'claude' && entry.agentId === undefined;
  return { duoc: true, forkDuoc: laClaude && entry.claudeSessionId !== undefined };
}

/**
 * Tên vai dùng làm đuôi worktree của bản sao (`<việc>-<vai>`).
 *
 * Giữ đúng vai của bản gốc để bản sao nằm cùng nhóm nhánh khi `git branch` sắp xếp chữ cái —
 * đó là toàn bộ lý do tên worktree được ghép phẳng. Vai treo (trỏ vào vai đã xoá) rơi về tên
 * agent, cùng cách xử lý với chỗ khác trong extension: một vai treo không được làm hỏng lệnh.
 */
export function vaiChoTenWorktree(nguon: NguonNhanBan, tenAgentMacDinh: string): string {
  const { entry, roles } = nguon;
  if (entry.roleId === undefined) return tenAgentMacDinh;
  return roles.find((r) => r.id === entry.roleId)?.name ?? tenAgentMacDinh;
}

export interface DichNhanBan {
  id: string;
  cwd: string;
  ten: string;
  worktree?: WorktreeRef;
  /**
   * Id phiên mint sẵn cho bản sao. CHỈ dùng cho đường "phiên mới trắng" — đường fork không mint
   * vì id của hội thoại fork do chính `claude` sinh ra, và đoán trước nó là đoán sai.
   */
  sessionIdMoi?: string;
  /** Lệnh khởi động riêng cho bản sao (Codex), đè lên lệnh của bản gốc. */
  startCommandMoi?: string;
}

/**
 * Dựng entry cho bản sao. Giữ những gì nói "làm việc gì" (vai, loại agent, lệnh khởi động),
 * bỏ những gì nói "đang ở đâu và là ai" (worktree cũ, id phiên cũ, tên cũ).
 */
export function dungEntryNhanBan(nguon: TerminalEntry, dich: DichNhanBan): TerminalEntry {
  const coSession = dich.sessionIdMoi !== undefined;
  const laClaude = nguon.kind === 'claude' && nguon.agentId === undefined;
  return {
    id: dich.id,
    name: dich.ten,
    cwd: dich.cwd,
    // Chỉ là `claude` khi đã có id phiên trong tay; không thì `plain` và để matcher phả hệ PID
    // thăng cấp nó khi claude hiện ra trong registry — đúng đường mà biến thể `-c`/`-r` đang đi.
    kind: laClaude && coSession ? 'claude' : 'plain',
    ...(coSession && laClaude ? { claudeSessionId: dich.sessionIdMoi, claudeName: dich.ten } : {}),
    // Agent không phải Claude: giữ `agentId` để lần khôi phục sau biết chạy gì, nhưng KHÔNG giữ
    // `agentSessionId` — đó là hội thoại của bản gốc.
    ...(nguon.agentId === undefined ? {} : { agentId: nguon.agentId }),
    ...(dich.startCommandMoi !== undefined
      ? { startCommand: dich.startCommandMoi }
      : nguon.startCommand === undefined
        ? {}
        : { startCommand: nguon.startCommand }),
    ...(nguon.roleId === undefined ? {} : { roleId: nguon.roleId }),
    ...(dich.worktree === undefined ? {} : { worktree: dich.worktree }),
  };
}

/**
 * Lệnh chạy Codex cho bản sao. LUÔN là phiên mới: bản sao đứng ở worktree khác, mà
 * `codex resume --last` nối vào phiên gần nhất bất kể thư mục — dùng lại lệnh gốc nguyên văn
 * là cách chắc chắn để hai terminal cùng chui vào một hội thoại.
 *
 * `--yolo` thì giữ: đó là quyền người dùng đã cấp cho bản gốc, bỏ đi là tự ý đổi ý họ.
 */
export function lenhCodexChoBanSao(startCommandGoc: string | undefined): string {
  const yolo = startCommandGoc !== undefined && /(^|\s)--yolo(\s|$)/.test(startCommandGoc);
  return yolo ? 'codex --yolo' : 'codex';
}

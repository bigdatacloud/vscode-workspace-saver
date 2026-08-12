import type { RunningSession } from '../agent/types';
import { timTerminalTheoToTien } from '../proc/tree';

export interface GomTheoTerminal {
  /** terminalId → các session đang chạy BÊN TRONG terminal đó (theo phả hệ tiến trình). */
  theoTerminal: Map<string, RunningSession[]>;
  /** Pid đã tra nhưng không thuộc terminal nào của cửa sổ này (claude ở nơi khác). */
  pidNgoai: number[];
}

/**
 * Quy session về terminal bằng phả hệ tiến trình: pid của session đi ngược lên tổ tiên gặp
 * pid shell của terminal nào thì nó chạy trong terminal đó. Đây là bằng chứng mạnh hơn cwd —
 * cwd trong entry có thể lệch (người dùng `cd` sang thư mục khác rồi mới chạy claude).
 *
 * Session không có pid bị bỏ qua (không suy đoán). Hai tiến trình cùng `sessionId` (người
 * dùng đã `--resume` một hội thoại hai lần) chỉ tính tiến trình ĐẦU: để hai terminal cùng
 * nhận một hội thoại là sinh ra double `--resume` ở lần khôi phục sau.
 */
export function gomSessionTheoTerminal(
  sessions: readonly RunningSession[],
  parentOf: ReadonlyMap<number, number>,
  shellPids: ReadonlyMap<number, string>,
): GomTheoTerminal {
  const theoTerminal = new Map<string, RunningSession[]>();
  const daGan = new Set<string>();
  const khongPhanGiai: { session: RunningSession; pid: number }[] = [];
  // Phân giải TRƯỚC rồi mới khử trùng: registry có thể liệt kê hàng CŨ (tiến trình đã chết)
  // trước hàng sống của cùng một sessionId. Khử trùng trước thì hàng chết "đốt" mất id và
  // terminal thật không bao giờ nhận được — lặp lại tất định ở mọi nhịp poll.
  for (const session of sessions) {
    if (session.pid === null || daGan.has(session.sessionId)) continue;
    const terminalId = timTerminalTheoToTien(session.pid, parentOf, shellPids);
    if (terminalId === null) {
      khongPhanGiai.push({ session, pid: session.pid });
      continue;
    }
    daGan.add(session.sessionId);
    const ds = theoTerminal.get(terminalId);
    if (ds) ds.push(session);
    else theoTerminal.set(terminalId, [session]);
  }
  // Chỉ coi là "ngoài cửa sổ này" khi KHÔNG hàng nào của session đó phân giải được.
  const pidNgoai = khongPhanGiai
    .filter(({ session }) => !daGan.has(session.sessionId))
    .map(({ pid }) => pid);
  return { theoTerminal, pidNgoai };
}

/**
 * Một terminal có thể là tổ tiên của nhiều tiến trình claude (claude gọi claude). Giữ nguyên
 * session mà entry đang ôm nếu nó nằm trong số đó — nếu không, mỗi nhịp poll lại nhảy sang
 * một tiến trình khác và trạng thái nhấp nháy.
 */
export function chonSessionChoTerminal(
  ds: readonly RunningSession[],
  sessionDangGiu: string | undefined,
): RunningSession | null {
  if (ds.length === 0) return null;
  return ds.find((r) => r.sessionId === sessionDangGiu) ?? ds[0]!;
}

import type { AgentAdapter } from '../agent/types';
import { normalizeCwd } from '../claude/match';
import type { TerminalEntry, Workspace } from '../model/schema';

export interface ActivateTerminalHandle { sendText(text: string): void; }

export interface ActivatePorts {
  createTerminal(entry: TerminalEntry): ActivateTerminalHandle;
  agent: AgentAdapter;
  fsExists(p: string): boolean;
  isTrusted(commands: string[]): boolean;
  confirmTrust(commands: string[]): Promise<boolean>;
  /**
   * Entry này có phải terminal agent do chính extension dựng lệnh khởi chạy không. Chỉ những
   * entry đó được miễn cổng tin cậy — người dùng đã chủ động tạo chúng.
   *
   * Nhận diện theo ENTRY chứ không theo chuỗi lệnh: chuỗi là dữ liệu người dùng/repo kiểm
   * soát được (một repo ship file tên `codex` rồi để auto-capture ghi lại là chạy được ngầm
   * mãi mãi), còn `agentId` chỉ do code của extension đặt.
   */
  laLenhAgent(entry: TerminalEntry): boolean;
  /**
   * Lệnh nối lại phiên GẦN NHẤT của một agent không phải Claude (hiện chỉ Codex). Dùng khi
   * entry là terminal agent mà extension chưa bắt được id phiên: chạy lại lệnh khởi chạy đã
   * lưu sẽ mở phiên MỚI TOANH, tức người dùng mất chỗ đang làm dở.
   */
  lenhTiepTucAgent(entry: TerminalEntry): string | null;
  /**
   * Thư mục này có phiên agent đang chạy mà cửa sổ ta KHÔNG nhận nuôi được không (kể cả khi
   * không đọc nổi registry — lúc đó phải trả `true` vì không biết là không được liều).
   *
   * `claude -c` nối vào hội thoại gần nhất của thư mục; nếu hội thoại đó đang có tiến trình
   * khác chạy dở thì ta vừa tạo ra đúng cái cảnh hai tiến trình ghi một file phiên mà cả
   * luồng nối-lại-terminal sinh ra để chặn.
   */
  coPhienDangChayNgoai(cwd: string): boolean;
  onMinted(terminalId: string, sessionId: string): Promise<void>;
  warn(message: string): void;
}

export interface ActivateReport {
  opened: string[];
  failed: { id: string; reason: string }[];
}

export async function activateWorkspace(ws: Workspace, ports: ActivatePorts): Promise<ActivateReport> {
  const report: ActivateReport = { opened: [], failed: [] };

  const startCommands = ws.terminals
    .filter((t) => t.kind === 'plain' && t.startCommand && !ports.laLenhAgent(t))
    .map((t) => t.startCommand as string);
  let runStartCommands = true;
  if (startCommands.length > 0 && !ports.isTrusted(startCommands)) {
    runStartCommands = await ports.confirmTrust(startCommands);
    if (!runStartCommands) {
      ports.warn('Đã mở shell nhưng không chạy lệnh khởi động (chưa được tin cậy).');
    }
  }

  /** Thư mục đã có một entry dùng `-c` trong lượt này — cái thứ hai sẽ chui vào cùng hội thoại. */
  const cwdDaNoiTiep = new Set<string>();
  for (const entry of ws.terminals) {
    try {
      if (!ports.fsExists(entry.cwd)) {
        report.failed.push({ id: entry.id, reason: `Thư mục không còn: ${entry.cwd}` });
        continue;
      }
      const handle = ports.createTerminal(entry);
      const tiepTucAgent = ports.lenhTiepTucAgent(entry);
      if (entry.kind === 'claude') {
        const ten = entry.claudeName ?? entry.name;
        const sessionId = entry.claudeSessionId;
        if (sessionId !== undefined) {
          handle.sendText(ports.agent.buildLaunchCommand({ name: ten, mode: { kind: 'resume', sessionId } }));
        } else if (cwdDaNoiTiep.has(normalizeCwd(entry.cwd)) || ports.coPhienDangChayNgoai(entry.cwd)) {
          // `-c` nối vào hội thoại GẦN NHẤT của thư mục — nên nó chỉ an toàn khi thư mục đó
          // không còn tiến trình nào đang giữ hội thoại ấy, và chỉ cho MỘT entry mỗi thư mục.
          // Ngược lại ta tự tay tạo ra cảnh hai tiến trình ghi chung một file phiên. Khi
          // không dám `-c` thì mint phiên mới: mất chỗ đang dở còn hơn trộn hai hội thoại.
          const moi = ports.agent.newSessionId();
          await ports.onMinted(entry.id, moi);
          handle.sendText(ports.agent.buildLaunchCommand({ name: ten, mode: { kind: 'new', sessionId: moi } }));
        } else {
          cwdDaNoiTiep.add(normalizeCwd(entry.cwd));
          handle.sendText(ports.agent.buildLaunchCommand({ name: ten, mode: { kind: 'continue' } }));
        }
      } else if (tiepTucAgent !== null) {
        handle.sendText(tiepTucAgent);
      } else if (entry.startCommand && (runStartCommands || ports.laLenhAgent(entry))) {
        // Lệnh agent chạy kể cả khi người dùng từ chối tin cậy các lệnh khác: hai chuyện độc
        // lập nhau, từ chối một lệnh dev server không có nghĩa là không muốn mở lại agent.
        handle.sendText(entry.startCommand);
      }
      report.opened.push(entry.id);
    } catch (e) {
      report.failed.push({ id: entry.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}

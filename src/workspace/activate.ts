import type { AgentAdapter } from '../agent/types';
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

  for (const entry of ws.terminals) {
    try {
      if (!ports.fsExists(entry.cwd)) {
        report.failed.push({ id: entry.id, reason: `Thư mục không còn: ${entry.cwd}` });
        continue;
      }
      const handle = ports.createTerminal(entry);
      const tiepTucAgent = ports.lenhTiepTucAgent(entry);
      if (entry.kind === 'claude') {
        const sessionId = entry.claudeSessionId;
        // Không có id → nối lại hội thoại gần nhất của thư mục đó (`-c`). KHÔNG mint phiên
        // mới: người dùng mở lại workspace là để làm tiếp chỗ dở, không phải bắt đầu lại.
        // Id sẽ được cơ chế bắt theo phả hệ tiến trình gắn vào entry sau vài giây.
        handle.sendText(ports.agent.buildLaunchCommand(
          sessionId !== undefined
            ? { name: entry.claudeName ?? entry.name, mode: { kind: 'resume', sessionId } }
            : { name: entry.claudeName ?? entry.name, mode: { kind: 'continue' } },
        ));
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

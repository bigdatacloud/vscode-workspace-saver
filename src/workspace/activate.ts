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
      if (entry.kind === 'claude') {
        const hadId = entry.claudeSessionId !== undefined;
        const sessionId = entry.claudeSessionId ?? ports.agent.newSessionId();
        if (!hadId) await ports.onMinted(entry.id, sessionId);
        handle.sendText(ports.agent.buildLaunchCommand({
          name: entry.claudeName ?? entry.name,
          mode: { kind: hadId ? 'resume' : 'new', sessionId },
        }));
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

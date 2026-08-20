import type { AgentAdapter } from '../agent/types';
import { normalizeCwd } from '../claude/match';
import type { TerminalEntry, Workspace } from '../model/schema';

export interface ActivateTerminalHandle { sendText(text: string): void; }

export interface AgentRestoreSelection {
  command: string;
  /** Entry hiện hành sau khi QuickPick đóng; không dùng lại snapshot trước await. */
  entry: TerminalEntry;
}

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
  /** Hỏi người dùng lệnh khôi phục cho agent không phải Claude; undefined nghĩa là bỏ qua. */
  chonLenhKhoiPhucAgent(entry: TerminalEntry): Promise<AgentRestoreSelection | undefined>;
  /** Báo sau khi lệnh agent đã được gửi để manager bắt đầu dò lại session id. */
  onAgentLaunched(entry: TerminalEntry, command: string, startedAt: number): void;
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
      // Preflight trước mọi QuickPick: đường dẫn đã mất thì không có lựa chọn khôi phục nào
      // thực hiện được. Vẫn kiểm tra lại sau picker bên dưới vì entry/cwd có thể đổi trong lúc
      // người dùng đang chọn hoặc thư mục có thể bị xóa bởi tiến trình khác.
      if (!ports.fsExists(entry.cwd)) {
        report.failed.push({ id: entry.id, reason: `Thư mục không còn: ${entry.cwd}` });
        continue;
      }
      let currentEntry = entry;
      let restoreCommand: string | undefined;
      if (entry.kind === 'plain' && entry.agentId !== undefined) {
        const selection = await ports.chonLenhKhoiPhucAgent(entry);
        // Esc ở QuickPick là quyết định không mở terminal này; tạo shell rỗng chỉ làm người
        // dùng tưởng session đã được khôi phục trong khi thực tế không có lệnh nào chạy.
        if (selection === undefined) continue;
        currentEntry = selection.entry;
        restoreCommand = selection.command;
      }
      if (!ports.fsExists(currentEntry.cwd)) {
        report.failed.push({ id: currentEntry.id, reason: `Thư mục không còn: ${currentEntry.cwd}` });
        continue;
      }
      const startedAt = Date.now();
      const handle = ports.createTerminal(currentEntry);
      if (currentEntry.kind === 'claude') {
        const ten = currentEntry.claudeName ?? currentEntry.name;
        const sessionId = currentEntry.claudeSessionId;
        if (sessionId !== undefined) {
          handle.sendText(ports.agent.buildLaunchCommand({ name: ten, mode: { kind: 'resume', sessionId } }));
        } else if (cwdDaNoiTiep.has(normalizeCwd(currentEntry.cwd)) || ports.coPhienDangChayNgoai(currentEntry.cwd)) {
          // `-c` nối vào hội thoại GẦN NHẤT của thư mục — nên nó chỉ an toàn khi thư mục đó
          // không còn tiến trình nào đang giữ hội thoại ấy, và chỉ cho MỘT entry mỗi thư mục.
          // Ngược lại ta tự tay tạo ra cảnh hai tiến trình ghi chung một file phiên. Khi
          // không dám `-c` thì mint phiên mới: mất chỗ đang dở còn hơn trộn hai hội thoại.
          const moi = ports.agent.newSessionId();
          await ports.onMinted(currentEntry.id, moi);
          handle.sendText(ports.agent.buildLaunchCommand({ name: ten, mode: { kind: 'new', sessionId: moi } }));
        } else {
          cwdDaNoiTiep.add(normalizeCwd(currentEntry.cwd));
          handle.sendText(ports.agent.buildLaunchCommand({ name: ten, mode: { kind: 'continue' } }));
        }
      } else if (restoreCommand !== undefined) {
        handle.sendText(restoreCommand);
        ports.onAgentLaunched(currentEntry, restoreCommand, startedAt);
      } else if (currentEntry.startCommand && (runStartCommands || ports.laLenhAgent(currentEntry))) {
        // Lệnh agent chạy kể cả khi người dùng từ chối tin cậy các lệnh khác: hai chuyện độc
        // lập nhau, từ chối một lệnh dev server không có nghĩa là không muốn mở lại agent.
        handle.sendText(currentEntry.startCommand);
      }
      report.opened.push(currentEntry.id);
    } catch (e) {
      report.failed.push({ id: entry.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}

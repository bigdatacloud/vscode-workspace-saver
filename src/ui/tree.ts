import * as vscode from 'vscode';
import type { TerminalState, TerminalView, WorkspaceManager, WorkspaceView } from '../workspace/manager';

const POLL_MS = 3000;

/** Phải khớp với `contributes.keybindings` trong package.json. */
const PHIM_TERMINAL = process.platform === 'darwin' ? 'Cmd+Alt+T' : 'Ctrl+Alt+T';
const PHIM_CLAUDE = process.platform === 'darwin' ? 'Cmd+Alt+A' : 'Ctrl+Alt+A';

const STATE_ICONS: Record<TerminalState, { id: string; color: string }> = {
  busy: { id: 'circle-filled', color: 'charts.green' },
  idle: { id: 'circle-filled', color: 'charts.blue' },
  // Dừng giữa chừng chờ người dùng bấm — icon khác hẳn để lướt qua là thấy ngay cái nào cần mình.
  blocked: { id: 'question', color: 'charts.yellow' },
  // `loading~spin` là codicon có animation xoay sẵn của VS Code — cây tự chạy animation.
  loading: { id: 'loading~spin', color: 'charts.purple' },
  open: { id: 'terminal', color: 'charts.blue' },
  closed: { id: 'circle-outline', color: 'disabledForeground' },
  error: { id: 'error', color: 'charts.red' },
};

const STATE_LABELS: Record<TerminalState, string> = {
  busy: 'đang chạy',
  idle: 'rảnh',
  blocked: 'CHỜ BẠN TRẢ LỜI',
  loading: 'đang tải phiên…',
  open: 'đang mở',
  closed: 'chưa mở',
  error: 'lỗi',
};

export class WorkspaceItem extends vscode.TreeItem {
  constructor(readonly view: WorkspaceView) {
    super(view.name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `ws:${view.id}`;
    this.description = view.isActive
      ? `(đang active) · ${view.terminalCount} terminal`
      : `${view.terminalCount} terminal`;
    const dong = [view.name, `${view.terminalCount} terminal`];
    dong.push(
      view.lastActiveAt === null
        ? 'Chưa từng kích hoạt'
        : `Lần active gần nhất: ${new Date(view.lastActiveAt).toLocaleString('vi-VN')}`,
    );
    // Menu chuột phải của TreeView không hiện phím tắt (VS Code chỉ hiện trong Command
    // Palette), nên nhắc ngay trong tooltip — đây đúng chỗ người dùng đang định tạo terminal.
    // Ghi rõ "mặc định" vì extension KHÔNG đọc được phím người dùng đã gán lại: API không
    // cho tra keybinding đang có hiệu lực.
    dong.push(`Phím tắt mặc định: ${PHIM_TERMINAL} terminal mới · ${PHIM_CLAUDE} terminal Claude`);
    this.tooltip = dong.join('\n');
    // `folder-active` không có trong bộ codicon; `root-folder-opened` là icon thư mục
    // "đang mở" có thật, giữ được phân biệt active/không.
    this.iconPath = new vscode.ThemeIcon(
      view.isActive ? 'root-folder-opened' : 'folder',
      view.isActive ? new vscode.ThemeColor('charts.green') : undefined,
    );
    this.contextValue = view.isActive ? 'aiWorkspaceActive' : 'aiWorkspaceInactive';
    if (!view.isActive) {
      this.command = { command: 'aiWorkspace.activateWorkspace', title: 'Kích hoạt', arguments: [this] };
    }
  }
}

export class TerminalItem extends vscode.TreeItem {
  constructor(readonly view: TerminalView) {
    super(view.name, vscode.TreeItemCollapsibleState.None);
    this.id = `term:${view.id}`;
    const kindLabel =
      view.agent === 'claude' ? 'AI' : view.agent === 'codex' ? 'Codex' : 'shell';
    this.description = `${kindLabel} · ${STATE_LABELS[view.state]}`;
    // Đường dẫn nằm ngay trong tooltip: hover là thấy, không phải mở menu. Menu "Xem đường
    // dẫn" vẫn cần cho việc sao chép (tooltip không bôi đen copy được).
    const dong = [view.name, `Đường dẫn: ${view.cwd}`, `Trạng thái: ${STATE_LABELS[view.state]}`];
    if (view.hasStartCommand) dong.push('Có lệnh khởi động');
    this.tooltip = dong.join('\n');
    const icon = STATE_ICONS[view.state];
    this.iconPath = new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color));
    this.contextValue = view.kind === 'claude' ? 'aiTerminalClaude' : 'aiTerminalPlain';
    this.command = { command: 'aiWorkspace.focusTerminal', title: 'Mở terminal', arguments: [this] };
  }
}

export type TreeElement = WorkspaceItem | TerminalItem;

export class WorkspaceTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly changed = new vscode.EventEmitter<TreeElement | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly manager: WorkspaceManager) {
    manager.onDidChange(() => this.changed.fire(undefined));
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) return this.manager.workspaceViews().map((v) => new WorkspaceItem(v));
    if (element instanceof WorkspaceItem) {
      return this.manager.terminalViews(element.view.id).map((v) => new TerminalItem(v));
    }
    return [];
  }

  /** Chỉ poll khi view đang hiển thị — view ẩn thì dừng hẳn. */
  startPolling(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.manager.refreshStatuses();
    }, POLL_MS);
  }

  stopPolling(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stopPolling();
    this.changed.dispose();
  }
}

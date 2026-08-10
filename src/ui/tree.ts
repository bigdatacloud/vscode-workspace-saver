import * as vscode from 'vscode';
import type { SessionStatus } from '../manifest/schema';
import type { SessionView, WorkspaceManager } from '../workspace/manager';

const POLL_MS = 3000;

const ICONS: Record<SessionStatus, { id: string; color: string }> = {
  busy:    { id: 'circle-filled', color: 'charts.green' },
  idle:    { id: 'circle-filled', color: 'charts.blue' },
  blocked: { id: 'circle-filled', color: 'charts.yellow' },
  offline: { id: 'circle-outline', color: 'disabledForeground' },
  error:   { id: 'error', color: 'charts.red' },
};

const LABELS: Record<SessionStatus, string> = {
  busy: 'đang chạy', idle: 'rảnh', blocked: 'đang chờ',
  offline: 'chưa chạy', error: 'lỗi',
};

export class SessionTreeItem extends vscode.TreeItem {
  constructor(readonly sessionKey: string, view: SessionView) {
    super(view.name, vscode.TreeItemCollapsibleState.None);
    this.description = [view.branch ?? '(không worktree)', LABELS[view.status]].join(' · ');
    this.tooltip = `${view.name}\nVai trò: ${view.role}\nTrạng thái: ${LABELS[view.status]}`;
    const icon = ICONS[view.status];
    this.iconPath = new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color));
    this.contextValue = 'aiWorkspaceSession';
    this.command = {
      command: 'aiWorkspace.openSessionTerminal',
      title: 'Mở terminal',
      arguments: [this],
    };
  }
}

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly manager: WorkspaceManager) {
    manager.onDidChange(() => this.changed.fire());
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SessionTreeItem[] {
    return this.manager.currentSessions().map((view) => new SessionTreeItem(view.key, view));
  }

  /** Chỉ poll khi view đang hiển thị — view ẩn thì dừng hẳn. */
  startPolling(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => { void this.manager.refreshStatuses(); }, POLL_MS);
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

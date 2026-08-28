import * as vscode from 'vscode';
import * as nodePath from 'node:path';
import { ClaudeCodeAdapter } from './agent/claude';
import { CodexAdapter, codexHomeMacDinh, realCodexFs } from './agent/codex';
import { detectShellKind } from './agent/quote';
import { TerminalManager } from './terminal/manager';
import { WorkspaceManager } from './workspace/manager';
import { WorkspaceDragAndDrop, WorkspaceTreeProvider } from './ui/tree';
import { registerCommands } from './ui/commands';

let manager: WorkspaceManager | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const terminals = new TerminalManager();
  const shell = detectShellKind(process.platform, vscode.env.shell);
  const agent = new ClaudeCodeAdapter(shell);
  const codex = new CodexAdapter(shell, realCodexFs, codexHomeMacDinh(), nodePath.sep);
  manager = new WorkspaceManager(context, terminals, agent, codex);

  const tree = new WorkspaceTreeProvider(manager);
  const view = vscode.window.createTreeView('aiWorkspace.workspaces', {
    treeDataProvider: tree,
    dragAndDropController: new WorkspaceDragAndDrop(manager),
    // Cho chọn nhiều để kéo cả nhóm terminal một lượt. Các lệnh chuột phải chỉ đọc tham số
    // đầu nên vẫn chạy đúng như trước khi có multi-select.
    canSelectMany: true,
  });
  view.onDidChangeVisibility((e) => (e.visible ? tree.startPolling() : tree.stopPolling()));
  if (view.visible) tree.startPolling();

  context.subscriptions.push(view, tree, manager, terminals, ...registerCommands(manager));
}

export function deactivate(): void {
  // VS Code không đảm bảo await được async trong deactivate, cũng không đảm bảo chạy
  // context.subscriptions trước: gọi thẳng dispose() (idempotent) để chắc chắn khóa V5 được
  // gỡ và store được ghi. Mọi thao tác bên trong đều đồng bộ.
  manager?.dispose();
  manager = null;
}

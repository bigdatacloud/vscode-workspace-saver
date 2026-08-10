import * as vscode from 'vscode';
import { ClaudeCodeAdapter } from './agent/claude';
import { detectShellKind } from './agent/quote';
import { TerminalManager } from './terminal/manager';
import { WorkspaceManager } from './workspace/manager';
import { WorkspaceTreeProvider } from './ui/tree';
import { registerCommands } from './ui/commands';

let manager: WorkspaceManager | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const terminals = new TerminalManager();
  const agent = new ClaudeCodeAdapter(detectShellKind(process.platform, vscode.env.shell));
  manager = new WorkspaceManager(context, terminals, agent);

  const tree = new WorkspaceTreeProvider(manager);
  const view = vscode.window.createTreeView('aiWorkspace.workspaces', { treeDataProvider: tree });
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

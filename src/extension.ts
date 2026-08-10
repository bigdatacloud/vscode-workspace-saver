import * as path from 'node:path';
import * as vscode from 'vscode';
import { WorkspaceIndex } from './index/store';
import { TrustStore } from './trust/store';
import { TerminalManager } from './terminal/manager';
import { WorkspaceManager } from './workspace/manager';
import { SessionTreeProvider } from './ui/tree';
import { registerCommands } from './ui/commands';

export function activate(context: vscode.ExtensionContext): void {
  const index = new WorkspaceIndex(path.join(context.globalStorageUri.fsPath, 'index.json'));
  const trust = new TrustStore({
    get: (key) => context.globalState.get<string>(key),
    set: (key, value) => Promise.resolve(context.globalState.update(key, value)),
  });

  const terminals = new TerminalManager();
  const manager = new WorkspaceManager(terminals, index, trust);
  const tree = new SessionTreeProvider(manager);

  const view = vscode.window.createTreeView('aiWorkspace.sessions', { treeDataProvider: tree });
  view.onDidChangeVisibility((e) => (e.visible ? tree.startPolling() : tree.stopPolling()));
  if (view.visible) tree.startPolling();

  registerCommands(context, manager);
  context.subscriptions.push(view, tree, terminals);
}

export function deactivate(): void {}

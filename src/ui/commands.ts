import * as vscode from 'vscode';
import type { WorkspaceManager } from '../workspace/manager';
import { TerminalItem, WorkspaceItem } from './tree';

export function registerCommands(manager: WorkspaceManager): vscode.Disposable[] {
  const pickWorkspaceId = async (): Promise<string | null> => {
    const views = manager.workspaceViews();
    if (views.length === 0) {
      void vscode.window.showInformationMessage('Chưa có workspace nào.');
      return null;
    }
    const picked = await vscode.window.showQuickPick(
      views.map((v) => ({ label: v.name, id: v.id })),
      { placeHolder: 'Chọn workspace' },
    );
    return picked?.id ?? null;
  };
  const wsArg = async (item?: WorkspaceItem): Promise<string | null> =>
    item?.view.id ?? (await pickWorkspaceId());

  return [
    vscode.commands.registerCommand('aiWorkspace.createWorkspace', () => manager.createAndActivate()),
    vscode.commands.registerCommand('aiWorkspace.activateWorkspace', async (item?: WorkspaceItem) => {
      const id = await wsArg(item);
      if (id) await manager.activate(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.closeActiveWorkspace', () => manager.closeActive()),
    vscode.commands.registerCommand('aiWorkspace.renameWorkspace', async (item?: WorkspaceItem) => {
      const id = await wsArg(item);
      if (id) await manager.rename(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.deleteWorkspace', async (item?: WorkspaceItem) => {
      const id = await wsArg(item);
      if (id) await manager.deleteWorkspace(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.newClaudeTerminal', async (item?: WorkspaceItem) => {
      const id = await wsArg(item);
      if (id) await manager.newClaudeTerminal(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.setStartCommand', (item: TerminalItem) =>
      manager.setStartCommand(item.view.workspaceId, item.view.id),
    ),
    vscode.commands.registerCommand('aiWorkspace.removeTerminal', (item: TerminalItem) =>
      manager.removeTerminal(item.view.workspaceId, item.view.id),
    ),
    vscode.commands.registerCommand('aiWorkspace.focusTerminal', (item: TerminalItem) =>
      manager.focusTerminal(item.view.workspaceId, item.view.id),
    ),
    // Menu chuột phải tab terminal có thể truyền hoặc không truyền `Terminal`;
    // manager tự fallback về `window.activeTerminal` nên cả hai trường hợp đều chạy.
    vscode.commands.registerCommand('aiWorkspace.addOpenTerminalToWorkspace', (terminal?: vscode.Terminal) =>
      manager.addOpenTerminal(terminal),
    ),
  ];
}

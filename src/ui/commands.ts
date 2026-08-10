import * as vscode from 'vscode';
import type { WorkspaceManager } from '../workspace/manager';
// TODO(Task 16): `src/ui/tree.ts` chưa tồn tại ở Task 15. Dùng type cục bộ tạm thời;
// Task 16 sẽ nối lại `import type { SessionTreeItem } from './tree';`.
type SessionTreeItem = { sessionKey: string };

export function registerCommands(context: vscode.ExtensionContext, manager: WorkspaceManager): void {
  const register = (id: string, handler: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register('aiWorkspace.newWorkspace', () => manager.newWorkspace());
  register('aiWorkspace.saveWorkspace', () => manager.save());
  register('aiWorkspace.openWorkspace', () => manager.openViaQuickPick());
  register('aiWorkspace.closeWorkspace', () => manager.close());
  register('aiWorkspace.addSession', () => manager.addSession());

  register('aiWorkspace.removeSession', async (item?: SessionTreeItem) => {
    const key = item?.sessionKey ?? (await pickSessionKey(manager, 'Chọn session để gỡ'));
    if (key) await manager.removeSession(key);
  });

  register('aiWorkspace.openSessionTerminal', async (item?: SessionTreeItem) => {
    const key = item?.sessionKey ?? (await pickSessionKey(manager, 'Chọn session để mở terminal'));
    if (key) manager.focusSession(key);
  });

  register('aiWorkspace.restoreSession', async (item?: SessionTreeItem) => {
    const key = item?.sessionKey ?? (await pickSessionKey(manager, 'Chọn session để dựng lại'));
    if (key) await manager.restoreSession(key);
  });
}

async function pickSessionKey(manager: WorkspaceManager, placeHolder: string): Promise<string | undefined> {
  const sessions = manager.currentSessions();
  if (sessions.length === 0) {
    await vscode.window.showInformationMessage('Workspace chưa có session nào.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({ label: s.name, description: s.role, detail: s.key, key: s.key })),
    { placeHolder },
  );
  return picked?.key;
}

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

  /**
   * Riêng các lệnh TẠO terminal: gọi bằng phím tắt (không có item) thì nhắm thẳng workspace
   * ĐANG NHẬN — đó mới là ý nghĩa của phím tắt. Chỉ khi không có workspace nào mở mới hỏi
   * chọn. Các lệnh khác (kích hoạt, đổi tên, xóa…) vẫn hỏi, vì mặc định vào workspace đang
   * nhận cho một lệnh xóa là kiểu bất ngờ không ai muốn.
   */
  const wsChoTerminalMoi = async (item?: WorkspaceItem): Promise<string | null> =>
    item?.view.id ?? manager.getReceivingWorkspaceId() ?? (await pickWorkspaceId());

  return [
    vscode.commands.registerCommand('aiWorkspace.createWorkspace', () => manager.createAndActivate()),
    vscode.commands.registerCommand('aiWorkspace.activateWorkspace', async (item?: WorkspaceItem) => {
      const id = await wsArg(item);
      if (id) await manager.activate(id);
    }),
    // Đóng workspace được bấm chuột phải; gọi từ Command Palette (không có item) thì nhắm
    // workspace đang nhận — nhiều workspace mở cùng lúc nên "cái đang active" hết nghĩa.
    vscode.commands.registerCommand('aiWorkspace.closeWorkspace', async (item?: WorkspaceItem) => {
      const id = item?.view.id ?? manager.getReceivingWorkspaceId();
      if (id) await manager.closeConfirmed(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.renameWorkspace', async (item?: WorkspaceItem) => {
      const id = await wsArg(item);
      if (id) await manager.rename(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.deleteWorkspace', async (item?: WorkspaceItem) => {
      const id = await wsArg(item);
      if (id) await manager.deleteWorkspace(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.newClaudeTerminal', async (item?: WorkspaceItem) => {
      const id = await wsChoTerminalMoi(item);
      if (id) await manager.newClaudeTerminal(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.newCodexTerminal', async (item?: WorkspaceItem) => {
      const id = await wsChoTerminalMoi(item);
      if (id) await manager.newCodexTerminal(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.newPlainTerminal', async (item?: WorkspaceItem) => {
      const id = await wsChoTerminalMoi(item);
      if (id) await manager.newPlainTerminal(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.workspaceSettings', async (item?: WorkspaceItem) => {
      const id = await wsArg(item);
      if (id) await manager.workspaceSettings(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.showWorkspaceInfo', async (item?: WorkspaceItem) => {
      const id = await wsArg(item);
      if (id) await manager.showWorkspaceInfo(id);
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
    vscode.commands.registerCommand('aiWorkspace.assignClaudeSession', (item: TerminalItem) =>
      manager.assignClaudeSession(item.view.workspaceId, item.view.id),
    ),
    vscode.commands.registerCommand('aiWorkspace.renameTerminal', (item: TerminalItem) =>
      manager.renameTerminal(item.view.workspaceId, item.view.id),
    ),
    vscode.commands.registerCommand('aiWorkspace.showTerminalPath', (item: TerminalItem) =>
      manager.showTerminalPath(item.view.workspaceId, item.view.id),
    ),
    // Menu chuột phải tab terminal có thể truyền hoặc không truyền `Terminal`;
    // manager tự fallback về `window.activeTerminal` nên cả hai trường hợp đều chạy.
    vscode.commands.registerCommand('aiWorkspace.addOpenTerminalToWorkspace', (terminal?: vscode.Terminal) =>
      manager.addOpenTerminal(terminal),
    ),
  ];
}

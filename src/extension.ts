import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('aiWorkspace.newWorkspace', async () => {
      await vscode.window.showInformationMessage('AI Workspace: chưa cài đặt.');
    }),
  );
}

export function deactivate(): void {}

import * as vscode from 'vscode';
import type { CreateTerminalOptions, TerminalHandle } from '../workspace/restore';

export class TerminalManager {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly closedHandlers = new Set<(key: string) => void>();
  private readonly subscription: vscode.Disposable;

  constructor() {
    this.subscription = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [key, tracked] of this.terminals) {
        if (tracked === terminal) {
          this.terminals.delete(key);
          for (const handler of this.closedHandlers) handler(key);
        }
      }
    });
  }

  create(key: string, options: CreateTerminalOptions): TerminalHandle {
    const terminal = vscode.window.createTerminal({
      name: options.name,
      cwd: options.cwd,
      env: options.env,
    });
    this.terminals.set(key, terminal);
    terminal.show(false);
    return {
      sendText: (text) => terminal.sendText(text, true),
      show: () => terminal.show(false),
    };
  }

  focus(key: string): boolean {
    const terminal = this.terminals.get(key);
    if (!terminal) return false;
    terminal.show(false);
    return true;
  }

  has(key: string): boolean {
    return this.terminals.has(key);
  }

  onClosed(handler: (key: string) => void): vscode.Disposable {
    this.closedHandlers.add(handler);
    return new vscode.Disposable(() => this.closedHandlers.delete(handler));
  }

  closeAll(): void {
    for (const terminal of this.terminals.values()) terminal.dispose();
    this.terminals.clear();
  }

  dispose(): void {
    this.subscription.dispose();
    this.closedHandlers.clear();
  }
}

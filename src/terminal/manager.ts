import * as vscode from 'vscode';

/** Bằng chứng bền qua Reload để nối đúng terminal với entry, không phải đoán bằng tên/cwd. */
export const MANAGED_TERMINAL_ID_ENV = 'AI_WORKSPACE_TERMINAL_ID';

export interface TerminalHandle {
  sendText(text: string): void;
}

export interface CreateTerminalOptions {
  name: string;
  cwd: string;
  env?: Record<string, string>;
  /** Đè setting chung `aiWorkspace.terminalLocation` — dùng cho cài đặt riêng từng workspace. */
  location?: 'editor' | 'panel';
}

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
    const cu = this.terminals.get(key);
    if (cu) {
      // Gỡ khỏi map TRƯỚC khi dispose: nếu createTerminal ném exception sau khi dispose,
      // map không được giữ lại entry chỉ tới terminal đã bị dispose.
      this.terminals.delete(key);
      cu.dispose();
    }
    const noiMo =
      options.location ??
      vscode.workspace.getConfiguration('aiWorkspace').get<string>('terminalLocation', 'editor');
    const terminal = vscode.window.createTerminal({
      name: options.name,
      cwd: options.cwd,
      env: { ...options.env, [MANAGED_TERMINAL_ID_ENV]: key },
      location:
        noiMo === 'panel' ? vscode.TerminalLocation.Panel : vscode.TerminalLocation.Editor,
    });
    this.terminals.set(key, terminal);
    terminal.show(false);
    return { sendText: (text) => terminal.sendText(text, true) };
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

  /** Nhận nuôi terminal có sẵn (adoption) — track như terminal của mình, không show lại. */
  adopt(key: string, terminal: vscode.Terminal): void {
    const cu = this.terminals.get(key);
    if (cu && cu !== terminal) {
      this.terminals.delete(key);
      cu.dispose();
    }
    this.terminals.set(key, terminal);
  }

  /** Trả key nếu terminal này đang được track, ngược lại null. */
  ownsTerminal(terminal: vscode.Terminal): string | null {
    for (const [key, t] of this.terminals) if (t === terminal) return key;
    return null;
  }

  get(key: string): vscode.Terminal | undefined {
    return this.terminals.get(key);
  }

  /** Thôi theo dõi terminal của key này mà KHÔNG đóng nó — dùng khi gỡ entry khỏi workspace. */
  release(key: string): void {
    this.terminals.delete(key);
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

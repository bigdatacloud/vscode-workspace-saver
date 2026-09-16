import * as vscode from 'vscode';

/**
 * Bật/tắt nghe giọng nói vào terminal đang hoạt động, kèm chỉ báo "đang nghe" — cùng nhịp tay với
 * Orca: một phím bật, nói, cùng phím đó dừng.
 *
 * Extension KHÔNG tự nhận dạng giọng nói. Nó gọi dictation tích hợp của VS Code
 * (`workbench.action.terminal.startVoice`, có từ 1.131, model Nemotron chạy offline, có tiếng
 * Việt). Việc của lớp này chỉ là: chọn đúng terminal, bật, HIỆN cho người dùng biết đang nghe,
 * và dừng đúng lúc. Chữ nhận dạng được do VS Code gõ thẳng vào ô nhập của terminal; Enter là
 * của người dùng — tự gửi một câu nghe nhầm vào agent là chuyện không được phép xảy ra.
 */

const LENH_BAT = 'workbench.action.terminal.startVoice';
const LENH_DUNG = 'workbench.action.terminal.stopVoice';
const KHOA_NGU_CANH = 'aiWorkspace.dangNghe';
export const LENH_TOGGLE = 'aiWorkspace.voiceToggle';
const PHIM = process.platform === 'darwin' ? 'Cmd+E' : 'Ctrl+E';

export class BoNgheGiongNoi implements vscode.Disposable {
  private dangNghe = false;
  private readonly thanh: vscode.StatusBarItem;
  /** Đóng thông báo tiến trình khi dừng — nó là promise treo cho tới lúc ta gọi. */
  private dongThongBao: (() => void) | null = null;

  constructor() {
    // Ưu tiên rất cao để đứng sát mép trái: lúc đang nghe, đây là thứ duy nhất cần thấy.
    this.thanh = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10_000);
    this.thanh.command = LENH_TOGGLE;
    this.thanh.tooltip = `Đang nghe giọng nói vào terminal. Bấm ${PHIM} hoặc bấm vào đây để dừng.`;
    this.thanh.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  async toggle(): Promise<void> {
    if (this.dangNghe) {
      await this.dung();
      return;
    }
    // `activeTerminal` là terminal hoạt động GẦN NHẤT, kể cả khi focus đang ở cây hay editor —
    // nên bấm phím từ cây AI Workspaces vẫn nghe vào đúng terminal vừa chọn.
    const terminal = vscode.window.activeTerminal;
    if (terminal === undefined) {
      void vscode.window.showWarningMessage(
        'Chưa có terminal nào đang mở để nghe. Bấm vào một terminal trong cây AI Workspaces trước.',
      );
      return;
    }
    // Dictation gõ vào terminal ĐANG FOCUS — phải kéo focus về nó trước, không thì chữ rơi vào
    // chỗ khác hoặc VS Code từ chối bật.
    terminal.show(false);
    try {
      await vscode.commands.executeCommand(LENH_BAT);
    } catch (e) {
      void vscode.window.showWarningMessage(
        `Không bật được nghe giọng nói: ${e instanceof Error ? e.message : String(e)}. Cần VS Code ≥ 1.131 với dictation.enabled đang bật; lần đầu VS Code sẽ tải model về.`,
      );
      return;
    }
    this.dangNghe = true;
    void vscode.commands.executeCommand('setContext', KHOA_NGU_CANH, true);
    this.thanh.text = `$(mic-filled) ĐANG NGHE → "${terminal.name}" · ${PHIM} để dừng`;
    this.thanh.show();
    // Thông báo tiến trình là "màn hình đang nghe" duy nhất VS Code cho phép mà KHÔNG cướp focus
    // khỏi terminal (webview hay modal đều cướp, và cướp focus là dictation gõ nhầm chỗ).
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Đang nghe cho terminal "${terminal.name}" — nói xong bấm ${PHIM} (hoặc Cancel) để dừng`,
        cancellable: true,
      },
      (_tienTrinh, token) =>
        new Promise<void>((resolve) => {
          this.dongThongBao = resolve;
          token.onCancellationRequested(() => void this.dung());
        }),
    );
  }

  private async dung(): Promise<void> {
    this.dangNghe = false;
    void vscode.commands.executeCommand('setContext', KHOA_NGU_CANH, false);
    this.thanh.hide();
    this.dongThongBao?.();
    this.dongThongBao = null;
    try {
      await vscode.commands.executeCommand(LENH_DUNG);
    } catch {
      /* đã dừng từ nút mic của VS Code — không sao */
    }
    // Chữ đã nằm trong ô nhập terminal. CỐ Ý không gửi Enter: người dùng đọc lại rồi tự gửi.
  }

  dispose(): void {
    if (this.dangNghe) void this.dung();
    this.thanh.dispose();
  }
}

/**
 * Bảo đảm phím tắt tới được extension khi terminal đang focus.
 *
 * VS Code mặc định chuyển hầu hết phím vào shell khi terminal focus; chỉ lệnh nằm trong
 * `terminal.integrated.commandsToSkipShell` mới được giữ lại. Extension KHÔNG khai được vào
 * danh sách đó bằng `contributes`, nên phải ghi vào cài đặt người dùng — một lần, có báo.
 * Không làm thế thì Ctrl+E trong terminal thành lệnh "về cuối dòng" của readline và không bao
 * giờ tới được ta.
 */
export async function damBaoPhimQuaShell(): Promise<void> {
  const KHOA = 'terminal.integrated.commandsToSkipShell';
  const cauHinh = vscode.workspace.getConfiguration();
  const hienCo = cauHinh.get<string[]>(KHOA, []);
  if (hienCo.includes(LENH_TOGGLE)) return;
  try {
    await cauHinh.update(KHOA, [...hienCo, LENH_TOGGLE], vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(
      `Đã thêm "${LENH_TOGGLE}" vào ${KHOA} để ${PHIM} trong terminal bật nghe giọng nói thay vì bị shell nuốt.`,
    );
  } catch {
    void vscode.window.showWarningMessage(
      `Không ghi được ${KHOA}. Thêm tay "${LENH_TOGGLE}" vào cài đặt đó, không thì ${PHIM} trong terminal sẽ bị shell nuốt.`,
    );
  }
}

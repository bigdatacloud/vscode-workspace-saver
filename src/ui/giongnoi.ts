import * as vscode from 'vscode';
import { gopVeMotDong } from '../orch/bus';

/**
 * Bật/tắt nghe giọng nói vào terminal đang hoạt động, kèm chỉ báo "đang nghe" — cùng nhịp tay với
 * Orca: một phím bật, nói, cùng phím đó dừng.
 *
 * Extension KHÔNG tự nhận dạng giọng nói. Nó dùng dictation tích hợp của VS Code (model Nemotron
 * chạy offline, có tiếng Việt) — qua đường EDITOR: mở một tài liệu nháp, cho VS Code gõ vào đó,
 * dừng thì đọc lại rồi TỰ đưa vào terminal. Chọn đường này thay vì `terminal.startVoice` vì ba
 * lý do: giữ nguyên dấu câu (đường terminal của VS Code cố ý bỏ dấu câu cho dòng lệnh, không hợp
 * với prompt cho agent); người dùng THẤY chữ đang hiện dần trong tab nháp — kể cả dòng "đang nạp
 * model" — nên biết lúc nào nói được; và ta cầm được chữ để báo lại. Cả hai đường đều được đo
 * bằng micro giả của Chromium (2026-09-17, test `giongnoi-thinghiem`) và đều ra chữ khi chờ
 * đủ thời gian nạp model.
 *
 * Enter vẫn là của người dùng — tự gửi một câu nghe nhầm vào agent là chuyện không được phép.
 */

const LENH_BAT = 'workbench.action.editorDictation.start';
const LENH_DUNG = 'workbench.action.editorDictation.stop';
const KHOA_NGU_CANH = 'aiWorkspace.dangNghe';
export const LENH_TOGGLE = 'aiWorkspace.voiceToggle';
export const LENH_CHON_MIC = 'aiWorkspace.voiceSelectMicrophone';
/** Lệnh chọn micro của chính VS Code cho dictation — ghi nhớ theo cửa sổ, không có setting tương ứng. */
const LENH_CHON_MIC_VSCODE = 'workbench.action.chat.selectSpeechToTextMicrophone';
const PHIM = process.platform === 'darwin' ? 'Cmd+Shift+Y' : 'Ctrl+Shift+Y';
/** Sau lệnh dừng, VS Code còn chuyển âm nốt đoạn cuối rồi mới gõ — chờ tới khi chữ đứng yên. */
const CHO_ON_DINH_MS = 1_200;
const CHO_TOI_DA_MS = 8_000;

interface PhienNghe {
  terminal: vscode.Terminal;
  nhap: vscode.TextDocument;
}

export class BoNgheGiongNoi implements vscode.Disposable {
  private phien: PhienNghe | null = null;
  private dangDung = false;
  private readonly thanh: vscode.StatusBarItem;
  /** Đóng thông báo tiến trình khi dừng — nó là promise treo cho tới lúc ta gọi. */
  private dongThongBao: (() => void) | null = null;
  /** Kênh chẩn đoán: mỗi bước một dòng, để "nghe xong không ra chữ" truy được thay vì đoán. */
  private readonly kenh = vscode.window.createOutputChannel('AI Workspace — Giọng nói');

  private ghi(dong: string): void {
    const d = `[${new Date().toLocaleTimeString('vi-VN')}] ${dong}`;
    this.kenh.appendLine(d);
    if (process.env.AI_WORKSPACE_THI_NGHIEM_GIONG_NOI === '1') console.log(`[giongnoi] ${d}`);
  }

  constructor() {
    // Ưu tiên rất cao để đứng sát mép trái: lúc đang nghe, đây là thứ duy nhất cần thấy.
    this.thanh = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10_000);
    this.thanh.command = LENH_TOGGLE;
    this.thanh.tooltip = `Đang nghe giọng nói. Bấm ${PHIM} hoặc bấm vào đây để dừng và đưa chữ vào terminal. Nói mà không ra chữ → lệnh "AI Workspace: Chọn micro nghe giọng nói".`;
    this.thanh.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  async toggle(): Promise<void> {
    if (this.phien !== null) {
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
    // Tài liệu nháp untitled: dictation của VS Code cần một editor đang hoạt động để gõ vào.
    // Đóng không lưu ở bước dừng, không để lại file nào.
    const nhap = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '' });
    await vscode.window.showTextDocument(nhap, { preview: true, preserveFocus: false });
    this.ghi(`bật: đích "${terminal.name}", tab nháp ${nhap.uri.toString()}, editor đang hoạt động = ${vscode.window.activeTextEditor?.document.uri.toString() ?? 'không có'}`);
    try {
      await vscode.commands.executeCommand(LENH_BAT);
      this.ghi('đã gọi editorDictation.start');
    } catch (e) {
      this.ghi(`editorDictation.start ném lỗi: ${e instanceof Error ? e.message : String(e)}`);
      await this.dongNhap(nhap);
      terminal.show(false);
      void vscode.window.showWarningMessage(
        `Không bật được nghe giọng nói: ${e instanceof Error ? e.message : String(e)}. Cần VS Code ≥ 1.131 với dictation.enabled đang bật; lần đầu VS Code sẽ tải model về.`,
      );
      return;
    }
    this.phien = { terminal, nhap };
    void vscode.commands.executeCommand('setContext', KHOA_NGU_CANH, true);
    this.thanh.text = `$(mic-filled) ĐANG NGHE → "${terminal.name}" · ${PHIM} để dừng`;
    this.thanh.show();
    // Thông báo tiến trình là "màn hình đang nghe" duy nhất VS Code cho phép mà không cướp focus
    // khỏi editor nháp (dictation gõ vào chỗ đang focus).
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        // Nói trước khi model sẵn sàng là mất lời (VS Code không đệm âm thanh lúc đang nạp model;
        // lần đầu sau khi tải, nạp model CPU 755 MB mất hàng chục giây). Nên dặn ngay tại đây.
        title: `Đang nghe cho terminal "${terminal.name}" — CHỜ tiếng báo rồi mới nói (lần đầu nạp model có thể mất 10–30 giây); nói xong bấm ${PHIM} hoặc Cancel: chữ sẽ được đưa vào terminal, bạn tự Enter`,
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
    const phien = this.phien;
    if (phien === null || this.dangDung) return;
    this.dangDung = true;
    try {
      void vscode.commands.executeCommand('setContext', KHOA_NGU_CANH, false);
      this.thanh.hide();
      this.dongThongBao?.();
      this.dongThongBao = null;
      this.ghi(`dừng: tab nháp đang có ${phien.nhap.getText().length} ký tự trước khi gọi stop`);
      try {
        await vscode.commands.executeCommand(LENH_DUNG);
      } catch (e) {
        this.ghi(`editorDictation.stop ném lỗi (bỏ qua): ${e instanceof Error ? e.message : String(e)}`);
      }
      const chu = await this.choChuOnDinh(phien.nhap);
      this.ghi(`sau khi chữ ổn định: ${chu.length} ký tự`);
      await this.dongNhap(phien.nhap);
      phien.terminal.show(false);
      // GỘP VỀ MỘT DÒNG: trong TUI của agent mỗi xuống dòng là một lần Enter, mà Enter là của
      // người dùng. Dấu câu thì giữ — đây là prompt cho agent, không phải dòng lệnh shell.
      const motDong = gopVeMotDong(chu);
      if (motDong === '') {
        void vscode.window.showWarningMessage(
          'Không nghe được chữ nào. Nói lại sau khi thấy tiếng báo; vẫn không ra thì chạy "AI Workspace: Chọn micro nghe giọng nói".',
        );
        return;
      }
      phien.terminal.sendText(motDong, false);
      this.ghi(`đã đưa ${motDong.length} ký tự vào "${phien.terminal.name}"`);
      const rutGon = motDong.length > 80 ? `${motDong.slice(0, 80)}…` : motDong;
      vscode.window.setStatusBarMessage(`$(mic) Đã đưa vào "${phien.terminal.name}": ${rutGon} — Enter để gửi`, 8_000);
    } finally {
      this.phien = null;
      this.dangDung = false;
    }
  }

  /** Chữ trong tài liệu nháp sau khi dừng — chờ tới khi nó không đổi nữa (VS Code chuyển âm nốt đoạn cuối). */
  private async choChuOnDinh(nhap: vscode.TextDocument): Promise<string> {
    const han = Date.now() + CHO_TOI_DA_MS;
    let truoc = nhap.getText();
    let onDinhTu = Date.now();
    while (Date.now() < han) {
      await new Promise((r) => setTimeout(r, 200));
      const nay = nhap.getText();
      if (nay !== truoc) {
        truoc = nay;
        onDinhTu = Date.now();
      } else if (Date.now() - onDinhTu >= CHO_ON_DINH_MS) {
        break;
      }
    }
    return truoc;
  }

  /** Đóng tài liệu nháp KHÔNG lưu, không hỏi. */
  private async dongNhap(nhap: vscode.TextDocument): Promise<void> {
    try {
      await vscode.window.showTextDocument(nhap, { preview: true, preserveFocus: false });
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    } catch {
      /* tài liệu đã bị người dùng đóng — không sao */
    }
  }

  dispose(): void {
    if (this.phien !== null) void this.dung();
    this.thanh.dispose();
    this.kenh.dispose();
  }

  /**
   * Mở bảng chọn micro của VS Code. Dictation lấy micro "mặc định" theo Chromium; trên máy có
   * micro ảo (app chia sẻ màn hình…) cái đó có thể là một thiết bị câm — model nghe toàn im lặng,
   * kết thúc với transcript rỗng mà không báo lỗi. Chọn tay đúng micro thật là cách gỡ; VS Code
   * nhớ lựa chọn này.
   */
  async chonMic(): Promise<void> {
    try {
      await vscode.commands.executeCommand(LENH_CHON_MIC_VSCODE);
    } catch (e) {
      void vscode.window.showWarningMessage(
        `Không mở được bảng chọn micro của VS Code: ${e instanceof Error ? e.message : String(e)}. Thử Command Palette → "Voice: Select Microphone".`,
      );
    }
  }
}

/**
 * Bảo đảm phím tắt tới được extension khi terminal đang focus.
 *
 * VS Code mặc định chuyển hầu hết phím vào shell khi terminal focus; chỉ lệnh nằm trong
 * `terminal.integrated.commandsToSkipShell` mới được giữ lại. Extension KHÔNG khai được vào
 * danh sách đó bằng `contributes`, nên phải ghi vào cài đặt người dùng — một lần, có báo.
 * Không làm thế thì phím trong terminal bị đẩy xuống shell và không bao giờ tới được ta.
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

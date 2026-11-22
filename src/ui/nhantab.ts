import * as vscode from 'vscode';

/**
 * Ép nhãn tab terminal thành đúng cái tên ta muốn người dùng đọc.
 *
 * Vì sao cần: `vscode.window.createTerminal({ name })` KHÔNG quyết định nhãn tab. Đo trong
 * Extension Host 22/11/2026 — tạo terminal với `name: 'ten-cay-claude'` rồi đọc
 * `tab.label` thì nhận về **"pwsh"**: VS Code dựng nhãn theo
 * `terminal.integrated.tabs.title`, mặc định là `${process}`, tức tên tiến trình đang chạy.
 * Hệ quả đúng là thứ anh Ý muốn tránh khi yêu cầu "tên terminal trùng tên cây": mọi tab agent
 * đều mang nhãn "claude", không phân biệt được cái nào là việc nào.
 *
 * `workbench.action.terminal.renameWithArg` đặt tiêu đề do người dùng, và tiêu đề đó thắng
 * `${process}`. Lệnh này tác động lên terminal ĐANG ACTIVE nên phải `show()` trước — đó cũng
 * là thứ các đường "tạo terminal mới" vốn muốn (người dùng vừa bấm tạo thì họ muốn thấy nó).
 *
 * Không dùng ở đường KHÔI PHỤC hàng loạt: ở đó `show()` từng cái sẽ làm tab nhảy liên tục,
 * và bước xếp lưới ngay sau đó mới là thứ quyết định cái gì hiện ở đâu.
 */
export async function datNhanTab(
  t: vscode.Terminal,
  ten: string,
  ghiLog: (d: string) => void = () => undefined,
): Promise<boolean> {
  try {
    t.show(false);
    // Chờ ĐÚNG điều kiện lệnh cần (terminal này đang active), không nghỉ một nhịp cố định:
    // lệnh rename tác động lên terminal active, nên gọi sớm là đổi tên nhầm cái khác.
    const het = Date.now() + 2000;
    while (vscode.window.activeTerminal !== t && Date.now() < het) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (vscode.window.activeTerminal !== t) {
      ghiLog(`[nhan] "${ten}" chưa active sau 2 s nên không đặt nhãn tab (tránh đổi tên nhầm)`);
      return false;
    }
    await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: ten });
    return true;
  } catch (e) {
    // Nhãn tab là chuyện hiển thị: hỏng thì terminal vẫn chạy, không được làm vỡ cả lệnh tạo.
    ghiLog(`[nhan] không đặt được nhãn tab "${ten}": ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

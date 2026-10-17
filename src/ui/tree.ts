import * as vscode from 'vscode';
import type { TerminalState, TerminalView, WorkspaceManager, WorkspaceView } from '../workspace/manager';
import { bieuTuongTerminal } from './bieutuong';

const POLL_MS = 3000;

/** Phải khớp với `contributes.keybindings` trong package.json. */
const PHIM_TERMINAL = process.platform === 'darwin' ? 'Cmd+Alt+T' : 'Ctrl+Alt+T';
const PHIM_CLAUDE = process.platform === 'darwin' ? 'Cmd+Alt+A' : 'Ctrl+Alt+A';

const STATE_LABELS: Record<TerminalState, string> = {
  busy: 'đang chạy',
  idle: 'rảnh',
  blocked: 'CHỜ BẠN TRẢ LỜI',
  loading: 'đang tải phiên…',
  open: 'đang mở',
  closed: 'chưa mở',
  error: 'lỗi',
};

export class WorkspaceItem extends vscode.TreeItem {
  constructor(readonly view: WorkspaceView) {
    super(view.name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `ws:${view.id}`;
    // "đang nhận" phải hiện ra: quy tắc chọn workspace nhận terminal mới là ngầm định, không
    // hiện thì người dùng không đoán được terminal tiếp theo rơi vào đâu.
    const trangThai = !view.isActive
      ? null
      : view.isReceiving
        ? '(đang mở · nhận terminal mới)'
        : '(đang mở)';
    const phanMoTa = [
      ...(trangThai === null ? [] : [trangThai]),
      `${view.terminalCount} terminal`,
      // Ghim phải hiện ra: cái ghim không tụt xuống khi workspace khác được dùng, mà người
      // dùng cần biết vì sao thứ tự "không chịu đổi".
      ...(view.daGhim === true ? ['đã ghim thứ tự'] : []),
    ];
    this.description = phanMoTa.join(' · ');
    const dong = [view.name, `${view.terminalCount} terminal`];
    if (view.isReceiving) dong.push('Terminal bạn tự mở tay sẽ được thêm vào workspace này');
    dong.push(
      view.lastActiveAt === null
        ? 'Chưa từng kích hoạt'
        : `Lần active gần nhất: ${new Date(view.lastActiveAt).toLocaleString('vi-VN')}`,
    );
    // Menu chuột phải của TreeView không hiện phím tắt (VS Code chỉ hiện trong Command
    // Palette), nên nhắc ngay trong tooltip — đây đúng chỗ người dùng đang định tạo terminal.
    // Ghi rõ "mặc định" vì extension KHÔNG đọc được phím người dùng đã gán lại: API không
    // cho tra keybinding đang có hiệu lực.
    dong.push(`Phím tắt mặc định: ${PHIM_TERMINAL} terminal mới · ${PHIM_CLAUDE} terminal Claude`);
    dong.push(
      view.daGhim === true
        ? 'Thứ tự: bạn đã ghim tay — kéo thả hoặc ↑/↓ để đổi, "Bỏ ghim thứ tự" để về tự sắp'
        : 'Thứ tự: tự sắp theo lần kích hoạt gần nhất — kéo thả để ghim vị trí',
    );
    this.tooltip = dong.join('\n');
    // `folder-active` không có trong bộ codicon; `root-folder-opened` là icon thư mục
    // "đang mở" có thật, giữ được phân biệt active/không.
    this.iconPath = new vscode.ThemeIcon(
      view.isActive ? 'root-folder-opened' : 'folder',
      view.isActive ? new vscode.ThemeColor('charts.green') : undefined,
    );
    this.contextValue = view.isActive ? 'aiWorkspaceActive' : 'aiWorkspaceInactive';
    if (!view.isActive) {
      this.command = { command: 'aiWorkspace.activateWorkspace', title: 'Kích hoạt', arguments: [this] };
    }
  }
}

export class TerminalItem extends vscode.TreeItem {
  constructor(readonly view: TerminalView) {
    super(view.name, vscode.TreeItemCollapsibleState.None);
    this.id = `term:${view.id}`;
    const kindLabel =
      view.agent === 'claude' ? 'AI' : view.agent === 'codex' ? 'Codex' : 'shell';
    // Vai đứng TRƯỚC trạng thái: khi nhìn lướt cả cây, câu hỏi đầu tiên là "ai làm gì",
    // trạng thái là câu hỏi thứ hai.
    const phan = [kindLabel];
    if (view.roleName !== undefined) phan.push(view.laDieuPhoi === true ? `${view.roleName} ★` : view.roleName);
    phan.push(STATE_LABELS[view.state]);
    if (view.vaiDaDoi === true) phan.push('vai đã đổi');
    this.description = phan.join(' · ');
    // Đường dẫn nằm ngay trong tooltip: hover là thấy, không phải mở menu. Menu "Xem đường
    // dẫn" vẫn cần cho việc sao chép (tooltip không bôi đen copy được).
    const dong = [view.name, `Đường dẫn: ${view.cwd}`, `Trạng thái: ${STATE_LABELS[view.state]}`];
    if (view.roleName !== undefined) {
      dong.push(`Vai: ${view.roleName}${view.laDieuPhoi === true ? ' (điều phối)' : ''}`);
    }
    if (view.vaiDaDoi === true) {
      dong.push('Mô tả vai đã đổi sau khi terminal chạy — AGENTS.md đã cập nhật, nhưng system');
      dong.push('prompt thì phải đóng terminal và kích hoạt lại workspace mới khớp.');
    }
    if (view.hasStartCommand) dong.push('Có lệnh khởi động');
    // Nhắc ngay ở đây vì đây là chỗ người dùng đang phân vân: trước bản này, terminal của
    // workspace chưa kích hoạt bấm vào chỉ báo "kích hoạt workspace trước".
    if (view.state === 'closed') dong.push('Bấm để bật RIÊNG terminal này (có hỏi xác nhận, không mở cả workspace)');
    this.tooltip = dong.join('\n');
    // Màu = nhà cung cấp, hình = trạng thái — quy tắc thuần nằm ở `bieutuong.ts`.
    const icon = bieuTuongTerminal(view.state, view.agent);
    this.iconPath = new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color));
    // Hậu tố `DieuPhoi` để menu lập tổ chỉ hiện đúng chỗ. Vẫn khớp /aiTerminal(Claude|Plain)/
    // của các menu khác vì chúng dùng `=~` (khớp mẫu) chứ không phải so bằng.
    const goc = view.kind === 'claude' ? 'aiTerminalClaude' : 'aiTerminalPlain';
    this.contextValue = view.laDieuPhoi === true ? `${goc}DieuPhoi` : goc;
    this.command = { command: 'aiWorkspace.focusTerminal', title: 'Mở terminal', arguments: [this] };
  }
}

export type TreeElement = WorkspaceItem | TerminalItem;

export class WorkspaceTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly changed = new vscode.EventEmitter<TreeElement | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly manager: WorkspaceManager) {
    manager.onDidChange(() => this.changed.fire(undefined));
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) return this.manager.workspaceViews().map((v) => new WorkspaceItem(v));
    if (element instanceof WorkspaceItem) {
      return this.manager.terminalViews(element.view.id).map((v) => new TerminalItem(v));
    }
    return [];
  }

  /** Chỉ poll khi view đang hiển thị — view ẩn thì dừng hẳn. */
  startPolling(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.manager.refreshStatuses();
    }, POLL_MS);
  }

  stopPolling(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stopPolling();
    this.changed.dispose();
  }
}

/**
 * Kiểu MIME riêng cho payload kéo thả.
 *
 * Khai riêng thay vì mượn kiểu mặc định của TreeView: ta cần payload là DANH SÁCH ID terminal
 * (kéo nhiều cái một lúc), và một kiểu riêng cũng bảo đảm cây này không nhận nhầm thứ kéo từ
 * cây khác của VS Code.
 */
const MIME_TERMINAL = 'application/vnd.aiworkspace.terminal';

/**
 * Kiểu MIME RIÊNG cho workspace, không dùng chung với terminal: hai thứ này thả vào cùng một
 * chỗ lại có nghĩa khác hẳn nhau (terminal thả lên workspace = chuyển vào trong nó; workspace
 * thả lên workspace = xếp trước nó). Một kiểu chung thì `handleDrop` phải đoán, mà đoán sai ở
 * đây là chuyển nhầm terminal sang workspace khác.
 */
const MIME_WORKSPACE = 'application/vnd.aiworkspace.workspace';

/** Đọc danh sách id từ payload kéo thả. Payload hỏng → `null`, bên gọi im lặng bỏ qua. */
async function docIds(muc: vscode.DataTransferItem | undefined): Promise<string[] | null> {
  if (muc === undefined) return null;
  try {
    const doc: unknown = JSON.parse(await muc.asString());
    if (!Array.isArray(doc)) return null;
    const ids = doc.filter((x): x is string => typeof x === 'string');
    return ids.length === 0 ? null : ids;
  } catch {
    return null; // bỏ qua chứ không ném ra giữa thao tác kéo thả
  }
}

export class WorkspaceDragAndDrop implements vscode.TreeDragAndDropController<TreeElement> {
  readonly dragMimeTypes = [MIME_TERMINAL, MIME_WORKSPACE];
  readonly dropMimeTypes = [MIME_TERMINAL, MIME_WORKSPACE];

  constructor(private readonly manager: WorkspaceManager) {}

  handleDrag(source: readonly TreeElement[], data: vscode.DataTransfer): void {
    // Chọn lẫn cả hai loại rồi kéo thì chỉ nhận terminal: gom hai thao tác khác nghĩa vào một
    // cú thả là cách chắc chắn làm sai một trong hai.
    const terminal = source.filter((x): x is TerminalItem => x instanceof TerminalItem);
    if (terminal.length > 0) {
      data.set(MIME_TERMINAL, new vscode.DataTransferItem(JSON.stringify(terminal.map((x) => x.view.id))));
      return;
    }
    const ws = source.filter((x): x is WorkspaceItem => x instanceof WorkspaceItem);
    if (ws.length === 0) return;
    data.set(MIME_WORKSPACE, new vscode.DataTransferItem(JSON.stringify(ws.map((x) => x.view.id))));
  }

  async handleDrop(target: TreeElement | undefined, data: vscode.DataTransfer): Promise<void> {
    const idWs = await docIds(data.get(MIME_WORKSPACE));
    if (idWs !== null) {
      // Thả workspace lên một TERMINAL = thả lên workspace chứa terminal đó: người dùng nhắm
      // vào chỗ nằm giữa cây, không nhắm vào cái terminal.
      const dich =
        target instanceof WorkspaceItem
          ? target.view.id
          : target instanceof TerminalItem
            ? target.view.workspaceId
            : null;
      await this.manager.thaWorkspace(idWs, dich);
      return;
    }

    const ids = await docIds(data.get(MIME_TERMINAL));
    if (ids === null) return;

    if (target instanceof TerminalItem) {
      await this.manager.thaTerminal(ids, target.view.workspaceId, target.view.id);
      return;
    }
    if (target instanceof WorkspaceItem) {
      // Thả lên chính dòng workspace = đưa xuống cuối danh sách của nó.
      await this.manager.thaTerminal(ids, target.view.id, null);
    }
    // Thả ra vùng trống ngoài mọi item: không rõ ý muốn gì, nên không làm gì.
  }
}

# AI Workspace Session Manager

Extension VS Code quản lý **nhiều workspace toàn cục**, mỗi workspace giữ **nhiều terminal
đang mở** — kể cả terminal bạn tự mở tay lẫn terminal chạy Claude Code. Không còn manifest
sống trong repo: toàn bộ danh sách workspace được lưu ở global storage của extension
(`workspaces.json`), tự động cập nhật trong suốt quá trình làm việc — không có nút Save thủ
công. Mở VS Code lên, cây "AI Workspaces" hiện danh sách workspace đã có; bấm vào một
workspace để kích hoạt nó, extension mở lại đúng các terminal của lần làm việc trước, resume
đúng cuộc hội thoại Claude Code (nếu có) hoặc chạy lại `startCommand` đã khai báo.

## Yêu cầu

- VS Code ≥ 1.93 (dùng Terminal Shell Integration API để bắt cwd chính xác)
- `git` có sẵn trong PATH (chỉ cần khi tạo terminal Claude có worktree riêng)
- Claude Code ≥ 2.1 (lệnh `claude` có sẵn trong PATH) — chỉ cần cho terminal `kind: claude`

## Tính năng chính

- **Danh sách workspace toàn cục**: không gắn với một thư mục/repo cụ thể; một workspace có
  thể chứa terminal trỏ tới nhiều repo/thư mục khác nhau.
- **Adoption (nhận nuôi terminal)**: khi có workspace đang active,
  - terminal bạn tự mở bằng <kbd>Ctrl+Shift+`</kbd> (không tên, không phải task runner) →
    **tự động thêm ngay** vào workspace active, kèm toast có nút "Bỏ ra" nếu thêm nhầm;
  - terminal do task runner/extension khác tạo (có tên riêng) → toast gợi ý, bấm "Thêm" mới
    được thêm vào workspace;
  - có thể thêm thủ công bất kỳ terminal đang mở nào qua menu chuột phải trên tab terminal
    (**AI Workspace: Thêm terminal đang mở vào workspace**) — nếu chưa có workspace active,
    lệnh hỏi chọn/tạo workspace (không tự kích hoạt nó).
- **Auto-save**: mọi biến động (thêm/bỏ terminal, đổi tên, gắn session, đổi cwd,
  kích hoạt/đóng workspace) tự lưu debounce 500ms xuống `workspaces.json`, ghi qua
  temp+rename (atomic) — không có thao tác Save thủ công nào.
- **Kích hoạt / chuyển workspace**: bấm một workspace chưa active → mở lại từng terminal đã
  lưu. Nếu đang có workspace khác active, extension hỏi modal "Lưu và đóng X trước khi mở
  Y?" trước khi chuyển; hủy modal thì không làm gì.
- **Terminal Claude** (`kind: claude`): khi mở lại, gửi `claude --resume '<sessionId>' -n
  '<claudeName>'`; nếu entry chưa từng có sessionId (mới tạo), extension mint uuid mới, gửi
  `--session-id`, và lưu ngay lập tức xuống đĩa TRƯỚC khi gửi lệnh (chống mồ côi nếu VS Code
  tắt đột ngột).
- **Terminal thường** (`kind: plain`): chỉ track vỏ (tên + cwd); có thể khai báo
  `startCommand` tùy chọn qua **AI Workspace: Đặt lệnh khởi động cho terminal**. Khi mở lại,
  nếu có `startCommand` chưa được tin tưởng, extension hiện modal liệt kê nguyên văn lệnh,
  chọn "Tin và chạy" hoặc "Chỉ mở shell". Đổi `startCommand` sẽ làm mất trust cũ (vân tay đổi)
  — lần mở kế tiếp phải hỏi trust lại.
- **Bắt Claude session tự động**: mỗi ~3 giây, extension đối chiếu cwd của các terminal đang
  mở trong workspace active với `claude agents --json` (chỉ hàng `kind: interactive`). Khớp
  duy nhất → tự gắn `claudeSessionId`/tên peer, terminal `plain` "thăng cấp" thành `claude`.
  Nhiều terminal cùng cwd/nhiều session cùng cwd → hiện QuickPick hỏi một lần cho mỗi cụm cwd
  (không hỏi lặp lại mỗi chu kỳ poll nếu bạn bỏ qua).
- **Một workspace active mỗi cửa sổ VS Code**: khóa best-effort theo `activeWindowId`; mở
  cùng một workspace ở cửa sổ thứ hai sẽ bị cảnh báo, có nút "Vẫn mở" để ghi đè.
- **Đóng terminal không xóa khỏi workspace**: đóng tay một terminal (bấm X hoặc `exit`) chỉ
  chuyển entry sang trạng thái "chưa mở" trong cây — workspace vẫn nhớ nó, mở lại workspace
  sẽ mở lại terminal đó. Muốn loại hẳn khỏi workspace, dùng **AI Workspace: Bỏ terminal khỏi
  workspace**.
- **Xóa workspace không đóng terminal thật**: xóa một workspace khỏi danh sách chỉ quên nó đi
  — các terminal thật đang mở của nó vẫn chạy nguyên, không bị đóng.

## Các lệnh

| Lệnh | Command ID | Ngữ cảnh |
|---|---|---|
| AI Workspace: Tạo workspace mới | `aiWorkspace.createWorkspace` | Palette / nút "+" trên view |
| AI Workspace: Kích hoạt workspace | `aiWorkspace.activateWorkspace` | Click item / context menu workspace chưa active |
| AI Workspace: Đóng workspace đang active | `aiWorkspace.closeActiveWorkspace` | Palette / context menu workspace active |
| AI Workspace: Đổi tên workspace | `aiWorkspace.renameWorkspace` | Context menu workspace |
| AI Workspace: Xóa workspace | `aiWorkspace.deleteWorkspace` | Context menu workspace (có modal xác nhận) |
| AI Workspace: Tạo terminal Claude mới | `aiWorkspace.newClaudeTerminal` | Palette / context menu workspace |
| AI Workspace: Đặt lệnh khởi động cho terminal | `aiWorkspace.setStartCommand` | Context menu terminal `plain` |
| AI Workspace: Bỏ terminal khỏi workspace | `aiWorkspace.removeTerminal` | Context menu terminal |
| AI Workspace: Mở terminal | `aiWorkspace.focusTerminal` | Click terminal item trong cây |
| AI Workspace: Thêm terminal đang mở vào workspace | `aiWorkspace.addOpenTerminalToWorkspace` | Menu chuột phải tab terminal / palette |

Cây "AI Workspaces" (trong Explorer, id view `aiWorkspace.workspaces`) hiện 2 tầng: tầng 1 là
danh sách workspace (sắp theo lần active gần nhất, workspace active có badge riêng), tầng 2 là
các terminal của workspace kèm nhãn trạng thái (đang chạy / rảnh / đang chờ / đang mở / chưa
mở / lỗi), tự cập nhật mỗi ~3 giây khi view đang hiển thị (dừng poll khi view bị ẩn).

## Nguyên tắc an toàn

- Không tự chạy `startCommand` nào chưa được xác nhận tin tưởng (trust theo vân tay nội dung
  lệnh, đổi lệnh là mất trust cũ).
- Không tự đóng terminal thật khi xóa workspace hay khi gỡ terminal khỏi workspace.
- `workspaces.json` hỏng/parse lỗi → sao lưu sang `workspaces.json.bak-<epoch>` rồi khởi tạo
  lại danh sách rỗng, kèm cảnh báo một lần — không bao giờ âm thầm vứt dữ liệu hỏng.
- Terminal có `--resume` id không còn hội thoại: extension không tự xử lý, terminal vẫn mở và
  lỗi hiển thị trực tiếp trong terminal đó; entry vẫn giữ nguyên id để có thể sửa tay/thử lại.

## Giới hạn đã biết

- Không có migration từ dữ liệu MVP (manifest `workspace.yaml` cũ) — v2 là mô hình dữ liệu
  hoàn toàn khác (global storage, không phải file trong repo).
- Không restore được nội dung/lịch sử shell — chỉ resume được hội thoại Claude Code qua
  `--resume`, terminal thường chỉ mở lại đúng cwd rồi chạy `startCommand` (nếu có).
- Không tự kích hoạt workspace nào khi mở VS Code — cây chỉ hiện danh sách, bạn phải bấm chọn.
- Khóa "một workspace active mỗi cửa sổ" chỉ best-effort (không heartbeat, không lock cứng);
  đóng cửa sổ đột ngột có thể để lại khóa cũ — cửa sổ khác dùng nút "Vẫn mở" để thoát tình
  huống đó.
- Hai entry ở hai workspace khác nhau có thể cùng trỏ về một `claudeSessionId`: việc đối chiếu
  session chỉ nhìn workspace đang active, nên nó không biết session đó đã bị workspace khác
  nhận. Kích hoạt cả hai workspace sẽ `--resume` cùng một hội thoại hai lần.
- Nhiều cửa sổ VS Code: mỗi lần lưu là gộp theo id, và **mỗi cửa sổ chỉ ghi đè những workspace
  mà chính nó đã đụng tới** (tạo, đổi tên, kích hoạt, thêm/bỏ terminal…). Workspace nó không
  đụng tới sẽ đi theo bản mới nhất trên đĩa, nên việc cửa sổ khác đang làm không bị ghi đè.
  Trạng thái của mỗi workspace vì thế là của cửa sổ cuối cùng đụng tới nó.
- Xóa một workspace ở cửa sổ này có thể bị cửa sổ khác — đang giữ workspace đó trong RAM và
  đã từng đụng tới nó — ghi sống lại ở lần lưu sau của nó.
- Không quản lý workspace từ nhiều máy, không chia sẻ workspace qua git.

## Phát triển

```bash
npm install
npm test              # 95 unit/integration test (vitest) — pure core, không đụng vscode API
npm run test:vscode   # 6 smoke test chạy trong Extension Host thật
npm run typecheck     # tsc --noEmit
npm run build         # bundle bằng esbuild ra dist/extension.js
```

Nhấn <kbd>F5</kbd> trong VS Code (dùng cấu hình "Chạy Extension" có sẵn trong
`.vscode/launch.json`) để mở một cửa sổ Extension Host với extension đang chạy ở chế độ
debug — dùng cửa sổ đó để chạy checklist kiểm thử tay ở `docs/manual-verification.md`, vì
phần lớn các luồng có hộp thoại (modal, toast, QuickPick) không thể kiểm thử tự động trong
Extension Host chạy headless.

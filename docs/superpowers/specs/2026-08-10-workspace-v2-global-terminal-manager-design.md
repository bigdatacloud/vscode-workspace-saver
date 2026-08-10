# Workspace v2 — Quản lý terminal toàn cục (Design)

Ngày: 2026-08-10. Thay thế mô hình MVP (spec 2026-08-09). Người dùng đã duyệt thiết kế
trong hội thoại; các quyết định dưới đây là chung cuộc.

## 1. Bối cảnh & mục tiêu

MVP quản lý session theo manifest trong repo và chỉ quản terminal do extension tạo (D2 cũ).
Người dùng cần mô hình khác:

- Danh sách **nhiều workspace toàn cục**; mỗi workspace quản **nhiều terminal đang mở**.
- Terminal mới mở (Ctrl+Shift+`) **tự động vào workspace đang active**.
- **Tự động lưu** trạng thái trong suốt quá trình làm việc — không còn nút Save thủ công.
- Mở VS Code → tree hiện danh sách workspace; click một workspace → mở lại các terminal
  của lần làm việc cuối; nếu đang có workspace active → hỏi lưu & đóng trước khi chuyển.

## 2. Quyết định thiết kế (đảo/kế thừa từ MVP)

| # | Quyết định | Ghi chú |
|---|---|---|
| V1 | Workspace **toàn cục, tự do** — lưu ở globalStorage (`workspaces.json`), terminal trong một workspace được phép trỏ cwd vào nhiều repo khác nhau | Đảo mô hình manifest-in-repo. KHÔNG viết migration từ MVP (người dùng duy nhất, dữ liệu test). Xóa module `manifest/`, `index/`, flow restore cũ. |
| V2 | **Đảo D2 cũ**: nhận cả terminal người dùng tự mở. Terminal người dùng mở → **tự thêm ngay + toast có nút "Bỏ ra"**; terminal do extension khác tạo → không tự thêm, toast gợi ý "[Thêm vào workspace]" | Người dùng duyệt phương án dung hòa này. |
| V3 | Terminal thường (không Claude): track **vỏ** (tên + cwd) + `startCommand` khai báo tùy chọn; restore mở shell đúng cwd rồi chạy `startCommand` nếu đã trust | `startCommand` đi qua trust-gate (fingerprint), tái dùng `TrustStore`. |
| V4 | Bắt Claude session bằng đối chiếu `cwd` terminal ↔ `claude agents --json` (chỉ hàng `kind: 'interactive'`); khớp duy nhất → gắn tự động; nhiều terminal cùng cwd → QuickPick; terminal thường "thăng cấp" thành claude khi bắt được | Đã xác minh 2026-08-10: registry trả `cwd`, `kind`, `sessionId`, `name`, `status`/`state`. |
| V5 | Mỗi cửa sổ VS Code **tối đa một workspace active**; khóa best-effort (`activeWindowId` trong store) — cửa sổ thứ hai bị cảnh báo, có nút override | Không heartbeat, không lock cứng (YAGNI). |
| V6 | Chuyển workspace: modal xác nhận "Lưu và đóng X trước khi mở Y?"; đồng ý → lưu state, đóng terminal của X, kích hoạt Y; hủy → không làm gì | |
| V7 | Đóng một terminal thủ công **không** xóa nó khỏi workspace — chỉ chuyển trạng thái "chưa mở". Muốn loại hẳn dùng lệnh "Bỏ khỏi workspace" | Workspace là bộ nhớ dài hạn, không phải ảnh chụp tức thời. |
| V8 | Worktree + role giữ dạng **tùy chọn** khi tạo terminal Claude mới từ extension; tái dùng `git/` hiện có | Không còn là trục chính của data model. |

## 3. Mô hình dữ liệu

File: `<globalStorage>/workspaces.json`. Zod schema (module mới `src/model/schema.ts`):

```ts
TerminalEntry {
  id: string (uuid),            // khóa nội bộ, đồng thời là key trong TerminalManager
  name: string (>=1 ký tự),
  cwd: string (đường dẫn tuyệt đối),
  kind: 'claude' | 'plain',
  startCommand?: string,        // chỉ có nghĩa với 'plain'
  claudeSessionId?: string (uuid),  // chỉ có nghĩa với 'claude'
  claudeName?: string,          // tên peer -n; chỉ có nghĩa với 'claude'
}
Workspace {
  id: string (uuid),
  name: string (>=1, unique không phân biệt hoa thường trong file),
  lastActiveAt: string (ISO) | null,
  activeWindowId: string | null,   // khóa best-effort V5
  terminals: TerminalEntry[],      // id unique trong workspace
}
StoreFile { version: 2, workspaces: Workspace[] }
```

Chính sách hỏng dữ liệu: `workspaces.json` thiếu → store rỗng mới (im lặng).
Parse/validate lỗi → **backup file hỏng** sang `workspaces.json.bak-<epoch>` rồi khởi tạo
rỗng, kèm warning một lần cho người dùng (khác MVP: state hỏng không được im lặng vứt vì
giờ nó là dữ liệu chính, không phải cache).

Ghi file: ghi qua temp + rename (atomic) — sửa nợ kỹ thuật MVP vì file này giờ là nguồn
sự thật duy nhất. Auto-save debounce 500ms, mọi biến động (thêm/bỏ terminal, đổi tên, gắn
sessionId, đổi cwd, activate/close) đều schedule save.

## 4. Vòng đời workspace active

- **Kích hoạt** (click tree / lệnh): nếu đang có active → flow V6. Sau đó, với từng
  `TerminalEntry`:
  - cwd không còn tồn tại trên đĩa → bỏ qua, đánh dấu `lỗi`, ghi warning vào report.
  - `kind: 'claude'`: mở terminal (tên, cwd) rồi gửi `claude --resume '<sessionId>' -n '<claudeName>'`;
    entry chưa có `claudeSessionId` → mint uuid mới, gửi `--session-id`, lưu ngay (chống mồ côi — giữ hành vi MVP).
  - `kind: 'plain'`: mở terminal (tên, cwd); có `startCommand` → kiểm tra trust
    (fingerprint toàn bộ startCommand của workspace, key `ws:<workspaceId>`): đã trust →
    gửi lệnh; chưa → modal liệt kê lệnh, "Tin và chạy" / "Chỉ mở shell".
  - Lỗi từng terminal được cô lập (try/catch per-entry như MVP restore).
  - Ghi `lastActiveAt`, `activeWindowId`; refresh tree.
- **Đóng** (lệnh / trước khi chuyển): lưu state, đóng mọi terminal đang track của
  workspace, xóa `activeWindowId`, active = null.
- **Khóa V5**: khi kích hoạt, nếu `activeWindowId` khác null và khác windowId hiện tại →
  warning "Workspace đang mở ở cửa sổ khác" với nút "Vẫn mở" (override ghi đè khóa).
  windowId = `vscode.env.sessionId`.
- Deactivate extension (đóng cửa sổ): flush save; KHÔNG xóa `activeWindowId` được một cách
  đáng tin (VS Code không đảm bảo async trong deactivate) → khi một cửa sổ thấy khóa của
  chính `env.sessionId` cũ không còn sống, override là lối thoát; chấp nhận best-effort.

## 5. Nhận terminal mới (adoption)

Nghe `vscode.window.onDidOpenTerminal`. Bỏ qua nếu: không có workspace active, hoặc
terminal do chính extension tạo (tra `TerminalManager`). Còn lại phân loại
(pure function `classifyTerminal` trong `src/adopt/filter.ts`, nhận dữ liệu đã trích từ
`creationOptions`):

- `ExtensionTerminalOptions` (pty của extension khác) → `suggest`.
- `TerminalOptions.name` có giá trị (task runner, extension đặt tên) → `suggest`.
- Không tên (người dùng Ctrl+Shift+`) → `auto`.

`auto`: thêm ngay vào workspace active (kind `plain`, cwd tốt nhất hiện có), toast
`Đã thêm "<tên>" vào workspace <X>` + nút `Bỏ ra` (bấm → gỡ entry). `suggest`: toast
`Thêm terminal "<tên>" vào workspace <X>?` + nút `Thêm`. Toast không chặn; bỏ qua toast
`auto` = giữ, bỏ qua `suggest` = không thêm.

cwd của terminal nhận vào: ưu tiên `terminal.shellIntegration.cwd`, fallback
`creationOptions.cwd`, fallback folder đang mở. Nghe `onDidChangeTerminalShellIntegration`
để cập nhật cwd chính xác hơn về sau (ghi đè entry + auto-save).

## 6. Bắt Claude session (matching)

Chu kỳ poll 3s (tái dùng vòng poll tree): gọi `adapter.listRunning()`, lọc
`kind === 'interactive'`. Pure function `matchClaudeSessions(entries, running)` trong
`src/claude/match.ts`:

- So `cwd` chuẩn hóa (path.resolve + lowercase — Windows case-insensitive) giữa terminal
  đang mở của workspace active và các hàng registry **chưa bị entry nào giữ**.
- Một terminal ↔ một hàng khớp duy nhất → `matched`: gắn `claudeSessionId`+`claudeName`,
  đổi `kind` thành `'claude'` nếu đang `plain` (thăng cấp), auto-save.
- Nhiều khả năng (2 terminal cùng cwd / 2 session cùng cwd) → `ambiguous`: UI hiện
  QuickPick một lần cho mỗi cụm cwd (không lặp lại spam mỗi 3s — nhớ cụm đã hỏi và bị bỏ
  qua trong phiên).
- Terminal đã có `claudeSessionId` nhưng session không còn trong registry → chỉ đổi
  trạng thái hiển thị (`chưa chạy`), không gỡ id (còn dùng để resume).

Trạng thái hiển thị terminal (tái dùng nhãn MVP): `đang chạy`/`rảnh`/`đang chờ` từ
status registry khi bắt được; terminal mở nhưng không có Claude → `đang mở`;
terminal chưa mở → `chưa mở`; cwd mất/lỗi restore → `lỗi`.

## 7. UI

Tree 2 tầng (`aiWorkspace.workspaces` — đổi id view):

- Tầng 1: mọi workspace, sắp theo `lastActiveAt` giảm dần; workspace active có badge/icon
  riêng + mô tả `(đang active)`; item có số terminal.
- Tầng 2: terminal của workspace với icon + nhãn trạng thái như mục 6; click terminal
  đang mở → focus; terminal chưa mở của workspace active → mở lại riêng nó.
- Click workspace (không active) → kích hoạt (flow V6). Khởi động VS Code: tree hiện danh
  sách, KHÔNG tự kích hoạt gì.

Lệnh (palette + context menu tree):

| Lệnh | Ngữ cảnh |
|---|---|
| `aiWorkspace.createWorkspace` | palette — nhập tên, tạo + kích hoạt luôn |
| `aiWorkspace.activateWorkspace` | click item / context menu |
| `aiWorkspace.closeActiveWorkspace` | palette / context menu item active |
| `aiWorkspace.renameWorkspace`, `aiWorkspace.deleteWorkspace` | context menu (delete: confirm modal; nếu đang active thì đóng trước) |
| `aiWorkspace.newClaudeTerminal` | palette / context menu workspace — hỏi tên peer, cwd (mặc định folder đang mở), tùy chọn worktree (V8) |
| `aiWorkspace.setStartCommand` | context menu terminal `plain` — nhập/xóa lệnh; đổi lệnh làm mất trust cũ (fingerprint đổi) |
| `aiWorkspace.removeTerminal` | context menu terminal |
| `aiWorkspace.addOpenTerminalToWorkspace` | menu chuột phải tab terminal (`terminal/title/context` + `terminal/context`) và palette — thêm terminal đang mở bất kỳ vào workspace active (không active → hỏi chọn/tạo workspace) |
| `aiWorkspace.focusTerminal` | click terminal item |

## 8. Kiến trúc & tái dùng

Bất biến giữ nguyên từ MVP:

- **Pure core không import vscode** — `src/model/`, `src/adopt/filter.ts`,
  `src/claude/match.ts`, `src/workspace/activate.ts`, `src/agent/`, `src/git/` thuần;
  `architecture.test.ts` mở rộng danh sách quét.
- Chuỗi đặc thù Claude nằm trong `src/agent/claude.ts` (ngoại lệ đã biết:
  `kind: 'claude'` trong schema — chấp nhận như MVP đã chấp nhận `z.literal('claude')`).

Tái dùng nguyên vẹn: `src/agent/*` (adapter, quote, registry — `RunningSession` đã có
`cwd`/`kind`), `src/git/*`, `src/terminal/manager.ts` (thêm API tra "terminal này có phải
của mình" + adopt-tracking), icon/label tree, khung poll.

Sửa nhỏ: `TrustStore` đổi key từ đường dẫn manifest sang key mờ (`ws:<id>`) — bỏ
`path.resolve` trong `memoryKey` (resolve một uuid sẽ dính cwd process, sai).

Xóa: `src/manifest/`, `src/index/`, `src/events/` (chết từ MVP), `src/workspace/restore.ts`
+ `src/workspace/manager.ts` cũ (thay bằng activate.ts + manager v2), lệnh/flow save-load
manifest, README + manual checklist viết lại.

Orchestrator mới `src/workspace/activate.ts` (pure, ports như restore.ts cũ):
`activateWorkspace(ws: Workspace, ports: ActivatePorts): Promise<ActivateReport>` — ports:
`{ createTerminal, sendText, agent, fsExists, isTrusted, confirmTrust, warn }`;
report `{ opened: string[], failed: {id, reason}[], mintedSessions: {id, sessionId}[] }`.

## 9. Failure modes

| Tình huống | Hành vi |
|---|---|
| `workspaces.json` hỏng | backup `.bak-<epoch>` + store rỗng + warning (mục 3) |
| cwd của entry không còn | skip entry, đánh dấu `lỗi`, warning gộp trong report |
| `--resume` id không còn hội thoại | terminal mở, claude báo lỗi trong terminal — extension không tự xử; người dùng thấy trực tiếp; entry giữ nguyên |
| `claude` CLI vắng mặt | terminal claude vẫn mở shell, lệnh fail hiển thị trong terminal; poll `listRunning` trả [] → trạng thái `đang mở` |
| Registry lỗi/`claude agents` fail | poll bỏ qua chu kỳ đó (adapter đã trả []) |
| 2 cửa sổ cùng workspace | V5: warning + override |
| Ghi file fail (đĩa) | warning; giữ dirty flag, retry ở lần save sau |

## 10. Testing

- Pure core: vitest — schema, store (load/save/backup/atomic qua fs port giả), classify,
  match (khớp duy nhất/ambiguous/thăng cấp/không-lặp-hỏi), activate orchestrator
  (per-entry isolation, trust gate, mint-and-persist), TrustStore key mới.
- Lớp vscode (manager v2, tree, commands, adoption listener): không unit-test được —
  typecheck + Extension Host smoke (activate, view tồn tại, lệnh đăng ký đủ) + manual
  checklist viết lại (adoption toast, chuyển workspace, QuickPick ambiguity, menu chuột
  phải tab terminal).
- Fact cần smoke-verify thủ công sớm (spike trong task đầu của lớp UI): menu
  `terminal/title/context` có truyền `Terminal` object vào handler không; nếu không,
  fallback `vscode.window.activeTerminal`.

## 11. Ngoài phạm vi

- Migration dữ liệu MVP; chia sẻ workspace qua git; messaging giữa session (Claude tự lo);
  restore nội dung/lịch sử shell (bất khả thi API); auto-activate workspace khi mở VS Code;
  quản lý workspace từ nhiều máy.

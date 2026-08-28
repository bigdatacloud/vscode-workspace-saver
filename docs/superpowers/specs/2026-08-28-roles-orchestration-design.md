# Roles + Orchestration

**Ngày:** 2026-08-28
**Tiếp nối:** `2026-08-27-multi-workspace-worktree-design.md` mục 5 (định hướng đã duyệt).
**Phạm vi:** phần C (roles) và phần D (orchestration).

---

## 1. Fact đã xác minh trên máy này

| Fact | Cách đo |
|---|---|
| `claude --append-system-prompt-file <path>` **có thật** | `claude --append-system-prompt-file /khong/co -p hi` → `Error: Append system prompt file not found: …`; cờ bịa cho `error: unknown option` |
| `claude --mcp-config <configs...>` có thật | trong `claude --help` |
| Codex **không** có cờ tương đương | `codex --help` không có khoá instructions |

Hệ quả: Claude nhận vai qua **cả hai** kênh; Codex chỉ qua `AGENTS.md`. Đây là giới hạn
thật, ghi vào README chứ không giấu.

## 2. Phần C — Roles

### 2.1 Nguồn sự thật là FILE, không phải shard

```
Workspace.roles?: Role[]          Role = { id, name, kind: 'worker' | 'orchestrator' }
TerminalEntry.roleId?: string
mô tả vai                          <globalStorage>/roles/<wsId>/<roleId>.md   ← NGUỒN SỰ THẬT
```

Đổi so với định hướng ban đầu (mô tả nằm trong shard rồi materialize ra file). Lý do đổi:

1. `--append-system-prompt-file` cần một FILE. Để mô tả trong shard nghĩa là phải sinh file
   mỗi lần khởi chạy — thêm một bước đồng bộ, tức thêm một chỗ lệch.
2. Mô tả vai là văn bản nhiều dòng. `showInputBox` chỉ một dòng. File mở trong editor cho
   markdown, xuống dòng, undo, và mọi thứ người dùng đã quen.

Một nguồn, hai bản kết xuất **vẫn giữ nguyên** — chỉ là nguồn dời từ shard sang file:

```
      roles/<wsId>/<roleId>.md          ← NGUỒN
              │
     ┌────────┴─────────┐
     ▼                  ▼
--append-system-    khối có mốc+hash trong
prompt-file         <worktree>/AGENTS.md
(Claude)            (Claude + Codex)
```

### 2.2 Chống lệch

Khối trong `AGENTS.md`:

```
<!-- ai-workspace:role <tên> id=<roleId> hash=<8 ký tự> — SINH TỰ ĐỘNG, đừng sửa tay -->
…nội dung file vai…
<!-- /ai-workspace:role -->
```

Hàm thuần trong **file mới `src/role/agentsmd.ts`**:

```ts
export function bamNoiDung(s: string): string;                  // 8 ký tự hex, ổn định
export function dungKhoiRole(noiDung, ten, roleId): string;
export type KetQuaChen = 'them' | 'thay' | 'nguoiDungDaSua' | 'khongDoi';
export function chenKhoiRole(agentsMd, noiDung, ten, roleId): { noiDung: string; ketQua: KetQuaChen };
export function goKhoiRole(agentsMd, roleId): string;
```

Quy tắc:

1. **Không bao giờ ghi ngoài mốc.** `AGENTS.md` sẵn có của repo được giữ nguyên từng ký tự.
2. `hash` ghi trong mốc là hash của nội dung LÚC SINH. Đọc lại thấy hash của thân khối khác
   hash ghi trong mốc → **có người sửa tay** → trả `nguoiDungDaSua`, KHÔNG đè; bên gọi hỏi
   người dùng "giữ bản sửa tay hay ghi đè bằng bản vai?".
3. Nội dung không đổi → `khongDoi`, không ghi file (không đụng mtime vô cớ).
4. System prompt đóng băng từ lúc khởi chạy. Sửa file vai khi terminal đang chạy → `AGENTS.md`
   được ghi lại NGAY (ăn liền), còn system prompt thì không: entry mang cờ `roleCu` và cây
   hiện `vai đã đổi`, kèm hành động khởi chạy lại. **Lệch được hiển thị, không bị giấu.**

`.git/info/exclude` chỉ được thêm dòng `AGENTS.md` khi (a) file do ta tạo mới, và (b) dòng đó
chưa có. Không đụng `.gitignore` của người dùng.

### 2.3 Lệnh

| Lệnh | Chỗ gọi | Việc |
|---|---|---|
| `aiWorkspace.addRole` | chuột phải workspace | nhập tên → chọn loại → tạo file từ mẫu → **mở trong editor** |
| `aiWorkspace.manageRoles` | chuột phải workspace | QuickPick: sửa mô tả / đổi tên / xoá |
| `aiWorkspace.assignRole` | chuột phải terminal | QuickPick vai + `(bỏ vai)` |

Tên vai đi vào tên nhánh git → validate `/^[A-Za-z0-9_.][\w.-]*$/` ngay ở ô nhập, và duy nhất
trong workspace (không phân biệt hoa thường).

**Ràng buộc:** tối đa MỘT terminal mang vai `orchestrator` trong một workspace. Kiểm ở lúc
gắn, báo rõ terminal nào đang giữ.

### 2.4 Vai quyết định tên worktree

`newClaudeTerminal`/`newCodexTerminal`: sau khi chọn đường dẫn, **nếu workspace có vai** thì
hỏi vai (QuickPick, có mục "không gắn vai"). `vai` truyền cho `hoiWorktree` = `role.name`, không
có vai thì `agentId` như hiện tại. Đây đúng là "chỗ duy nhất đổi nguồn" đã hẹn ở spec trước.

## 3. Phần D — Orchestration

### 3.1 Hình dạng

Orchestrator là **agent thường trong một terminal**, được cấp một MCP server do extension
ship. Extension là đường ống, không phải bộ não — mọi phán đoán nằm ở agent, nơi sửa được
bằng lời chứ không phải bằng TypeScript.

```
<globalStorage>/orch/<wsId>/
  mcp-<terminalId>.json   cấu hình MCP cho ĐÚNG terminal orchestrator
  status.json             extension ghi mỗi nhịp poll: terminal + vai + trạng thái
  req/<id>.json           MCP server → extension (việc chỉ extension làm được)
  res/<id>.json           extension → MCP server (kết quả)
```

Không cổng mạng, không thương lượng port, sống sót qua Reload Window. Ghi nguyên tử bằng
temp+rename như store hiện có.

### 3.2 Năm tool

| Tool | Làm gì | Đường đi |
|---|---|---|
| `list_agents` | terminal trong workspace: id, tên, vai, trạng thái, cwd, nhánh | đọc `status.json` |
| `read_transcript` | N lượt cuối của worker: đã gọi tool gì, sửa file nào | đọc thẳng transcript Claude |
| `dispatch` | bơm chỉ thị vào terminal worker | `req`/`res` |
| `wait` | chờ tới khi các worker rảnh/chờ-bấm/đóng | poll `status.json` |
| `report` | ghi vào khung kiểm toán + báo cho người dùng | `req`/`res` |

Cố ý **không** làm task DAG / decision gate như Orca. Orchestrator là một mô hình ngôn ngữ:
nó tự giữ kế hoạch được. Thứ nó KHÔNG tự làm được là nhìn thấy terminal khác, đọc bài làm của
chúng, gửi chữ vào chúng, và biết khi nào chúng xong — đúng năm tool trên, không hơn.

`read_transcript` là lợi thế thật so với `terminal read` của Orca: đọc bản ghi hội thoại chứ
không cào màn hình. Entry không phải Claude → trả lời rõ "chưa hỗ trợ", không đoán.

### 3.3 Chốt an toàn

1. **Độ sâu = 1.** `req` mang `from` = id terminal do chính args của MCP server khai. Extension
   chỉ chấp nhận `dispatch` khi `from` ĐÚNG là terminal đang giữ vai orchestrator. Worker gọi
   `dispatch` → từ chối. Chặn bom đệ quy.
2. **Chỉ bơm vào terminal có agent đang chạy thật.** Đích phải đang được track, phải là entry
   agent, và trạng thái không phải `closed`. Bơm chữ vào một shell trần là thực thi lệnh tuỳ ý.
3. **Không tự bơm vào chính mình.** `terminal_id === from` → từ chối.
4. **Khung kiểm toán.** Output Channel `AI Workspace — Orchestration` ghi mọi `req` và kết
   quả. Người dùng đọc được toàn bộ những gì sếp đã nói với lính.

### 3.4 Cấu hình MCP không phụ thuộc biến môi trường

```json
{ "mcpServers": { "ai-workspace": {
    "command": "<process.execPath>",
    "args": ["<extensionPath>/dist/mcp.js", "--orch", "<orchDir>", "--self", "<terminalId>"],
    "env": { "ELECTRON_RUN_AS_NODE": "1" } } } }
```

`process.execPath` + `ELECTRON_RUN_AS_NODE=1` chạy được node mà KHÔNG đòi `node` có trong
PATH. Mọi tham số nằm trong `args`, không dựa vào env kế thừa qua hai tầng tiến trình
(terminal → claude → mcp server) — tầng nào nuốt env thì cả cơ chế chết im lặng.

Chỉ terminal mang vai orchestrator mới được thêm `--mcp-config`. Worker không cần tool.

### 3.5 MCP server

`src/orch/mcp.ts` → bundle riêng ra `dist/mcp.js` (entry thứ hai của esbuild). **Không import
`vscode`** — thêm vào hàng rào kiến trúc.

JSON-RPC 2.0 trên stdio, mỗi thông điệp một dòng. Xử lý `initialize`, `notifications/initialized`,
`tools/list`, `tools/call`. Không thêm dependency: giao thức đủ nhỏ để tự viết, và một
dependency mới trong vsix là thứ phải bảo trì mãi.

## 4. Kiểm thử

**Hàm thuần:**

| Hàm | Ca |
|---|---|
| `bamNoiDung` | ổn định, đổi nội dung là đổi hash |
| `chenKhoiRole` | thêm mới vào file rỗng; thay khối cũ; giữ nguyên nội dung ngoài khối; hash lệch → `nguoiDungDaSua`; nội dung y hệt → `khongDoi`; hai vai khác id cùng tồn tại |
| `goKhoiRole` | gỡ đúng khối, giữ phần còn lại |
| `xuLyYeuCau` (lõi thuần của bộ xử lý req) | `from` không phải orchestrator → từ chối; đích không phải agent → từ chối; đích đã đóng → từ chối; tự bơm vào mình → từ chối; hợp lệ → cho phép |
| `dungCauHinhMcp` | đúng shape, có `ELECTRON_RUN_AS_NODE` |
| MCP dispatcher | `initialize` trả capabilities; `tools/list` đủ 5 tool; `tools/call` tool lạ → lỗi JSON-RPC; JSON hỏng → không sập |

**Schema:** `roles` + `roleId` đi qua đĩa, `.passthrough()` giữ chúng cho bản cũ.

**Kiến trúc:** `src/orch/mcp.ts` và cả cây `src/role/` không được import `vscode`.

**Kiểm tay:** thêm mục vào `docs/manual-verification.md`.

## 5. Ràng buộc toàn cục

- Chuỗi hiển thị tiếng Việt có dấu; comment giải thích **vì sao**.
- `version: 2`, trường mới luôn optional, `.passthrough()` giữ nguyên.
- **Không thêm dependency runtime nào.**
- `noUncheckedIndexedAccess` đang bật.
- Mọi test hiện có phải xanh.

---

## Phụ lục (2026-08-28, sau khi khảo sát Oh My Pi)

Đọc [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) — agent Rust, fork của pi-mono.
Nó có `task` tool fan-out ra worktree cách ly, và điểm mạnh thật nằm ở **hợp đồng kết quả**:
*"the final yield is a schema-validated object the parent reads directly. No prose to parse."*

**Lấy: kết quả có kiểu.** Thiết kế cũ của mục 3.2 yếu đúng chỗ này — `wait` kết thúc khi
worker `idle`, mà `idle` không phân biệt được "xong việc được giao" với "đang chờ người bấm"
hay "vừa xong một việc khác hẳn"; người điều phối phải đọc transcript rồi tự đoán.

Nay: terminal mang vai **worker** cũng được cấp MCP, nhưng bộ tool KHÁC — đúng một tool
`report_done(outcome, summary, dispatch_id?, files?)` với `outcome ∈ {succeeded, failed,
blocked}` được validate ở cửa đọc. Mỗi `dispatch` tự gắn `dispatch_id` vào chỉ thị và dặn
worker gọi `report_done` khi xong. `wait` kết thúc khi worker BÁO XONG **hoặc** dừng tay, và
trả kèm kết quả. Kết quả bị xoá khi có `dispatch` mới cho worker đó — không thì lần `wait` kế
tiếp trả về báo cáo của việc trước và người điều phối tưởng việc mới đã xong ngay.

Điều này KHÔNG nới độ sâu 1: worker không có `dispatch`, và `xetDispatch` vẫn từ chối mọi lệnh
giao việc không đến từ terminal điều phối (đã khoá bằng test).

**Không lấy: IRC DM giữa các peer.** omp cho subagent nhắn thẳng cho nhau, bỏ qua parent. Đó
đúng là thứ luật độ-sâu-1 sinh ra để cấm, và nó phá mô hình "sếp kiểm bài" — nếu worker tự
thoả thuận với nhau thì người điều phối không còn là nơi duy nhất biết toàn cảnh.

**Không lấy: Agent Hub, `orchestrate`/`workflowz` keyword.** Agent Hub (đọc transcript sống,
gõ chỉ thị, kill worker kẹt) là thứ cây AI Workspaces + terminal thật của VS Code đã làm sẵn.
Hai keyword kia là mẹo prompt trong agent của họ; ở đây file mô tả vai đã giữ vai trò đó.

Ghi nhận: [issue #2413](https://github.com/can1357/oh-my-pi/issues/2413) của chính omp còn mở,
thừa nhận `task()` "chưa đủ cho phối hợp đa agent" — nên omp là nguồn tốt cho hợp đồng kết
quả, không phải cho tô-pô điều phối.

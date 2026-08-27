# Nhiều workspace cùng mở + worktree cho terminal agent

**Ngày:** 2026-08-27
**Phạm vi spec này:** phần A (bỏ popup, nhiều workspace cùng mở) và phần B (worktree cho
terminal agent + lệnh dọn worktree).
**Không thuộc spec này:** phần C (roles) và phần D (orchestration) — kiến trúc của chúng
được ghi ở mục 5 để A và B không bị thiết kế lệch hướng, nhưng sẽ có spec riêng sau khi A+B
chạy thật.

---

## 1. Mục tiêu

1. Kích hoạt một workspace **không** còn đóng workspace đang mở. Nhiều workspace mở song
   song trong cùng một cửa sổ VS Code là chuyện bình thường.
2. Terminal agent (Claude/Codex) mặc định có worktree riêng đặt tên theo `<việc>-<vai>`,
   và tên terminal lấy theo tên worktree đó.
3. Có đường dọn worktree an toàn — vì làm việc 1 và 2 xong thì worktree sẽ sinh ra nhiều.

## 2. Bối cảnh: vì sao code hiện tại chỉ cho một workspace

`WorkspaceManager.activeId: string | null` không chỉ là nhãn hiển thị. Nó gánh bốn việc:

| Nơi dùng | Việc |
|---|---|
| `onTerminalOpened` (manager.ts:2044) | **đích tự-nhận** terminal người dùng tự mở tay |
| `startActivePoll` / `pollActive` | workspace nào được poll trạng thái agent |
| `closeActive`, `finalClaimSweep`, `dispose` | workspace nào bị đóng / quét lần cuối / gỡ khoá |
| `WorkspaceView.isActive`, `focusTerminal` | hiển thị và chặn mở lại terminal của ws chưa mở |

Việc thứ nhất là lý do thật khiến thiết kế cũ phải độc quyền: khi bạn bấm `Ctrl+Shift+~`,
extension phải biết terminal đó thuộc về ai. Bỏ độc quyền thì phải thay bằng một quy tắc
khác — mục 3.2.

Khoá chéo cửa sổ (`Workspace.activeWindowId`) là chuyện **khác** và **không đổi**: nó ngăn
hai cửa sổ VS Code cùng resume một hội thoại. Một cửa sổ mở nhiều workspace không đụng gì
tới nó.

## 3. Phần A — nhiều workspace cùng mở

### 3.1 Thay `activeId` bằng `activeIds`

```ts
private activeIds: string[] = [];   // theo THỨ TỰ kích hoạt, mới nhất ở CUỐI
```

Mảng chứ không phải `Set`: cần thứ tự "mở gần nhất", và kích hoạt lại một workspace đang mở
phải đẩy nó lên cuối. Ba hàm nội bộ:

```ts
private laDangMo(id: string): boolean          // activeIds.includes(id)
private moGanNhat(): string | null             // activeIds.at(-1) ?? null
private wsNhan(): string | null                // mục 3.2
```

`getActiveWorkspaceId()` (public, dùng bởi `ui/commands.ts` cho phím tắt tạo terminal) đổi
tên thành `getReceivingWorkspaceId()` và trả về `wsNhan()`.

### 3.2 Quy tắc "workspace đang nhận"

Tách thành hàm thuần ở **file mới `src/workspace/receiving.ts`** để test được mà không cần
`vscode`:

```ts
/**
 * Terminal tự mở tay sẽ vào workspace nào.
 *
 * Ưu tiên workspace của terminal ĐANG FOCUS: đang gõ trong terminal của workspace B rồi mở
 * terminal mới thì gần như chắc chắn bạn muốn nó thuộc về B. Chỉ khi không focus terminal
 * nào (đang ở editor, hoặc terminal đó không thuộc workspace nào) mới rơi về workspace mở
 * gần nhất.
 */
export function chonWorkspaceNhan(
  keyTerminalDangFocus: string | null,
  wsCuaTerminal: (key: string) => string | null,
  thuTuMo: readonly string[],
): string | null {
  if (keyTerminalDangFocus !== null) {
    const ws = wsCuaTerminal(keyTerminalDangFocus);
    if (ws !== null && thuTuMo.includes(ws)) return ws;
  }
  return thuTuMo.at(-1) ?? null;
}
```

Phía manager: `keyTerminalDangFocus = this.terminals.ownsTerminal(vscode.window.activeTerminal)`.
`TerminalManager.ownsTerminal` đã trả đúng key (= id entry) nên không cần API mới.

`onTerminalOpened` đổi `this.activeId` → `this.wsNhan()`. Thông báo "Đã thêm X vào workspace
Y" kèm nút **Bỏ ra** giữ nguyên — đó là lưới an toàn khi quy tắc đoán sai.

### 3.3 `activate()` — bỏ hộp thoại

Xoá nguyên khối manager.ts:607-615 (`Lưu và đóng workspace "…" trước khi mở "…"?` và lời gọi
`closeActive()` sau nó). Luồng mới:

```
activate(id):
  ws = findWorkspace(id); nếu không có → return
  nếu laDangMo(id):  focus terminal đầu tiên đang mở của nó; return
  nếu this.activating: báo "đang mở một workspace khác"; return
  activating = true
  try:
    kiểm khoá V5 (activeWindowId ≠ sessionId) → hỏi "Vẫn mở"     ← GIỮ NGUYÊN
    … phần còn lại giữ nguyên …
    activeIds = [...activeIds.filter(x => x !== id), id]           ← thay this.activeId = id
  finally: activating = false
```

`this.activating` **giữ nguyên**: nó tuần tự hoá các lượt kích hoạt. Mở hai workspace cùng
lúc vẫn được, chỉ là lần lượt — và điều đó tránh hai lượt tranh nhau nhận cùng một terminal
đang chạy sẵn trong `noiLaiTerminalHoiSinh`.

### 3.4 Đóng workspace

- `closeActive()` → `close(workspaceId: string)`; chỉ dispose terminal của workspace đó,
  `activeIds = activeIds.filter(x => x !== workspaceId)`.
- `closeActiveConfirmed()` → `closeConfirmed(workspaceId: string)`.
- `finalClaimSweep()` → `finalClaimSweep(workspaceId: string)`; gọi từ `close(id)`.
- Lệnh `aiWorkspace.closeActiveWorkspace` **thay bằng** `aiWorkspace.closeWorkspace`
  (title `AI Workspace: Đóng workspace`). Nhận `WorkspaceItem`; gọi không có item (Command
  Palette) thì nhắm `wsNhan()`. Menu: `viewItem == aiWorkspaceActive`, group `9_close`.
- `dispose()`: lặp qua **mọi** id trong `activeIds` để gỡ khoá V5, không chỉ một.
- `deleteWorkspace`: `activeIds = activeIds.filter(x => x !== wsNow.id)` thay cho
  `if (this.activeId === wsNow.id) this.activeId = null`.

### 3.5 Poll trạng thái

`startActivePoll` bật khi `activeIds.length > 0`, tắt khi rỗng. Vòng poll (manager.ts:2042)
đang lấy đúng một workspace — đổi thành lặp qua mọi id trong `activeIds`, gộp danh sách entry
rồi chạy đúng một lượt `listRunning()` như hiện tại (không gọi CLI nhiều lần hơn).

`saveNow` (manager.ts:527) đổi `this.activeId === ws.id` → `this.activeIds.includes(ws.id)`.

`focusTerminal` (manager.ts:2026) đổi `this.activeId !== ws.id` → `!this.laDangMo(ws.id)`.

### 3.6 Hiển thị trên cây

`WorkspaceView` thêm `isReceiving: boolean`. `WorkspaceItem.description`:

| Trạng thái | description |
|---|---|
| đang mở, đang nhận | `(đang mở · nhận terminal mới) · N terminal` |
| đang mở | `(đang mở) · N terminal` |
| chưa mở | `N terminal` |

Icon giữ nguyên quy tắc cũ (`root-folder-opened` xanh khi đang mở, `folder` khi chưa).
`contextValue` giữ nguyên `aiWorkspaceActive` / `aiWorkspaceInactive`.

Lý do phải hiện "nhận terminal mới": quy tắc 3.2 là ngầm định. Không hiện ra thì người dùng
không đoán được terminal tiếp theo rơi vào đâu.

## 4. Phần B — worktree cho terminal agent

### 4.1 Phạm vi: chỉ terminal agent

`hoiWorktree` hiện chỉ được gọi từ `newClaudeTerminal` (manager.ts:1272) và
`newCodexTerminal` (manager.ts:1335). `newPlainTerminal` **không** gọi và **sẽ không** gọi:
`npm run dev`, `git log`, test runner chạy trong worktree riêng gần như luôn là sai ý.

Đây là bất biến, không phải chuyện tình cờ → thêm một khẳng định vào
`test/unit/architecture.test.ts`.

### 4.2 Tên worktree = `<việc>-<vai>`

Tên gắn với **việc** và với **vai**, ghép phẳng bằng dấu gạch. Nhóm theo việc khi sắp xếp
chữ cái (`fix-login-impl`, `fix-login-reviewer`, `fix-login-test` nằm liền nhau), không sinh
thư mục lồng, không để lại thư mục cha rỗng sau khi gỡ.

Ở spec này roles chưa tồn tại nên **vai tạm là `agentId`** (`claude` / `codex`). Khi phần C
có mặt, chỉ đúng một chỗ đổi: đối số `vai` truyền vào `hoiWorktree` lấy từ `role.name` thay
vì `agentId`. Hình dạng tên không đổi lần nào nữa.

Hàm thuần, đặt cạnh `buildAddWorktreeArgs` trong `src/git/worktree.ts`:

```ts
/**
 * Ghép tên worktree từ việc và vai. Bỏ qua bước ghép nếu người dùng đã tự gõ sẵn đuôi vai —
 * gõ `fix-login-claude` mà nhận về `fix-login-claude-claude` là kiểu bất ngờ vô nghĩa.
 */
export function ghepTenWorktree(viec: string, vai: string): string {
  const v = viec.trim();
  return v.endsWith(`-${vai}`) ? v : `${v}-${vai}`;
}
```

Không cần bộ đánh số thứ tự: mở lại **cùng việc + cùng vai** phải cho ra **cùng worktree**,
và luồng "thư mục đã tồn tại thì dùng lại" ở 4.3 đã lo đúng việc đó. Thêm hậu tố `-2` vào
đây sẽ biến thao tác mở lại thành thao tác tạo mới — sai hẳn ý.

`GitClient` thêm một hàm đọc:

```ts
listWorktrees(repoRoot: string): Promise<WorktreeInfo[]>   // git worktree list --porcelain
```

và một parser thuần trong `src/git/worktree.ts`:

```ts
export interface WorktreeInfo {
  path: string;
  branch: string | null;   // null khi detached hoặc bare
  bare: boolean;
  detached: boolean;
}
export function parseWorktreeList(stdout: string): WorktreeInfo[]
```

Định dạng `--porcelain`: các khối cách nhau bằng dòng trống, mỗi khối bắt đầu bằng
`worktree <path>`, có thể có `HEAD <sha>`, `branch refs/heads/<tên>`, `bare`, `detached`,
`locked`, `prunable`. Parser bỏ qua khoá lạ và bỏ qua khối không có `worktree`.

### 4.3 Luồng `hoiWorktree(cwd, vai)`

Ô nhập hỏi **việc**, không hỏi tên worktree:

- title: `Worktree trong repo <tên repo>`
- prompt: ``Tên việc — thư mục + nhánh sẽ là `<việc>-<vai>`. Để TRỐNG nếu làm thẳng trên thư mục vừa chọn.``
- placeHolder: `ví dụ: fix-login`
- validate: giữ nguyên bộ hiện có (`/^[\w.][\w./-]*$/`, chặn `..`), áp lên phần **việc**;
  rỗng thì hợp lệ (là lối thoát).

Rỗng → trả `{ cwd }`, không tạo worktree. Lối thoát này vẫn cần cho repo không muốn tách
nhánh, và cho terminal agent chỉ để đọc.

Có việc → `ten = ghepTenWorktree(viec, vai)`,
`duongDan = <dirname(repo)>/<basename(repo)>-worktrees/<ten>`, rồi:

| Tình huống | Xử lý |
|---|---|
| `duongDan` tồn tại và **là** worktree git hợp lệ | **dùng lại**; đọc nhánh của nó từ `listWorktrees(repo)` khớp theo path |
| `duongDan` tồn tại nhưng **không** phải worktree hợp lệ | cảnh báo như hiện tại, huỷ lệnh |
| chưa tồn tại | `addWorktree(repo, duongDan, ten)` — `buildAddWorktreeArgs` đã tự chọn `-b` hay không tuỳ nhánh đã có chưa |

`listWorktrees` lỗi ở nhánh "dùng lại" → vẫn mở terminal tại `duongDan`, chỉ là không ghi
được `entry.worktree`. Không chặn cả lệnh vì một lệnh đọc phụ hỏng.

### 4.4 Tên terminal

Tên terminal = **tên worktree** (`fix-login-reviewer`). Vì tên ghép phẳng nên nó bằng đúng
`path.basename(cwd)` mà `newClaudeTerminal`/`newCodexTerminal` đang dùng — không cần đổi
code, nhưng dùng thẳng tên trả về từ `hoiWorktree` khi có, rõ ý hơn là đi vòng qua đường dẫn.
Không có worktree → giữ `path.basename(cwd)` như cũ.

### 4.5 Ghi worktree vào entry

`src/model/schema.ts`:

```ts
export const WorktreeRefSchema = z.object({
  /** Đường dẫn tuyệt đối của worktree. Trùng với `cwd` của entry lúc tạo, nhưng cwd có thể
   *  bị đổi bởi các luồng khác nên giữ riêng — lệnh dọn cần biết chính xác cái gì phải gỡ. */
  path: z.string().min(1),
  /** Nhánh của worktree. KHÔNG ép regex: worktree dùng lại có thể mang tên nhánh do người
   *  khác đặt, mà bộ ký tự hợp lệ của git rộng hơn bộ ta cho nhập. */
  branch: z.string().min(1),
});
```

Thêm vào `TerminalEntrySchema`: `worktree: WorktreeRefSchema.optional()`.
Giữ `version: 2` và `.passthrough()` — trường mới là optional nên bản cũ đọc file mới không
hỏng, và `.passthrough()` giữ nó không bị bản cũ xoá.

`hoiWorktree` đổi kiểu trả về:

```ts
type KetQuaWorktree = { cwd: string; worktree?: { path: string; branch: string } };
// undefined vẫn nghĩa là người dùng huỷ cả lệnh
```

Trường hợp dùng lại worktree đã tồn tại (nhánh nào chưa biết): đọc nhánh từ
`listWorktrees(goc)` khớp theo `path`. Không đọc được → không ghi `worktree` vào entry;
terminal vẫn chạy bình thường, chỉ là lệnh dọn sẽ không thấy nó qua entry (vẫn thấy qua
bước liệt kê worktree ở 4.6).

### 4.6 Lệnh `aiWorkspace.cleanWorktrees` — "AI Workspace: Dọn worktree"

Menu: chuột phải workspace (`aiWorkspace(Active|Inactive)`), group `3_edit@5`.

**Bước 1 — gom ứng viên.** Lấy tập `repoRoot` phân biệt của mọi `entry.cwd` **và**
`entry.worktree?.path` trong workspace. Với mỗi repo, `listWorktrees(repoRoot)`, rồi **lọc
chỉ giữ worktree nằm trong `<dirname(repo)>/<basename(repo)>-worktrees/`**.

`listWorktrees` liệt kê mọi worktree git biết, nên worktree mồ côi — cái mà entry trỏ vào nó
đã bị bỏ khỏi workspace từ trước — vẫn xuất hiện, miễn là còn ít nhất một entry nào đó trong
workspace neo được vào cùng repo. Đây là đường duy nhất dọn được rác của những lần trước.

Đây là ranh giới an toàn quan trọng nhất của lệnh này: worktree người dùng tự tạo ở chỗ khác,
worktree chính của repo, và worktree của công cụ khác đều **không bao giờ** lọt vào danh sách.
Hàm thuần `laWorktreeCuaExtension(duongDan, repoRoot): boolean` trong `src/git/worktree.ts`,
so sánh sau khi chuẩn hoá hoa/thường và dấu phân cách (Windows).

**Bước 2 — phân loại.** Hàm thuần:

```ts
export type LoaiWorktree = 'dangDung' | 'banThayDoi' | 'chuaMerge' | 'sach';
export function phanLoaiWorktree(dau: {
  dangDung: boolean;      // có terminal ĐANG MỞ trỏ vào đây (bất kỳ workspace nào)
  sachGit: boolean;       // git status --porcelain rỗng
  daMerge: boolean;       // nhánh nằm trong git branch --merged <base>
}): LoaiWorktree
```

Thứ tự ưu tiên: `dangDung` → `banThayDoi` (khi `!sachGit`) → `chuaMerge` (khi `!daMerge`)
→ `sach`.

`base` = nhánh mặc định của repo: `git symbolic-ref --short refs/remotes/origin/HEAD` (bỏ
tiền tố `origin/`); không có thì thử `main` rồi `master` bằng `branchExists`. Không xác định
được base → **coi mọi nhánh là `chuaMerge`**. Đoán bừa ở đây là xoá nhầm việc.

**Bước 3 — chọn.** `showQuickPick` với `canPickMany: true`:

| Loại | Nhãn | Tick sẵn | Chọn được |
|---|---|---|---|
| `sach` | `<tên>` — sạch, đã merge | có | có |
| `chuaMerge` | `<tên>` — CHƯA merge vào `<base>` | không | có |
| `banThayDoi` | `<tên>` — CÒN THAY ĐỔI CHƯA COMMIT | không | có |
| `dangDung` | `<tên>` — đang có terminal mở | không | **không** (`picked: false`, mô tả nói rõ lý do) |

**Bước 4 — xác nhận.** Modal liệt kê đúng đường dẫn + nhánh sắp gỡ, và câu:
`N terminal trỏ vào các worktree này cũng sẽ bị bỏ khỏi workspace.` — vì gỡ worktree xong,
`cwd` của các entry đó trỏ vào thư mục không còn tồn tại và chúng không bao giờ mở lại được.

**Bước 5 — thực hiện.**

```
git worktree remove <path>      ← KHÔNG BAO GIỜ --force
git branch -d <branch>          ← KHÔNG BAO GIỜ -D
```

Git từ chối là **lưới an toàn đang làm việc**, không phải lỗi cần vượt qua. Gom lỗi lại và
báo nguyên văn `stderr`. Xoá worktree thành công nhưng `branch -d` từ chối → vẫn tính là gỡ
worktree xong, nhánh còn lại được nêu trong báo cáo.

Với mỗi worktree gỡ thành công: gọi `removeTerminal(wsId, entryId)` cho mọi entry trỏ vào nó
(bia mộ đã có nên thao tác này bền qua khởi động lại).

**Bước 6 — báo cáo.** `Đã gỡ N worktree. M cái git từ chối:` + danh sách lý do.

### 4.7 Bổ sung `GitClient`

```ts
listWorktrees(repoRoot)                 // đọc
isClean(dir): Promise<boolean>          // git status --porcelain, stdout rỗng
mergedBranches(repoRoot, base)          // git branch --merged <base> --format=%(refname:short)
defaultBranch(repoRoot)                 // symbolic-ref → main → master → null
removeWorktree(repoRoot, path)          // git worktree remove <path>   (không --force)
deleteBranch(repoRoot, branch)          // git branch -d <branch>       (không -D)
```

`removeWorktree`/`deleteBranch` trả `{ ok: boolean; stderr: string }` thay vì ném — lệnh dọn
xử lý nhiều mục một lượt và phải báo cáo từng cái, không được dừng ở cái đầu tiên hỏng.

## 5. Định hướng cho C và D (không thi hành ở spec này)

Ghi lại để A+B không đóng cửa những gì C+D cần.

**Mô hình dữ liệu tương lai** — cả hai đều optional, `version` vẫn là 2:

```ts
Workspace  + roles?: Role[]
Role         { id, name, description, kind: 'worker' | 'orchestrator' }
TerminalEntry + roleId?: string
```

Ràng buộc: tối đa **một** terminal mang role `orchestrator` trong một workspace.

**Chống lệch giữa hai nơi chứa role** — một nguồn sự thật (`role.description` trong shard),
hai bản kết xuất:

1. `<globalStorage>/roles/<wsId>/<roleId>.md` → `claude --append-system-prompt-file`
   (đã xác minh cờ này có thật trong Claude Code CLI).
2. Khối có mốc trong `<worktree>/AGENTS.md`:
   `<!-- ai-workspace:role <tên> id=<uuid> hash=<hash> -->` … `<!-- /ai-workspace:role -->`.
   Nội dung ngoài khối được giữ nguyên. Sửa role → ghi lại mọi khối đang sống ngay.
   Hash lệch (có người sửa tay trong khối) → **hỏi**, không đè. System prompt đóng băng từ
   lúc khởi chạy nên terminal có role đổi sau đó mang nhãn `role đã đổi` + nút khởi chạy lại.
   `AGENTS.md` do ta tạo mới thì thêm vào `.git/info/exclude` (đã có `gitCommonDir()`).

**Kênh điều phối:** MCP server do extension ship, orchestrator chạy với `--mcp-config`
(Claude) / `codex mcp add` (Codex). Tool: `list_agents`, `dispatch`, `read_transcript`,
`wait`, `ask`, `reply`. Bus tin nhắn là file trong `globalStorage`, ghi nguyên tử bằng
temp+rename+fsync như store hiện có, tái dùng cổng `StoreFs`. Không dùng cổng mạng.

**Chốt an toàn:** độ sâu dispatch = 1 (worker không được giao việc tiếp); chỉ dispatch vào
terminal có agent đang chạy thật theo registry (bơm chữ vào shell trần là thực thi lệnh tuỳ
ý); mọi dispatch/reply đổ ra một Output Channel để kiểm toán.

**A và B chuẩn bị gì cho chúng:** `activeIds` cho phép orchestrator ở workspace này giám sát
trong khi bạn làm việc ở workspace khác; `entry.worktree` là địa chỉ mà `dispatch` cần để
biết worker đang ở nhánh nào; và hình dạng tên `<việc>-<vai>` đã đúng dạng cuối — khi C có
mặt, chỉ đối số `vai` đổi nguồn từ `agentId` sang `role.name`, không đổi hình dạng lần nào
nữa. Nhờ đó `fix-login-impl`, `fix-login-reviewer`, `fix-login-test` nằm liền nhau trong
`git branch`, tức nhìn một cái là thấy cả tổ đang làm gì trên cùng một việc.

## 6. Kiểm thử

**Hàm thuần (vitest, không cần `vscode`):**

| Hàm | Ca kiểm |
|---|---|
| `chonWorkspaceNhan` | focus terminal của ws đang mở → ws đó; focus terminal không thuộc ws nào → ws mở gần nhất; focus terminal của ws đã đóng → ws mở gần nhất; không mở ws nào → `null` |
| `ghepTenWorktree` | `fix-login` + `claude` → `fix-login-claude`; đã sẵn đuôi `-claude` → giữ nguyên, không ghép hai lần; khoảng trắng thừa hai đầu bị cắt |
| `parseWorktreeList` | khối thường; `bare`; `detached` (không có dòng `branch`); khoá lạ bị bỏ qua; stdout rỗng → `[]` |
| `laWorktreeCuaExtension` | trong `<repo>-worktrees/` → true; worktree chính → false; thư mục khác cùng tiền tố → false; khác hoa/thường trên Windows → true |
| `phanLoaiWorktree` | đủ 4 nhánh + thứ tự ưu tiên (`dangDung` thắng `banThayDoi`) |

**Schema/store:** entry có `worktree` đi qua `saveShard`/`loadShards` giữ nguyên; `gopShard`
giữ `worktree` của bản RAM; bản cũ không hiểu `worktree` không xoá nó (đã có `.passthrough()`,
thêm một ca khẳng định).

**Tích hợp (`test/integration/workspace-manager.test.ts`, `vscode` đã được mock sẵn):**

- kích hoạt ws A rồi ws B → **không** có `showWarningMessage` modal nào; cả hai nằm trong
  `activeIds`; terminal của A không bị dispose
- `close(A)` → terminal của A bị dispose, terminal của B còn nguyên, `activeIds === [B]`
- terminal tự mở khi đang focus terminal của A → entry rơi vào A dù B mở sau
- `deleteWorkspace(B)` khi B đang mở → `activeIds` không còn B

**Architecture test:** `newPlainTerminal` không gọi `hoiWorktree`; không có chuỗi `--force`
trong lệnh `worktree remove` và không có `-D` trong lệnh `branch` ở bất kỳ đâu trong `src/`.

**Kiểm tay** (thêm vào `docs/manual-verification.md`): mở 3 workspace cùng lúc, mỗi cái vài
terminal → không popup nào; đóng cái giữa → hai cái kia nguyên vẹn; tạo terminal Claude →
ô nhập worktree đã điền sẵn `claude-1`, Enter → terminal tên `claude-1`, `git branch` trong
đó cho thấy nhánh `claude-1`; chạy Dọn worktree → cái đang có terminal mở không chọn được,
cái còn thay đổi chưa commit không tick sẵn và nếu cố xoá thì git từ chối và báo lý do.

## 7. Ràng buộc toàn cục

- Mọi chuỗi hiển thị bằng **tiếng Việt có dấu**. Comment giải thích **vì sao**, không mô tả
  lại code.
- `StoreFileSchema` giữ `version: z.literal(2)`. Trường mới **luôn** optional; `.passthrough()`
  ở `TerminalEntrySchema` và `WorkspaceSchema` giữ nguyên.
- `noUncheckedIndexedAccess` đang bật — mọi truy cập chỉ số phải xử lý `undefined`.
- **Không thêm dependency runtime nào.**
- Lệnh git phá huỷ: chỉ `worktree remove` (không `--force`) và `branch -d` (không `-D`), và
  chỉ trên đường dẫn nằm trong `<repo>-worktrees/`.
- Không đổi hành vi khoá chéo cửa sổ (`Workspace.activeWindowId`).
- Giữ mọi test hiện có xanh. Test nào mã hoá giả định "chỉ một workspace active" thì sửa cho
  đúng thiết kế mới, không xoá.

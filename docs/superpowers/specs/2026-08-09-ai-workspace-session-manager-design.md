# AI Coding Workspace Session Manager for VS Code — Design (MVP)

- Ngày: 2026-08-09
- Nguồn: `AI_Coding_Workspace_Session_Manager_Spec.pdf` (24 mục)
- Phạm vi vòng này: MVP mục 18 + nhận diện peer. Phase 2 (Coordinator điều phối, dependency,
  notification) và Phase 3 (autonomous) có spec riêng sau.

## 1. Vấn đề

Một dự án lớn được làm bởi nhiều Claude Code session chạy song song, mỗi session một terminal,
một git worktree, một vai trò. Đóng VS Code là mất toàn bộ topology đó: phải mở lại từng terminal,
`cd` đúng chỗ, nhớ session nào làm việc gì, resume thủ công.

Sản phẩm lưu topology đó thành một manifest và dựng lại bằng một lệnh.

Định vị: *"Save your entire AI coding team and resume it later."* Không phải "extension lưu terminal".

## 2. Nền tảng đã xác minh (Claude Code 2.1.226)

Những điều dưới đây được kiểm chứng trực tiếp trên CLI đã cài, không phải giả định:

| Khả năng | Bằng chứng | Hệ quả thiết kế |
|---|---|---|
| Registry session sống | `claude agents --json` → mảng `{pid, cwd, kind, sessionId, name, status}` | Nguồn trạng thái chính thức. Không parse stdout. |
| Mirror trên đĩa | `~/.claude/sessions/<pid>.json`, có cờ `peerProtocol: 1` | Fallback đọc trực tiếp nếu cần |
| Đặt trước session ID | `claude --session-id <uuid>` | Extension **cấp** ID, không đoán. Ánh xạ terminal ↔ session là xác định. |
| Đặt tên session | `claude -n <name>` | `name` là **địa chỉ** peer |
| Resume | `claude --resume <uuid>`, `--fork-session` | Khôi phục hội thoại |
| Worktree | `claude -w <name>` | Không dùng: extension cần kiểm soát path, nên gọi `git worktree` trực tiếp |
| Chạy nền | `claude --bg`, quản qua `claude agents` | Ngoài phạm vi MVP |
| Nhắn giữa các session | Tool `ListAgents` (nội bộ `ListPeers`) + `SendMessage({to, message})` | Extension **không** tự xây messaging |
| Message đến | Bọc trong `<cross-session-message from="...">`, đến với vai trò user | |
| Inbound gate | Policy `accept`/`refuse`/`hold`/`bypass-default`/`coordinator`, TTL theo setting `dialogExpiry` (mặc định 5m) | Cách đặt policy từ ngoài: **chưa xác minh** |
| Coordinator mode | Env `CLAUDE_CODE_COORDINATOR_MODE=1`, có system prompt riêng | Bật coordinator = đặt env lúc launch |

Trích nguyên văn mô tả tool `ListAgents` trong binary:

> Lists agents you can `SendMessage` to — in-process subagents you spawned, other local Claude
> sessions on this machine, your Claude sessions running in the cloud, and Remote Control sessions
> on other machines. Names are the address: send with `SendMessage({to: "<name>", message: "..."})`.

Vì vậy mục 8 của spec gốc (`SessionMessagingProvider` tự chế) rút xuống thành: extension chỉ cần
**đặt đúng `--name`** cho từng session; phần còn lại Claude Code lo.

### Hai giới hạn thật, không né được

- **Không freeze được process.** Restore là *reconstruct* environment + resume hội thoại, không phải
  khôi phục process. Spec §22 đã nói đúng.
- **Không đọc được cwd của terminal người dùng tự mở**, trừ khi shell integration đã kích hoạt
  (`Terminal.shellIntegration.cwd`, bất đồng bộ, có thể không bao giờ có). MVP né hoàn toàn bằng
  cách chỉ quản terminal do chính extension tạo — khi đó cwd do extension đặt nên biết sẵn.

## 3. Quyết định thiết kế

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Phạm vi = MVP mục 18 + đặt `--name`/`--session-id` + đọc status từ registry | Peer discovery gần như miễn phí khi đã launch đúng cờ |
| D2 | Chỉ quản terminal do extension tạo | Định danh xác định, không đoán cwd, không nhập nhằng khi 2 session cùng thư mục |
| D3 | Worktree thiếu → hỏi rồi mới `git worktree add` | Cân bằng giữa "restore một cú bấm" và §21 |
| D4 | Manifest trong repo + index toàn cục làm cache | Commit/chia sẻ được, mà Quick Pick vẫn liệt kê từ mọi cửa sổ |
| D5 | `workspace.yaml` ghi thủ công; `state.json` tự ghi nền | Diff sạch, mà đóng máy đột ngột vẫn không mất `sessionId` |
| D6 | Terminal-driven (`createTerminal` + `sendText`) | TUI chạy trong terminal thật; trạng thái lấy từ registry nên không cần pty |
| D7 | Core không import `vscode`; Claude nằm trong adapter | Phòng thủ rủi ro §22 |

Đã cân nhắc và loại: pty-driven qua `node-pty` (được exit code + stdout, đổi lại phải tự render
ANSI/resize/scrollback và thêm native dependency — MVP không dùng tới thứ nó mua thêm);
"chỉ sinh lệnh để user tự bấm" (biến một cú bấm thành N cú bấm).

## 4. Kiến trúc

```
extension.ts
  ui/            TreeView sidebar, Quick Pick, dialog        -> vscode
  workspace/     WorkspaceManager: save / open / restore / close
  terminal/      TerminalManager: tạo & theo dõi terminal    -> vscode
  trust/         Trust store cho startupCommand              -> vscode globalState
  index/         Index workspace toàn cục                    -> fs
  agent/         AgentAdapter + ClaudeCodeAdapter            -> claude CLI
  git/           worktree: parse / validate / add            -> git CLI
  manifest/      Schema + đọc/ghi yaml & json                -> thuần TS
  events/        EventBus typed nội bộ                       -> thuần TS
```

`manifest/`, `events/`, `git/`, `agent/` **không** import `vscode` → unit test chạy bằng vitest
thường, không cần Extension Host. Đây là ranh giới quan trọng nhất của codebase.

`AgentAdapter` — giao diện tối thiểu, đủ để sau này cắm Codex/Gemini:

```ts
interface AgentAdapter {
  readonly id: string;                                  // 'claude'
  newSessionId(): string;                               // uuid v4
  buildLaunchCommand(s: SessionSpec, mode: LaunchMode): string;
  listRunning(): Promise<RunningSession[]>;             // {sessionId, name, cwd, status, pid}
  isAvailable(): Promise<boolean>;                      // claude có trong PATH?
}
type LaunchMode = { kind: 'new' } | { kind: 'resume'; sessionId: string };
```

### EventBus (mục 15, rút gọn cho MVP)

`SessionStarting`, `SessionStarted`, `SessionFailed`, `SessionExited`, `SessionStatusChanged`,
`WorktreeMissing`, `WorkspaceOpened`, `WorkspaceClosed`. Typed, đồng bộ, in-process. Không cần
message broker — spec §15 nói đúng.

## 5. Mô hình dữ liệu

`<project>/.ai-workspace/workspace.yaml` — khai báo, commit được:

```yaml
version: 1
workspace:
  name: ERP Development Team
project:
  root: .                          # tương đối so với .ai-workspace/
sessions:
  - key: coordinator               # slug ổn định, không bao giờ đổi
    name: ERP-Coordinator          # = --name, ĐỊA CHỈ peer, duy nhất trên máy
    role: coordinator              # chuỗi tự do; chỉ giá trị "coordinator" có hành vi
                                   # (đặt CLAUDE_CODE_COORDINATOR_MODE=1), còn lại chỉ để hiển thị
    worktree:
      path: ../erp-coordinator     # tương đối so với project.root
      branch: main
    terminal:
      name: Coordinator
    startupCommand: null
    agent: claude
```

`<project>/.ai-workspace/state.json` — runtime, gitignore, tự ghi nền:

```json
{
  "version": 1,
  "sessions": {
    "coordinator": {
      "sessionId": "639a2ba8-e4f0-4e0b-917c-6ab773c8a922",
      "pid": 12028,
      "lastStatus": "idle",
      "lastActiveAt": 1786254024591
    }
  }
}
```

Index toàn cục — `globalStorageUri/index.json`, thuần cache:

```json
{ "workspaces": [ { "name": "ERP Development Team",
                    "manifestPath": "D:\\Coding\\erp\\.ai-workspace\\workspace.yaml",
                    "lastOpenedAt": 1786254024591 } ] }
```

Ba chi tiết có chủ ý:

- **`key` tách khỏi `name`.** `name` là địa chỉ peer nên phải duy nhất trên toàn máy; nếu đụng, adapter
  thêm hậu tố lúc launch. `key` chỉ cần duy nhất trong một workspace và không đổi, nên `state.json`
  gắn vào `key`.
- **`worktree.path` tương đối.** Absolute path (như §5.1 spec gốc) vỡ ngay khi đổi máy hoặc clone lại.
- **Index là cache.** Mất thì dựng lại được bằng cách quét lại các đường dẫn đã biết; không bao giờ là
  nguồn sự thật.

## 6. Luồng

### Save Workspace
Đọc các session đang được quản → ghi `workspace.yaml` (chỉ phần khai báo) → cập nhật index.
`state.json` không chờ lệnh này; nó được ghi nền mỗi khi session sinh ra hoặc đổi trạng thái.

### Open / Restore Workspace

1. Đọc + validate manifest. Sai schema → dừng, chỉ đúng dòng sai.
2. Giải `project.root`, xác nhận là git repo. Không phải repo → bỏ phần worktree, mọi session chạy ở
   project root, cảnh báo một lần.
3. Validate worktree từng session, gom kết quả thành một danh sách.
4. Có worktree thiếu → **một** dialog liệt kê tất cả kèm đúng lệnh `git worktree add` sẽ chạy → xác
   nhận → tạo. Từ chối thì các session còn lại vẫn restore.
5. Trust check: manifest chưa từng được tin mà có `startupCommand` → hiện toàn văn lệnh → xác nhận →
   ghi nhớ theo đường dẫn manifest.
6. Với mỗi session hợp lệ, theo thứ tự manifest: `createTerminal({cwd, name, env})`
   (thêm `CLAUDE_CODE_COORDINATOR_MODE=1` nếu `role: coordinator`) → `sendText(startupCommand)` nếu
   có → `sendText(<dòng launch của adapter>)`.
7. Poll `claude agents --json` tối đa ~20s, đối chiếu bằng `sessionId` extension đã cấp, đánh dấu từng
   session started / failed.
8. Báo cáo: dựng được X/Y session, cái nào hỏng và vì sao.

**Cách ly lỗi:** một session hỏng không bao giờ chặn session khác. Yêu cầu "báo session nào thành
công hoặc thất bại" (§4) là hệ quả của thiết kế này.

### Close Workspace
Ghi `state.json` lần cuối → đóng các terminal do extension tạo → xoá trạng thái in-memory. Không giết
process nào ngoài terminal của chính nó.

## 7. Xử lý sự cố

| Tình huống | Hành động | Không bao giờ |
|---|---|---|
| Worktree thiếu | Hỏi → `git worktree add <path> <branch>` | tạo ngầm |
| Branch khác manifest | Cảnh báo, vẫn chạy ở worktree đó | `git checkout` đè branch đang làm |
| Worktree dirty | Chỉ hiển thị | `reset --hard`, `clean`, `stash` |
| Đang có conflict dở | Cảnh báo rõ, vẫn chạy | tự merge / rebase / abort |
| `--resume <uuid>` thất bại | Mở session mới, đánh dấu "hội thoại mới", giữ uuid cũ trong state | xoá lịch sử cũ |
| Trùng `name` trên máy | Thêm hậu tố, cảnh báo | im lặng ghi đè địa chỉ peer |
| Không có `claude` trong PATH | Lỗi kèm hướng dẫn; terminal vẫn mở đúng cwd | |
| Người dùng đóng terminal | Đánh dấu offline trong sidebar | tự mở lại |
| Manifest sai schema | Dừng, chỉ đúng dòng | tự "sửa" rồi ghi đè |

Đây là mục 21 spec — *Never destroy developer state* — viết thành hành vi cụ thể.

### Bảo mật: startup command

`startupCommand` là lệnh của người dùng chạy trên máy người dùng. Vì `workspace.yaml` commit được và
chia sẻ được, mở workspace của người khác nghĩa là chạy lệnh của người khác. Xử lý: lần đầu mở một
manifest chưa được tin, hiện toàn văn mọi lệnh sẽ chạy, xác nhận rồi ghi nhớ theo đường dẫn manifest.
Manifest đổi nội dung `startupCommand` → hỏi lại.

## 8. UI

**Sidebar** — TreeView `AI Workspace`, root là tên workspace, con là session:

```
ERP Development Team
  ● Coordinator     main               busy
  ● Backend         feature/order-api  idle
  ○ Frontend        feature/order-ui   offline
  ⚠ QC              feature/qc         worktree missing
```

Icon theo `status` từ registry (`busy` / `idle` / `blocked`) cộng hai trạng thái do extension suy ra
(`offline` khi không thấy trong registry, `error`). Poll 3s **chỉ khi view đang hiển thị**; view ẩn thì
dừng poll.

**Commands MVP:**

- `AI Workspace: New Workspace`
- `AI Workspace: Save Workspace`
- `AI Workspace: Open Workspace` (Quick Pick từ index — trải nghiệm mục 13)
- `AI Workspace: Close Workspace`
- `AI Workspace: Add Session` (hỏi name, role, branch/worktree, startup command)
- `AI Workspace: Remove Session` (chỉ gỡ khỏi manifest; **không** đụng worktree)
- `AI Workspace: Open Session Terminal` (focus terminal của session)
- `AI Workspace: Restore Session` (dựng lại một session đơn lẻ)

Hoãn sang Phase 2: `Save As`, `Create Worktree` đứng riêng, `Send Message`, `Set Coordinator`
(MVP đặt role lúc Add Session).

## 9. Stack & test

TypeScript, esbuild bundle, `zod` cho schema, `yaml` cho manifest. Không native dependency.

| Tầng | Công cụ | Phủ cái gì |
|---|---|---|
| Unit (TDD) | vitest | Round-trip manifest, phân giải path tương đối, parse `claude agents --json`, parse `git worktree list --porcelain`, dựng dòng lệnh launch, xử lý trùng tên, index rebuild |
| Integration | vitest + git thật trên repo tạm | `git worktree add`/validate — không mock git |
| Extension | `@vscode/test-electron` | Đăng ký command, tạo terminal đúng cwd/env, TreeView render |
| Thủ công | Checklist | Hành vi TUI Claude Code, resume thật, peer thấy nhau |

Bốn module không phụ thuộc `vscode` là nơi đặt phần lớn logic, nên phần lớn test chạy nhanh và không
cần Extension Host. Test integration git dùng git thật vì đúng thứ dễ sai nằm ở hành vi thật của git.

## 10. Cần spike trước khi code

Ba câu hỏi chưa có câu trả lời chắc chắn, plan phải mở đầu bằng việc chốt chúng:

1. `--resume <uuid>` có nhận kèm `-n <name>` không, hay resume thì tên lấy từ session cũ? Ảnh hưởng
   trực tiếp tới địa chỉ peer sau khi restore.
2. Quoting `sendText` trên PowerShell khi `name` có dấu cách hoặc tiếng Việt.
3. Đặt inbound policy (`accept`/`hold`/`refuse`) cho một session từ bên ngoài — có làm được không.
   Nếu không, phần peer của MVP dừng ở "các session nhận diện đúng tên của nhau", đúng như phạm vi
   đã chốt.

## 11. Ngoài phạm vi

Coordinator điều phối thật sự, dependency giữa session (§14), notification, status Waiting/Blocked do
extension suy luận (§11), inter-session messaging do extension khởi xướng (§8), autonomous workspace
(§20), adapter cho Codex/Gemini (chỉ để sẵn interface, không hiện thực).

## 12. Định nghĩa hoàn thành

11 mục của §18 chạy được: tạo, lưu, mở workspace; biết cwd; biết worktree; lưu branch; lưu startup
command; lưu Claude session ID; dựng lại terminal; resume Claude session; sidebar hiện session. Cộng
thêm: mỗi session mang đúng `--name` của nó nên các session thấy và nhắn được cho nhau bằng cơ chế
sẵn có của Claude Code.

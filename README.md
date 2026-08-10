# AI Workspace Session Manager

Extension VS Code lưu và khôi phục một workspace gồm nhiều session Claude Code chạy song song —
mỗi session là một cặp (terminal + git worktree riêng + branch riêng + session ID Claude Code +
vai trò). Thay vì mở tay từng terminal, `cd` vào từng worktree, và nhớ session nào đang làm gì,
bạn định nghĩa workspace một lần trong `.ai-workspace/workspace.yaml`; extension dựng lại toàn bộ
— terminal, thư mục làm việc, và việc resume đúng cuộc hội thoại Claude Code trước đó — chỉ bằng
một lệnh mở workspace. Các session trong cùng workspace nhận diện lẫn nhau bằng đúng cái tên khai
báo trong manifest, nên nhắn tin chéo session (peer messaging) trong Claude Code hoạt động ngay mà
không cần tự đặt tên lại.

## Yêu cầu

- VS Code ≥ 1.90
- `git` có sẵn trong PATH
- Claude Code ≥ 2.1 (lệnh `claude` có sẵn trong PATH)

## Các lệnh

| Lệnh | Command ID |
|---|---|
| AI Workspace: New Workspace | `aiWorkspace.newWorkspace` |
| AI Workspace: Save Workspace | `aiWorkspace.saveWorkspace` |
| AI Workspace: Open Workspace | `aiWorkspace.openWorkspace` |
| AI Workspace: Close Workspace | `aiWorkspace.closeWorkspace` |
| AI Workspace: Add Session | `aiWorkspace.addSession` |
| AI Workspace: Remove Session | `aiWorkspace.removeSession` |
| AI Workspace: Open Session Terminal | `aiWorkspace.openSessionTerminal` |
| AI Workspace: Restore Session | `aiWorkspace.restoreSession` |

Sidebar "AI Workspace" (trong Explorer) liệt kê các session của workspace đang mở, kèm branch và
trạng thái (đang chạy / rảnh / đang chờ / chưa chạy / lỗi), tự cập nhật mỗi vài giây khi view đang
hiển thị. Bấm vào một session trong sidebar sẽ mở/focus terminal của session đó.

## `workspace.yaml` — ví dụ đầy đủ

Manifest sống ở `.ai-workspace/workspace.yaml` trong gốc dự án. `.ai-workspace/.gitignore` được
tự sinh cùng lúc để loại `state.json` (trạng thái chạy) khỏi git — chỉ `workspace.yaml` được commit.

```yaml
version: 1
workspace:
  name: myproj
project:
  root: .
sessions:
  - key: backend
    name: myproj-backend
    role: coordinator
    worktree:
      path: ../myproj-backend
      branch: feature/backend
    terminal:
      name: myproj-backend
    startupCommand: npm install
    agent: claude
  - key: qc
    name: myproj-qc
    role: developer
    worktree: null
    terminal:
      name: myproj-qc
    startupCommand: null
    agent: claude
```

Ghi chú schema:
- `key`: slug duy nhất trong workspace (chữ thường, số, gạch ngang), dùng nội bộ để định danh
  session.
- `name`: tên hiển thị và cũng là địa chỉ mà các session khác dùng để nhắn tới session này.
- `role`: chuỗi tự do; giá trị `coordinator` được extension nhận diện đặc biệt — session đó khởi
  động với biến môi trường `CLAUDE_CODE_COORDINATOR_MODE=1`.
- `worktree`: `null` nếu session chạy thẳng ở thư mục gốc dự án; nếu có, `path` là đường dẫn tương
  đối so với `project.root` (dùng dấu `/`), `branch` là branch git.
- `terminal.name`: tên terminal VS Code sẽ tạo.
- `startupCommand`: lệnh chạy trong terminal trước khi khởi động Claude Code; `null` nếu không cần.
- `agent`: hiện chỉ có giá trị `claude`.

## Nguyên tắc an toàn

Extension thao tác Git theo nguyên tắc **chỉ thêm, không bao giờ sửa hay xoá** trạng thái sẵn có
của bạn. Cụ thể, extension sẽ không bao giờ:

- Chạy `git reset`, `git clean`, `git checkout` (trên file), `git stash`, `git rebase`,
  `git merge`, `git worktree remove`, `git branch -d`, hay `git push --force`
- Đổi branch hiện tại của bạn
- Tạo một git worktree mà không hỏi trước
- Chạy một startup command mà bạn chưa xác nhận tin tưởng (trust)

Khi phát hiện worktree bị thiếu, extension gom tất cả worktree thiếu lại và hỏi MỘT LẦN trước khi
chạy `git worktree add`. Khi phát hiện branch thực tế của một worktree khác với branch khai báo
trong manifest, extension chỉ cảnh báo — không tự đổi branch. Việc tin tưởng startup command được
nhớ theo vân tay (hash) nội dung lệnh của từng manifest; thêm hoặc sửa startup command sẽ khiến
lần mở kế tiếp phải hỏi trust lại.

## Giới hạn đã biết (không phải lỗi — đây là ranh giới thật của bản MVP)

- Extension chỉ quản lý được các terminal do chính nó tạo ra. Một terminal bạn tự mở tay không thể
  "nhận nuôi" vào một workspace ở phiên bản này.
- Tên của một session được đặt khi khởi động (launch) và không thể đổi trong lúc session đang
  chạy.
- Chính sách nhận tin nhắn chéo session (chấp nhận / giữ lại / từ chối) không thể cấu hình từ bên
  ngoài Claude Code, nên extension không cố can thiệp vào việc đó.
- `state.json` là dữ liệu dùng-một-lần, có thể xoá bất cứ lúc nào: xoá nó nghĩa là lần mở workspace
  kế tiếp sẽ khởi động session mới thay vì resume lại cuộc hội thoại cũ.

## Phát triển

```bash
npm install
npm test              # 134 unit/integration test (vitest)
npm run test:vscode   # 5 smoke test chạy trong Extension Host thật
npm run build         # bundle bằng esbuild ra dist/extension.js
```

Nhấn F5 trong VS Code để mở một cửa sổ Extension Host với extension đang chạy ở chế độ debug —
dùng cửa sổ đó để chạy checklist kiểm thử tay ở `docs/manual-verification.md`.

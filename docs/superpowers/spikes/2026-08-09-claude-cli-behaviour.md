# Spike: hành vi thật của Claude Code CLI (2026-08-09)

Môi trường: Windows 11, PowerShell 7 (pwsh), Claude Code 2.1.226. Thư mục scratch:
`$env:TEMP\wss-spike` (git repo trống, dọn sau khi xong).

## Bước 1: `--resume` có nhận kèm `-n <name>` không

Lệnh chạy (rút gọn, uuid thật thay cho biến):

```powershell
mkdir $env:TEMP\wss-spike; cd $env:TEMP\wss-spike; git init
$id = [guid]::NewGuid().ToString()   # 2c94d6a9-0901-4ce9-bc7b-e021dfcd0fd7
claude --session-id $id -p "tra loi dung chu: OK"
claude agents --json | ConvertFrom-Json | Where-Object { $_.sessionId -eq $id }
claude --resume $id -n "spike-renamed" -p "tra loi dung chu: OK2"
claude agents --json | ConvertFrom-Json | Where-Object { $_.sessionId -eq $id }
```

Output thật:

```
GENERATED_ID=2c94d6a9-0901-4ce9-bc7b-e021dfcd0fd7
OK

EXIT1=0
```

Truy vấn registry ngay sau lệnh `-p` đầu tiên: **không có dòng nào** khớp
`sessionId -eq $id` (không có output). Toàn bộ `claude agents --json` dump lúc đó chỉ liệt kê các
session `interactive`/`background` đang sống trên máy (pid/id khác), không có session vừa tạo.

Chạy resume kèm `-n`:

```
claude --resume $id -n "spike-renamed" -p "tra loi dung chu: OK2"
```

```
OK2

EXIT2=0
```

Lệnh chạy được, không báo lỗi cú pháp, exit code 0. Sau lệnh này, `claude agents --json` lọc theo
`sessionId -eq $id` **vẫn không có output** — vì session `-p` (print mode) không phải tiến trình
sống, nên nó không có mặt trong registry `claude agents --json` dù ngay trước hay ngay sau khi
resume.

Để xác minh việc đổi tên có thực sự xảy ra hay không, đọc trực tiếp file mirror của session
(`~/.claude/projects/<slug>/<uuid>.jsonl`):

```
grep '"agent-name"\|"custom-title"' 2c94d6a9-0901-4ce9-bc7b-e021dfcd0fd7.jsonl
```

```
{"type":"custom-title","customTitle":"spike-renamed","sessionId":"2c94d6a9-0901-4ce9-bc7b-e021dfcd0fd7"}
{"type":"agent-name","agentName":"spike-renamed","sessionId":"2c94d6a9-0901-4ce9-bc7b-e021dfcd0fd7"}
```

**Kết luận:** `claude --resume <uuid> -n <name>` chạy được không báo lỗi và ghi đè tên (`agent-name`/
`custom-title` = "spike-renamed") vào file mirror của session; tuy nhiên `claude agents --json`
không phản ánh việc này vì session chạy ở chế độ `-p` (print, không phải tiến trình sống) nên
không bao giờ xuất hiện trong registry live cả trước lẫn sau khi resume — registry chỉ theo dõi
tiến trình `interactive`/`background` đang chạy, không theo dõi lịch sử session đã thoát.

## Bước 2: `--resume` một uuid không tồn tại

Lệnh:

```powershell
claude --resume 00000000-0000-4000-8000-000000000000 -p "hi"
echo "exit=$LASTEXITCODE"
```

Output thật:

```
No conversation found with session ID: 00000000-0000-4000-8000-000000000000

exit=1
```

**Kết luận:** resume một session ID không tồn tại thất bại với exit code `1` và thông báo lỗi rõ
ràng `No conversation found with session ID: <uuid>` in ra stderr — tín hiệu này khác hẳn với
trường hợp "claude không có trong PATH" (lỗi đó là lỗi shell/OS khi spawn tiến trình, không phải
lỗi ứng dụng, và sẽ không có chuỗi "No conversation found").

## Bước 3: Quoting trên PowerShell với tên có dấu + khoảng trắng

Lệnh:

```powershell
claude --session-id ([guid]::NewGuid().ToString()) -n 'Tên có dấu và khoảng trắng' -p "ok"
claude agents --json | ConvertFrom-Json | Select-Object name
```

uuid thật sinh ra: `e537ad38-8d66-4e6e-8967-2ebf7f1e0d59`, exit code `0`.

Vì đây cũng là session `-p` (đã thoát), `claude agents --json` tại thời điểm kiểm tra không chứa
session này (chỉ có các session interactive/background khác đang sống — nội dung `name` của các
session đó, ví dụ `"xong chưa?"`, đã chứng minh JSON registry lưu và trả tiếng Việt có dấu đúng
UTF-8 khi encode qua `ConvertTo-Json`). Để xác minh riêng tên vừa đặt có bị quoting PowerShell làm
hỏng hay không, đọc trực tiếp file mirror của session:

```
grep '"agent-name"\|"custom-title"' e537ad38-8d66-4e6e-8967-2ebf7f1e0d59.jsonl
```

```
{"type":"custom-title","customTitle":"Tên có dấu và khoảng trắng","sessionId":"e537ad38-8d66-4e6e-8967-2ebf7f1e0d59"}
{"type":"agent-name","agentName":"Tên có dấu và khoảng trắng","sessionId":"e537ad38-8d66-4e6e-8967-2ebf7f1e0d59"}
```

**Kết luận:** nháy đơn (`'...'`) trong PowerShell 7 giữ nguyên chuỗi tiếng Việt có dấu và khoảng
trắng nguyên vẹn — "Tên có dấu và khoảng trắng" được truyền tới `claude` và lưu lại đúng byte-for-
byte trong file mirror của session, không bị PowerShell tách thành nhiều token hay làm hỏng dấu.

## Bước 4: Đặt inbound policy (accept/hold/refuse) từ bên ngoài

Lệnh:

```powershell
claude --help | Select-String -Pattern 'peer|inbound|policy|coordinator'
Get-ChildItem "$env:USERPROFILE\.claude\settings.json" | Get-Content
```

Output thật (grep trên `--help`, lấy thêm ngữ cảnh 3 dòng trước/1 dòng sau để xác định đây là flag
gì):

```
                                          output styles, workflows, custom themes,
                                          keybindings, and more) disabled — useful
                                          for troubleshooting a broken
>                                         configuration. Admin-managed (policy)
                                          settings still apply. Auth, model
```

Đây là đoạn mô tả của một flag troubleshooting cấu hình chung (kiểu `--strict-mcp-config` /
tắt cấu hình tuỳ biến), cụm "(policy)" ở đây nói về admin-managed settings nói chung — không liên
quan gì tới inbound message policy giữa các session. Không có flag nào khác chứa `peer`, `inbound`,
hay `coordinator` trong toàn bộ `claude --help`.

`~/.claude/settings.json` tồn tại và đọc được. **Nội dung thật chứa API key/token bí mật (MCP
server credentials) nên không dán nguyên văn vào tài liệu này** (tài liệu sẽ được commit vào git).
Các top-level key có trong file: `env`, `permissions`, `model`, `skillOverrides`, `hooks`,
`enabledPlugins`, `extraKnownMarketplaces`, `language`, `effortLevel`, `autoUpdatesChannel`, `tui`,
`voice`, `channelsEnabled`, `skipDangerousModePermissionPrompt`, `theme`, `agentPushNotifEnabled`,
`skipAutoPermissionPrompt`, `voiceEnabled`, `mcpServers`. **Không có key nào tên
`peer`/`inbound`/`policy`/`coordinator`/`accept`/`hold`/`refuse`** ở bất kỳ cấp nào của object.

**Kết luận:** không đặt được `accept|hold|refuse` từ ngoài — không có cờ CLI, không có khoá trong
`settings.json`; MVP dừng ở việc đặt đúng `--name` cho mỗi session để các session định danh đúng
nhau, đúng như phạm vi đã chốt ở spec.

## Ảnh hưởng tới plan

Một điểm không nằm trong giả định gốc của spec (§10 mục 1) cần task sau lưu ý:

- **Task 9 / Task 13** (khôi phục session, resume, đọc trạng thái từ `claude agents --json`): giả
  định ngầm là có thể verify `--name` đã áp dụng bằng cách đọc registry live ngay sau lệnh
  `--resume ... -n ...`. Thực tế **registry live (`claude agents --json`) chỉ phản ánh tiến trình
  đang chạy** (`interactive`/`background`); một lệnh `claude -p` (mà extension dùng để gửi tin nhắn
  một lần hoặc để rename) thoát ngay sau khi trả lời nên không bao giờ xuất hiện trong registry đó
  — kể cả ngay trước lẫn ngay sau khi chạy. Muốn xác nhận việc đổi tên đã áp dụng cho một session
  đã thoát, phải đọc file mirror `~/.claude/projects/<slug>/<uuid>.jsonl` (event `agent-name` /
  `custom-title`), không thể dựa vào `claude agents --json`. Task 9 (restore) và Task 13 (đọc trạng
  thái) cần cập nhật để: (a) chỉ tin tưởng `claude agents --json` cho session đang chạy thật sự
  (terminal `interactive` mà extension vừa mở, không phải các lệnh `-p` một lần), và (b) nếu cần
  xác minh rename qua `-p`, đọc file `.jsonl` mirror thay vì registry.

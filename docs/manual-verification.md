# Checklist kiểm thử tay

Một phần lớn của extension này **không thể kiểm thử tự động, kể cả về nguyên tắc**: mọi lệnh chờ
hộp thoại VS Code (`showInputBox`, `showWarningMessage`, `showQuickPick`) treo vô hạn trong
Extension Host chạy headless — `showWarningMessage()` không bao giờ tự resolve. Vì vậy
`New Workspace`, `Add Session`, hộp thoại xác nhận worktree thiếu và hộp thoại trust đều nằm
ngoài phạm vi 134 test vitest + 5 test Extension Host hiện có. Checklist này là lưới an toàn
DUY NHẤT cho các luồng đó.

Chạy trên một repo git thật, có ít nhất 1 commit, mở trong VS Code. Đánh dấu từng mục — mỗi mục
phải trả lời được "đạt/không đạt" mà không cần suy đoán.

## Chuẩn bị
- [ ] `claude --version` chạy được trong terminal tích hợp của VS Code
- [ ] `git --version` chạy được trong terminal tích hợp của VS Code
- [ ] Mở extension ở chế độ debug (F5), mở một repo git thử nghiệm ở cửa sổ Extension Host (đã mở
      sẵn một thư mục làm workspace folder — `New Workspace` yêu cầu có workspace folder đang mở)

## Vòng đời cơ bản
- [ ] `AI Workspace: New Workspace` → nhập tên → sinh ra `.ai-workspace/workspace.yaml` và
      `.ai-workspace/.gitignore`
- [ ] `.ai-workspace/.gitignore` có dòng `state.json`
- [ ] `AI Workspace: Add Session` với branch mới → session xuất hiện trong sidebar
- [ ] `AI Workspace: Save Workspace` → `workspace.yaml` chứa đúng session vừa thêm
- [ ] Đóng cửa sổ, mở lại, `AI Workspace: Open Workspace` → workspace hiện trong Quick Pick

### Hộp thoại (không có kiểm thử tự động nào phủ được các mục này)
- [ ] `AI Workspace: New Workspace` mở hộp nhập tên, giá trị mặc định sẵn điền là tên thư mục
      đang mở; nhấn Esc để huỷ giữa chừng → không sinh ra `.ai-workspace/` hay bất kỳ file nào
- [ ] `AI Workspace: Add Session` hỏi lần lượt đúng 6 bước theo thứ tự: khoá (key) → tên (name) →
      vai trò (role) → branch → đường dẫn worktree (chỉ hỏi nếu branch không để trống) → startup
      command
- [ ] Nhập khoá không phải slug (ví dụ có khoảng trắng, chữ hoa, hoặc bắt đầu bằng dấu gạch
      ngang) → hộp thoại báo lỗi validate ngay, không cho qua bước tiếp theo
- [ ] Nhấn Esc ở BẤT KỲ bước nào trong 6 bước trên (thử riêng từng bước, không chỉ bước đầu) →
      lệnh dừng ngay lập tức, `workspace.yaml` không có session mới nào được thêm vào
- [ ] Khi có nhiều worktree bị thiếu cùng lúc (ví dụ xoá tay 2 thư mục worktree rồi restore),
      hộp thoại xác nhận chỉ hiện ĐÚNG MỘT LẦN, liệt kê đủ toàn bộ các worktree thiếu — không phải
      một hộp thoại riêng cho từng worktree
- [ ] Hộp thoại trust hiển thị đầy đủ, nguyên văn nội dung của TỪNG startup command trong manifest
      trước khi bất kỳ lệnh nào được chạy (kiểm bằng cách đặt một startup command dài/đặc biệt và
      đọc lại nguyên văn trong hộp thoại)

## Restore
- [ ] Restore tạo đúng số terminal, mỗi terminal đúng tên
- [ ] `pwd` (hoặc `Get-Location`) trong mỗi terminal ra đúng worktree
- [ ] Claude Code khởi động trong từng terminal
- [ ] `claude agents --json` ở terminal khác cho thấy đúng `name` đã đặt trong manifest
- [ ] Sidebar chuyển session sang trạng thái "rảnh"/"đang chạy" trong vòng ~3 giây

### Vòng đời terminal
- [ ] `AI Workspace: Restore Session` trên một session đã có terminal sống → extension TỪ CHỐI
      dựng lại, hiện cảnh báo bảo đóng terminal trước, rồi focus vào terminal đang chạy đó. Không
      có terminal thứ hai nào được tạo ra
- [ ] Đóng terminal đó rồi chạy lại `AI Workspace: Restore Session` → lần này dựng lại bình thường,
      và sidebar/`vscode.window.terminals` chỉ có MỘT terminal cho session đó
- [ ] Đóng một terminal bằng tay (bấm dấu X hoặc gõ `exit`) → đúng session đó chuyển sang trạng
      thái "chưa chạy"/offline trong sidebar trong vòng vài giây
- [ ] Khi đóng terminal ở trên, KHÔNG có session nào khác trong sidebar bị đổi trạng thái

## Polling
- [ ] Ẩn view AI Workspace (thu gọn Explorer hoặc chuyển sang view container khác, ví dụ Search)
      → mở Task Manager (hoặc công cụ theo dõi tiến trình tương đương) và xác nhận `claude agents
      --json` không còn bị gọi lặp lại (theo dõi CPU của tiến trình `claude`/`node`, hoặc dùng
      Process Monitor lọc theo tên lệnh)
- [ ] Hiện lại view AI Workspace → xác nhận việc gọi `claude agents --json` lặp lại (polling) chạy
      trở lại

## Peer
- [ ] Sau khi restore, trong một session hỏi Claude liệt kê các agent nhắn được → các session khác
      của workspace xuất hiện dưới đúng tên đã ghi trong `workspace.yaml` (trường `name` của từng
      session), KHÔNG phải tên tự sinh của Claude Code
- [ ] Nhắn từ session A sang session B → B nhận được tin nhắn và nhận diện đúng nguồn là session A
- [ ] Session có `role: coordinator` khởi động ở chế độ coordinator (kiểm bằng
      `echo $env:CLAUDE_CODE_COORDINATOR_MODE`, phải ra `1`)

## Resume
- [ ] Trò chuyện vài lượt trong một session, đóng workspace, mở lại → lịch sử hội thoại còn nguyên
- [ ] Xoá thủ công file jsonl của session đó rồi restore → session đó bị báo là THẤT BẠI với lý do
      rõ ràng (không lên được registry của Claude Code sau khi chờ). Bản MVP KHÔNG có cơ chế tự
      chuyển sang hội thoại mới khi `--resume` hỏng — đó là việc của Phase 2. Kiểm thêm hai điều:
      `workspace.yaml` không bị đụng tới, và `state.json` vẫn giữ nguyên `sessionId` cũ của session
      đó (không bị đổi sang uuid khác)

## An toàn
- [ ] Xoá thủ công một thư mục worktree → restore hỏi trước khi tạo lại, liệt kê đúng đường dẫn
- [ ] Từ chối hộp thoại → các session còn lại vẫn restore bình thường
- [ ] Sửa branch của một worktree sang branch khác → restore chỉ cảnh báo, KHÔNG đổi branch
- [ ] Tạo thay đổi chưa commit trong worktree → restore không làm mất thay đổi đó
- [ ] Thêm `startupCommand` mới vào manifest → lần mở kế tiếp phải hỏi trust lại
- [ ] `AI Workspace: Remove Session` → thư mục worktree vẫn còn nguyên trên đĩa

## Trường hợp biên
- [ ] Đặt tên session trùng với một session Claude đang chạy ngoài workspace → có cảnh báo, tên
      được thêm hậu tố
- [ ] Đổi tên `claude` khỏi PATH → restore báo lỗi rõ ràng, không tạo terminal
- [ ] Mở workspace trên thư mục không phải git repo → cảnh báo một lần, session chạy ở thư mục gốc

## Kết quả lần chạy

<!-- Điền ngày chạy, người chạy, và kết quả từng mục (đạt/không đạt/ghi chú) tại đây. -->

# Changelog

Mọi thay đổi đáng kể của **AI Workspaces** được ghi ở đây.
Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).

## [0.2.1] — 2026-10-26

### Sửa

- **"Đóng phiên đó rồi mở lại ở đây" không còn để lại terminal rỗng.** `taskkill /T` đi
  *xuống* nên nó kết thúc claude mà để lại cái vỏ shell đã sinh ra claude. Đo trên máy thật
  cho thấy ca thường gặp không phải "terminal ở cửa sổ khác" mà là terminal nằm **ngay trong
  cửa sổ này**, chỉ là extension không nhận nuôi được nó — nên mỗi lần giành lại một hội
  thoại là lưới xem song song mọc thêm một ô rỗng. Nay phả hệ tiến trình được tra **trước**
  khi đóng, và terminal nào của cửa sổ này đang chứa tiến trình bị đóng thì được đóng theo.
  Chỉ dọn sau khi đã chắc tiến trình chết: chưa chắc mà đóng là vừa không giành được hội
  thoại vừa làm mất chỗ người dùng đang nhìn.
- **Bớt một lần quét bảng tiến trình cho mỗi hội thoại.** `taskkill /F` là đồng bộ nên tiến
  trình đã chết lúc nó trả về, vậy mà vòng chờ vẫn quét lại cả bảng chỉ để xác nhận điều đó —
  mất thêm 1,44–1,77 giây trên máy đang tải. Nay vòng chờ hỏi hệ điều hành bằng tín hiệu 0
  (đo được: nhận ra tiến trình chết ngay khi `taskkill` trả về), và chỉ quét bảng khi hết hạn
  mà pid vẫn sống — đúng lúc cần phân biệt "claude chưa chết" với "pid đã được cấp cho chương
  trình khác". Các lệnh đóng chạy song song thay vì lần lượt (mỗi `taskkill` mất ~0,6 giây),
  và một lần quét giờ lấy cả phả hệ lẫn dòng lệnh thay vì quét hai lượt. Ước tính ~4,5 giây
  xuống dưới 3 giây cho một hội thoại; chưa đo đầu-cuối trên phiên thật.
- **Nhật ký.** Luồng giành lại phiên ghi vào kênh Output *AI Workspace — Điều phối* (và file
  kiểm toán của workspace): pid nào bị đóng, bao nhiêu terminal vỏ được dọn, hết bao lâu.

## [0.2.0] — 2026-10-26

### Thêm

- **Giành lại hội thoại đang chạy ở nơi khác.** Khi hội thoại Claude của một terminal đang bị
  một tiến trình ở **cửa sổ VS Code khác** (hoặc ngoài VS Code) giữ, cửa sổ này không nhận
  nuôi được nó — trước đây chỉ còn cách bỏ qua hoặc mở phiên thứ hai (xé đôi lịch sử). Nay
  hộp thoại có thêm **"Đóng phiên đó rồi mở lại ở đây"**: đóng mọi tiến trình đang bám hội
  thoại ấy rồi mới `--resume` ở workspace hiện tại. Lịch sử giữ nguyên (transcript ghi dần
  theo từng lượt); cái mất là việc tiến trình kia đang chạy dở.
  - Trước khi đóng, mỗi pid được soi dòng lệnh để chắc chắn nó VẪN là tiến trình claude — sổ
    phiên của claude còn hàng cũ, mà pid thì hệ điều hành cấp lại cho chương trình khác.
  - Sau khi đóng, phải xác minh tiến trình đã chết thật bằng bảng tiến trình của hệ điều hành
    thì mới mở; không xác minh được thì KHÔNG mở.

## [0.1.0] — 2026-10-25

Bản phát hành công khai đầu tiên.

### Có gì

- **Danh sách workspace toàn cục** — không gắn với một thư mục/repo nào. Một workspace giữ
  nhiều terminal trỏ tới nhiều repo khác nhau. Trạng thái tự lưu liên tục, không có nút Save.
- **Khôi phục đúng chỗ đang dở** — mở lại VS Code, bấm một workspace là các terminal mở lại
  như phiên trước, nối đúng hội thoại Claude Code (hoặc chạy lại `startCommand` đã ghi).
- **Nhận nuôi terminal** — terminal bạn tự mở được thêm vào workspace đang hoạt động.
- **Xem song song** — xếp các terminal của một workspace thành lưới trong vùng editor để nhìn
  nhiều phiên cùng lúc; terminal không thuộc lưới được đưa xuống panel (vẫn chạy).
- **Kéo thả trong cây** — đổi thứ tự workspace và terminal, kéo một terminal sang workspace khác.
- **Vai và điều phối đa agent** — worktree riêng cho từng vai, giao việc, hỏi–đáp chặn giữa
  các agent qua MCP server đi kèm.
- **Nhập liệu bằng giọng nói** vào terminal (<kbd>Ctrl+Shift+Y</kbd>), chạy mô hình cục bộ
  hoặc dịch vụ đám mây.
- **Hàng rào một-hội-thoại-một-tiến-trình** — không để hai tiến trình cùng ghi một file hội
  thoại Claude; gặp phiên trùng tên và trùng thư mục thì hỏi thay vì âm thầm mở thêm.

### Yêu cầu

- VS Code ≥ 1.93 · Node ≥ 20
- Claude Code ≥ 2.1 trên PATH (chỉ cần cho terminal `kind: claude`)

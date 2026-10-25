# Changelog

Mọi thay đổi đáng kể của **AI Workspaces** được ghi ở đây.
Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).

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

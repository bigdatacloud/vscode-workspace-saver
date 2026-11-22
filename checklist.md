# Checklist công việc — AI Workspaces (extension VS Code quản lý phiên agent theo workspace)

## 1. Mới nhận

## 2. Đang làm

## 3. Chờ anh quyết

## 4. Nợ kỹ thuật / việc treo

- [ ] #002 · 22/11 · `hienTerminal` không tìm ra tab của terminal đang sống — chưa có dữ liệu, 0.2.4 chỉ thêm lối thoát "Đóng và mở lại" — nguồn: ca 26/10
- [ ] #003 · 22/11 · `öclaude`: lệnh resume bị chèn ký tự rác ở entry OpenClawServer, nghi `sendText` không chờ shell sẵn sàng (`src\workspace\activate.ts:147`) — nguồn: anh Ý
- [ ] #004 · 22/11 · Ca Extension Host `themOVaoLuoi` đỏ chập chờn theo tải máy — nguồn: 0.2.3
- [ ] #006 · 22/11 · `huong-dan-ai-workspace.html` chưa cập nhật từ 0.2.1 — nguồn: nợ cũ
- [ ] #008 · 22/11 · `package-lock.json` còn ghi version 0.2.2 (lệch package.json từ bản 0.2.3) — nguồn: rà 22/11 · chưa đụng để không lẫn vào bản vá này

## 5. Xong gần đây

- [x] #001 · 22/11 · Mỗi phiên agent mới = một cây riêng + một tên riêng (0.2.5) — nguồn: anh Ý · 693 vitest xanh, tsc sạch · CHƯA push, CHƯA gói VSIX, CHƯA publish; tên tab sau khi Claude khởi động chưa kiểm trên VS Code thật; bộ Extension Host chưa chạy trọn trên mã cuối (bị dừng vì máy cạn RAM)

- [x] #005 · 22/11 · Biến thể `-c` / `-r` trong cây vừa tạo nay có dòng phụ "cây mới — chưa có hội thoại nào để nối" (vẫn chọn được, chỉ nói trước) — nguồn: rà mã 22/11
- [x] #000 · 26/10 · 0.2.4 phân biệt "terminal còn sống" với "phiên còn sống" (vỏ trống) — commit `22da7a9`, đã publish marketplace

# Checklist công việc — AI Workspaces (extension VS Code quản lý phiên agent theo workspace)

## 1. Mới nhận

## 2. Đang làm


## 3. Chờ anh quyết

## 4. Nợ kỹ thuật / việc treo

- [-] #002 · 22/11 · `hienTerminal` không tìm ra tab của một terminal đang sống — CHẶN: chưa tái hiện lần nào từ 26/10. 0.2.4 đã ghi đủ bằng chứng khi thất bại (tab đang hiện, terminal active, bố cục) và nút "Đóng và mở lại" làm lối ra. Bước kế tiếp thuộc về lần gặp lại, không thuộc về mã — nguồn: ca 26/10

## 5. Xong gần đây

- [x] #003 · 22/11 · `öclaude` (lệnh resume bị chèn ký tự rác) — KHÔNG sửa mò đường gửi, vì chưa biết rác sinh ra trước hay sau khi rời extension. Thêm kênh Output **"AI Workspace — Phiên"** ghi nguyên văn mọi chuỗi gửi vào shell ở cả 6 đường (khôi phục resume / phiên mới / continue, lệnh agent, startCommand, tạo mới, nhân bản, lập tổ) kèm giờ ISO → lần tái hiện sau so được ngay "ta gửi gì" với "shell nhận gì" — nguồn: anh Ý
- [x] #010 · 22/11 · Toolchain dev: vitest 2→5, esbuild 0.23→0.28, mocha 10→12, test-cli 0.0.10→0.0.15, test-electron 2.4→3.1, @types/node 20→22, + `overrides` serialize-javascript. **15 lỗ hổng → 7** (1 low + 6 moderate, không còn high/critical; 7 cái còn lại trong cây lồng của test-cli, không vào gói VSIX). Lệch luật đã ghi rõ: npm cài vitest 5.1.1 (18/11, 4 ngày tuổi) vì ghim 5.0.5 làm arborist crash — nguồn: `npm audit` 22/11
- [x] #004 · 22/11 · Ca Extension Host `themOVaoLuoi` — GIẢI QUYẾT THẬT, không chỉ thêm log. Nhật ký (thu được sau khi truyền hàm ghi log vào ca test) chỉ ra: `show()` đặt `activeTerminal` = terminal mới nhưng TAB active của nhóm vẫn là cái khác → `moveToTerminalPanel` đẩy nhầm; trả nó lên lại thì terminal mới vẫn ở editor, mà bước kéo lên đòi số tab TĂNG. Nay có đường ngắn "xoay tới đúng tab của nó". Đo: ca đó xanh 5/5 lần, cả bộ EH 33 passing / 6 pending / 0 failing — nguồn: 0.2.3
- [x] #006 · 22/11 · `huong-dan-ai-workspace.html` cập nhật cho 0.2.5: phiên bản v0.2.5, tên gói, thứ tự bốn bước (hỏi tên TRƯỚC khi chọn cách chạy), luật tên bắt buộc + một tên ba chỗ + chặn trùng + gốc là cây chính + ca ngoài git, và trạng thái "phiên đã thoát · shell trống" — nguồn: nợ cũ
- [x] #008 · 22/11 · `package-lock.json` về đúng 0.2.5 (`npm install --package-lock-only --ignore-scripts`; diff đúng 2 dòng version, không dependency nào đổi) — nguồn: rà 22/11
- [x] #009 · 22/11 · `zod` 3.23 → **4.6.7**, vá GHSA-mrhx-c7xc-m3w5 (high) — dependency chạy thật duy nhất của extension. tsc sạch, 696 vitest xanh, và cả 8 file store THẬT trên máy (30 terminal) parse đúng bằng schema mới; `zod` rời khỏi danh sách `npm audit` — nguồn: `npm audit` 22/11
- [x] #001 · 22/11 · Mỗi phiên agent mới = một cây riêng + một tên riêng — 0.2.5 đã publish Marketplace (22/11), commit `2c9ff3b` + `26b7f49`. Còn chưa kiểm tay: tên tab sau khi Claude khởi động; bộ Extension Host chưa chạy trọn trên mã cuối (bị dừng vì máy cạn RAM) — nguồn: anh Ý
- [x] #005 · 22/11 · Biến thể `-c` / `-r` trong cây vừa tạo có dòng phụ "cây mới — chưa có hội thoại nào để nối" (vẫn chọn được, chỉ nói trước) — nguồn: rà mã 22/11
- [x] #000 · 26/10 · 0.2.4 phân biệt "terminal còn sống" với "phiên còn sống" (vỏ trống) — commit `22da7a9`, đã publish Marketplace

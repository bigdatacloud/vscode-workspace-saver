# Checklist công việc — AI Workspaces (extension VS Code quản lý phiên agent theo workspace)

## 1. Mới nhận

## 2. Đang làm


## 3. Chờ anh quyết

- [-] #012 · 22/11 · **Publish 0.2.6 lên Marketplace** — mã đã xong và push (`12a3ed1`), gói `D:\Codingscode-workspace-saveri-workspaces-0.2.6.vsix` đã cài trên máy, Marketplace hiện vẫn là 0.2.5. CHẶN: cổng kiểm soát của Claude Code từ chối cả `vsce publish` lẫn việc mở cửa sổ PowerShell, nên Claude không thực hiện được. Anh chạy: `! npx @vscode/vsce publish --packagePath ./ai-workspaces-0.2.6.vsix` (PAT đã lưu từ lần 0.2.5)

## 4. Nợ kỹ thuật / việc treo



## 5. Xong gần đây

- [x] #011 · 22/11 · Ca vitest `docBangTienTrinhDayDu` đỏ chập chờn mỗi lần chạy cả bộ — nguyên nhân thật: `Get-CimInstance Win32_Process` không tham số kéo hơn 40 cột của mọi tiến trình, quá hạn 15 s khi 51 worker chạy song song → hàm trả map RỖNG, và rỗng nghĩa là "không biết" nên đường đóng phiên bỏ qua. Nay truy vấn 3 cột + hạn 25 s; 701 vitest xanh cả bộ — nguồn: rà 22/11
- [x] #002 · 22/11 · `hienTerminal` không tìm ra tab của terminal đang sống — tìm được HAI nguyên nhân bằng đọc mã + đo EH, không phải chờ tái hiện: (1) so `tab.label === terminal.name` nguyên văn, mà agent ghi tiêu đề tab kèm ký hiệu trạng thái đổi liên tục → mệnh đề nhãn chết với mọi terminal agent; nay so qua `khopTenTab` (cắt ký hiệu hai bên, nhãn rỗng không khớp gì — có 4 ca test thuần); (2) terminal ở panel: `show()` không kéo nổi khi editor giữ focus → cho panel nhận focus rồi show lại. Đo: 701 vitest xanh, EH 33 passing / 6 pending / 0 failing — nguồn: ca 26/10
- [x] #003 · 22/11 · `öclaude` (lệnh resume bị chèn ký tự rác) — KHÔNG sửa mò đường gửi, vì chưa biết rác sinh ra trước hay sau khi rời extension. Thêm kênh Output **"AI Workspace — Phiên"** ghi nguyên văn mọi chuỗi gửi vào shell ở cả 6 đường (khôi phục resume / phiên mới / continue, lệnh agent, startCommand, tạo mới, nhân bản, lập tổ) kèm giờ ISO → lần tái hiện sau so được ngay "ta gửi gì" với "shell nhận gì" — nguồn: anh Ý
- [x] #010 · 22/11 · Toolchain dev + **0 lỗ hổng** (từ 15): vitest 2→**5.0.5** ghim qua `overrides` (không phải 5.1.1 mới 4 ngày — hết lệch luật 7 ngày), esbuild 0.23→0.28, mocha 10→12, test-cli 0.0.10→0.0.15, test-electron 2.4→3.1, @types/node 20→22; bảy cái trong cây LỒNG của test-cli vá bằng `overrides` ghim chính xác: serialize-javascript 7.1.4, glob 14.0.4, minimatch 11.0.8, diff 8.0.4, test-exclude 8.0.0, c8 12.0.0 (mọi bản đều >7 ngày tuổi). Đo: `npm audit` **found 0 vulnerabilities**, 701 vitest xanh, EH 33 passing / 0 failing — nguồn: `npm audit` 22/11
- [x] #004 · 22/11 · Ca Extension Host `themOVaoLuoi` — GIẢI QUYẾT THẬT, không chỉ thêm log. Nhật ký (thu được sau khi truyền hàm ghi log vào ca test) chỉ ra: `show()` đặt `activeTerminal` = terminal mới nhưng TAB active của nhóm vẫn là cái khác → `moveToTerminalPanel` đẩy nhầm; trả nó lên lại thì terminal mới vẫn ở editor, mà bước kéo lên đòi số tab TĂNG. Nay có đường ngắn "xoay tới đúng tab của nó". Đo: ca đó xanh 5/5 lần, cả bộ EH 33 passing / 6 pending / 0 failing — nguồn: 0.2.3
- [x] #006 · 22/11 · `huong-dan-ai-workspace.html` cập nhật cho 0.2.5: phiên bản v0.2.5, tên gói, thứ tự bốn bước (hỏi tên TRƯỚC khi chọn cách chạy), luật tên bắt buộc + một tên ba chỗ + chặn trùng + gốc là cây chính + ca ngoài git, và trạng thái "phiên đã thoát · shell trống" — nguồn: nợ cũ
- [x] #008 · 22/11 · `package-lock.json` về đúng 0.2.5 (`npm install --package-lock-only --ignore-scripts`; diff đúng 2 dòng version, không dependency nào đổi) — nguồn: rà 22/11
- [x] #009 · 22/11 · `zod` 3.23 → **4.6.7**, vá GHSA-mrhx-c7xc-m3w5 (high) — dependency chạy thật duy nhất của extension. tsc sạch, 696 vitest xanh, và cả 8 file store THẬT trên máy (30 terminal) parse đúng bằng schema mới; `zod` rời khỏi danh sách `npm audit` — nguồn: `npm audit` 22/11
- [x] #001 · 22/11 · Mỗi phiên agent mới = một cây riêng + một tên riêng — **0.2.5 đã publish Marketplace** (xác nhận bằng `vsce show`: 0.2.5 · November 22, 2026), commit `2c9ff3b` + `26b7f49`. Bộ Extension Host nay đã chạy TRỌN trên mã sau đó: 33 passing / 6 pending / 0 failing. Còn chưa kiểm tay đúng một điểm: tên tab sau khi Claude khởi động (chỉ mắt người thấy được) — nguồn: anh Ý
- [x] #005 · 22/11 · Biến thể `-c` / `-r` trong cây vừa tạo có dòng phụ "cây mới — chưa có hội thoại nào để nối" (vẫn chọn được, chỉ nói trước) — nguồn: rà mã 22/11
- [x] #000 · 26/10 · 0.2.4 phân biệt "terminal còn sống" với "phiên còn sống" (vỏ trống) — commit `22da7a9`, đã publish Marketplace

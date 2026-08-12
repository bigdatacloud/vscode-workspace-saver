# Checklist kiểm thử tay — v2

Phần lớn hành vi của v2 xoay quanh hộp thoại VS Code (`showInputBox`, `showWarningMessage`,
`showQuickPick`) và trạng thái terminal thật (đóng tay, task runner mở terminal, hai cửa sổ
cùng lúc) — những thứ Extension Host chạy headless không kiểm được: mọi hộp thoại sẽ treo vô
hạn vì không có ai bấm. 98 test vitest (pure core: schema, store, classify, match, activate
orchestrator, TrustStore) + 6 smoke test Extension Host (activation, lệnh đăng ký, view tồn
tại, TerminalManager thật) chỉ phủ được phần không cần hộp thoại. Checklist này là lưới an
toàn DUY NHẤT cho phần còn lại.

Chạy trên một repo git thật (một số mục ở "Vòng đời cơ bản" và "Terminal Claude" cần `git` và
`claude` trong PATH), mở trong VS Code. Đánh dấu từng mục — mỗi mục phải trả lời được
"đạt/không đạt" mà không cần suy đoán.

## Chuẩn bị
- [ ] `claude --version` chạy được trong terminal tích hợp của VS Code
- [ ] `git --version` chạy được trong terminal tích hợp của VS Code
- [ ] Mở extension ở chế độ debug (nhấn F5, dùng cấu hình "Chạy Extension" có sẵn trong
      `.vscode/launch.json`), mở một cửa sổ Extension Host

## Vòng đời workspace cơ bản
- [ ] `AI Workspace: Tạo workspace mới` → nhập tên → workspace mới xuất hiện trong cây VÀ được
      kích hoạt ngay (badge/mô tả "(đang active)")
- [ ] Nhấn Esc ở hộp nhập tên → không có workspace nào được tạo
- [ ] Bấm vào một workspace khác (chưa active) trong khi đang có workspace active → hiện modal
      "Lưu và đóng X trước khi mở Y?"; bấm "Lưu và đóng" → X bị đóng (terminal của X đóng hết),
      Y được kích hoạt và mở lại đúng terminal đã lưu của Y
- [ ] Lặp lại bước trên nhưng bấm Hủy/Esc ở modal → KHÔNG có gì thay đổi: X vẫn active,
      terminal của X vẫn mở nguyên, Y vẫn ở trạng thái chưa active
- [ ] `AI Workspace: Đóng workspace đang active` → mọi terminal thật của workspace đó đóng hết,
      cây không còn workspace nào active
- [ ] Đóng cửa sổ Extension Host, mở lại → cây vẫn hiện đúng danh sách workspace đã tạo (đọc
      lại từ `workspaces.json` trong global storage), KHÔNG có workspace nào tự động active

## Trường hợp biên: hủy modal giữa chừng khi tạo workspace mới (orphan)
- [ ] Đang có workspace A active → `AI Workspace: Tạo workspace mới` → nhập tên workspace B
      (không Esc) → khi modal "Lưu và đóng A trước khi mở B?" xuất hiện, bấm Hủy/Esc → xác nhận:
      workspace B (rỗng, 0 terminal, chưa từng active) **vẫn còn nằm trong cây danh sách**,
      KHÔNG bị xóa hay rollback — vì `createWorkspace` + lưu đĩa đã xảy ra TRƯỚC khi modal xuất
      hiện. Đây là hành vi đã biết (orphan workspace rỗng), không phải bug cần fix ở task này —
      chỉ cần xác nhận đúng như mô tả để không bất ngờ khi gặp trong thực tế.

## Đổi tên / Xóa workspace
- [ ] `AI Workspace: Đổi tên workspace` → tên mới hiển thị ngay trong cây
- [ ] Đổi tên trùng (không phân biệt hoa thường) với workspace khác đã có → bị từ chối, có
      cảnh báo, tên KHÔNG đổi
- [ ] `AI Workspace: Xóa workspace` trên một workspace có terminal đang mở → modal xác nhận
      "Xóa workspace X? Terminal đang mở không bị đóng." → bấm "Xóa" → workspace biến mất khỏi
      cây NHƯNG các terminal thật của nó **vẫn mở nguyên** trong `vscode.window.terminals`
      (xóa workspace không đóng terminal thật)
- [ ] Xóa một workspace đang active → sau khi xóa, không còn workspace nào active

## Adoption — terminal tự mở tay (auto)
- [ ] Có workspace active → mở terminal mới bằng <kbd>Ctrl+Shift+`</kbd> (không đặt tên qua
      task/extension khác) → terminal được **tự động thêm ngay** vào workspace active, kèm
      toast "Đã thêm "<tên>" vào workspace <X>" có nút "Bỏ ra"
- [ ] Bấm "Bỏ ra" trên toast đó → terminal biến mất khỏi cây của workspace (entry bị gỡ),
      terminal thật KHÔNG bị đóng
- [ ] Không có workspace nào active → mở terminal mới bằng Ctrl+Shift+` → KHÔNG có toast nào,
      KHÔNG terminal nào tự thêm vào đâu cả

## Adoption — terminal có tên riêng (suggest)
- [ ] Có workspace active → mở một terminal có tên riêng (ví dụ chạy một Task của VS Code có
      `"label"`, hoặc terminal do extension khác tạo có tên) → hiện toast gợi ý
      "Thêm terminal "<tên>" vào workspace <X>?" có nút "Thêm" — KHÔNG tự thêm ngay
- [ ] Bỏ qua toast gợi ý (không bấm gì) → terminal đó KHÔNG được thêm vào workspace
- [ ] Bấm "Thêm" trên toast gợi ý → terminal xuất hiện trong cây của workspace active

## Thêm terminal đang mở thủ công (menu chuột phải tab terminal)
- [ ] Chuột phải vào tab của một terminal đang mở (chưa thuộc workspace nào) → chọn
      "AI Workspace: Thêm terminal đang mở vào workspace" → nếu đang có workspace active,
      terminal được thêm thẳng vào workspace đó, có toast xác nhận
- [ ] Lặp lại khi KHÔNG có workspace nào active → lệnh hỏi QuickPick chọn workspace có sẵn
      hoặc "Tạo workspace mới…"; chọn xong, terminal được thêm vào workspace đó **nhưng
      workspace đó KHÔNG bị tự kích hoạt**
- [ ] Chạy lệnh này lần nữa trên CHÍNH terminal vừa thêm → báo "Terminal đã thuộc một
      workspace.", không thêm trùng lặp
- [ ] Cũng thử gọi lệnh từ Command Palette (không phải menu chuột phải) trên terminal đang
      focus → hoạt động tương tự (dùng `vscode.window.activeTerminal` khi không có context
      terminal truyền vào)

## Terminal thường (`plain`) — startCommand & trust
- [ ] Tạo terminal `plain` (qua adoption ở trên), chuột phải chọn "AI Workspace: Đặt lệnh
      khởi động cho terminal" → nhập một lệnh bất kỳ → lưu lại
- [ ] Đóng workspace, kích hoạt lại → hiện modal trust liệt kê ĐÚNG NGUYÊN VĂN lệnh vừa đặt,
      có nút "Tin và chạy"
- [ ] Bấm "Tin và chạy" → terminal mở đúng cwd rồi lệnh được gửi chạy trong terminal đó
- [ ] Đóng và kích hoạt lại LẦN NỮA (cùng lệnh, chưa đổi) → KHÔNG hỏi trust lại (đã nhớ theo
      vân tay), lệnh tự chạy luôn
- [ ] Đổi `startCommand` sang lệnh khác → kích hoạt lại → modal trust hiện lại (vân tay đổi)
- [ ] Ở modal trust, bấm "Chỉ mở shell" (hoặc Esc) thay vì "Tin và chạy" → terminal vẫn mở
      đúng cwd, nhưng `startCommand` KHÔNG được chạy, và trust KHÔNG được lưu (lần sau hỏi lại)
- [ ] Xóa `startCommand` (để trống ô nhập rồi lưu) → kích hoạt lại → không còn modal trust nào,
      terminal chỉ mở shell

## Terminal Claude (`kind: claude`) — resume
- [ ] `AI Workspace: Tạo terminal Claude mới` trên workspace → CHỈ hỏi một đường dẫn (validate
      tồn tại) → QuickPick 6 biến thể lệnh (duyệt bằng phím mũi tên): 2 "Phiên mới" (mint
      `--session-id`, resume đảm bảo) + `-c` / `-r` thường và kèm
      `--dangerously-skip-permissions` → terminal mở NGAY tại đường dẫn, tên = tên thư mục,
      lệnh đã chọn tự chạy
- [ ] Chọn biến thể `-c` hoặc `-r` → entry tạo dạng `plain`, và trong vài chu kỳ poll sau khi
      Claude hiện trong registry, entry tự thăng cấp `claude` + gắn đúng sessionId (phả hệ PID)
- [ ] `AI Workspace: Đổi tên terminal` trên terminal item → nhập tên mới → cây VÀ tab terminal
      cùng đổi tên; ngược lại, đổi tên bằng Rename có sẵn của VS Code trên tab → tên trong cây
      tự khớp lại trong ~3 giây (name-sync qua poll)
- [ ] Đổi tên bằng lệnh của extension trong khi một terminal KHÁC đang được focus → đúng tab
      của entry được rename (không rename nhầm tab đang focus — show() phải thắng trước
      renameWithArg)
- [ ] Tạo terminal Claude (-c/-r) trên workspace KHÔNG active → terminal vẫn mở và chạy lệnh;
      entry vẫn tự thăng cấp `claude` trong vài chu kỳ poll (matcher quét mọi terminal đang
      mở, không chỉ workspace active)
- [ ] Trò chuyện vài lượt trong terminal đó, đóng workspace, kích hoạt lại → Claude Code resume
      đúng cuộc hội thoại cũ (lịch sử còn nguyên) — kiểm bằng cách hỏi lại điều vừa nói trước
      khi đóng
- [ ] `claude agents --json` ở terminal khác cho thấy đúng tên peer (`claudeName`) đã đặt

## Bắt Claude session tự động (matching) — QuickPick ambiguity
- [ ] Có workspace active với MỘT terminal `plain` trỏ cùng cwd với một session Claude đang
      chạy NGOÀI workspace (tự mở tay bằng `claude`) → trong vòng ~3 giây, terminal đó tự thăng
      cấp thành `kind: claude`, gắn đúng sessionId, nhãn trạng thái đổi sang đang chạy/rảnh
- [ ] Tạo tình huống ambiguous: HAI terminal của workspace active cùng trỏ một cwd, và có (ít
      nhất) hai session Claude đang chạy ở cwd đó → trong vòng ~3 giây hiện QuickPick hỏi
      "Terminal nào đang chạy session "<tên/id>"?" — chọn đúng terminal cho từng session
- [ ] Bỏ qua QuickPick đó (Esc) → hỏi lại lần đó không được ghi nhận, và **không hỏi lại nữa
      trong phiên hiện tại** dù vẫn ambiguous ở chu kỳ poll kế tiếp (không spam mỗi 3 giây)
- [ ] **Matching không phụ thuộc tree**: ẩn hẳn view AI Workspaces (đóng section trong
      Explorer / chuyển sang view khác), gõ `claude` trong terminal của workspace active có
      cwd không trùng ai → sau ~3 giây entry vẫn tự thăng cấp thành `claude` (poll riêng của
      manager chạy khi có workspace active, không cần tree hiển thị)
- [ ] **Quét bắt lần cuối lúc đóng**: tạo tình huống ambiguous rồi Esc QuickPick; sau đó
      "Đóng workspace đang active" → QuickPick hỏi LẠI đúng cụm đã Esc trước khi terminal bị
      đóng; chọn xong, mở lại workspace → hội thoại Claude resume đúng
- [ ] **Gắn tay session**: terminal `plain` của workspace đang chạy `claude` mà máy không tự
      bắt (vd nhiều terminal cùng cwd) → chuột phải terminal item trong cây → "Gắn session
      Claude vào terminal" → QuickPick liệt kê session đang chạy (tên + cwd + trạng thái),
      session đã bị entry khác giữ KHÔNG xuất hiện; chọn xong entry thăng cấp `claude`, đóng/mở
      workspace resume đúng hội thoại
- [ ] Gắn tay khi không có session nào đang chạy → thông báo "Không có session Claude nào
      đang chạy (chưa bị gắn) để chọn.", không có QuickPick rỗng
- [ ] **Phân giải mơ hồ bằng phả hệ PID**: HAI terminal của workspace active cùng một cwd,
      mỗi terminal tự gõ `claude` chạy một session riêng → trong vài chu kỳ poll, CẢ HAI
      entry tự gắn đúng session của mình mà KHÔNG hiện QuickPick nào (pid session đối chiếu
      ngược lên pid shell)
- [ ] **Tự nhớ app đang chạy**: trong terminal `plain` của workspace, chạy `npm run dev`
      (hoặc lệnh sống >15 giây bất kỳ) → cây đổi mô tả có lệnh khởi động; đóng workspace, mở
      lại → terminal mở ra và (sau khi "Tin và chạy") tự chạy lại đúng lệnh đó — KHÔNG cần
      đặt tay bằng menu
- [ ] Lệnh vặt không bị nhớ nhầm: sau khi dừng dev server, chạy `git status` (kết thúc ngay)
      → lệnh khởi động vẫn là `npm run dev`, không bị `git status` chiếm chỗ
- [ ] Gõ `claude` trong terminal `plain` → KHÔNG bị bắt làm lệnh khởi động (đường resume
      riêng của Claude xử lý, không chạy lại lệnh thô)

## Vòng đời terminal thủ công
- [ ] Đóng một terminal bằng tay (bấm dấu X hoặc gõ `exit`) trong workspace active → entry đó
      chuyển sang nhãn "chưa mở" trong cây (KHÔNG biến mất khỏi workspace)
- [ ] Đóng workspace rồi kích hoạt lại workspace đó → terminal "chưa mở" ở trên được mở lại
      bình thường (đúng cwd, resume/startCommand như đã khai báo)
- [ ] `AI Workspace: Bỏ terminal khỏi workspace` trên một terminal ĐANG MỞ → entry biến mất
      khỏi cây, nhưng terminal thật KHÔNG bị đóng (vẫn còn trong `vscode.window.terminals`)

## Vị trí terminal (editor area)
- [ ] `AI Workspace: Tạo terminal mới` từ menu chuột phải workspace → hỏi một đường dẫn →
      terminal mở thành TAB trong khu editor (không phải panel dưới), entry `plain` xuất hiện
      trong cây; chạy một lệnh sống ≥15s trong đó → thành `startCommand` như terminal thường
- [ ] `AI Workspace: Tạo terminal Claude mới` → terminal Claude cũng mở thành tab trong editor
- [ ] Kích hoạt lại workspace → các terminal khôi phục đều mở thành tab trong editor area
- [ ] Đổi setting `aiWorkspace.terminalLocation` sang `panel` → tạo terminal mới → mở ở panel
      dưới như cũ (không cần reload window)
- [ ] `AI Workspace: Cài đặt workspace` → chọn "Panel dưới" cho workspace A (setting chung vẫn
      editor) → terminal mới/khôi phục của A mở ở panel; workspace B không đụng gì vẫn mở ở
      editor; mở lại QuickPick thấy dấu "hiện tại" đúng mục đã chọn; chọn "Theo setting chung"
      → A quay về theo setting chung

## Bắt session khi LỆCH cwd và khi id đã chết
- [ ] Mở terminal trong workspace, `cd` sang repo KHÁC rồi chạy `claude` ở đó → trong ~3-6
      giây entry vẫn bắt được session (nhãn đổi từ "đang mở" sang "rảnh"/"đang chạy") dù cwd
      ghi trong entry khác cwd của session
- [ ] Terminal có entry `claude` đang gắn id cũ, thoát claude rồi chạy `claude` phiên MỚI
      trong chính terminal đó → id cũ chết, entry tự gắn sang session mới (không kẹt "đang mở")
- [ ] Hai terminal cùng cwd, mỗi cái một session → vẫn gắn đúng từng cái (phả hệ PID), không
      hoán đổi cho nhau
- [ ] Terminal thường không chạy claude, trong khi máy có session claude ở thư mục khác →
      KHÔNG bị gắn nhầm session nào
- [ ] Entry claude đang giữ id hội thoại ĐÃ THOÁT (terminal còn mở, không chạy claude), đồng
      thời có claude khác chạy ở CÙNG cwd đó từ cửa sổ VS Code khác → id cũ KHÔNG bị ghi đè
      (kích hoạt lại vẫn `--resume` đúng hội thoại cũ)
- [ ] Hai entry ở hai workspace không bao giờ cùng một session id: gắn session S cho terminal
      B trong khi entry A đang giữ S → A tự mất id (xem `workspaces.json`)

## Trạng thái "đang tải phiên" (spinner)
- [ ] Kích hoạt workspace có terminal Claude → NGAY khi terminal mở, item trong cây hiện
      icon xoay + "đang tải phiên…"; khi claude boot xong và registry thấy session (vài
      giây) → tự đổi sang "rảnh"/"đang chạy"
- [ ] Terminal thường (plain) khi kích hoạt KHÔNG hiện "đang tải" (chỉ "đang mở")
- [ ] `Tạo terminal Claude mới` → item mới hiện "đang tải phiên…" cho tới khi bắt được session
- [ ] Claude thoát ngay sau mở (vd resume id hỏng) → spinner tự tắt sau tối đa 90 giây,
      quay về "đang mở"

## Gắn session tay & đóng workspace có confirm
- [ ] Terminal có claude đang chạy nhưng session đã bị entry khác giữ →
      `Gắn session Claude vào terminal`: session vẫn hiện trong danh sách kèm nhãn
      `đang gắn ở "<ws / terminal>"` → chọn → claim CHUYỂN về terminal này, entry cũ mất
      sessionId (không double --resume khi kích hoạt lại)
- [ ] Trong QuickPick gắn session, mục "Nhập session ID thủ công…" → nhập UUID (lấy từ
      /status trong Claude) → entry gắn đúng id; nhập chuỗi không phải UUID bị chặn
- [ ] Menu chuột phải workspace active: "Đóng workspace đang active" nằm ở NHÓM CUỐI menu;
      bấm → modal xác nhận, Cancel thì không gì xảy ra, "Đóng" mới đóng terminal
- [ ] Chuyển workspace (bấm workspace khác) vẫn chỉ hỏi MỘT modal "Lưu và đóng X trước khi
      mở Y?" — không hỏi confirm hai lần

## Khóa một workspace active mỗi cửa sổ (V5)
- [ ] Kích hoạt một workspace ở cửa sổ VS Code A → mở một cửa sổ VS Code B khác (cùng máy),
      cũng kích hoạt CHÍNH workspace đó → cửa sổ B hiện cảnh báo "Workspace "X" đang mở ở cửa
      sổ khác." với nút "Vẫn mở"
- [ ] Bấm Hủy/Esc ở cảnh báo đó (cửa sổ B) → workspace KHÔNG được kích hoạt ở cửa sổ B, cửa sổ
      A không bị ảnh hưởng gì
- [ ] Bấm "Vẫn mở" ở cửa sổ B → workspace được kích hoạt ở B, ghi đè khóa (không có cơ chế nào
      tự đóng workspace ở A — đây là giới hạn best-effort đã biết, chỉ xác nhận không crash)

## Dữ liệu hỏng
- [ ] Đóng VS Code, sửa tay `workspaces.json` trong global storage của extension thành nội
      dung không phải JSON hợp lệ (hoặc JSON không khớp schema) → mở lại VS Code → có cảnh báo
      một lần "File workspaces.json bị hỏng nên đã được sao lưu sang…"; file gốc được đổi tên
      thành `workspaces.json.bak-<epoch>`; danh sách workspace bắt đầu lại từ rỗng (không crash
      extension)

## Kết quả lần chạy

<!-- Điền ngày chạy, người chạy, và kết quả từng mục (đạt/không đạt/ghi chú) tại đây. -->

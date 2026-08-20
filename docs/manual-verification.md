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

## Trạng thái "CHỜ BẠN TRẢ LỜI"
- [ ] Trong một terminal Claude, để nó hỏi (câu hỏi chọn phương án hoặc hộp xin quyền) rồi
      ĐỪNG trả lời → trong ~3 giây nhãn đổi từ "rảnh" sang "CHỜ BẠN TRẢ LỜI", icon dấu hỏi vàng
- [ ] Trả lời xong → nhãn quay về "đang chạy" rồi "rảnh"
- [ ] Claude vừa trả lời xong một lượt (không hỏi gì) → vẫn là "rảnh", KHÔNG báo chờ nhầm
- [ ] Claude đang chạy tool dài (build, test) → là "đang chạy", không phải "chờ"
- [ ] Mở Task Manager lúc có phiên đang chờ: KHÔNG thấy đọc file liên tục (cache theo mtime)

## Terminal Codex
- [ ] `Tạo terminal Codex mới` → chọn "Phiên mới" → terminal mở chạy `codex`; gõ vài câu rồi
      đợi ~5 giây → mở `workspaces.json` thấy entry có `agentId: "codex"` và `agentSessionId`,
      `startCommand` đổi thành `codex resume '<id>'`
- [ ] Đóng workspace rồi kích hoạt lại → terminal Codex mở lại ĐÚNG hội thoại cũ (không phải
      phiên mới), và KHÔNG hỏi hộp thoại tin cậy cho lệnh này
- [ ] Chọn "Tiếp tục phiên gần nhất" → sau khi gõ một câu, id vẫn được dò ra (Codex ghi tiếp
      file rollout cũ nên nhận diện qua lần ghi cuối)
- [ ] Hai terminal Codex cùng một thư mục → KHÔNG gắn id bừa cho cái nào (thà để trống)
- [ ] Chuột phải terminal Codex → `Gắn session AI vào terminal` → hiện danh sách phiên gần
      đây, phiên cùng thư mục xếp trước; chọn xong `startCommand` đổi theo id đã chọn
- [ ] Nhãn trong cây hiện `Codex` (không phải `AI` hay `shell`)
- [ ] Máy chưa từng chạy Codex (không có `~/.codex/sessions`) → lệnh vẫn chạy được, chỉ là
      không dò ra id, không văng lỗi

## Nối lại terminal sau khi reload cửa sổ (chống resume hai lần)
- [ ] Đang có workspace active với vài terminal Claude → `Developer: Reload Window` → sau khi
      VS Code hồi sinh terminal, bấm kích hoạt lại workspace đó → hiện toast "Đã nối lại N
      terminal đang chạy sẵn", KHÔNG mở thêm terminal trùng
- [ ] `claude agents --json` sau đó: mỗi sessionId chỉ còn ĐÚNG MỘT tiến trình (trước bản sửa
      có hội thoại chạy tới 3 tiến trình)
- [ ] Terminal thường có `startCommand` được nối lại thì KHÔNG bị chạy lại lệnh (app đang
      chạy dở không bị nhân đôi)
- [ ] Terminal đang mở nhưng KHÔNG thuộc workspace (tên khác) không bị nhận nuôi nhầm
- [ ] Terminal riêng của bạn TRÙNG TÊN với một entry (vd đều tên `pwsh`) nhưng khác thư mục →
      KHÔNG bị nhận nuôi (đóng workspace không được giết nó)
- [ ] Đổi tên `claude` trong PATH cho hỏng tạm (hoặc tắt CLI) rồi kích hoạt workspace →
      hành vi phải là "mở terminal mới + resume" (chấp nhận trùng), KHÔNG được im lặng bỏ
      qua entry hay treo
- [ ] Có hội thoại đang chạy nhiều tiến trình → hiện cảnh báo "nên đóng bớt terminal Claude
      không nằm trong cây"

## Chọn thư mục làm việc bằng tìm kiếm
- [ ] Tạo terminal mới → hộp thoại hiện danh sách thư mục đã dùng (cwd của các terminal đang
      có xuất hiện trong đó); gõ vài ký tự GIỮA đường dẫn (vd `qualipa`) vẫn lọc ra đúng dòng
- [ ] Chọn một dòng → terminal mở đúng thư mục đó
- [ ] Gõ một đường dẫn KHÔNG có trong danh sách nhưng có thật trên đĩa → dòng đầu ghi "dùng
      đường dẫn này", Enter là mở được
- [ ] Gõ đường dẫn không tồn tại → dòng đầu ghi "không tồn tại"; Enter KHÔNG đóng hộp thoại,
      tiêu đề đổi thành "Đường dẫn không tồn tại: …" để sửa tiếp
- [ ] Tạo terminal ở thư mục X rồi mở lại hộp thoại → X nằm ở ĐẦU danh sách (lịch sử)
- [ ] Lịch sử sống qua reload window (lưu trong globalState)

## Duyệt thư mục bằng hộp thoại hệ điều hành
- [ ] Hộp thoại chọn thư mục luôn có dòng CUỐI "Duyệt tìm thư mục…"; khi chưa gõ gì, Enter
      chọn gợi ý ĐẦU tiên chứ không phải dòng duyệt
- [ ] Gõ một chuỗi không khớp gợi ý nào → dòng "Duyệt tìm thư mục…" VẪN hiện (không bị lọc mất)
- [ ] Chọn "Duyệt tìm thư mục…" → hộp thoại chọn thư mục của hệ điều hành mở ra, nút xác nhận
      ghi "Chọn thư mục này", KHÔNG chọn được file
- [ ] Chọn một thư mục → terminal mở đúng thư mục đó, và lần sau nó nằm đầu danh sách gợi ý
- [ ] Đang gõ dở một đường dẫn có thật rồi mới bấm duyệt → hộp thoại mở SẴN ở thư mục đó
      (gõ dở một đường dẫn chưa tồn tại → mở ở thư mục cha)
- [ ] Bấm Cancel trong hộp thoại duyệt → QuickPick hiện lại, GIỮ nguyên chữ đang gõ dở
      (không hủy cả lệnh tạo terminal)
- [ ] Esc ở QuickPick (không qua duyệt) → hủy hẳn lệnh, không mở terminal nào

## Phím tắt tạo terminal
- [ ] Mở Command Palette gõ "AI Workspace: Tạo terminal" → VS Code hiện sẵn phím tắt bên phải
      tên lệnh (tự động, không cần extension làm gì)
- [ ] Rê chuột vào dòng workspace → tooltip có dòng "Phím tắt mặc định: …"
- [ ] Có workspace đang active → <kbd>Ctrl+Alt+T</kbd> → vào thẳng luồng tạo terminal cho
      workspace ĐANG ACTIVE, KHÔNG hiện danh sách chọn workspace
- [ ] <kbd>Ctrl+Alt+A</kbd> → tương tự với terminal Claude
- [ ] KHÔNG có workspace nào active → phím tắt hiện danh sách để chọn workspace (không im lặng)
- [ ] Bấm phím tắt khi con trỏ đang ở trong một terminal → vẫn chạy lệnh của extension
- [ ] Chuột phải một workspace KHÁC → "Tạo terminal mới" vẫn vào đúng workspace được bấm
      (không bị phím tắt kéo về workspace active)

## Nút "+" trên dòng workspace
- [ ] Rê chuột vào một dòng workspace → hiện nút "+" bên phải; bấm → hỏi đường dẫn rồi mở
      terminal mới đúng workspace đó (KHÔNG phải workspace active nếu bấm ở dòng khác)
- [ ] Bấm "+" KHÔNG kích hoạt workspace đó và không đóng workspace đang active
- [ ] Bấm vào TÊN workspace (không phải nút "+") vẫn là kích hoạt như cũ

## Xem thông tin workspace
- [ ] Chuột phải workspace → `Xem thông tin workspace` → modal hiện đúng: id, lần active gần
      nhất, "Đang giữ bởi" (cửa sổ này / cửa sổ khác / không), số terminal + số đang mở, vị
      trí mở terminal, đường dẫn `workspaces.json`, và danh sách terminal kèm cwd
- [ ] Terminal có lệnh khởi động / có session Claude → hai dòng đó hiện trong danh sách
- [ ] "Sao chép thông tin" → dán ra được nguyên khối; "Mở file lưu" → Explorer mở đúng
      `workspaces.json`
- [ ] Hover vào workspace item → tooltip hiện số terminal và lần active gần nhất

## Xem / sao chép đường dẫn terminal
- [ ] Hover vào một terminal item trong cây → tooltip hiện dòng "Đường dẫn: …" đúng cwd
- [ ] Chuột phải terminal item → `Xem đường dẫn terminal` → modal hiện đủ đường dẫn;
      "Sao chép đường dẫn" → dán ra chỗ khác đúng chuỗi đó
- [ ] "Mở thư mục" → File Explorer mở đúng thư mục đó
- [ ] Terminal có cwd đã bị xóa khỏi máy → modal ghi rõ "không còn tồn tại", KHÔNG có nút
      "Mở thư mục" (vẫn sao chép được)

## Vòng đời terminal thủ công
- [ ] Đóng một terminal bằng tay (bấm dấu X hoặc gõ `exit`) trong workspace active → entry đó
      chuyển sang nhãn "chưa mở" trong cây (KHÔNG biến mất khỏi workspace)
- [ ] Đóng workspace rồi kích hoạt lại workspace đó → terminal "chưa mở" ở trên được mở lại
      bình thường (đúng cwd, resume/startCommand như đã khai báo)
- [ ] `AI Workspace: Bỏ terminal khỏi workspace` trên một terminal ĐANG MỞ → modal hỏi đóng
      luôn hay chỉ bỏ; kiểm đủ ba nhánh ở mục **Bỏ terminal khỏi workspace** bên dưới

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

## Quay lại đúng chỗ đang dở (reload / đóng-mở workspace)
- [ ] Terminal Claude đang làm dở, ĐÓNG workspace rồi kích hoạt lại → claude nối lại ĐÚNG
      hội thoại cũ (không phải hội thoại trắng), kể cả entry chưa từng bắt được session id
      (khi đó lệnh gửi là `claude -c`)
- [ ] Terminal Codex chưa bắt được id phiên → kích hoạt lại chạy `codex resume --last`,
      không mở phiên mới; QuickPick đặt lựa chọn này ở đầu
- [ ] Terminal Codex bắt đầu bằng `codex --yolo` → kích hoạt lại cho chọn
      `codex --yolo resume <id>` (nếu đã dò được id) hoặc `codex --yolo resume --last`;
      chọn `--last`/picker/new thì id mới được dò và lưu lại
- [ ] Esc ở QuickPick khôi phục Codex → terminal đó vẫn đóng, không sinh tab shell rỗng;
      các terminal khác trong workspace vẫn mở bình thường
- [ ] Reload Window rồi kích hoạt workspace → KHÔNG sinh thêm tiến trình claude thứ hai cho
      cùng một hội thoại (kiểm bằng `claude agents --json`: mỗi sessionId chỉ một pid)
- [ ] Tên terminal trong cây KHÔNG bị đổi thành "claude" hay dính ký hiệu ✳/◐ sau khi khôi
      phục; tên người dùng đặt giữ nguyên qua nhiều lần đóng/mở
- [ ] Đổi tên tab bằng Rename có sẵn của VS Code khi terminal đang ở dấu nhắc (không chạy
      lệnh gì) → tên vẫn đồng bộ về cây trong ~3 giây

## Nối lại terminal hồi sinh sau reload (KHÔNG nhân đôi)
- [ ] Có workspace active với 2-3 terminal Claude đang chạy → Reload Window → các tab terminal
      hồi sinh, workspace về trạng thái inactive → kích hoạt lại workspace: KHÔNG mở thêm tab
      nào, các tab cũ được nhận vào cây (thông báo "Đã nối lại N terminal đang chạy sẵn")
- [ ] Kiểm chứng bằng `claude agents --json`: mỗi sessionId chỉ có ĐÚNG một pid sau khi kích
      hoạt lại
- [ ] Terminal hồi sinh đang chạy claude ở cùng thư mục với entry nhưng id phiên KHÁC (entry
      chưa bắt được id, hoặc đã /clear rồi chạy phiên mới) → vẫn được nhận, entry tự trỏ sang
      phiên đang chạy thật
- [ ] Có terminal chạy TRÙNG hội thoại với terminal vừa nối lại → hiện cảnh báo kèm nút "Đóng
      các terminal trùng"; bấm thì chỉ đóng đúng những cái trùng, terminal trong cây còn nguyên
- [ ] Terminal Codex hồi sinh (trùng tên + cwd) cũng được nhận, không mở thêm tab
- [ ] Hai terminal Codex cùng tên + cwd được VS Code hồi sinh đủ cả hai → nhận lại cả hai,
      KHÔNG mở/resume thêm terminal nào
- [ ] Hai entry Codex cùng tên + cwd nhưng chỉ còn một tab hồi sinh → không đoán entry, không
      resume chồng; hiện cảnh báo yêu cầu đóng tab mơ hồ rồi kích hoạt lại

## Thêm terminal mồ côi từ menu tab
- [ ] Chuột phải TAB terminal trong khu editor → có mục "AI Workspace: Thêm terminal đang mở
      vào workspace"; bấm khi có nhiều terminal mồ côi → hiện danh sách chọn (cái đang focus
      nằm đầu, ghi "đang focus")
- [ ] Chỉ có một terminal mồ côi → thêm thẳng, không hỏi
- [ ] Mọi terminal đều đã thuộc workspace → báo "Mọi terminal đang mở đều đã thuộc một workspace"

## Worktree khi tạo terminal agent
- [ ] `Tạo terminal Claude mới` trên một thư mục là repo git → sau khi chọn đường dẫn, hộp
      thoại hỏi tên worktree; để TRỐNG → làm thẳng trên thư mục đã chọn
- [ ] Nhập tên worktree mới → tạo `<repo>-worktrees/<tên>` NGOÀI repo (cạnh thư mục repo) +
      nhánh cùng tên, terminal mở tại đó, tên terminal lấy theo tên worktree
- [ ] `git status` trong repo sạch (worktree nằm ngoài nên không cần khai báo ignore gì)
- [ ] Hỏi worktree diễn ra SAU khi chọn xong lệnh chạy; Esc ở bước chọn lệnh KHÔNG để lại
      thư mục/nhánh rác nào
- [ ] Nhập lại đúng tên worktree đã có → dùng lại thư mục đó, không lỗi, không ghi đè
- [ ] Thư mục KHÔNG phải repo git → không hỏi worktree, mở thẳng
- [ ] Tên worktree có ký tự lạ (`--foo`, `a/../b`) → bị chặn ngay ở ô nhập

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

## Bỏ terminal khỏi workspace
- [ ] Terminal còn mở → context menu **Bỏ terminal khỏi workspace** hiện modal với
      **Bỏ và đóng terminal** / **Chỉ bỏ khỏi workspace** / Cancel
- [ ] Chọn **Bỏ và đóng terminal** → entry biến mất và tab terminal tương ứng đóng
- [ ] Chọn **Chỉ bỏ khỏi workspace** → entry biến mất nhưng tab terminal vẫn chạy
- [ ] Cancel/Esc → cả entry và tab terminal giữ nguyên; terminal vốn đã đóng thì bỏ trực tiếp
      không hỏi

## Khóa một workspace active mỗi cửa sổ (V5)
- [ ] Kích hoạt một workspace ở cửa sổ VS Code A → mở một cửa sổ VS Code B khác (cùng máy),
      cũng kích hoạt CHÍNH workspace đó → cửa sổ B hiện cảnh báo "Workspace "X" đang mở ở cửa
      sổ khác." với nút "Vẫn mở"
- [ ] Bấm Hủy/Esc ở cảnh báo đó (cửa sổ B) → workspace KHÔNG được kích hoạt ở cửa sổ B, cửa sổ
      A không bị ảnh hưởng gì
- [ ] Bấm "Vẫn mở" ở cửa sổ B → workspace được kích hoạt ở B, ghi đè khóa (không có cơ chế nào
      tự đóng workspace ở A — đây là giới hạn best-effort đã biết, chỉ xác nhận không crash)

## Lưu trữ tách file (mỗi workspace một file)
- [ ] Mở VS Code lần đầu sau khi cập nhật → thông báo "Đã chuyển N workspace sang lưu trữ tách
      file"; kiểm `%APPDATA%\Code\User\globalStorage\bigdatacloud.ai-workspace-session-manager\`:
      có thư mục `workspaces\` chứa `<id>.json`, file cũ đổi tên thành `.migrated-<epoch>`
      (KHÔNG bị xoá)
- [ ] Sửa một workspace (đổi tên/thêm terminal) → CHỈ file của workspace đó đổi mtime, file
      workspace khác giữ nguyên
- [ ] Xóa workspace → file `<id>.json` biến mất; mở lại VS Code không thấy nó sống lại
- [ ] Làm hỏng tay một file `<id>.json` (sửa thành `{{{`) rồi mở lại VS Code → chỉ workspace
      đó mất (được backup `.bak-<epoch>`), các workspace khác vẫn nguyên
- [ ] Hai cửa sổ VS Code, mỗi cửa sổ sửa một workspace KHÁC nhau → không cửa sổ nào mất việc
      của cửa sổ kia (trước đây cửa sổ đụng workspace nào một lần là đè bản đĩa của cửa sổ đó
      suốt phiên)

## Dữ liệu hỏng
- [ ] Đóng VS Code, sửa tay `workspaces.json` trong global storage của extension thành nội
      dung không phải JSON hợp lệ (hoặc JSON không khớp schema) → mở lại VS Code → có cảnh báo
      một lần "File workspaces.json bị hỏng nên đã được sao lưu sang…"; file gốc được đổi tên
      thành `workspaces.json.bak-<epoch>`; danh sách workspace bắt đầu lại từ rỗng (không crash
      extension)

## Kết quả lần chạy

<!-- Điền ngày chạy, người chạy, và kết quả từng mục (đạt/không đạt/ghi chú) tại đây. -->

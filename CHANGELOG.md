# Changelog

Mọi thay đổi đáng kể của **AI Workspaces** được ghi ở đây.
Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).

## [0.2.3] — 2026-10-26

### Sửa

- **Mỗi ô của lưới giờ luôn ĐANG HIỆN terminal của nó.** Trước đây "xem song song" chỉ
  bảo đảm mỗi ô **chứa** một terminal, không bảo đảm ô đang **hiện** nó — hai chuyện khác
  nhau, và người dùng chỉ nhìn thấy chuyện thứ hai. Ô nào còn tab file đứng cạnh thì sau khi
  rải xong VS Code có thể chọn đúng tab file làm tab đang hiện — ô đó trông như một ô rỗng
  dù terminal vẫn nằm trong đó. Bất biến này trước giờ đúng một cách tình cờ, phụ thuộc tab
  nào đứng cạnh tab vừa bị dời đi; nay có một pha cuối nói thành lời.
  Ô **không** chứa terminal nào thì không bị đụng tới — tab đang mở ở đó là của người dùng.

### Lưu ý

- Bản vá này **không dọn** tab `Untitled-1` cũ. 0.2.2 chặn việc sinh ra tab nháp mới, còn tab
  đã có thì VS Code khôi phục qua mỗi lần khởi động lại — đóng tay một lần là xong. Pha mới ở
  trên không đóng tab nào, nó chỉ đẩy tab terminal lên trước mặt.

## [0.2.2] — 2026-10-26

### Sửa

- **Không còn tab `Untitled-1` tự mọc ra cạnh lưới.** Việc nạp sẵn model giọng nói lúc mở cửa
  sổ nay **mặc định TẮT** (`aiWorkspace.voice.warmUpOnStartup`). Nó chạy ở giây thứ 4 sau mỗi
  lần mở hoặc reload cửa sổ, và để nạp model thì buộc phải mở một tài liệu nháp rồi bật
  dictation vào đó 40 giây — không có API nào nạp model mà không mở micro. Hai hệ quả đều gặp
  ngoài đời thực: micro tự sáng mỗi lần mở cửa sổ, và tab nháp bị ném vào ĐÚNG nhóm editor
  đang active, tức một ô của lưới xem song song vừa xếp xong. Bật lại nếu hay dùng giọng nói
  và chấp nhận hai điều đó.
- **Thu panel sau khi xếp lưới.** Pha vét đẩy mọi terminal không thuộc lưới xuống panel, nên
  panel bật lên kèm tab đang mở sẵn của nó (hay gặp nhất là Debug Console) và ăn mất phần màn
  hình mà "xem song song" vốn sinh ra để giải phóng. Lệnh đóng panel đặt ở **dòng cuối**, sau
  khi mọi thao tác dời đã lắng — cả `moveToEditor` lẫn `moveToTerminalPanel` đều làm việc
  trên "terminal đang active của panel", nên đóng panel giữa chừng là đụng vào đúng bất biến
  mà cơ chế lưới dựa vào. Terminal nằm dưới panel vẫn chạy; Ctrl+J hiện lại.
- **Ghi lại khi không đóng được tab nháp** thay vì nuốt im — trước đây `catch` rỗng nên không
  để lại dấu vết nào để lần ra.

### Lưu ý

- Việc thu panel **không kiểm chứng được bằng test tự động**: không API nào đọc được panel
  đang mở hay đóng, và bộ test Extension Host trên máy này bám theo tải máy nên không phán
  quyết được (xem `docs/manual-verification.md`). Hai lần thử trước vì thế đã bị gỡ. Lần này
  giữ lại kèm một van thoát: tắt `aiWorkspace.splitView.closePanelAfterLayout` là về đúng
  hành vi cũ, không cần gỡ bản.
- Lỗi báo "ô thứ nhất của lưới hiện tab trống": đã thử tái hiện bằng hai ca Extension Host
  (tab file đứng đầu nhóm, và đứng cuối nhóm) — **cả hai đều xanh với mã hiện có**, tức vòng
  rải vẫn để lại tab terminal ở trước mặt. Nên nguyên nhân không nằm trong `xepLuoiTerminal`
  mà ở chỗ tab nháp xuất hiện SAU khi lưới đã xếp xong. Ca test mới được giữ lại làm hàng rào.

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

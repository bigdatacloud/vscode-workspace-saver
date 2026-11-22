# Changelog

Mọi thay đổi đáng kể của **AI Workspaces** được ghi ở đây.
Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).

## [0.2.6] — 2026-11-22

### Sửa

- **Thêm một terminal vào lưới đang xem song song: hết đỏ chập chờn, vì nó không phải chuyện
  tải máy.** Ca Extension Host này đỏ thất thường từ 0.2.3 mà chưa ai biết nhánh nào hỏng — lý
  do đơn giản: ca test gọi hàm KHÔNG truyền hàm ghi log, nên bốn nhánh thất bại khác nhau trông
  y như nhau. Thu nhật ký vào thông báo assert là ra ngay: `show()` đặt `activeTerminal` = cái
  terminal mới, nhưng TAB active của nhóm vẫn là terminal khác, nên lệnh `moveToTerminalPanel`
  đẩy nhầm cái đó xuống panel; sau khi trả nó lên lại, terminal mới vẫn còn ở editor — mà bước
  kéo lên đòi *số tab phải tăng*, điều không thể xảy ra nữa. Nay nếu terminal đã có tab trong
  vùng editor thì chỉ xoay tới đúng tab của nó; đường đẩy-panel-rồi-kéo-lên chỉ còn là chỗ rơi
  về. Đo: ca đó xanh 5/5 lần, và cả bộ Extension Host **33 passing / 6 pending / 0 failing**.

### Bảo mật chuỗi cung ứng

- **`zod` 3.23 → 4.6.7** (GHSA-mrhx-c7xc-m3w5, mức high: cạn bộ nhớ khi validate collection quá
  lớn). Đây là dependency CHẠY THẬT duy nhất của extension. Nghiệm thu không chỉ bằng test:
  cả 8 file store thật trên máy người dùng (30 terminal) parse đúng bằng schema mới.
- **Gói cài không phình theo**: `import * as z from 'zod'` thay cho `import { z }` — đo được
  92 KB so với 446 KB cho riêng `schema.ts`, vì bản 4 tree-shake được còn named import kéo cả
  barrel. 354 KB đó đi thẳng vào gói của người dùng, nên có một ca test giữ hàng rào này.
- **Toolchain phát triển**: vitest 2 → 5 (bỏ `tinypool` có lỗ hổng critical), esbuild 0.23 →
  0.28, mocha 10 → 12, `@vscode/test-cli` 0.0.10 → 0.0.15, `@vscode/test-electron` 2.4 → 3.1,
  `@types/node` 20 → 22 (vitest 5 đòi ≥22). Thêm `overrides` đẩy `serialize-javascript` trong
  nhánh lồng của test-cli lên bản đã vá.
- Kết quả quét: **15 lỗ hổng → 0.** Bảy cái cuối nằm trong cây LỒNG của `@vscode/test-cli`
  (nó ghim mocha cũ bên trong) nên không gói nào ở gốc vá được chúng; `overrides` đẩy từng cái
  lên bản đã vá: `serialize-javascript` 7.1.4, `glob` 14.0.4, `minimatch` 11.0.8, `diff` 8.0.4,
  `test-exclude` 8.0.0, `c8` 12.0.0 — mỗi bản đều ghim CHÍNH XÁC và đều quá 7 ngày tuổi.
- `vitest` ghim **5.0.5** (phát hành 15/10/2026, 38 ngày tuổi) chứ không phải 5.1.1 (18/11,
  mới 4 ngày — dưới ngưỡng chờ của luật chuỗi cung ứng). `npm install vitest@5.0.5` crash
  (`Cannot read properties of null (reading 'edgesOut')` trong arborist khi giải peer set của
  vitest 5), nhưng ghim qua `overrides` thì được — nên không còn chỗ nào lệch luật.

- **Bấm vào một terminal mà "không đưa ra trước được": vá hai nguyên nhân đo được.** (1) Phép
  nhận diện tab so `tab.label === terminal.name` NGUYÊN VĂN, mà agent ghi tiêu đề tab thành
  "<ký hiệu trạng thái> <tên phiên>" và đổi liên tục — nên với mọi terminal agent, mệnh đề nhãn
  chết hẳn và đường tìm tab chỉ còn dựa vào `activeTerminal`; khi số đó nói sai thì vòng xoay
  quay trọn rồi báo "không tìm thấy". Nay so qua `khopTenTab`, cắt ký hiệu ở cả hai bên (nhãn
  RỖNG vẫn không khớp với bất cứ gì — tab chưa từng hiện có nhãn rỗng vĩnh viễn, coi rỗng là
  khớp thì lệnh dời sẽ ném một tab lạ sang ô khác). (2) Terminal sống ở panel: `show()` một
  mình không luôn kéo nổi khi vùng editor đang giữ focus — nay cho panel nhận focus rồi show
  lại trước khi xoay tab.
- **Quét bảng tiến trình không còn bỏ cuộc lúc máy tải.** `Get-CimInstance Win32_Process`
  không tham số kéo về mọi thuộc tính của mọi tiến trình (hơn 40 cột); đo 22/11/2026, khi bộ
  vitest chạy 51 worker song song thì lệnh vượt hạn 15 giây và hàm trả map RỖNG — mà rỗng
  nghĩa là "không biết", nên đường đóng phiên bỏ qua đúng lúc cần nó nhất. Nay truy vấn chỉ
  ba cột thật sự dùng (`ProcessId`, `ParentProcessId`, `CommandLine`) và hạn nới lên 25 giây.
  Ca test đọc bảng thật vốn đỏ chập chờn mỗi lần chạy cả bộ, nay xanh.
- **Gỡ một hàm chết** trong `splitview.ts` (`nhomConDongTerminal` — không nơi nào gọi).

### Thêm

- **Kênh Output "AI Workspace — Phiên"** ghi nguyên văn mọi chuỗi extension gửi vào shell, kèm
  giờ ISO, ở cả sáu đường (khôi phục resume / phiên mới / continue, lệnh agent, startCommand,
  tạo mới, nhân bản, lập tổ). Lý do: một lệnh resume từng bị chèn ký tự rác (`öclaude`) mà
  không chỗ nào ghi lại chuỗi đã gửi — không có nhật ký thì "ta dựng sai lệnh" và "shell nhận
  méo" trông y như nhau, và cách duy nhất còn lại là sửa mò đúng đường cốt tử của extension.

### Tài liệu

- `huong-dan-ai-workspace.html` cập nhật cho 0.2.5–0.2.6: phiên bản, tên gói, thứ tự bốn bước,
  luật tên bắt buộc + một tên cho ba chỗ + chặn trùng + gốc là cây chính + ca ngoài git, và
  trạng thái "phiên đã thoát · shell trống".
- `package-lock.json` về đúng version của `package.json` (đang lệch từ 0.2.3).

## [0.2.5] — 2026-11-22

### Thay đổi

- **Mỗi phiên agent mới = một cây riêng, và một TÊN riêng.** Mở `Tạo terminal Claude mới` /
  `Tạo terminal Codex mới` nay luôn phải nhập tên việc: ô nhập không còn nhận câu trả lời
  trống, nên không còn đường để hai phiên dùng chung một thư mục làm việc (đúng cái worktree
  sinh ra để tránh — hai phiên cùng thư mục thì `claude -c` / `codex resume --last` trỏ vào
  CÙNG một hội thoại và cơ chế bắt phiên theo cwd cũng không phân biệt nổi).
- **Tên đó là một tên cho cả ba chỗ**: entry trong cây workspace, tab terminal, và tên phiên
  agent (`claude -n`). Trước bản này lệnh khởi chạy được dựng TRƯỚC khi hỏi worktree, nên nó
  mang tên repo gốc trong khi tab và entry mang tên cây — lệch nhau mỗi lần có cây.
- **Tên trùng bị chặn ở ba cửa đặt tên, so trên toàn bộ store** (mọi workspace, kể cả workspace
  đang đóng, kể cả repo khác): `Tạo terminal Claude/Codex mới`, `Đổi tên terminal`, và `Lập tổ`.
  Cây mà một entry khác đang trỏ vào cũng không được nhận im lặng nữa. Ba đường KHÔNG kiểm
  trùng, có lý do: `Tạo terminal mới` (shell thường), `Thêm terminal đang mở vào workspace`, và
  phép đồng bộ tên tab — cả ba chỉ áp cho terminal không phải phiên agent (tên tab của agent do
  chính agent ghi, extension cố ý không hút vào entry).
- **Nhân bản terminal** nay cũng đi qua đúng cửa đó: bản sao ngoài repo git trước đây tự đặt tên
  `<tên gốc> (bản sao)`, nay được hỏi tên như mọi phiên khác.
- **Cây không còn lồng vào nhau.** Gốc để tính chỗ đặt cây là cây làm việc CHÍNH của repo, không
  phải thư mục đang đứng: đo 22/11/2026, `git rev-parse --show-toplevel` chạy bên trong một
  linked worktree trả về chính worktree đó, mà lịch sử gợi ý đường dẫn lại chứa đúng các đường
  cây — nên "mở phiên mới từ trong một cây" sẽ sinh `<repo>-worktrees/<việc-a>-worktrees/<việc-b>`
  và hai entry không còn nhìn thấy nhau để báo trùng.
- **Thư mục không nằm trong repo git**: trước đây lặng lẽ bỏ qua bước worktree; nay vẫn hỏi
  tên (tên đặt cho tab terminal và cho phiên agent, vẫn kiểm trùng) kèm một câu nói rõ thư
  mục đó sẽ bị dùng chung với mọi phiên khác ở đấy.
- **Biến thể "nối tiếp hội thoại" (`-c` / `-r`) trong một cây vừa tạo được dán nhãn**: Claude
  lưu hội thoại theo thư mục, nên cây mới chưa có gì để nối. Lựa chọn vẫn còn, chỉ là nói
  trước thay vì để người dùng nhận một phiên trắng mang tên "tiếp tục".

### Ghi chú kỹ thuật

- Hỏi tên và tạo cây nay là hai bước tách bạch (`hoiTenCay` / `taoCay`): tên phải biết TRƯỚC
  khi dựng lệnh, còn `git worktree add` vẫn phải chạy SAU mọi hộp thoại còn có thể bị Esc —
  `addWorktree` cố ý không có đường gỡ, nên một lần Esc muộn là một thư mục + một nhánh rác.
  Một ca kiểm kiến trúc khoá đúng thứ tự đó trong mã.
- Phép phán xử nằm trong module thuần `src/workspace/tencay.ts` (không biết vscode): cú pháp
  tên, ghép đuôi vai, đường dẫn cây, trùng tên, trùng cây. Đường dẫn cây nay do một hàm duy
  nhất tính (`duongDanCay` trong `src/git/worktree.ts`) thay vì ba chỗ tự ghép — ba chỗ tự
  ghép là ba chỗ có thể lệch, mà lệch đường dẫn nghĩa là "cây đã có" và "cây tạo mới" không
  còn nhìn thấy nhau.
- Luật "cùng thư mục, khác tên là chủ ý" của `trungphien.ts` KHÔNG bị đổi: nó nói về các
  terminal đang chạy, còn hàng rào mới chỉ áp ở cửa đặt tên.
- Đo: 701 vitest xanh (thêm 24 ca), `tsc --noEmit` sạch. Năm thí nghiệm phân biệt: gỡ phép
  kiểm trùng tên → đỏ 3 ca; cho tên trống là hợp lệ → đỏ 3 ca; trả tên lệnh về cách cũ (tên
  repo gốc) → đỏ 2 ca; lấy `--show-toplevel` làm gốc cây khi tạo phiên → đỏ 1 ca; lấy nó làm
  gốc khi lập tổ → đỏ 1 ca.
- Extension Host: 33 passing / 6 pending / 0 failing (4 phút) — nhưng số đó chạy trên mã TRƯỚC
  hai bản sửa gốc cây (`goiRepoChinh`). Lần chạy lại trên mã cuối bị hệ thống dừng giữa chừng
  vì máy cạn RAM, nên bộ Extension Host CHƯA được chạy trọn trên bản 0.2.5 này.
- CHƯA kiểm trên VS Code thật: tiêu đề tab sau khi Claude khởi động với `-n <tên>`. Mã đặt tên
  tab lúc tạo terminal và truyền cùng tên đó vào `-n`, nhưng thứ hiện trên tab sau đó do chính
  Claude ghi bằng escape sequence — chỉ chạy tay mới biết chắc. Xem mục "Mỗi phiên một tên" trong
  `docs/manual-verification.md`.

## [0.2.4] — 2026-10-26

### Sửa

- **Phiên đã thoát không còn giả vờ đang chạy, và mở lại được.** Terminate một phiên agent
  thì cái vỏ shell đã sinh ra nó vẫn sống (`taskkill /T` đi xuống; `/exit` thì chỉ agent
  thoát). Trước bản này, mọi đường "mở lại một phiên" đều hỏi đúng một câu — *cửa sổ này còn
  giữ terminal nào cho entry không* — mà câu đó trả lời về **terminal**, không phải về
  **phiên**. Vỏ còn sống nghĩa là câu trả lời luôn là "có", nên:
  cây vẽ chấm đầy màu nhà cung cấp y như đang chạy; bấm vào thì nhận "đang chạy nhưng không
  đưa ra trước được" rồi hết đường; menu "Kích hoạt riêng terminal này" cũng bỏ qua đúng
  entry đó (nó chỉ mở những entry *chưa* có terminal). Lối duy nhất còn lại là chuột phải →
  gỡ hẳn terminal khỏi workspace.
  Nay cây có trạng thái riêng **"phiên đã thoát · shell trống"** (vòng tròn rỗng, màu mờ), và
  bấm vào nó thì được hỏi mở lại phiên — đồng ý thì vỏ cũ bị đóng rồi phiên bật lại đúng
  entry ấy.
- **Thông báo "không đưa ra trước mặt được" nay có lối ra**: hai nút *Đóng và mở lại* và
  *Xem Output*, và nó không còn khẳng định "đang chạy" — thứ duy nhất extension biết chắc là
  terminal còn trong sổ.
- **Kênh "AI Workspace — Xem song song" ghi thêm lý do** khi không hiện được một terminal đã
  thoát. Nhánh đó trước đây trả về im lặng, nên Output không có dòng nào giải thích.

### Ghi chú kỹ thuật

- Giả thuyết đầu tiên (VS Code giữ terminal đã chết trong sổ với `exitStatus`) đã bị **loại
  bằng đo**, không bằng suy luận: thăm dò trong Extension Host ngày 26/10/2026 cho thấy
  `onDidCloseTerminal` bắn sau **426 ms** khi shell bị `taskkill /T /F` từ ngoài và sau
  **896–3 259 ms** khi tiến trình tự thoát, và terminal rời `window.terminals` ngay trong
  nhịp đó. Nên `terminals.has()` đúng là "terminal còn sống"; thứ sai là coi nó bằng với
  "phiên còn sống".
- Vòng điều phối **không** nhận trạng thái mới: với bus, "không thấy phiên trong sổ" vẫn phải
  là *chưa xác minh được*, vì coi nó là chết thì một nhịp sổ phiên hỏng cũng đủ làm người
  điều phối bỏ rơi một worker đang làm việc thật.

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

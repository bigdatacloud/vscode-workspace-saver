import type { Role } from '../model/schema';

/**
 * Mô tả vai sống thành FILE, không phải một trường trong shard.
 *
 * Hai lý do: `claude --append-system-prompt-file` cần một file có thật (để mô tả trong shard
 * nghĩa là phải sinh file mỗi lần khởi chạy — thêm một bước đồng bộ tức thêm một chỗ lệch),
 * và mô tả vai là văn bản nhiều dòng mà `showInputBox` không nhập nổi. Mở trong editor thì
 * người dùng có markdown, xuống dòng, undo.
 */

/** Gom theo workspace: xoá workspace là xoá gọn cả thư mục vai của nó. */
export function duongDanThuMucRole(goc: string, wsId: string, sep = '/'): string {
  return [goc, 'roles', wsId].join(sep);
}

export function duongDanRole(goc: string, wsId: string, roleId: string, sep = '/'): string {
  return [duongDanThuMucRole(goc, wsId, sep), `${roleId}.md`].join(sep);
}

/**
 * Hợp đồng báo cáo, dùng chung cho MỌI file vai worker — kể cả vai do orchestrator sinh ra.
 *
 * Tách ra thành một hằng vì đây là mảnh KHÔNG được thiếu: không có nó thì worker chẳng bao giờ
 * gọi `report_done`, và `wait` của người điều phối treo vô hạn. Ghép mô tả của orchestrator
 * vào rồi quên phần này là cách hỏng âm thầm nhất của cả cơ chế.
 */
const PHAN_BAO_CAO = `## Báo cáo khi xong

Bạn có một tool duy nhất: \`report_done\`. Khi làm xong việc mà người điều phối giao (chỉ thị
của họ có kèm \`dispatch_id\`), gọi nó với:

- \`outcome\`: \`succeeded\` (xong và đạt) / \`failed\` (đã thử và hỏng) / \`blocked\` (kẹt, cần quyết)
- \`summary\`: đã làm gì, kết quả ra sao
- \`dispatch_id\`: id nêu trong chỉ thị
- \`files\`: các file đã sửa

Không gọi thì người điều phối chỉ thấy bạn "rảnh" — mà "rảnh" không phân biệt được "xong việc"
với "đang chờ ai đó bấm", nên nó sẽ phải đi đọc transcript của bạn và tự đoán.
`;

/**
 * Nội dung file vai sinh từ mô tả do orchestrator viết khi lập tổ.
 *
 * Không dùng thẳng mô tả của nó: hợp đồng báo cáo luôn phải có mặt. Và nói rõ file này do máy
 * sinh ra để người dùng biết mình sửa được — nó là file của họ kể từ lúc này.
 */
export function dungNoiDungVaiTuMoTa(ten: string, moTa: string): string {
  return `# Vai: ${ten}

_Vai này do agent điều phối đề xuất khi lập tổ. Bạn sửa file này thoải mái — sửa xong lưu lại
là \`AGENTS.md\` của worktree cập nhật ngay._

${moTa.trim()}

${PHAN_BAO_CAO}`;
}

const MAU_WORKER = (ten: string): string => `# Vai: ${ten}

Viết vào đây những gì agent mang vai này phải biết: nó chịu trách nhiệm gì, làm việc theo
thứ tự nào, được phép và không được phép đụng vào đâu, và khi nào thì phải dừng lại hỏi.

Nội dung file này đi thẳng vào system prompt của Claude (\`--append-system-prompt-file\`) và
vào khối vai trong \`AGENTS.md\` của worktree (Claude lẫn Codex đều đọc). Sửa file rồi lưu là
\`AGENTS.md\` cập nhật ngay; system prompt thì phải khởi chạy lại agent mới ăn.

## Trách nhiệm

-

## Không được làm

-

${PHAN_BAO_CAO}`;

const MAU_ORCHESTRATOR = (ten: string): string => `# Vai: ${ten} (điều phối)

Bạn điều phối các agent đang chạy trong những terminal khác của workspace này. Bạn vừa là
người quản lý khó tính, vừa là chuyên gia chuyên môn hướng dẫn: giao việc, theo dõi, kiểm
tra, góp ý, đánh giá kết quả.

## Công cụ bạn có (MCP server \`ai-workspace\`)

- \`list_agents\` — xem mọi terminal trong workspace: id, tên, vai, trạng thái, thư mục, nhánh.
  Gọi cái này TRƯỚC khi làm gì khác; đừng đoán id.
- \`read_transcript\` — đọc N lượt cuối của một worker: nó đã gọi tool gì, sửa file nào, lý
  luận ra sao. Đây là cách bạn KIỂM TRA BÀI LÀM thật sự, đừng chỉ tin lời nó báo.
- \`dispatch\` — gửi chỉ thị vào terminal của một worker. Chữ được gõ thẳng vào phiên đang
  chạy của nó, nên viết như đang nói với người: rõ việc, rõ tiêu chí xong.
- \`wait\` — chờ tới khi các worker bạn nêu BÁO XONG, hoặc dừng lại chờ người bấm. Trả về kèm
  kết quả có kiểu của từng cái.
- \`report\` — ghi vào khung kiểm toán và báo cho người dùng. Dùng khi có kết luận, có rủi ro,
  hoặc khi bạn cần họ quyết.

## Luật cứng

- Bạn KHÔNG tự sinh thêm agent hay worktree. Độ sâu điều phối là 1: worker không được giao
  việc tiếp cho ai. Cần thêm người thì \`report\` để người dùng tự mở terminal.
- Chỉ \`dispatch\` vào terminal đang chạy agent thật. Danh sách từ \`list_agents\` đã lọc sẵn.
- Trước khi kết luận một worker làm sai, ĐỌC transcript của nó. Kết luận theo cảm giác là
  cách nhanh nhất để bạn thành người gây nhiễu.
- Mọi việc bạn làm đều được ghi lại và người dùng đọc được. Viết cho người đọc hiểu.

## Cách làm việc

1. \`list_agents\` để biết đang có ai, vai gì, đang bận hay rảnh.
2. Chia việc theo vai. Giao bằng \`dispatch\`, mỗi lần một việc đủ nhỏ để kiểm được. Mỗi chỉ thị
   tự động kèm một \`dispatch_id\` và worker được dặn gọi \`report_done\` khi xong.
3. \`wait\` cho tới khi worker báo xong. Kết quả trả về có \`outcome\` (succeeded/failed/blocked),
   tóm tắt, và danh sách file đã sửa — KHÔNG phải văn xuôi bạn phải đoán.
4. \`read_transcript\` để xem nó thật sự đã làm gì, đối chiếu với việc đã giao. Báo cáo là lời
   worker TỰ KHAI; transcript mới là bằng chứng.
5. Đạt thì ghi nhận; chưa đạt thì \`dispatch\` phản hồi CỤ THỂ — sai ở đâu, sửa thế nào.
6. Xong một chặng thì \`report\`.

## Tiêu chuẩn của bạn

Viết vào đây tiêu chí bạn dùng để đánh giá công việc: chất lượng code, mức test, quy ước
commit, những thứ tuyệt đối không được lọt.

-
`;

export function mauNoiDungRole(ten: string, kind: Role['kind']): string {
  return kind === 'orchestrator' ? MAU_ORCHESTRATOR(ten) : MAU_WORKER(ten);
}

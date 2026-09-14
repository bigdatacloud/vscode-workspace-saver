# Hỏi–đáp chặn, hàng chờ giao việc, phán quyết sống chết

**Ngày:** 2026-09-14
**Tiếp nối:** `2026-08-28-roles-orchestration-design.md` (phần D).
**Nguồn học:** guide `orca skills get orchestration` của Orca — lấy ba ý chuyển được mà không cần
runtime của Orca, bỏ phần gắn với binary của họ (Run, Dispatch authority, worker-release).

## 0. Điều gì đổi so với spec 2026-08-28

Spec cũ (§3.2) cố ý **không** làm task DAG / decision gate: "orchestrator là một mô hình ngôn ngữ,
nó tự giữ kế hoạch được". Ý đó vẫn đúng và vẫn giữ: **kế hoạch vẫn nằm ở agent**. Cái đổi là
extension nay được phép *xếp hàng* một chỉ thị cho tới khi việc trước báo `succeeded` — nó chỉ
sắp thứ tự, không quyết nội dung. Lý do đổi: không có hàng chờ, một chuỗi ba việc bắt người
điều phối ngồi trong `wait` ba lần, và mỗi lần là một lượt ngữ cảnh chỉ để nói "tiếp đi".

## 1. Hỏi–đáp chặn (ask / reply)

Vấn đề: worker kẹt thì chỉ có hai đường, đều dở — `report_done(blocked)` là *kết thúc* việc,
còn hỏi trong TUI thì người điều phối chỉ thấy `idle` và phải đi đọc transcript mới biết.

```
worker: ask(question)            → req/<id>.json {type:'ask'}  → extension ghi nhận câu hỏi vào
                                                                   status.json NGAY, ack qua res/
        …tool call CHẶN, poll ans/<id>.json…
điều phối: wait(...)             → dừng ngay, dòng ↳ ĐANG HỎI (ask_id=…): …
điều phối: reply(ask_id, text)   → req {type:'reply'} → extension ghi ans/<askId>.json, xoá câu hỏi
worker: ask(...) trả về          ← "Trả lời của người điều phối: …"
```

Ràng buộc quyết định đúng/sai:

- **Hai pha, không đi qua `goiYeuCau` một lần.** Vòng req/res bị chặn 20 giây và file req chết sau
  60 giây — cố ý, dùng chung cho dispatch/report/team. Câu trả lời đi bằng file riêng `ans/<askId>`.
- **`reply` KHÔNG gõ vào terminal worker.** Worker đang đứng giữa một tool call; chữ gõ vào sẽ
  thành lượt kế tiếp của nó và nó nhận câu trả lời hai lần. Kết quả tool là kênh duy nhất.
- **Chống bế tắc:** `wait` của người điều phối phải DỪNG khi bất kỳ worker đang chờ nào có câu
  hỏi treo — không thì hai bên cùng ngồi chờ tới hết hạn.
- Phân biệt hai lý do dừng: `blocked` (Claude chờ người dùng bấm quyền — chỉ người dùng gỡ được)
  và câu hỏi treo (người điều phối gỡ được bằng `reply`). Cùng là dừng, hành động kế khác nhau.
- **Nối lại theo id:** `ask(ask_id)` chờ tiếp một câu hỏi cũ sau khi hết hạn chờ, không mất câu hỏi.
- Câu hỏi treo bị xoá khi: có trả lời; worker đó nhận `dispatch` mới; worker đó `report_done`;
  terminal worker đóng; quá hạn `HAN_HOI_MS`. Không thì một câu hỏi cũ ghim `wait` mãi.
- Extension kiểm `reply` giống `xetDispatch`: `from` phải là terminal điều phối, dù bộ tool worker
  không có `reply` — phòng thủ theo lớp, cùng lý do với dispatch.
- `ask` đi **lên** (worker → điều phối), không đi ngang, không đi xuống: không nới độ sâu 1.

## 2. Hàng chờ giao việc (`dispatch … after`)

`dispatch(terminal_id, text, after?: dispatch_id[])`. Cổng quyết định là **ngầm**: chỉ thị chỉ được
giao khi MỌI id trong `after` đã báo `succeeded`; một cái `failed`/`blocked`/bị huỷ thì chỉ thị bị
**huỷ** kèm dòng kiểm toán, và dòng huỷ hiện trong `list_agents`/`wait`. Không thêm primitive
riêng cho cổng.

- Sổ kết cục **theo dispatch** (`dispatchId → succeeded | failed | blocked | dangBay | choGiao | huy`).
  `ketQuaWorker` không dùng được: nó theo terminal và bị xoá ngay khi worker nhận việc mới.
- Quy tắc dừng của `wait`: worker còn có chỉ thị **đang xếp hàng** nhắm vào nó thì CHƯA xong, dù
  đang `idle` — không thì `dispatch A; dispatch B after A; wait [A,B]` trả về ngay lập tức.
- `xetDispatch` chạy lại **lúc giao**, không chỉ lúc xếp hàng: đích có thể đã đóng trong lúc chờ.
- `after` chứa id sổ không biết → từ chối ngay (gõ nhầm, hoặc trước reload). Sổ và hàng chờ chỉ sống
  trong RAM như `ketQuaWorker`; reload là mất, và mất thì ghi kiểm toán chứ không im.
- Chỉ thị được giao mang **id của chính nó** trong hợp đồng `report_done`.

## 3. Phán quyết sống chết ba mức

Hàm thuần trên `TerminalState`: `closed`/`error` → `exited`; `busy`/`idle`/`blocked` → `live`
(registry vừa thấy); `open`/`loading` → `unverifiable` (đang track nhưng registry im — phủ luôn ca
`listRunning` hỏng, vì `syncStatuses` xoá trạng thái khi registry trống). `wait` vẫn chờ tiếp trên
`unverifiable` (đúng tinh thần Orca: vắng mặt không phải bằng chứng chết); cái đổi là thông điệp hết
hạn nêu phán quyết của từng worker để người điều phối thôi đoán.

## 4. Kiểm thử (hàm thuần trong `src/orch/bus.ts`)

| Hàm | Ca |
|---|---|
| `docYeuCau` | ask có/không dispatchId; reply thiếu askId → null; dispatch có `after`, phần tử không phải chuỗi → null (bỏ im là bỏ cổng) |
| `docTraLoi`, `tenFileTraLoi` | đọc được; id có ký tự đường dẫn → ném |
| `phanQuyetSong` | đủ bảy trạng thái |
| `nenDungCho` | câu hỏi treo → dừng; còn hàng chờ nhắm vào → KHÔNG dừng dù idle; ketQua → dừng; open → không; mất terminal → dừng |
| `xetGiaoSau` | đủ succeeded → giao; còn dangBay/choGiao → chờ; failed/blocked/huy/không biết → huỷ nêu id |
| `xetAsk` / `xetReply` | điều phối tự hỏi → từ chối; reply không từ điều phối → từ chối; askId không treo → từ chối |

MCP server: worker có `report_done` + `ask`; điều phối có thêm `reply`; vòng poll thoát khi stdin
đóng (tiến trình mồ côi không được ngồi poll 15 phút).

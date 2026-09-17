# Tham chiếu: skill `orca-cli` và `orchestration` của Orca (bản clone)

Bản chụp nguyên văn hai skill do binary Orca phục vụ (`orca skills get <name>`), dùng làm
**mẫu tham chiếu** khi thiết kế tính năng tương đương cho AI Workspace Session Manager:

- cho Claude Code trong một terminal **đọc / chờ / gửi** vào terminal khác của cùng workspace
  (`terminal list/read/wait/send`, cursor đọc output dài, `wait --for tui-idle` cho agent CLI,
  receipt `input_accepted` → `turn_started`);
- điều phối nhiều agent có trạng thái (task, dispatch, inbox/reply, worker_done, decision gate).

| File | Nguồn | Ghi chú |
|---|---|---|
| `orca-cli.md` | `orca skills get orca-cli` | guide chính: worktree, terminal, artifact, browser |
| `orca-cli-full.md` | `orca skills get orca-cli --full` | guide + mọi reference đi kèm (browser, automations, publishing) |
| `orchestration.md` | `orca skills get orchestration` | vai trò coordinator/worker, vòng lặp giám sát, hợp đồng task-spec |
| `orchestration-full.md` | `orca skills get orchestration --full` | bản đầy đủ kèm reference |
| `VERSION.txt` | `orca --version` | phiên bản binary lúc chụp — guide đổi theo release, chụp lại khi nâng Orca |

Không dùng trực tiếp làm skill cho extension này: tên lệnh `orca ...` chỉ có ý nghĩa với Orca.
Cái cần lấy là **mô hình lệnh + quy tắc an toàn** (đọc trước khi gửi, receipt hai giai đoạn,
không gửi lại khi im lặng, đọc theo cursor, timeout bắt buộc) để viết CLI + skill riêng của
extension (ví dụ `aiws terminal read/send/wait`).

Chụp ngày 2026-09-17 theo yêu cầu anh Ý ("nếu clone được skill này thì nên clone và đưa vào
extension vscode-workspace-saver").

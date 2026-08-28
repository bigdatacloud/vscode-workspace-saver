/**
 * Bus tin nhắn giữa MCP server (tiến trình con của agent điều phối) và extension host.
 *
 * Là FILE trong globalStorage chứ không phải cổng mạng: không phải thương lượng port, không
 * phải giữ tiến trình nào sống, và sống sót qua Reload Window. Đổi lại `wait` phải poll —
 * chấp nhận được vì đơn vị thời gian ở đây là "agent làm xong một việc", không phải mili giây.
 *
 * Module này KHÔNG import vscode: nó chạy ở CẢ hai phía.
 */

export type TrangThaiAgent =
  | 'busy'
  | 'idle'
  | 'blocked'
  | 'loading'
  | 'open'
  | 'closed'
  | 'error';

export interface AgentTrangThai {
  id: string;
  name: string;
  state: TrangThaiAgent;
  /** `null` nghĩa là shell thường, KHÔNG phải terminal agent. */
  agent: 'claude' | 'codex' | null;
  roleName?: string;
  roleKind?: 'worker' | 'orchestrator';
  cwd?: string;
  branch?: string;
  /** Id phiên để đọc transcript; vắng mặt thì `read_transcript` chịu. */
  sessionId?: string;
  /**
   * Kết quả worker này báo gần nhất. Bị xoá khi có lần giao việc MỚI cho nó — nếu không,
   * người điều phối đọc lại kết quả cũ và tưởng việc mới đã xong.
   */
  ketQua?: KetQuaWorker;
}

export interface AnhChupTrangThai {
  at: number;
  workspaceId: string;
  /** Terminal đang giữ vai điều phối; null nếu chưa có ai. */
  idDieuPhoi: string | null;
  agents: AgentTrangThai[];
}

export interface YeuCauDispatch {
  id: string;
  from: string;
  at: number;
  type: 'dispatch';
  terminalId: string;
  text: string;
}

export interface YeuCauReport {
  id: string;
  from: string;
  at: number;
  type: 'report';
  text: string;
}

export const KET_CUC = ['succeeded', 'failed', 'blocked'] as const;
export type KetCuc = (typeof KET_CUC)[number];

/**
 * Worker báo đã xong việc được giao, kèm kết cục có kiểu.
 *
 * Vì sao cần dù đã có `wait` và `read_transcript`: `idle` của registry KHÔNG phân biệt được
 * "làm xong việc được giao" với "đang chờ người bấm" hay "vừa xong một việc khác hẳn", còn
 * transcript là văn xuôi mà người điều phối phải tự đoán. Một kết cục có kiểu do chính worker
 * khai là tín hiệu hoàn thành duy nhất không phải suy diễn.
 */
export interface YeuCauDone {
  id: string;
  from: string;
  at: number;
  type: 'done';
  outcome: KetCuc;
  text: string;
  /** Id lần giao việc mà báo cáo này trả lời; vắng mặt nếu worker tự báo. */
  dispatchId?: string;
  files?: string[];
}

export type YeuCau = YeuCauDispatch | YeuCauReport | YeuCauDone;

/** Kết quả gần nhất một worker đã báo — đi kèm trạng thái trong `status.json`. */
export interface KetQuaWorker {
  outcome: KetCuc;
  text: string;
  at: number;
  dispatchId?: string;
  files?: string[];
}

export interface PhanHoi {
  id: string;
  ok: boolean;
  message: string;
}

export type QuyetDinh = { cho: true } | { cho: false; lyDo: string };

/**
 * Có được phép bơm chữ từ `from` vào terminal `dich` không.
 *
 * Bốn lớp chặn, và mỗi lớp có một lý do cụ thể chứ không phải cho đủ bộ:
 *  - chỉ terminal điều phối được gửi → độ sâu 1, worker không đẻ worker;
 *  - không tự gửi cho mình → tránh vòng lặp agent tự nói với chính nó;
 *  - đích phải là terminal AGENT → bơm chữ vào shell trần chính là thực thi lệnh tuỳ ý;
 *  - đích phải còn mở → gõ vào một terminal đã đóng là mất chữ im lặng.
 */
export function xetDispatch(
  from: string,
  dich: string,
  idDieuPhoi: string | null,
  agents: readonly AgentTrangThai[],
): QuyetDinh {
  if (idDieuPhoi === null) {
    return { cho: false, lyDo: 'Workspace này chưa có terminal nào giữ vai điều phối.' };
  }
  if (from !== idDieuPhoi) {
    return {
      cho: false,
      lyDo: 'Chỉ terminal giữ vai điều phối mới được giao việc (độ sâu điều phối là 1).',
    };
  }
  if (dich === from) return { cho: false, lyDo: 'Không gửi chỉ thị cho chính mình.' };
  const t = agents.find((a) => a.id === dich);
  if (t === undefined) return { cho: false, lyDo: `Không có terminal id "${dich}" trong workspace.` };
  if (t.agent === null) {
    return {
      cho: false,
      lyDo: `Terminal "${t.name}" là shell thường, không phải agent — gõ chữ vào đó là chạy lệnh tuỳ ý.`,
    };
  }
  if (t.state === 'closed') {
    return { cho: false, lyDo: `Terminal "${t.name}" đang đóng. Kích hoạt workspace để mở lại.` };
  }
  return { cho: true };
}

/** Id đi vào TÊN FILE: chỉ cho chữ, số, gạch — nếu không một id bịa ghi được ra ngoài thư mục. */
const ID_HOP_LE = /^[A-Za-z0-9_-]{1,64}$/;

function kiemId(id: string): void {
  if (!ID_HOP_LE.test(id)) throw new Error(`Id yêu cầu không hợp lệ: ${id}`);
}

export function thuMucYeuCau(orchDir: string, sep = '/'): string {
  return [orchDir, 'req'].join(sep);
}

export function thuMucPhanHoi(orchDir: string, sep = '/'): string {
  return [orchDir, 'res'].join(sep);
}

export function tenFileTrangThai(orchDir: string, sep = '/'): string {
  return [orchDir, 'status.json'].join(sep);
}

export function tenFileYeuCau(orchDir: string, id: string, sep = '/'): string {
  kiemId(id);
  return [thuMucYeuCau(orchDir, sep), `${id}.json`].join(sep);
}

export function tenFilePhanHoi(orchDir: string, id: string, sep = '/'): string {
  kiemId(id);
  return [thuMucPhanHoi(orchDir, sep), `${id}.json`].join(sep);
}

function laChuoi(v: unknown): v is string {
  return typeof v === 'string' && v !== '';
}

/**
 * Đọc một yêu cầu. Trả `null` thay vì ném với MỌI đầu vào xấu: file có thể được đọc đúng lúc
 * đang ghi dở, và ném ở đây là làm chết cả vòng xử lý vì một file rác.
 */
export function docYeuCau(raw: string): YeuCau | null {
  let o: Record<string, unknown>;
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p !== 'object' || p === null) return null;
    o = p as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!laChuoi(o.id) || !laChuoi(o.from) || typeof o.at !== 'number') return null;
  if (!laChuoi(o.text)) return null;
  if (o.type === 'report') {
    return { id: o.id, from: o.from, at: o.at, type: 'report', text: o.text };
  }
  if (o.type === 'dispatch' && laChuoi(o.terminalId)) {
    return { id: o.id, from: o.from, at: o.at, type: 'dispatch', terminalId: o.terminalId, text: o.text };
  }
  if (o.type === 'done') {
    // Đây mới là chỗ "schema-validated" thật: nhận bừa `outcome` thì kết quả có kiểu trở nên
    // vô nghĩa, và người điều phối sẽ tin vào một chữ mà nó không hiểu.
    const kc = KET_CUC.find((k) => k === o.outcome);
    if (kc === undefined) return null;
    // Một phần tử rác trong `files` không đáng làm hỏng cả báo cáo — lọc rồi đi tiếp.
    const files = Array.isArray(o.files) ? o.files.filter(laChuoi) : undefined;
    return {
      id: o.id,
      from: o.from,
      at: o.at,
      type: 'done',
      outcome: kc,
      text: o.text,
      ...(laChuoi(o.dispatchId) ? { dispatchId: o.dispatchId } : {}),
      ...(files === undefined ? {} : { files }),
    };
  }
  return null;
}

export function docTrangThai(raw: string): AnhChupTrangThai | null {
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p !== 'object' || p === null) return null;
    const o = p as Record<string, unknown>;
    if (!Array.isArray(o.agents)) return null;
    return {
      at: typeof o.at === 'number' ? o.at : 0,
      workspaceId: laChuoi(o.workspaceId) ? o.workspaceId : '',
      idDieuPhoi: laChuoi(o.idDieuPhoi) ? o.idDieuPhoi : null,
      agents: o.agents as AgentTrangThai[],
    };
  } catch {
    return null;
  }
}

export function docPhanHoi(raw: string): PhanHoi | null {
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p !== 'object' || p === null) return null;
    const o = p as Record<string, unknown>;
    if (!laChuoi(o.id) || typeof o.ok !== 'boolean') return null;
    return { id: o.id, ok: o.ok, message: laChuoi(o.message) ? o.message : '' };
  } catch {
    return null;
  }
}

/**
 * Yêu cầu quá hạn này thì không ai còn chờ nó nữa — MCP server bỏ cuộc sau 20 giây.
 *
 * Rộng hơn hạn chờ của server để tránh đua vô nghĩa, nhưng phải HỮU HẠN: file `req` còn nằm
 * lại sau khi server bỏ cuộc, và thi hành nó ở lần mở workspace sau là bơm chỉ thị của một
 * phiên đã chết vào một worker đang làm việc khác.
 */
export const HAN_YEU_CAU_MS = 60_000;

export function yeuCauConHan(yc: YeuCau, now: number, hanMs = HAN_YEU_CAU_MS): boolean {
  // Đồng hồ lùi (người dùng chỉnh giờ hệ thống) cho hiệu số âm — đó không phải "quá cũ".
  return now - yc.at <= hanMs;
}

export interface CauHinhMcp {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
}

/**
 * Cấu hình MCP nạp bằng `--mcp-config` cho terminal điều phối.
 *
 * `binary` là `process.execPath` — chính Electron của VS Code — cộng `ELECTRON_RUN_AS_NODE=1`
 * để nó chạy như node. Dùng `node` trần là đòi người dùng phải có node trong PATH, mà nhiều
 * máy chỉ cài VS Code.
 *
 * MỌI tham số nằm trong `args`, không có cái nào dựa vào biến môi trường kế thừa: env phải
 * sống sót qua hai tầng tiến trình (terminal → agent → server này), tầng nào nuốt thì cả cơ
 * chế chết im lặng và gần như không truy được.
 */
export function dungCauHinhMcp(
  binary: string,
  mcpJs: string,
  orchDir: string,
  terminalId: string,
  vai: 'worker' | 'orchestrator' = 'orchestrator',
): CauHinhMcp {
  return {
    mcpServers: {
      'ai-workspace': {
        command: binary,
        args: [mcpJs, '--orch', orchDir, '--self', terminalId, '--vai', vai],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
    },
  };
}

/**
 * Gộp một chỉ thị nhiều dòng về MỘT dòng.
 *
 * `sendText` gõ thẳng vào pty, và trong TUI của agent mỗi xuống dòng là một lần Enter — chỉ
 * thị nhiều dòng sẽ thành nhiều lượt, agent bắt tay làm khi mới đọc nửa câu. Mất ngắt dòng là
 * cái giá rẻ hơn nhiều so với một chỉ thị bị cắt đôi.
 */
export function gopVeMotDong(text: string): string {
  return text
    .split(/[\r\n]+/)
    .map((d) => d.trim())
    .filter((d) => d !== '')
    .join(' ');
}

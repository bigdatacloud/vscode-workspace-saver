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
  /**
   * Câu hỏi worker này đang treo chờ người điều phối trả lời. Có nó thì `wait` phải DỪNG:
   * người điều phối ngồi trong `wait` trong khi worker ngồi trong `ask` là bế tắc hai bên.
   */
  cauHoi?: CauHoiWorker;
}

/** Câu hỏi chặn của một worker — sống trong RAM của extension, đi ra ngoài qua `status.json`. */
export interface CauHoiWorker {
  id: string;
  text: string;
  at: number;
  dispatchId?: string;
}

/**
 * Một chỉ thị đang XẾP HÀNG: chỉ được giao khi mọi id trong `after` báo `succeeded`.
 * `text` đi kèm để người điều phối đọc lại được nó đã hứa giao gì.
 */
export interface ChoGiao {
  id: string;
  terminalId: string;
  after: string[];
  at: number;
  text: string;
}

/** Một chỉ thị đã bị huỷ khỏi hàng chờ — giữ lại vài dòng gần nhất để người điều phối thấy. */
export interface DaHuy {
  id: string;
  terminalId: string;
  lyDo: string;
  at: number;
}

export interface AnhChupTrangThai {
  at: number;
  workspaceId: string;
  /** Terminal đang giữ vai điều phối; null nếu chưa có ai. */
  idDieuPhoi: string | null;
  agents: AgentTrangThai[];
  /** Chỉ thị đang xếp hàng chờ việc trước xong. Vắng mặt = bản extension cũ, coi như rỗng. */
  hangCho?: ChoGiao[];
  daHuy?: DaHuy[];
}

export interface YeuCauDispatch {
  id: string;
  from: string;
  at: number;
  type: 'dispatch';
  terminalId: string;
  text: string;
  /** Chỉ giao sau khi các dispatch này báo `succeeded`. Vắng mặt = giao ngay. */
  after?: string[];
}

/**
 * Worker hỏi người điều phối và ĐỨNG CHỜ trong tool call cho tới khi có trả lời.
 *
 * Đi LÊN, không đi ngang: worker chỉ hỏi được người điều phối, nên độ sâu 1 vẫn nguyên. Câu
 * trả lời về bằng file `ans/<id>.json` chứ không qua `res/`: vòng req/res bị chặn 20 giây, còn
 * một câu hỏi thì có thể treo hàng phút.
 */
export interface YeuCauAsk {
  id: string;
  from: string;
  at: number;
  type: 'ask';
  text: string;
  dispatchId?: string;
}

export interface YeuCauReply {
  id: string;
  from: string;
  at: number;
  type: 'reply';
  askId: string;
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

/**
 * Trần cứng số thành viên một tổ.
 *
 * Không phải con số tuỳ tiện: mỗi thành viên là MỘT terminal, MỘT thư mục worktree và MỘT
 * nhánh git thật trên máy người dùng. Một đề xuất hai chục người gần như luôn là dấu hiệu mô
 * hình hiểu sai việc, và cái giá của việc tin nó thì người dùng gánh.
 */
export const TOI_DA_THANH_VIEN = 6;

/** Tên đi vào nhánh git và một đoạn đường dẫn — cùng bộ ký tự với ô nhập của người dùng. */
const TEN_GIT_HOP_LE = /^[\w.][\w.-]*$/;

export interface ThanhVienTeam {
  role: string;
  kind: 'worker';
  description: string;
}

/**
 * Orchestrator đề xuất lập tổ. Extension KHÔNG tạo gì cho tới khi người dùng duyệt danh sách.
 *
 * Cố ý chỉ cho `worker`: tổ do một người điều phối lập ra mà lại sinh thêm người điều phối là
 * đúng cái vòng đệ quy mà độ sâu 1 sinh ra để chặn.
 */
export interface YeuCauTeam {
  id: string;
  from: string;
  at: number;
  type: 'team';
  text: string;
  viec: string;
  thanhVien: ThanhVienTeam[];
}

export type YeuCau = YeuCauDispatch | YeuCauReport | YeuCauDone | YeuCauTeam | YeuCauAsk | YeuCauReply;

/** Lý do từ chối một đề xuất tổ; `null` nghĩa là hợp lệ. Trả CHUỖI để nói thẳng cho agent sửa. */
export function kiemTraTeam(team: Pick<YeuCauTeam, 'viec' | 'thanhVien'>): string | null {
  const viec = team.viec.trim();
  if (viec === '' || !TEN_GIT_HOP_LE.test(viec) || viec.includes('..')) {
    return 'tên việc phải hợp lệ cho nhánh git: chữ không dấu, số, . _ - và không bắt đầu bằng dấu gạch';
  }
  if (team.thanhVien.length === 0) return 'tổ phải có ít nhất một thành viên';
  if (team.thanhVien.length > TOI_DA_THANH_VIEN) {
    return `tổ tối đa ${TOI_DA_THANH_VIEN} thành viên; đề xuất ${team.thanhVien.length} là quá nhiều`;
  }
  const daCo = new Set<string>();
  for (const m of team.thanhVien) {
    const ten = m.role.trim();
    if (ten === '' || !TEN_GIT_HOP_LE.test(ten) || ten.includes('..')) {
      return `tên vai "${m.role}" không hợp lệ cho nhánh git: chữ không dấu, số, . _ - và không bắt đầu bằng dấu gạch`;
    }
    if (daCo.has(ten.toLowerCase())) return `tên vai trùng nhau: "${ten}"`;
    daCo.add(ten.toLowerCase());
    if (m.description.trim() === '') return `vai "${ten}" thiếu mô tả — một vai không mô tả là vai vô dụng`;
  }
  return null;
}

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

/** Worker được hỏi không: phải là terminal trong workspace, và không phải chính người điều phối. */
export function xetAsk(
  from: string,
  idDieuPhoi: string | null,
  agents: readonly AgentTrangThai[],
): QuyetDinh {
  if (idDieuPhoi === null) {
    return { cho: false, lyDo: 'Workspace này chưa có terminal nào giữ vai điều phối — không có ai để hỏi.' };
  }
  if (from === idDieuPhoi) {
    return { cho: false, lyDo: 'Terminal điều phối không hỏi được chính mình; muốn hỏi người dùng thì dùng report.' };
  }
  if (!agents.some((a) => a.id === from)) {
    return { cho: false, lyDo: 'Terminal hỏi không thuộc workspace này.' };
  }
  return { cho: true };
}

export type QuyetDinhReply = { cho: true; terminalId: string } | { cho: false; lyDo: string };

/**
 * Chỉ người điều phối được trả lời, và chỉ trả lời câu hỏi ĐANG TREO.
 *
 * Bộ tool worker không có `reply`, nhưng vẫn kiểm `from` ở đây: cùng lý do với `xetDispatch` —
 * một file `req` ghi tay không được phép mạo danh người điều phối.
 */
export function xetReply(
  from: string,
  askId: string,
  idDieuPhoi: string | null,
  agents: readonly AgentTrangThai[],
): QuyetDinhReply {
  if (idDieuPhoi === null || from !== idDieuPhoi) {
    return { cho: false, lyDo: 'Chỉ terminal giữ vai điều phối mới trả lời được câu hỏi của worker.' };
  }
  const w = agents.find((a) => a.cauHoi?.id === askId);
  if (w === undefined) {
    return {
      cho: false,
      lyDo: `Không có câu hỏi nào đang treo với ask_id "${askId}" — có thể đã được trả lời, hết hạn, hoặc worker đã nhận việc mới.`,
    };
  }
  return { cho: true, terminalId: w.id };
}

/**
 * Phán quyết sống chết ba mức, học từ Orca: `unverifiable` KHÔNG phải chết.
 *
 * `open`/`loading` nghĩa là ta đang track terminal nhưng registry chưa (hoặc không còn) thấy
 * phiên — registry hỏng cũng rơi vào đây. Coi nó là chết rồi dừng chờ là bỏ rơi một worker
 * đang làm việc thật; coi nó là sống rồi tin tưởng là chờ một cái xác. Nên trả đúng chữ
 * "chưa xác minh được" và để người điều phối tự quyết.
 */
export type PhanQuyetSong = 'live' | 'unverifiable' | 'exited';

export function phanQuyetSong(state: TrangThaiAgent): PhanQuyetSong {
  if (state === 'closed' || state === 'error') return 'exited';
  if (state === 'open' || state === 'loading') return 'unverifiable';
  return 'live';
}

/** Trạng thái đã dừng tay — `wait` kết thúc ở đây (trừ khi còn hàng chờ nhắm vào nó). */
const DA_DUNG: ReadonlySet<TrangThaiAgent> = new Set(['idle', 'blocked', 'closed', 'error']);

/**
 * `wait` có nên dừng vì worker này không.
 *
 * Thứ tự ưu tiên là cố ý:
 *  1. terminal biến mất → dừng, chờ nữa vô ích;
 *  2. có câu hỏi treo → dừng NGAY, kể cả đang busy — không thì bế tắc hai bên;
 *  3. còn chỉ thị xếp hàng nhắm vào nó → CHƯA xong dù đang idle — không thì
 *     `dispatch A; dispatch B after A; wait [A,B]` trả về tức thì vì B đang rảnh;
 *  4. đã báo kết quả có kiểu → dừng;
 *  5. đã dừng tay → dừng; `open`/`loading` → chờ tiếp (vắng mặt không phải bằng chứng chết).
 */
export function nenDungCho(a: AgentTrangThai | undefined, hangCho: readonly ChoGiao[]): boolean {
  if (a === undefined) return true;
  if (a.cauHoi !== undefined) return true;
  if (hangCho.some((c) => c.terminalId === a.id)) return false;
  if (a.ketQua !== undefined) return true;
  return DA_DUNG.has(a.state);
}

/**
 * Tình trạng một dispatch trong SỔ theo id — khác `ketQuaWorker` (theo terminal, bị xoá khi
 * worker nhận việc mới): cổng của hàng chờ cần biết kết cục của ĐÚNG việc A, kể cả khi worker
 * làm A đã đi làm C.
 */
export type TinhTrangGiao = KetCuc | 'dangBay' | 'choGiao' | 'huy';

export type QuyetDinhGiaoSau = { ket: 'giao' } | { ket: 'cho' } | { ket: 'huy'; lyDo: string };

/**
 * Cổng ngầm của hàng chờ: giao khi MỌI việc trước `succeeded`; một việc `failed`/`blocked`/bị
 * huỷ/không có trong sổ thì HUỶ chứ không chờ mãi — chờ một việc đã hỏng là treo vô hạn.
 */
export function xetGiaoSau(
  after: readonly string[],
  so: ReadonlyMap<string, TinhTrangGiao>,
): QuyetDinhGiaoSau {
  let conCho = false;
  for (const id of after) {
    const t = so.get(id);
    if (t === 'succeeded') continue;
    if (t === 'dangBay' || t === 'choGiao') {
      conCho = true;
      continue;
    }
    if (t === undefined) {
      return { ket: 'huy', lyDo: `việc trước "${id}" không có trong sổ (gõ nhầm id, hoặc sổ đã mất sau reload)` };
    }
    return { ket: 'huy', lyDo: `việc trước "${id}" kết cục ${t}, không phải succeeded` };
  }
  return conCho ? { ket: 'cho' } : { ket: 'giao' };
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

export function thuMucTraLoi(orchDir: string, sep = '/'): string {
  return [orchDir, 'ans'].join(sep);
}

/** Câu trả lời cho một câu hỏi chặn — file riêng vì nó có thể tới sau `res/` hàng phút. */
export function tenFileTraLoi(orchDir: string, askId: string, sep = '/'): string {
  kiemId(askId);
  return [thuMucTraLoi(orchDir, sep), `${askId}.json`].join(sep);
}

export interface TraLoi {
  id: string;
  text: string;
  at: number;
}

export function docTraLoi(raw: string): TraLoi | null {
  try {
    const p: unknown = JSON.parse(raw);
    if (typeof p !== 'object' || p === null) return null;
    const o = p as Record<string, unknown>;
    if (!laChuoi(o.id) || !laChuoi(o.text) || typeof o.at !== 'number') return null;
    return { id: o.id, text: o.text, at: o.at };
  } catch {
    return null;
  }
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
    const goc: YeuCauDispatch = { id: o.id, from: o.from, at: o.at, type: 'dispatch', terminalId: o.terminalId, text: o.text };
    if (o.after === undefined) return goc;
    // Một phần tử rác trong `after` làm hỏng CẢ yêu cầu, không lọc im: lọc im là âm thầm bỏ
    // một điều kiện tiên quyết, và chỉ thị sẽ được giao trong khi việc trước chưa xong.
    if (!Array.isArray(o.after) || !o.after.every(laChuoi)) return null;
    return { ...goc, after: [...o.after] };
  }
  if (o.type === 'ask') {
    return {
      id: o.id,
      from: o.from,
      at: o.at,
      type: 'ask',
      text: o.text,
      ...(laChuoi(o.dispatchId) ? { dispatchId: o.dispatchId } : {}),
    };
  }
  if (o.type === 'reply') {
    if (!laChuoi(o.askId)) return null;
    return { id: o.id, from: o.from, at: o.at, type: 'reply', askId: o.askId, text: o.text };
  }
  if (o.type === 'team') {
    if (!laChuoi(o.viec) || !Array.isArray(o.thanhVien)) return null;
    const tv: ThanhVienTeam[] = [];
    for (const raw of o.thanhVien) {
      if (typeof raw !== 'object' || raw === null) return null;
      const m = raw as Record<string, unknown>;
      // Phần tử rác làm hỏng CẢ đề xuất, không lọc bỏ im lặng: khác `files` của report_done
      // (mất một đường dẫn là chuyện nhỏ), ở đây mỗi phần tử là một terminal và một nhánh git
      // sắp được tạo — lọc im lặng nghĩa là tạo sai số lượng so với cái người dùng đã duyệt.
      if (!laChuoi(m.role) || !laChuoi(m.description)) return null;
      tv.push({ role: m.role, kind: 'worker', description: m.description });
    }
    return { id: o.id, from: o.from, at: o.at, type: 'team', text: o.text, viec: o.viec, thanhVien: tv };
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
      ...(Array.isArray(o.hangCho) ? { hangCho: o.hangCho as ChoGiao[] } : {}),
      ...(Array.isArray(o.daHuy) ? { daHuy: o.daHuy as DaHuy[] } : {}),
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

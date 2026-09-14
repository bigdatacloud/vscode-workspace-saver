/**
 * MCP server cấp công cụ điều phối cho agent giữ vai orchestrator.
 *
 * Chạy như TIẾN TRÌNH CON của agent (claude/codex spawn nó theo `--mcp-config`), nên tuyệt
 * đối không import `vscode`. Mọi việc chỉ extension host làm được — bơm chữ vào một terminal,
 * ghi khung kiểm toán — đi qua bus file: ghi `req/<id>.json`, chờ `res/<id>.json`.
 *
 * Mọi tham số vào bằng ARGV chứ không bằng biến môi trường: env phải sống sót qua hai tầng
 * tiến trình (terminal → agent → server này), tầng nào nuốt thì cả cơ chế chết im lặng.
 */

import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { claudeHomeMacDinh, duongDanTranscript, tomTatTranscript } from '../claude/transcript';
import {
  docPhanHoi,
  docTraLoi,
  docTrangThai,
  KET_CUC,
  kiemTraTeam,
  nenDungCho,
  phanQuyetSong,
  TOI_DA_THANH_VIEN,
  tenFilePhanHoi,
  tenFileTraLoi,
  tenFileTrangThai,
  tenFileYeuCau,
  thuMucPhanHoi,
  thuMucYeuCau,
  type AgentTrangThai,
  type AnhChupTrangThai,
  type ChoGiao,
  type ThanhVienTeam,
} from './bus';
import { taoBoXuLyRpc, type KetQuaTool, type ToolDef } from './rpc';

const TEN_SERVER = 'ai-workspace';
const PHIEN_BAN = '0.0.1';

/** Nhịp poll bus. Đơn vị thời gian ở đây là "agent làm xong một việc", 300ms là quá đủ mịn. */
const NHIP_POLL_MS = 300;
const HAN_DISPATCH_MS = 20_000;
const HAN_WAIT_MAC_DINH_MS = 300_000;
const HAN_WAIT_TOI_DA_MS = 900_000;
/** Worker đứng chờ trả lời tối đa chừng này mỗi lần gọi `ask`; hết thì gọi lại với `ask_id`. */
const HAN_HOI_MAC_DINH_MS = 600_000;

/**
 * stdin đã đóng = agent đã thoát. Các vòng poll dài (`wait`, `ask`) phải nhìn cờ này: không thì
 * một worker thoát giữa lúc hỏi để lại tiến trình mồ côi ngồi poll file tới 15 phút.
 */
let stdinDaDong = false;

interface ThamSo {
  orchDir: string;
  self: string;
  /** Bộ tool được cấp phụ thuộc vai: worker chỉ có report_done và ask (đều đi lên). */
  vai: 'worker' | 'orchestrator';
}

function docThamSo(argv: readonly string[]): ThamSo {
  const lay = (ten: string): string => {
    const i = argv.indexOf(ten);
    const v = i === -1 ? undefined : argv[i + 1];
    if (v === undefined || v === '') throw new Error(`Thiếu tham số ${ten}`);
    return v;
  };
  const tuyChon = (ten: string): string | undefined => {
    const i = argv.indexOf(ten);
    return i === -1 ? undefined : argv[i + 1];
  };
  // Cấu hình do bản extension cũ ghi không có `--vai`, mà bản đó chỉ cấp MCP cho điều phối —
  // nên mặc định 'orchestrator' là đúng với dữ liệu cũ, không phải nới lỏng.
  return {
    orchDir: lay('--orch'),
    self: lay('--self'),
    vai: tuyChon('--vai') === 'worker' ? 'worker' : 'orchestrator',
  };
}

function docFile(p: string): string | null {
  try {
    return nodeFs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function ngu(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function docAnhChup(ts: ThamSo): AnhChupTrangThai | null {
  const raw = docFile(tenFileTrangThai(ts.orchDir, path.sep));
  return raw === null ? null : docTrangThai(raw);
}

/** Ghi nguyên tử: tạm + rename. Bên đọc không bao giờ thấy file ghi dở. */
function ghiNguyenTu(duongDan: string, noiDung: string): void {
  nodeFs.mkdirSync(path.dirname(duongDan), { recursive: true });
  const tam = `${duongDan}.tmp-${randomUUID().slice(0, 8)}`;
  nodeFs.writeFileSync(tam, noiDung, 'utf8');
  nodeFs.renameSync(tam, duongDan);
}

/** Gửi một yêu cầu cần extension thực hiện, rồi chờ phản hồi. */
async function goiYeuCau(
  ts: ThamSo,
  than: Record<string, unknown>,
  id: string = randomUUID(),
): Promise<KetQuaTool> {
  nodeFs.mkdirSync(thuMucYeuCau(ts.orchDir, path.sep), { recursive: true });
  nodeFs.mkdirSync(thuMucPhanHoi(ts.orchDir, path.sep), { recursive: true });
  ghiNguyenTu(
    tenFileYeuCau(ts.orchDir, id, path.sep),
    JSON.stringify({ id, from: ts.self, at: Date.now(), ...than }),
  );

  const fileRes = tenFilePhanHoi(ts.orchDir, id, path.sep);
  const han = Date.now() + HAN_DISPATCH_MS;
  while (Date.now() < han && !stdinDaDong) {
    const raw = docFile(fileRes);
    if (raw !== null) {
      const ph = docPhanHoi(raw);
      try {
        nodeFs.unlinkSync(fileRes);
      } catch {
        /* dọn được thì tốt, không thì thôi */
      }
      if (ph !== null) return { text: ph.message, ...(ph.ok ? {} : { loi: true }) };
    }
    await ngu(NHIP_POLL_MS);
  }
  return {
    text: 'Extension không phản hồi trong 20 giây. Cửa sổ VS Code có thể đã đóng hoặc workspace đã bị đóng.',
    loi: true,
  };
}

const CHU_PHAN_QUYET = {
  live: 'sống',
  unverifiable: 'CHƯA XÁC MINH ĐƯỢC (registry không thấy phiên — chưa chắc chết)',
  exited: 'đã thoát',
} as const;

function motDong(a: AgentTrangThai): string {
  // Phán quyết ba mức đứng cạnh trạng thái: `open` một mình không nói được là sống hay chết.
  const phan = [`${a.id}  ${a.name}`, `${a.state} [${CHU_PHAN_QUYET[phanQuyetSong(a.state)]}]`];
  if (a.roleName !== undefined) phan.push(`vai=${a.roleName}${a.roleKind === 'orchestrator' ? '(điều phối)' : ''}`);
  phan.push(a.agent === null ? 'shell' : a.agent);
  if (a.branch !== undefined) phan.push(`nhánh=${a.branch}`);
  if (a.cwd !== undefined) phan.push(a.cwd);
  let dong = phan.join('  ·  ');
  // Kết quả có kiểu đứng thành dòng riêng: nó là thứ đáng đọc nhất, đừng để nó lẫn vào đuôi
  // một dòng dài toàn đường dẫn.
  if (a.ketQua !== undefined) {
    const f = a.ketQua.files === undefined || a.ketQua.files.length === 0 ? '' : ` [${a.ketQua.files.join(', ')}]`;
    dong += `
    ↳ ĐÃ BÁO XONG (${a.ketQua.outcome}): ${a.ketQua.text}${f}`;
  }
  // Hai lý do dừng khác nhau, hành động kế khác nhau: câu hỏi thì BẠN trả lời được bằng
  // `reply`; còn `blocked` là Claude chờ người dùng bấm quyền — chỉ người dùng gỡ được.
  if (a.cauHoi !== undefined) {
    dong += `
    ↳ ĐANG HỎI (ask_id=${a.cauHoi.id}): ${a.cauHoi.text} — trả lời bằng tool reply`;
  } else if (a.state === 'blocked') {
    dong += `
    ↳ đang chờ người dùng bấm quyền — chỉ người dùng gỡ được, không phải bạn`;
  }
  return dong;
}

/** Hàng chờ và các dòng huỷ gần nhất — đi kèm mọi bức ảnh trạng thái để không có gì bị giấu. */
function phanHangCho(anh: AnhChupTrangThai): string {
  const ra: string[] = [];
  const hang = anh.hangCho ?? [];
  if (hang.length > 0) {
    ra.push('HÀNG CHỜ (giao khi mọi việc trước succeeded):');
    for (const c of hang) ra.push(`  ${c.id} → ${c.terminalId}  sau [${c.after.join(', ')}]: ${c.text}`);
  }
  const huy = anh.daHuy ?? [];
  if (huy.length > 0) {
    ra.push('ĐÃ HUỶ khỏi hàng chờ:');
    for (const h of huy) ra.push(`  ${h.id} → ${h.terminalId}: ${h.lyDo}`);
  }
  return ra.length === 0 ? '' : `\n${ra.join('\n')}`;
}

const TOOL_REPORT_DONE: ToolDef = {
  name: 'report_done',
  description:
    'Báo cho người điều phối rằng việc được giao đã xong, kèm kết cục có kiểu. Gọi nó khi làm xong việc mà dispatch giao cho bạn — trạng thái "rảnh" không phân biệt được "xong việc" với "đang chờ bạn bấm", nên không gọi thì người điều phối phải đi đoán.',
  inputSchema: {
    type: 'object',
    properties: {
      outcome: {
        type: 'string',
        enum: [...KET_CUC],
        description: 'succeeded = xong và đạt; failed = đã thử và hỏng; blocked = kẹt, cần quyết',
      },
      summary: { type: 'string', description: 'tóm tắt ngắn: đã làm gì, kết quả ra sao' },
      dispatch_id: { type: 'string', description: 'id nêu trong chỉ thị được giao' },
      files: { type: 'array', items: { type: 'string' }, description: 'file đã sửa' },
    },
    required: ['outcome', 'summary'],
    additionalProperties: false,
  },
};

const TOOL_ASK: ToolDef = {
  name: 'ask',
  description:
    `Hỏi người điều phối một câu và ĐỨNG CHỜ trả lời ngay trong tool call này (tối đa ${HAN_HOI_MAC_DINH_MS / 60_000} phút mỗi lần gọi). Chỉ hỏi khi thật sự kẹt vì thiếu một quyết định — câu hỏi chặn chính bạn. Hết thời gian mà chưa có trả lời thì gọi lại với ask_id để chờ tiếp, đừng hỏi lại câu mới. Muốn báo xong hoặc báo kẹt hẳn thì dùng report_done, không dùng cái này.`,
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'câu hỏi, nêu rõ các phương án nếu có' },
      dispatch_id: { type: 'string', description: 'id nêu trong chỉ thị được giao, nếu đang làm việc được giao' },
      ask_id: { type: 'string', description: 'chờ tiếp một câu hỏi đã gửi (khi lần gọi trước hết thời gian)' },
      timeout_ms: { type: 'number', description: `mặc định ${HAN_HOI_MAC_DINH_MS}, tối đa ${HAN_WAIT_TOI_DA_MS}` },
    },
    additionalProperties: false,
  },
};

/** Bảy tool của người điều phối; worker có `report_done` và `ask`. */
const TOOLS_DIEU_PHOI: ToolDef[] = [
  {
    name: 'list_agents',
    description:
      'Liệt kê mọi terminal trong workspace: id, tên, vai, trạng thái, thư mục, nhánh. Gọi cái này trước khi làm gì khác — đừng đoán id.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_transcript',
    description:
      'Đọc N lượt cuối trong hội thoại của một worker: nó đã gọi tool gì, đụng file nào. Dùng để KIỂM TRA bài làm thay vì tin lời tự thuật.',
    inputSchema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'id lấy từ list_agents' },
        turns: { type: 'number', description: 'số lượt cuối cần đọc (mặc định 20)' },
      },
      required: ['terminal_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'dispatch',
    description:
      'Gửi chỉ thị vào phiên đang chạy của một worker. Chữ được gõ thẳng vào agent đó, nên viết rõ việc và rõ tiêu chí xong. Xuống dòng bị gộp thành khoảng trắng (trong TUI mỗi xuống dòng là một lần Enter) — hãy viết một đoạn liền mạch. Kết quả trả về id của lần giao; đưa id đó vào `after` của một dispatch khác để XẾP HÀNG: chỉ thị sau chỉ được giao khi mọi việc trong `after` báo succeeded, một việc failed/blocked thì chỉ thị sau bị huỷ và bạn thấy dòng ĐÃ HUỶ ở list_agents/wait.',
    inputSchema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'id lấy từ list_agents' },
        text: { type: 'string', description: 'nội dung chỉ thị' },
        after: {
          type: 'array',
          items: { type: 'string' },
          description: 'id các lần dispatch phải succeeded trước; bỏ trống = giao ngay',
        },
      },
      required: ['terminal_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'reply',
    description:
      'Trả lời một câu hỏi mà worker đang treo bằng ask (dòng ĐANG HỎI trong wait/list_agents). Câu trả lời về thẳng tool call của worker — KHÔNG gõ vào terminal nó, nên đừng dispatch thêm cùng nội dung.',
    inputSchema: {
      type: 'object',
      properties: {
        ask_id: { type: 'string', description: 'ask_id ở dòng ĐANG HỎI' },
        text: { type: 'string', description: 'câu trả lời' },
      },
      required: ['ask_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait',
    description:
      'Chờ tới khi các worker nêu tên BÁO XONG bằng report_done, HỎI bạn bằng ask (khi đó trả lời bằng reply rồi wait tiếp), hoặc dừng tay (rảnh / chờ người bấm / đã đóng). Worker còn chỉ thị xếp hàng nhắm vào nó thì chưa tính là xong. Trả về trạng thái, phán quyết sống chết và kết quả có kiểu của từng cái.',
    inputSchema: {
      type: 'object',
      properties: {
        terminal_ids: { type: 'array', items: { type: 'string' } },
        timeout_ms: { type: 'number', description: `mặc định ${HAN_WAIT_MAC_DINH_MS}, tối đa ${HAN_WAIT_TOI_DA_MS}` },
      },
      required: ['terminal_ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'report',
    description:
      'Ghi vào khung kiểm toán và báo cho người dùng. Dùng khi có kết luận, có rủi ro, hoặc khi cần họ quyết.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_team',
    description:
      `Đề xuất một tổ cho việc đang làm. Extension sẽ HỎI người dùng duyệt danh sách, rồi mới tạo: mỗi thành viên thành một terminal Claude, một worktree git riêng và một nhánh cùng tên. Chỉ gọi khi người dùng yêu cầu lập tổ. Tối đa ${TOI_DA_THANH_VIEN} thành viên — đề xuất đông hơn thường là dấu hiệu chia việc chưa đúng.`,
    inputSchema: {
      type: 'object',
      properties: {
        viec: {
          type: 'string',
          description: 'tên việc, chữ không dấu — thành tiền tố của nhánh git, ví dụ fix-login',
        },
        members: {
          type: 'array',
          minItems: 1,
          maxItems: TOI_DA_THANH_VIEN,
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', description: 'tên vai, chữ không dấu, ví dụ impl / reviewer / test' },
              description: {
                type: 'string',
                description: 'vai này chịu trách nhiệm gì, và KHÔNG được làm gì — đi thẳng vào system prompt của agent đó',
              },
            },
            required: ['role', 'description'],
            additionalProperties: false,
          },
        },
      },
      required: ['viec', 'members'],
      additionalProperties: false,
    },
  },
];

/**
 * Worker có đúng hai tool, cả hai đều đi LÊN người điều phối: báo xong và hỏi. Không có
 * `dispatch` — cấp nó là mở đường cho worker giao việc tiếp, phá độ sâu 1.
 */
const TOOLS_WORKER: ToolDef[] = [TOOL_REPORT_DONE, TOOL_ASK];

function chuoi(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Worker hỏi và đứng chờ. Hai pha: gửi `req` (ack trong 20 giây như mọi yêu cầu) rồi poll file
 * `ans/<askId>.json` tới khi có trả lời hoặc hết hạn. Không nhét cả hai vào một vòng req/res
 * vì vòng đó cố ý ngắn — một câu hỏi thì có thể treo hàng phút.
 */
async function hoi(ts: ThamSo, args: Record<string, unknown>): Promise<KetQuaTool> {
  const askIdCu = chuoi(args.ask_id);
  const question = chuoi(args.question);
  let askId: string;
  if (askIdCu !== '') {
    askId = askIdCu;
  } else {
    if (question === '') return { text: 'ask cần question (hoặc ask_id để chờ tiếp câu đã hỏi).', loi: true };
    askId = randomUUID();
    const ack = await goiYeuCau(
      ts,
      { type: 'ask', text: question, ...(chuoi(args.dispatch_id) === '' ? {} : { dispatchId: chuoi(args.dispatch_id) }) },
      askId,
    );
    if (ack.loi === true) return ack;
  }

  let fileAns: string;
  try {
    fileAns = tenFileTraLoi(ts.orchDir, askId, path.sep);
  } catch {
    return { text: `ask_id "${askId}" không hợp lệ.`, loi: true };
  }
  const yeuCau = typeof args.timeout_ms === 'number' ? args.timeout_ms : HAN_HOI_MAC_DINH_MS;
  const choMs = Math.min(Math.max(yeuCau, NHIP_POLL_MS), HAN_WAIT_TOI_DA_MS);
  const han = Date.now() + choMs;
  const docTraLoiFile = (): KetQuaTool | null => {
    const raw = docFile(fileAns);
    if (raw === null) return null;
    const tl = docTraLoi(raw);
    try {
      nodeFs.unlinkSync(fileAns);
    } catch {
      /* dọn được thì tốt */
    }
    return tl === null ? null : { text: `Trả lời của người điều phối: ${tl.text}` };
  };
  for (;;) {
    const tl = docTraLoiFile();
    if (tl !== null) return tl;
    if (stdinDaDong) return { text: 'Phiên đã đóng trong lúc chờ trả lời.', loi: true };
    if (Date.now() >= han) break;
    // Câu hỏi đã bị gỡ khỏi trạng thái (hết hạn, hoặc bạn vừa nhận việc mới) mà không có trả
    // lời → nói thẳng, đừng để worker chờ một câu trả lời sẽ không bao giờ tới.
    const anh = docAnhChup(ts);
    if (anh !== null && !anh.agents.some((a) => a.cauHoi?.id === askId)) {
      // Extension ghi file trả lời TRƯỚC rồi mới gỡ câu hỏi — đọc lại một lần nữa để không
      // bỏ sót câu trả lời vừa tới giữa hai lần đọc.
      const muon = docTraLoiFile();
      if (muon !== null) return muon;
      return {
        text: `Câu hỏi ask_id=${askId} không còn treo (đã hết hạn, hoặc người điều phối đã giao việc mới cho bạn thay vì trả lời). Đọc lại chỉ thị mới nhất trong phiên rồi làm tiếp; còn kẹt thì hỏi lại bằng một câu hỏi mới.`,
        loi: true,
      };
    }
    await ngu(NHIP_POLL_MS);
  }
  return {
    text: `Chưa có trả lời sau ${choMs < 60_000 ? `${Math.round(choMs / 1000)} giây` : `${Math.round(choMs / 60_000)} phút`}. Gọi lại ask với ask_id="${askId}" để chờ tiếp; đừng gửi câu hỏi mới trùng nội dung.`,
    loi: true,
  };
}

async function goiTool(ts: ThamSo, ten: string, args: Record<string, unknown>): Promise<KetQuaTool> {
  if (ten === 'report_done') {
    const outcome = KET_CUC.find((k) => k === chuoi(args.outcome));
    const summary = chuoi(args.summary);
    if (outcome === undefined) {
      return { text: `outcome phải là một trong: ${KET_CUC.join(', ')}.`, loi: true };
    }
    if (summary === '') return { text: 'report_done cần summary.', loi: true };
    const files = Array.isArray(args.files)
      ? args.files.filter((x): x is string => typeof x === 'string')
      : undefined;
    return goiYeuCau(ts, {
      type: 'done',
      outcome,
      text: summary,
      ...(chuoi(args.dispatch_id) === '' ? {} : { dispatchId: chuoi(args.dispatch_id) }),
      ...(files === undefined || files.length === 0 ? {} : { files }),
    });
  }

  if (ten === 'ask') return hoi(ts, args);

  const anh = docAnhChup(ts);
  if (anh === null) {
    return {
      text: 'Chưa đọc được trạng thái workspace. Workspace phải đang mở trong VS Code thì mới điều phối được.',
      loi: true,
    };
  }

  if (ten === 'reply') {
    const askId = chuoi(args.ask_id);
    const text = chuoi(args.text);
    if (askId === '' || text === '') return { text: 'reply cần cả ask_id lẫn text.', loi: true };
    return goiYeuCau(ts, { type: 'reply', askId, text });
  }

  if (ten === 'list_agents') {
    if (anh.agents.length === 0) return { text: 'Workspace chưa có terminal nào.' };
    return { text: anh.agents.map(motDong).join('\n') + phanHangCho(anh) };
  }

  if (ten === 'read_transcript') {
    const id = chuoi(args.terminal_id);
    const a = anh.agents.find((x) => x.id === id);
    if (a === undefined) return { text: `Không có terminal id "${id}".`, loi: true };
    if (a.agent !== 'claude' || a.sessionId === undefined || a.cwd === undefined) {
      return {
        text: `Chưa đọc được hội thoại của "${a.name}": mới hỗ trợ terminal Claude đã có id phiên.`,
        loi: true,
      };
    }
    const duongDan = duongDanTranscript(claudeHomeMacDinh(), a.cwd, a.sessionId, path.sep);
    const raw = docFile(duongDan);
    if (raw === null) return { text: `Không đọc được ${duongDan}.`, loi: true };
    const soLuot = typeof args.turns === 'number' ? args.turns : 20;
    const tom = tomTatTranscript(raw, soLuot);
    return { text: tom === '' ? '(hội thoại còn trống)' : tom };
  }

  if (ten === 'dispatch') {
    const terminalId = chuoi(args.terminal_id);
    const text = chuoi(args.text);
    if (terminalId === '' || text === '') {
      return { text: 'dispatch cần cả terminal_id lẫn text.', loi: true };
    }
    const after = Array.isArray(args.after) ? args.after : [];
    if (!after.every((x): x is string => typeof x === 'string' && x !== '')) {
      return { text: 'after phải là danh sách id dạng chuỗi.', loi: true };
    }
    // Id lần giao do CHÍNH tool mint và trả về: người điều phối cần nó để xếp hàng việc kế.
    const id = randomUUID();
    const kq = await goiYeuCau(ts, { type: 'dispatch', terminalId, text, ...(after.length === 0 ? {} : { after }) }, id);
    return kq.loi === true ? kq : { text: `${kq.text} dispatch_id=${id}` };
  }

  if (ten === 'report') {
    const text = chuoi(args.text);
    if (text === '') return { text: 'report cần text.', loi: true };
    return goiYeuCau(ts, { type: 'report', text });
  }

  if (ten === 'propose_team') {
    const viec = chuoi(args.viec);
    const tho = Array.isArray(args.members) ? args.members : [];
    const thanhVien: ThanhVienTeam[] = [];
    for (const raw of tho) {
      if (typeof raw !== 'object' || raw === null) continue;
      const m = raw as Record<string, unknown>;
      thanhVien.push({ role: chuoi(m.role), kind: 'worker', description: chuoi(m.description) });
    }
    // Kiểm NGAY tại đây thay vì chỉ ở phía extension: agent nhận lỗi trong cùng lượt và sửa
    // được luôn, thay vì phải chờ một vòng bus rồi mới biết mình gõ sai tên vai.
    const loi = kiemTraTeam({ viec, thanhVien });
    if (loi !== null) return { text: `Đề xuất không hợp lệ: ${loi}.`, loi: true };
    return goiYeuCau(ts, {
      type: 'team',
      viec,
      thanhVien,
      text: `lập tổ ${thanhVien.length} người cho ${viec}`,
    });
  }

  if (ten === 'wait') {
    const ids = Array.isArray(args.terminal_ids) ? args.terminal_ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0) return { text: 'wait cần terminal_ids.', loi: true };
    const yeuCau = typeof args.timeout_ms === 'number' ? args.timeout_ms : HAN_WAIT_MAC_DINH_MS;
    const han = Date.now() + Math.min(Math.max(yeuCau, NHIP_POLL_MS), HAN_WAIT_TOI_DA_MS);
    for (;;) {
      const hienTai = docAnhChup(ts);
      const hang: readonly ChoGiao[] = hienTai?.hangCho ?? [];
      const dong = ids.map((id) => {
        const a = hienTai?.agents.find((x) => x.id === id);
        return a === undefined ? `${id}  KHÔNG CÒN` : motDong(a);
      });
      const duoi = hienTai === null ? '' : phanHangCho(hienTai);
      const xong = ids.every((id) => nenDungCho(hienTai?.agents.find((x) => x.id === id), hang));
      if (xong) return { text: dong.join('\n') + duoi };
      if (Date.now() >= han || stdinDaDong) {
        // Nêu phán quyết từng worker để người điều phối thôi đoán: "chưa xác minh được" nghĩa
        // là còn có thể sống — đừng vội giao lại việc cho người khác.
        return { text: `Hết thời gian chờ. Trạng thái hiện tại (xem phán quyết trong ngoặc vuông):\n${dong.join('\n')}${duoi}`, loi: true };
      }
      await ngu(NHIP_POLL_MS);
    }
  }

  return { text: `Tool "${ten}" chưa được cài đặt.`, loi: true };
}

export function chay(argv: readonly string[]): void {
  const ts = docThamSo(argv);
  const dsTool = ts.vai === 'worker' ? TOOLS_WORKER : TOOLS_DIEU_PHOI;
  const xuLy = taoBoXuLyRpc(TEN_SERVER, PHIEN_BAN, dsTool, (ten, args) => goiTool(ts, ten, args));

  let dem = '';
  let dangBay = 0;
  /**
   * Chỉ thoát khi stdin đã đóng VÀ không còn lời gọi nào đang bay.
   *
   * `dispatch` và `wait` chờ trên bus hàng giây; thoát ngay lúc stdin đóng là cắt ngang chúng
   * và agent không bao giờ nhận được kết quả của việc nó vừa yêu cầu.
   */
  const thoatNeuXong = (): void => {
    if (stdinDaDong && dangBay === 0) process.exit(0);
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    dem += chunk;
    // Mỗi thông điệp một dòng; phần đuôi chưa có xuống dòng là gói tin chưa về hết.
    for (;;) {
      const i = dem.indexOf('\n');
      if (i === -1) break;
      const dong = dem.slice(0, i);
      dem = dem.slice(i + 1);
      dangBay += 1;
      void xuLy(dong)
        .then((ra) => {
          if (ra !== null) process.stdout.write(`${ra}\n`);
        })
        .finally(() => {
          dangBay -= 1;
          thoatNeuXong();
        });
    }
  });
  // stdin đóng nghĩa là agent đã thoát — phục vụ nốt việc đang dở rồi mới đi.
  process.stdin.on('end', () => {
    stdinDaDong = true;
    thoatNeuXong();
  });
}

// Chỉ tự chạy khi được gọi như một chương trình, để test import module không khởi động server.
if (require.main === module) chay(process.argv.slice(2));

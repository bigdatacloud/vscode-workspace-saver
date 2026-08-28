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
  docTrangThai,
  tenFilePhanHoi,
  tenFileTrangThai,
  tenFileYeuCau,
  thuMucPhanHoi,
  thuMucYeuCau,
  type AgentTrangThai,
  type AnhChupTrangThai,
} from './bus';
import { taoBoXuLyRpc, type KetQuaTool, type ToolDef } from './rpc';

const TEN_SERVER = 'ai-workspace';
const PHIEN_BAN = '0.0.1';

/** Nhịp poll bus. Đơn vị thời gian ở đây là "agent làm xong một việc", 300ms là quá đủ mịn. */
const NHIP_POLL_MS = 300;
const HAN_DISPATCH_MS = 20_000;
const HAN_WAIT_MAC_DINH_MS = 300_000;
const HAN_WAIT_TOI_DA_MS = 900_000;

/** Trạng thái nghĩa là worker đã dừng tay — `wait` kết thúc ở những trạng thái này. */
const DA_DUNG = new Set(['idle', 'blocked', 'closed', 'error']);

interface ThamSo {
  orchDir: string;
  self: string;
}

function docThamSo(argv: readonly string[]): ThamSo {
  const lay = (ten: string): string => {
    const i = argv.indexOf(ten);
    const v = i === -1 ? undefined : argv[i + 1];
    if (v === undefined || v === '') throw new Error(`Thiếu tham số ${ten}`);
    return v;
  };
  return { orchDir: lay('--orch'), self: lay('--self') };
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
async function goiYeuCau(ts: ThamSo, than: Record<string, unknown>): Promise<KetQuaTool> {
  const id = randomUUID();
  nodeFs.mkdirSync(thuMucYeuCau(ts.orchDir, path.sep), { recursive: true });
  nodeFs.mkdirSync(thuMucPhanHoi(ts.orchDir, path.sep), { recursive: true });
  ghiNguyenTu(
    tenFileYeuCau(ts.orchDir, id, path.sep),
    JSON.stringify({ id, from: ts.self, at: Date.now(), ...than }),
  );

  const fileRes = tenFilePhanHoi(ts.orchDir, id, path.sep);
  const han = Date.now() + HAN_DISPATCH_MS;
  while (Date.now() < han) {
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

function motDong(a: AgentTrangThai): string {
  const phan = [`${a.id}  ${a.name}`, a.state];
  if (a.roleName !== undefined) phan.push(`vai=${a.roleName}${a.roleKind === 'orchestrator' ? '(điều phối)' : ''}`);
  phan.push(a.agent === null ? 'shell' : a.agent);
  if (a.branch !== undefined) phan.push(`nhánh=${a.branch}`);
  if (a.cwd !== undefined) phan.push(a.cwd);
  return phan.join('  ·  ');
}

const TOOLS: ToolDef[] = [
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
      'Gửi chỉ thị vào phiên đang chạy của một worker. Chữ được gõ thẳng vào agent đó, nên viết rõ việc và rõ tiêu chí xong. Xuống dòng bị gộp thành khoảng trắng (trong TUI mỗi xuống dòng là một lần Enter) — hãy viết một đoạn liền mạch.',
    inputSchema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'id lấy từ list_agents' },
        text: { type: 'string', description: 'nội dung chỉ thị' },
      },
      required: ['terminal_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait',
    description:
      'Chờ tới khi các worker nêu tên dừng tay (rảnh, hoặc đang chờ người bấm, hoặc đã đóng). Trả về trạng thái cuối cùng của từng cái.',
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
];

function chuoi(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function goiTool(ts: ThamSo, ten: string, args: Record<string, unknown>): Promise<KetQuaTool> {
  const anh = docAnhChup(ts);
  if (anh === null) {
    return {
      text: 'Chưa đọc được trạng thái workspace. Workspace phải đang mở trong VS Code thì mới điều phối được.',
      loi: true,
    };
  }

  if (ten === 'list_agents') {
    if (anh.agents.length === 0) return { text: 'Workspace chưa có terminal nào.' };
    return { text: anh.agents.map(motDong).join('\n') };
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
    return goiYeuCau(ts, { type: 'dispatch', terminalId, text });
  }

  if (ten === 'report') {
    const text = chuoi(args.text);
    if (text === '') return { text: 'report cần text.', loi: true };
    return goiYeuCau(ts, { type: 'report', text });
  }

  if (ten === 'wait') {
    const ids = Array.isArray(args.terminal_ids) ? args.terminal_ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0) return { text: 'wait cần terminal_ids.', loi: true };
    const yeuCau = typeof args.timeout_ms === 'number' ? args.timeout_ms : HAN_WAIT_MAC_DINH_MS;
    const han = Date.now() + Math.min(Math.max(yeuCau, NHIP_POLL_MS), HAN_WAIT_TOI_DA_MS);
    for (;;) {
      const hienTai = docAnhChup(ts);
      const dong = ids.map((id) => {
        const a = hienTai?.agents.find((x) => x.id === id);
        return a === undefined ? `${id}  KHÔNG CÒN` : motDong(a);
      });
      const xong = ids.every((id) => {
        const a = hienTai?.agents.find((x) => x.id === id);
        return a === undefined || DA_DUNG.has(a.state);
      });
      if (xong) return { text: dong.join('\n') };
      if (Date.now() >= han) {
        return { text: `Hết thời gian chờ. Trạng thái hiện tại:\n${dong.join('\n')}`, loi: true };
      }
      await ngu(NHIP_POLL_MS);
    }
  }

  return { text: `Tool "${ten}" chưa được cài đặt.`, loi: true };
}

export function chay(argv: readonly string[]): void {
  const ts = docThamSo(argv);
  const xuLy = taoBoXuLyRpc(TEN_SERVER, PHIEN_BAN, TOOLS, (ten, args) => goiTool(ts, ten, args));

  let dem = '';
  let dangBay = 0;
  let stdinDaDong = false;
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

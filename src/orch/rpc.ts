/**
 * JSON-RPC 2.0 tối giản cho MCP trên stdio: mỗi thông điệp một dòng.
 *
 * Tự viết thay vì thêm SDK: bốn method (`initialize`, `notifications/*`, `tools/list`,
 * `tools/call`) là toàn bộ những gì một server chỉ-có-tool cần, và một dependency mới trong
 * vsix là thứ phải bảo trì mãi.
 *
 * Module này KHÔNG import vscode — nó chạy trong tiến trình con của agent.
 */

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface KetQuaTool {
  text: string;
  loi?: boolean;
}

const PHIEN_BAN_MAC_DINH = '2025-06-18';

function traLoi(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function traLoi_Loi(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function noiDung(text: string, loi = false): Record<string, unknown> {
  return { content: [{ type: 'text', text }], ...(loi ? { isError: true } : {}) };
}

/**
 * @param tenServer Tên khai với client, hiện trong danh sách MCP của agent.
 * @param goiTool Thực thi một tool. Ném lỗi cũng không sao — nó thành `isError` chứ không
 *   thành lỗi giao thức. MCP phân biệt "giao thức hỏng" với "tool chạy hỏng"; lẫn hai cái là
 *   client ngắt kết nối vì một tool lỗi vặt.
 */
export function taoBoXuLyRpc(
  tenServer: string,
  phienBanServer: string,
  dsTool: readonly ToolDef[],
  goiTool: (ten: string, args: Record<string, unknown>) => Promise<KetQuaTool>,
): (raw: string) => Promise<string | null> {
  return async (raw: string): Promise<string | null> => {
    if (raw.trim() === '') return null;

    let msg: Record<string, unknown>;
    try {
      const p: unknown = JSON.parse(raw);
      if (typeof p !== 'object' || p === null) throw new Error('không phải object');
      msg = p as Record<string, unknown>;
    } catch {
      return traLoi_Loi(null, -32700, 'Parse error');
    }

    const id = msg.id;
    const method = typeof msg.method === 'string' ? msg.method : '';
    // Thông báo (không có id) KHÔNG bao giờ được trả lời — trả lời là vi phạm giao thức.
    const laThongBao = id === undefined || id === null;

    if (method.startsWith('notifications/')) return null;

    if (method === 'initialize') {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      // ĐÁP LẠI đúng phiên bản client hỏi: trả về một phiên bản khác là cách nhanh nhất để
      // client bỏ kết nối.
      const pv = typeof params.protocolVersion === 'string' ? params.protocolVersion : PHIEN_BAN_MAC_DINH;
      if (laThongBao) return null;
      return traLoi(id, {
        protocolVersion: pv,
        capabilities: { tools: {} },
        serverInfo: { name: tenServer, version: phienBanServer },
      });
    }

    if (method === 'tools/list') {
      if (laThongBao) return null;
      return traLoi(id, { tools: dsTool.map((t) => ({ ...t })) });
    }

    if (method === 'tools/call') {
      if (laThongBao) return null;
      const params = (msg.params ?? {}) as Record<string, unknown>;
      const ten = typeof params.name === 'string' ? params.name : '';
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (!dsTool.some((t) => t.name === ten)) {
        return traLoi(id, noiDung(`Không có tool tên "${ten}".`, true));
      }
      try {
        const r = await goiTool(ten, args);
        return traLoi(id, noiDung(r.text, r.loi === true));
      } catch (e) {
        return traLoi(id, noiDung(e instanceof Error ? e.message : String(e), true));
      }
    }

    if (laThongBao) return null;
    return traLoi_Loi(id, -32601, `Method not found: ${method}`);
  };
}

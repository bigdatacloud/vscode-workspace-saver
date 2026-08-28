import { describe, expect, it, vi } from 'vitest';
import { taoBoXuLyRpc, type ToolDef } from '../../src/orch/rpc';

const TOOLS: ToolDef[] = [
  { name: 'list_agents', description: 'liệt kê', inputSchema: { type: 'object', properties: {} } },
  { name: 'dispatch', description: 'giao việc', inputSchema: { type: 'object', properties: {} } },
];

function boXuLy(goi = vi.fn(async () => ({ text: 'xong' }))) {
  return { xuLy: taoBoXuLyRpc('thu-nghiem', '9.9.9', TOOLS, goi), goi };
}

const doc = async (raw: string): Promise<Record<string, unknown> | null> => {
  const { xuLy } = boXuLy();
  const r = await xuLy(raw);
  return r === null ? null : (JSON.parse(r) as Record<string, unknown>);
};

describe('bộ xử lý JSON-RPC của MCP server', () => {
  it('initialize trả về capabilities có tools và tên server', async () => {
    const r = await doc('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}');
    const kq = r?.result as Record<string, unknown>;
    expect(kq.capabilities).toHaveProperty('tools');
    expect((kq.serverInfo as Record<string, string>).name).toBe('thu-nghiem');
    expect(r?.id).toBe(1);
  });

  it('initialize ĐÁP LẠI đúng phiên bản giao thức client yêu cầu', async () => {
    // Trả về một phiên bản khác cái client hỏi là cách nhanh nhất để client bỏ kết nối.
    const r = await doc('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}');
    expect((r?.result as Record<string, string>).protocolVersion).toBe('2024-11-05');
  });

  it('thông báo (không có id) KHÔNG được trả lời', async () => {
    expect(await doc('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBeNull();
  });

  it('tools/list liệt kê đủ tool kèm inputSchema', async () => {
    const r = await doc('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
    const ds = (r?.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
    expect(ds.map((t) => t.name)).toEqual(['list_agents', 'dispatch']);
    expect(ds[0]?.inputSchema).toBeDefined();
  });

  it('tools/call chuyển đúng tên và tham số xuống hàm gọi', async () => {
    const { xuLy, goi } = boXuLy();
    const raw = await xuLy('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"dispatch","arguments":{"terminal_id":"x"}}}');
    expect(goi).toHaveBeenCalledWith('dispatch', { terminal_id: 'x' });
    const r = JSON.parse(raw ?? '') as { result: { content: { type: string; text: string }[] } };
    expect(r.result.content[0]).toEqual({ type: 'text', text: 'xong' });
  });

  it('tool không tồn tại → isError trong result, KHÔNG phải lỗi giao thức', async () => {
    // MCP phân biệt hai chuyện: giao thức hỏng, và tool chạy hỏng. Lẫn lộn là client ngắt kết nối.
    const r = await doc('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"khong-co"}}');
    expect(r?.error).toBeUndefined();
    expect((r?.result as { isError: boolean }).isError).toBe(true);
  });

  it('tool ném lỗi → isError, server vẫn sống', async () => {
    const { xuLy } = boXuLy(vi.fn(async () => { throw new Error('hỏng rồi'); }));
    const raw = await xuLy('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"dispatch"}}');
    const r = JSON.parse(raw ?? '') as { result: { isError: boolean; content: { text: string }[] } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0]?.text).toContain('hỏng rồi');
  });

  it('method lạ → lỗi -32601', async () => {
    const r = await doc('{"jsonrpc":"2.0","id":6,"method":"khong/co"}');
    expect((r?.error as { code: number }).code).toBe(-32601);
  });

  it('JSON hỏng → lỗi -32700 chứ không làm sập tiến trình', async () => {
    const r = await doc('{khong phai json');
    expect((r?.error as { code: number }).code).toBe(-32700);
  });

  it('dòng trống bị bỏ qua', async () => {
    expect(await doc('   ')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  docYeuCau,
  dungCauHinhMcp,
  gopVeMotDong,
  tenFileYeuCau,
  xetDispatch,
  type AgentTrangThai,
} from '../../src/orch/bus';

const SEP = '/';
const DIEU_PHOI = 'sep';
const WORKER = 'linh';

const ag = (over: Partial<AgentTrangThai> & { id: string }): AgentTrangThai => ({
  name: over.id,
  state: 'idle',
  agent: 'claude',
  ...over,
});

const DS: AgentTrangThai[] = [
  ag({ id: DIEU_PHOI, roleKind: 'orchestrator' }),
  ag({ id: WORKER, roleKind: 'worker' }),
  ag({ id: 'shell', agent: null }),
  ag({ id: 'daDong', state: 'closed' }),
];

describe('xetDispatch', () => {
  it('điều phối gửi cho worker đang chạy agent → cho phép', () => {
    expect(xetDispatch(DIEU_PHOI, WORKER, DIEU_PHOI, DS)).toEqual({ cho: true });
  });

  it('WORKER gửi đi → từ chối: độ sâu điều phối là 1', () => {
    // Không chặn ở đây thì worker đẻ worker và cả workspace thành bom đệ quy.
    const r = xetDispatch(WORKER, DIEU_PHOI, DIEU_PHOI, DS);
    expect(r.cho).toBe(false);
    if (!r.cho) expect(r.lyDo).toMatch(/điều phối|độ sâu/i);
  });

  it('workspace chưa có ai giữ vai điều phối → từ chối', () => {
    expect(xetDispatch(DIEU_PHOI, WORKER, null, DS).cho).toBe(false);
  });

  it('tự gửi cho chính mình → từ chối', () => {
    expect(xetDispatch(DIEU_PHOI, DIEU_PHOI, DIEU_PHOI, DS).cho).toBe(false);
  });

  it('đích là SHELL TRẦN → từ chối', () => {
    // Bơm chữ vào shell trần chính là thực thi lệnh tuỳ ý.
    const r = xetDispatch(DIEU_PHOI, 'shell', DIEU_PHOI, DS);
    expect(r.cho).toBe(false);
    if (!r.cho) expect(r.lyDo).toMatch(/agent/i);
  });

  it('đích đã đóng → từ chối', () => {
    expect(xetDispatch(DIEU_PHOI, 'daDong', DIEU_PHOI, DS).cho).toBe(false);
  });

  it('đích không tồn tại → từ chối', () => {
    expect(xetDispatch(DIEU_PHOI, 'khong-co', DIEU_PHOI, DS).cho).toBe(false);
  });
});

describe('tên file yêu cầu', () => {
  it('nằm trong thư mục req và mang đúng id', () => {
    expect(tenFileYeuCau('C:/gs/orch/w', 'abc', SEP)).toBe('C:/gs/orch/w/req/abc.json');
  });

  it('id có ký tự đường dẫn thì KHÔNG được thoát ra khỏi thư mục', () => {
    // Id đi vào tên file; không lọc thì một id bịa như '../../evil' ghi ra ngoài orch dir.
    expect(() => tenFileYeuCau('C:/gs/orch/w', '../evil', SEP)).toThrow();
    expect(() => tenFileYeuCau('C:/gs/orch/w', 'a/b', SEP)).toThrow();
  });
});

describe('docYeuCau', () => {
  it('đọc được yêu cầu dispatch hợp lệ', () => {
    const r = docYeuCau('{"id":"1","from":"sep","at":1,"type":"dispatch","terminalId":"linh","text":"làm đi"}');
    expect(r?.type).toBe('dispatch');
    if (r?.type === 'dispatch') expect(r.text).toBe('làm đi');
  });

  it('đọc được yêu cầu report', () => {
    expect(docYeuCau('{"id":"1","from":"sep","at":1,"type":"report","text":"xong"}')?.type).toBe('report');
  });

  it('JSON hỏng hoặc thiếu trường → null, KHÔNG ném', () => {
    // File có thể bị đọc lúc đang ghi dở. Ném ở đây là làm chết vòng xử lý.
    expect(docYeuCau('{khong phai json')).toBeNull();
    expect(docYeuCau('{"id":"1","type":"dispatch"}')).toBeNull();
    expect(docYeuCau('{"id":"1","from":"s","at":1,"type":"loai-la","text":"x"}')).toBeNull();
  });

  it('dispatch thiếu terminalId → null', () => {
    expect(docYeuCau('{"id":"1","from":"s","at":1,"type":"dispatch","text":"x"}')).toBeNull();
  });
});

describe('dungCauHinhMcp', () => {
  const ch = dungCauHinhMcp('C:/Code/Code.exe', 'C:/ext/dist/mcp.js', 'C:/gs/orch/w1', 'term-1');

  it('trỏ vào chính binary đang chạy kèm ELECTRON_RUN_AS_NODE', () => {
    // Dùng `node` trần là đòi người dùng phải có node trong PATH — nhiều máy chỉ có VS Code.
    const sv = ch.mcpServers['ai-workspace'];
    expect(sv?.command).toBe('C:/Code/Code.exe');
    expect(sv?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });

  it('mọi tham số nằm trong args, KHÔNG dựa vào biến môi trường kế thừa', () => {
    // env phải sống sót qua hai tầng tiến trình (terminal → agent → server); tầng nào nuốt
    // thì cả cơ chế chết im lặng.
    const args = ch.mcpServers['ai-workspace']?.args ?? [];
    expect(args[0]).toBe('C:/ext/dist/mcp.js');
    expect(args).toContain('--orch');
    expect(args[args.indexOf('--orch') + 1]).toBe('C:/gs/orch/w1');
    expect(args).toContain('--self');
    expect(args[args.indexOf('--self') + 1]).toBe('term-1');
  });

  it('serialize được thành JSON hợp lệ cho --mcp-config', () => {
    expect(() => JSON.parse(JSON.stringify(ch))).not.toThrow();
  });
});

describe('gopVeMotDong', () => {
  it('gộp chỉ thị nhiều dòng thành MỘT dòng', () => {
    // sendText gõ thẳng vào pty: trong TUI của agent mỗi xuống dòng là một lần Enter, nên
    // chỉ thị nhiều dòng thành nhiều lượt và agent bắt tay làm khi mới đọc nửa câu.
    expect(gopVeMotDong('Sửa login.\nChạy test.\nBáo lại.')).toBe('Sửa login. Chạy test. Báo lại.');
  });

  it('bỏ dòng trống và khoảng trắng thừa ở đầu/cuối từng dòng', () => {
    expect(gopVeMotDong('  một  \n\n\n   hai   \n')).toBe('một hai');
  });

  it('xử lý cả CRLF', () => {
    expect(gopVeMotDong('một\r\nhai')).toBe('một hai');
  });

  it('chuỗi chỉ có khoảng trắng → rỗng, để bên gọi từ chối', () => {
    expect(gopVeMotDong('  \n \n ')).toBe('');
  });

  it('một dòng thì giữ nguyên nội dung', () => {
    expect(gopVeMotDong('làm đi')).toBe('làm đi');
  });
});

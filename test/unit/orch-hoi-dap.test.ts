import { describe, expect, it } from 'vitest';
import {
  docTraLoi,
  docYeuCau,
  nenDungCho,
  phanQuyetSong,
  tenFileTraLoi,
  xetAsk,
  xetGiaoSau,
  xetReply,
  type AgentTrangThai,
  type ChoGiao,
  type TinhTrangGiao,
} from '../../src/orch/bus';

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
];

describe('docYeuCau — ask / reply / dispatch after', () => {
  it('đọc được yêu cầu ask, dispatchId là tuỳ chọn', () => {
    const co = docYeuCau(
      JSON.stringify({ id: 'a1', from: WORKER, at: 1, type: 'ask', text: 'dùng lib nào?', dispatchId: 'd1' }),
    );
    expect(co).toEqual({ id: 'a1', from: WORKER, at: 1, type: 'ask', text: 'dùng lib nào?', dispatchId: 'd1' });
    const khong = docYeuCau(JSON.stringify({ id: 'a2', from: WORKER, at: 1, type: 'ask', text: 'hỏi' }));
    expect(khong).toEqual({ id: 'a2', from: WORKER, at: 1, type: 'ask', text: 'hỏi' });
  });

  it('reply phải có askId, thiếu thì null', () => {
    expect(
      docYeuCau(JSON.stringify({ id: 'r1', from: DIEU_PHOI, at: 1, type: 'reply', text: 'dùng zod' })),
    ).toBeNull();
    expect(
      docYeuCau(
        JSON.stringify({ id: 'r1', from: DIEU_PHOI, at: 1, type: 'reply', askId: 'a1', text: 'dùng zod' }),
      ),
    ).toEqual({ id: 'r1', from: DIEU_PHOI, at: 1, type: 'reply', askId: 'a1', text: 'dùng zod' });
  });

  it('dispatch mang after là danh sách id', () => {
    const yc = docYeuCau(
      JSON.stringify({
        id: 'd2',
        from: DIEU_PHOI,
        at: 1,
        type: 'dispatch',
        terminalId: WORKER,
        text: 'làm B',
        after: ['d1'],
      }),
    );
    expect(yc).toMatchObject({ type: 'dispatch', after: ['d1'] });
  });

  it('after có phần tử không phải chuỗi → null, KHÔNG lọc im lặng (lọc im là bỏ cổng)', () => {
    expect(
      docYeuCau(
        JSON.stringify({
          id: 'd2',
          from: DIEU_PHOI,
          at: 1,
          type: 'dispatch',
          terminalId: WORKER,
          text: 'làm B',
          after: ['d1', 7],
        }),
      ),
    ).toBeNull();
  });

  it('dispatch không có after thì không sinh trường after', () => {
    const yc = docYeuCau(
      JSON.stringify({ id: 'd2', from: DIEU_PHOI, at: 1, type: 'dispatch', terminalId: WORKER, text: 'làm B' }),
    );
    expect(yc).not.toHaveProperty('after');
  });
});

describe('file trả lời (ans/)', () => {
  it('nằm trong thư mục ans và mang đúng id', () => {
    expect(tenFileTraLoi('/orch', 'a1', '/')).toBe('/orch/ans/a1.json');
  });
  it('id có ký tự đường dẫn thì ném', () => {
    expect(() => tenFileTraLoi('/orch', '../x', '/')).toThrow();
  });
  it('docTraLoi đọc được và từ chối rác', () => {
    expect(docTraLoi(JSON.stringify({ id: 'a1', text: 'dùng zod', at: 5 }))).toEqual({
      id: 'a1',
      text: 'dùng zod',
      at: 5,
    });
    expect(docTraLoi('{')).toBeNull();
    expect(docTraLoi(JSON.stringify({ id: 'a1' }))).toBeNull();
  });
});

describe('phanQuyetSong', () => {
  it('registry vừa thấy → live', () => {
    for (const s of ['busy', 'idle', 'blocked'] as const) expect(phanQuyetSong(s)).toBe('live');
  });
  it('đang track nhưng registry im → unverifiable, KHÔNG phải chết', () => {
    for (const s of ['open', 'loading'] as const) expect(phanQuyetSong(s)).toBe('unverifiable');
  });
  it('đóng hoặc lỗi → exited', () => {
    for (const s of ['closed', 'error'] as const) expect(phanQuyetSong(s)).toBe('exited');
  });
});

describe('nenDungCho — quy tắc dừng của wait', () => {
  const khongCho: ChoGiao[] = [];
  it('worker có câu hỏi treo → dừng, dù đang busy', () => {
    expect(
      nenDungCho(ag({ id: WORKER, state: 'busy', cauHoi: { id: 'a1', text: '?', at: 1 } }), khongCho),
    ).toBe(true);
  });
  it('worker idle nhưng còn chỉ thị xếp hàng nhắm vào nó → CHƯA dừng', () => {
    const hang: ChoGiao[] = [{ id: 'd2', terminalId: WORKER, after: ['d1'], at: 1, text: 'làm B' }];
    expect(nenDungCho(ag({ id: WORKER, state: 'idle' }), hang)).toBe(false);
  });
  it('hàng chờ nhắm vào worker KHÁC thì không giữ worker này', () => {
    const hang: ChoGiao[] = [{ id: 'd2', terminalId: 'khac', after: ['d1'], at: 1, text: 'làm B' }];
    expect(nenDungCho(ag({ id: WORKER, state: 'idle' }), hang)).toBe(true);
  });
  it('đã báo kết quả → dừng', () => {
    expect(
      nenDungCho(
        ag({ id: WORKER, state: 'busy', ketQua: { outcome: 'succeeded', text: 'ok', at: 1 } }),
        khongCho,
      ),
    ).toBe(true);
  });
  it('open (registry im) → chưa dừng: vắng mặt không phải bằng chứng chết', () => {
    expect(nenDungCho(ag({ id: WORKER, state: 'open' }), khongCho)).toBe(false);
  });
  it('terminal biến mất → dừng, chờ nữa vô ích', () => {
    expect(nenDungCho(undefined, khongCho)).toBe(true);
  });
});

describe('xetGiaoSau — cổng ngầm của hàng chờ', () => {
  const so = (o: Record<string, TinhTrangGiao>): Map<string, TinhTrangGiao> => new Map(Object.entries(o));
  it('mọi việc trước đều succeeded → giao', () => {
    expect(xetGiaoSau(['d1', 'd0'], so({ d1: 'succeeded', d0: 'succeeded' }))).toEqual({ ket: 'giao' });
  });
  it('còn việc đang bay hoặc đang xếp hàng → chờ', () => {
    expect(xetGiaoSau(['d1', 'd0'], so({ d1: 'succeeded', d0: 'dangBay' }))).toEqual({ ket: 'cho' });
    expect(xetGiaoSau(['d1'], so({ d1: 'choGiao' }))).toEqual({ ket: 'cho' });
  });
  it('một việc trước failed / blocked / bị huỷ → huỷ, nêu đúng id', () => {
    for (const t of ['failed', 'blocked', 'huy'] as const) {
      const r = xetGiaoSau(['d1', 'd0'], so({ d1: 'succeeded', d0: t }));
      expect(r.ket).toBe('huy');
      if (r.ket === 'huy') expect(r.lyDo).toContain('d0');
    }
  });
  it('id sổ không biết → huỷ, không coi là đã xong', () => {
    const r = xetGiaoSau(['bia'], so({}));
    expect(r.ket).toBe('huy');
  });
  it('after rỗng → giao ngay', () => {
    expect(xetGiaoSau([], so({}))).toEqual({ ket: 'giao' });
  });
});

describe('xetAsk / xetReply', () => {
  it('worker hỏi → cho phép', () => {
    expect(xetAsk(WORKER, DIEU_PHOI, DS)).toEqual({ cho: true });
  });
  it('người điều phối tự hỏi → từ chối', () => {
    expect(xetAsk(DIEU_PHOI, DIEU_PHOI, DS).cho).toBe(false);
  });
  it('terminal lạ hỏi → từ chối', () => {
    expect(xetAsk('la', DIEU_PHOI, DS).cho).toBe(false);
  });
  it('chưa có ai điều phối thì hỏi cũng vô ích → từ chối nói rõ', () => {
    expect(xetAsk(WORKER, null, DS).cho).toBe(false);
  });
  const dsCoHoi: AgentTrangThai[] = [
    ag({ id: DIEU_PHOI, roleKind: 'orchestrator' }),
    ag({ id: WORKER, roleKind: 'worker', cauHoi: { id: 'a1', text: '?', at: 1 } }),
  ];
  it('điều phối trả lời câu hỏi đang treo → cho phép, biết worker nào', () => {
    expect(xetReply(DIEU_PHOI, 'a1', DIEU_PHOI, dsCoHoi)).toEqual({ cho: true, terminalId: WORKER });
  });
  it('không phải điều phối trả lời → từ chối (phòng thủ theo lớp)', () => {
    expect(xetReply(WORKER, 'a1', DIEU_PHOI, dsCoHoi).cho).toBe(false);
  });
  it('askId không treo ở đâu → từ chối', () => {
    expect(xetReply(DIEU_PHOI, 'a9', DIEU_PHOI, dsCoHoi).cho).toBe(false);
  });
});

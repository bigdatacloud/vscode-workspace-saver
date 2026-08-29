import { describe, expect, it } from 'vitest';
import {
  dungNoiDungVaiTuMoTa,
  duongDanRole,
  duongDanThuMucRole,
  mauNoiDungRole,
} from '../../src/role/paths';

const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const R = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NGUOC = String.fromCharCode(92);

describe('đường dẫn file vai', () => {
  it('gom theo workspace để xoá workspace là xoá gọn cả thư mục vai của nó', () => {
    expect(duongDanThuMucRole('C:/gs', WS, '/')).toBe(`C:/gs/roles/${WS}`);
  });

  it('tôn trọng dấu phân cách của hệ điều hành', () => {
    expect(duongDanRole('C:/gs', WS, R, NGUOC)).toBe(`C:/gs${NGUOC}roles${NGUOC}${WS}${NGUOC}${R}.md`);
  });
});

describe('mauNoiDungRole', () => {
  it('vai worker: nhắc tên vai và để chỗ trống cho người dùng viết', () => {
    const m = mauNoiDungRole('reviewer', 'worker');
    expect(m).toContain('reviewer');
    expect(m.length).toBeGreaterThan(50);
  });

  it('vai worker: DẠY hợp đồng report_done, nếu không nó không bao giờ báo xong', () => {
    const m = mauNoiDungRole('reviewer', 'worker');
    expect(m).toContain('report_done');
    for (const kc of ['succeeded', 'failed', 'blocked']) expect(m).toContain(kc);
    expect(m).toContain('dispatch_id');
  });

  it('vai orchestrator: DẠY đủ năm tool, nếu không agent không biết mình có gì', () => {
    const m = mauNoiDungRole('lead', 'orchestrator');
    for (const tool of ['list_agents', 'read_transcript', 'dispatch', 'wait', 'report']) {
      expect(m, `mẫu orchestrator phải nhắc tới ${tool}`).toContain(tool);
    }
  });

  it('vai orchestrator: nói rõ giới hạn độ sâu để agent không thử rồi thất bại', () => {
    expect(mauNoiDungRole('lead', 'orchestrator')).toMatch(/không.*(tự tạo|sinh thêm)|độ sâu/i);
  });
});

describe('dungNoiDungVaiTuMoTa', () => {
  const noi = dungNoiDungVaiTuMoTa('impl', 'Viết code và test cho việc được giao.');

  it('giữ nguyên mô tả do orchestrator viết', () => {
    expect(noi).toContain('Viết code và test cho việc được giao.');
    expect(noi).toContain('impl');
  });

  it('LUÔN kèm hợp đồng report_done', () => {
    // Đây là lý do không dùng thẳng mô tả của orchestrator: thiếu phần này thì worker không
    // bao giờ báo xong, và `wait` của người điều phối treo vô hạn.
    expect(noi).toContain('report_done');
    for (const kc of ['succeeded', 'failed', 'blocked']) expect(noi).toContain(kc);
  });

  it('nói rõ file do orchestrator sinh, để người dùng biết sửa được', () => {
    expect(noi).toMatch(/điều phối|sinh/i);
  });
});

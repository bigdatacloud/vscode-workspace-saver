import { describe, expect, it } from 'vitest';
import { duongDanRole, duongDanThuMucRole, mauNoiDungRole } from '../../src/role/paths';

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

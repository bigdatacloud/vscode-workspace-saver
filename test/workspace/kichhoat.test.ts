import { describe, expect, it } from 'vitest';
import { phamViKichHoat } from '../../src/workspace/kichhoat';

const DS = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];

describe('phamViKichHoat', () => {
  it('không chỉ định terminal nào thì phạm vi là cả workspace', () => {
    expect(phamViKichHoat(DS)).toEqual(DS);
  });

  it('giữ nguyên thứ tự trong cây khi mở cả workspace', () => {
    expect(phamViKichHoat(DS).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('chỉ định một terminal thì phạm vi chỉ có ĐÚNG nó', () => {
    // Đây là điểm mấu chốt của "kích hoạt đơn lẻ": lọt thêm một entry nào khác là mở nhầm
    // một phiên agent người dùng không yêu cầu.
    expect(phamViKichHoat(DS, 't2')).toEqual([{ id: 't2' }]);
  });

  it('id không thuộc workspace thì phạm vi RỖNG, không rơi về mở cả workspace', () => {
    expect(phamViKichHoat(DS, 'khong-co')).toEqual([]);
  });
});

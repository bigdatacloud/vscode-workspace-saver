import { describe, expect, it } from 'vitest';
import { boCucLuoi, phanBoCot, TOI_DA_O } from '../../src/ui/luoi';

/** Tổng số ô của một bố cục — phải luôn khớp số terminal, không thừa ô trống. */
const demO = (bc: ReturnType<typeof boCucLuoi>): number =>
  bc.groups.reduce((t, g) => t + (g.groups?.length ?? 1), 0);

describe('phanBoCot — chia n ô thành các cột gần đều nhau', () => {
  it('1 ô: một cột', () => {
    expect(phanBoCot(1)).toEqual([1]);
  });

  it('2 ô: hai cột cạnh nhau — terminal cần bề ngang hơn bề dọc', () => {
    expect(phanBoCot(2)).toEqual([1, 1]);
  });

  it('3 ô: hai cột, cột trái hai hàng', () => {
    expect(phanBoCot(3)).toEqual([2, 1]);
  });

  it('4 ô: lưới 2x2', () => {
    expect(phanBoCot(4)).toEqual([2, 2]);
  });

  it('5 ô: ba cột 2-2-1, không có ô trống', () => {
    expect(phanBoCot(5)).toEqual([2, 2, 1]);
  });

  it('6 ô: ba cột đều', () => {
    expect(phanBoCot(6)).toEqual([2, 2, 2]);
  });

  it('9 ô: lưới 3x3', () => {
    expect(phanBoCot(9)).toEqual([3, 3, 3]);
  });

  it('cột luôn giảm dần hoặc bằng — cột đầy ở bên trái cho dễ nhìn', () => {
    for (let n = 1; n <= TOI_DA_O; n++) {
      const cot = phanBoCot(n);
      expect(cot.reduce((a, b) => a + b, 0)).toBe(n);
      expect([...cot].sort((a, b) => b - a)).toEqual(cot);
      expect(cot.every((c) => c >= 1)).toBe(true);
    }
  });

  it('0 hoặc số âm: một cột một ô, không bao giờ trả mảng rỗng', () => {
    expect(phanBoCot(0)).toEqual([1]);
    expect(phanBoCot(-3)).toEqual([1]);
  });
});

describe('boCucLuoi — đối số cho lệnh vscode.setEditorLayout', () => {
  it('hai terminal: hai cột, không lồng nhóm', () => {
    expect(boCucLuoi(2)).toEqual({ orientation: 0, groups: [{}, {}] });
  });

  it('bốn terminal: hai cột, mỗi cột chia đôi theo chiều dọc', () => {
    expect(boCucLuoi(4)).toEqual({
      orientation: 0,
      groups: [{ groups: [{}, {}] }, { groups: [{}, {}] }],
    });
  });

  it('năm terminal: cột cuối chỉ một ô (không dựng ô trống)', () => {
    expect(boCucLuoi(5)).toEqual({
      orientation: 0,
      groups: [{ groups: [{}, {}] }, { groups: [{}, {}] }, {}],
    });
  });

  it('số ô luôn bằng số terminal với mọi n trong tầm cho phép', () => {
    for (let n = 1; n <= TOI_DA_O; n++) expect(demO(boCucLuoi(n))).toBe(n);
  });

  it('hơn mức tối đa thì cắt về tối đa — một màn hình 20 ô không đọc được gì', () => {
    expect(demO(boCucLuoi(50))).toBe(TOI_DA_O);
  });

  it('một terminal: một ô duy nhất (gộp về bố cục đơn)', () => {
    expect(boCucLuoi(1)).toEqual({ orientation: 0, groups: [{}] });
  });
});

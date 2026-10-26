/**
 * Phân xử một cú bấm vào terminal trong cây.
 *
 * Tách riêng vì nhánh quan trọng nhất ở đây là nhánh KHÔNG làm được gì: trước đây cả hai ca
 * hỏng (entry đã rời workspace, và show() không đưa được terminal ra trước) đều `return` lặng
 * lẽ, nên người dùng chỉ thấy "bấm vào không có phản ứng gì" mà không có đầu mối nào.
 */

export type PhanXuBamTerminal =
  /** Terminal đã ở trước mặt — không phải nói gì thêm. */
  | { loai: 'daHien' }
  /** Đang chạy nhưng không đưa ra trước được: báo, và TUYỆT ĐỐI không mở phiên thứ hai. */
  | { loai: 'khongHienDuoc' }
  /** Chưa mở, entry còn đó: đường bình thường để bật lại một terminal đã đóng. */
  | { loai: 'hoiKichHoat' }
  /**
   * Terminal còn sống nhưng phiên trong nó đã thoát — hỏi để mở lại phiên trong entry này.
   * Khác `hoiKichHoat` ở chỗ phải dọn cái vỏ cũ trước, nếu không `activate` nhìn thấy
   * `terminals.has()` là true và bỏ qua đúng entry người dùng vừa bấm.
   */
  | { loai: 'hoiMoLai' }
  /** Entry không còn trong workspace đó — item trong cây đã lạc hậu (vd vừa bị kéo đi). */
  | { loai: 'entryLacHau' };

export function phanXuBamTerminal(trangThai: {
  /** Cửa sổ này đang theo dõi một terminal sống cho entry này? */
  dangMo: boolean;
  /** Đã đưa được nó lên `activeTerminal` chưa? */
  hienDuoc: boolean;
  /** Entry còn nằm trong workspace mà item khai không? */
  coEntry: boolean;
  /** Terminal còn sống nhưng phiên agent trong nó đã thoát (xem `votrong.ts`). */
  voTrong?: boolean;
}): PhanXuBamTerminal {
  // Vỏ trống xét TRƯỚC cả "terminal sống": terminal thì sống thật, nhưng thứ người dùng bấm
  // vào để xem là PHIÊN, mà phiên đã thoát. Hiện ra một shell trống không phải việc đúng, và
  // báo "đang chạy nhưng không đưa ra trước được" thì vừa sai vừa là ngõ cụt.
  if (trangThai.voTrong === true) {
    // Entry đã rời workspace thì không mở lại theo item cũ được: `activate` cần đúng cặp
    // (workspaceId, entryId) mà item đang cầm thì đã lạc hậu.
    return trangThai.coEntry ? { loai: 'hoiMoLai' } : { loai: 'entryLacHau' };
  }
  // Terminal sống thắng mọi thứ khác: kể cả khi store đã mất entry, cái người dùng vừa bấm
  // vẫn đang chạy trước mặt họ, nên việc đúng là hiện nó chứ không phải than phiền về store.
  if (trangThai.dangMo) {
    return trangThai.hienDuoc ? { loai: 'daHien' } : { loai: 'khongHienDuoc' };
  }
  return trangThai.coEntry ? { loai: 'hoiKichHoat' } : { loai: 'entryLacHau' };
}

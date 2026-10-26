/**
 * "Vỏ trống": terminal còn sống nhưng phiên agent bên trong nó đã thoát.
 *
 * Vì sao phải tách thành một khái niệm riêng: cả cây lẫn cú bấm trước đây chỉ hỏi
 * `terminals.has(entry.id)` — câu đó trả lời về TERMINAL, không phải về PHIÊN. Terminate một
 * phiên claude thì cái vỏ shell đã sinh ra nó vẫn sống (`taskkill /T` đi XUỐNG, và `/exit`
 * thì chỉ claude thoát), nên câu trả lời vẫn là "có" mãi: cây vẽ chấm đầy như đang chạy, và
 * mọi đường mở lại đều bị chặn vì chúng chỉ mở những entry `!has()`.
 *
 * Module thuần — mọi mệnh đề ở đây test được mà không cần Extension Host.
 */
export interface DauHieuVo {
  /** Entry này là một phiên agent (claude/codex), không phải shell thường. */
  laAgent: boolean;
  /** Entry đã từng bắt được một phiên agent — tức có id phiên để resume. */
  daTungCoPhien: boolean;
  /** Cửa sổ này còn giữ một terminal SỐNG cho entry. */
  terminalSong: boolean;
  /** Sổ phiên của agent còn liệt kê phiên của entry này. */
  registryConPhien: boolean;
  /** Extension đang bật phiên — đã gửi lệnh nhưng sổ phiên chưa kịp thấy. */
  dangTai: boolean;
}

/**
 * Bốn mệnh đề, bỏ cái nào cũng hỏng:
 *
 * - `laAgent` + `daTungCoPhien`: shell thường không có phiên nào để mất, và một terminal
 *   claude vừa mở (chưa kịp có id phiên) cũng chưa có gì để gọi là "đã thoát" — thiếu mệnh
 *   đề này thì mọi terminal agent mới tạo đều hiện "phiên đã thoát" trong vài giây đầu.
 * - `terminalSong`: terminal đã đóng đã có trạng thái riêng ("chưa mở"), và hai thứ dọn bằng
 *   hai cách khác nhau.
 * - `!registryConPhien` + `!dangTai`: hai bằng chứng độc lập rằng không còn phiên nào sống
 *   trong cái vỏ ấy.
 */
export function laVoTrong(d: DauHieuVo): boolean {
  if (!d.laAgent || !d.daTungCoPhien) return false;
  if (!d.terminalSong) return false;
  return !d.registryConPhien && !d.dangTai;
}

import { describe, expect, it } from 'vitest';
import { laVoTrong } from '../../src/workspace/votrong';

/**
 * "Vỏ trống" = terminal còn sống nhưng phiên agent bên trong đã thoát.
 *
 * Vì sao phải có khái niệm này: trước 0.2.4, mọi đường mở lại một phiên đều hỏi đúng một câu
 * — "cửa sổ này còn giữ terminal nào cho entry không" (`terminals.has`). Câu đó trả lời về
 * TERMINAL, không phải về PHIÊN. Người dùng terminate phiên thì cái vỏ shell vẫn sống, nên
 * câu trả lời vẫn là "có" mãi mãi: cây vẽ chấm đầy như đang chạy, bấm vào thì rơi vào nhánh
 * "không đưa ra trước được" và không bao giờ tới `activate`. Lối duy nhất còn lại là gỡ hẳn
 * entry khỏi workspace — đúng điều người dùng báo ngày 26/10/2026.
 *
 * Đo trong Extension Host cùng ngày (hai lượt, đã xoá file thăm dò): VS Code KHÔNG giữ
 * terminal đã chết trong sổ — `onDidCloseTerminal` bắn sau 426 ms khi shell bị taskkill từ
 * ngoài, 896–3 259 ms khi tiến trình tự thoát, và terminal rời `window.terminals` ngay trong
 * nhịp đó. Nên `terminals.has()` đúng là "terminal còn sống"; thứ sai là coi nó bằng với
 * "phiên còn sống".
 */
describe('nhận biết vỏ trống', () => {
  const vo = {
    laAgent: true,
    daTungCoPhien: true,
    terminalSong: true,
    registryConPhien: false,
    dangTai: false,
  };

  it('agent đã từng có phiên, terminal còn sống, registry không còn phiên → vỏ trống', () => {
    expect(laVoTrong(vo)).toBe(true);
  });

  it('shell thường KHÔNG bao giờ là vỏ trống — shell không có phiên nào để mất', () => {
    expect(laVoTrong({ ...vo, laAgent: false, daTungCoPhien: false })).toBe(false);
  });

  it('agent chưa từng bắt được phiên → KHÔNG phải vỏ: đó là terminal vừa mở, chưa kịp có gì', () => {
    // Bỏ mệnh đề này thì mọi terminal claude mới tạo đều hiện "phiên đã thoát" trong vài
    // giây đầu, trước khi registry kịp thấy nó.
    expect(laVoTrong({ ...vo, daTungCoPhien: false })).toBe(false);
  });

  it('terminal đã đóng → KHÔNG phải vỏ, đó là trạng thái "chưa mở" sẵn có', () => {
    expect(laVoTrong({ ...vo, terminalSong: false })).toBe(false);
  });

  it('registry vẫn còn phiên → phiên đang sống, không được đụng tới', () => {
    expect(laVoTrong({ ...vo, registryConPhien: true })).toBe(false);
  });

  it('extension đang bật phiên (chưa kịp hiện trong registry) → chưa kết luận vội', () => {
    expect(laVoTrong({ ...vo, dangTai: true })).toBe(false);
  });
});

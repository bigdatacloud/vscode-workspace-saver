/**
 * Quy tắc "workspace đang nhận" — thay chỗ `activeId` trong việc quyết định terminal người
 * dùng tự mở tay thuộc về ai.
 *
 * Trước đây chỉ một workspace được mở nên câu hỏi không tồn tại. Khi nhiều workspace mở song
 * song, phải có một quy tắc, và quy tắc đó không được là "cái mở gần nhất" đơn thuần: mở A
 * rồi mở B, sau đó làm việc trong A cả buổi thì terminal mới vẫn chạy vào B — sai gần như
 * mọi lần.
 */

/**
 * Terminal tự mở tay sẽ vào workspace nào.
 *
 * Ưu tiên workspace của terminal ĐANG FOCUS: đang gõ trong terminal của workspace B rồi mở
 * terminal mới thì gần như chắc chắn bạn muốn nó thuộc về B. Chỉ khi không focus terminal
 * nào (đang ở editor), hoặc terminal đó không thuộc workspace nào, hoặc thuộc một workspace
 * đã đóng, mới rơi về workspace mở gần nhất.
 *
 * @param keyTerminalDangFocus Key (= id entry) của terminal đang focus; null nếu không có.
 * @param wsCuaTerminal Tra id workspace chứa terminal đó; null nếu không thuộc workspace nào.
 * @param thuTuMo Các workspace ĐANG MỞ theo thứ tự kích hoạt, mới nhất ở CUỐI.
 */
export function chonWorkspaceNhan(
  keyTerminalDangFocus: string | null,
  wsCuaTerminal: (key: string) => string | null,
  thuTuMo: readonly string[],
): string | null {
  if (keyTerminalDangFocus !== null) {
    const ws = wsCuaTerminal(keyTerminalDangFocus);
    // Phải còn nằm trong thuTuMo: terminal vẫn sống sau khi workspace của nó bị đóng là
    // chuyện có thật, và nhận terminal mới vào một workspace không mở là làm nó biến mất
    // khỏi tầm mắt người dùng.
    if (ws !== null && thuTuMo.includes(ws)) return ws;
  }
  return thuTuMo.at(-1) ?? null;
}

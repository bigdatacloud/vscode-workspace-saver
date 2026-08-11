/**
 * Đọc và đi ngược cây tiến trình để tìm terminal "chứa" một tiến trình con.
 * Dùng cho việc gắn Claude session vào đúng terminal một cách tất định:
 * pid của session (từ registry) → cha → ông → … → pid shell của một terminal.
 */

/**
 * Parse output bảng tiến trình thành map con → cha.
 * Chấp nhận cả hai định dạng:
 * - Windows (PowerShell): mỗi dòng `pid,ppid`
 * - POSIX (`ps -eo pid=,ppid=`): mỗi dòng `  pid  ppid`
 * Dòng không parse được thì bỏ qua (header, dòng trống, rác).
 */
export function parseBangTienTrinh(text: string): Map<number, number> {
  const parentOf = new Map<number, number>();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d+)[,\s]+(\d+)$/);
    if (!m) continue;
    parentOf.set(Number(m[1]), Number(m[2]));
  }
  return parentOf;
}

/**
 * Đi ngược từ `pidCon` qua chuỗi tổ tiên; gặp pid nào có trong `shellPids`
 * thì trả về terminalId tương ứng. Không gặp ai (hoặc đứt chuỗi/chu trình) → null.
 */
export function timTerminalTheoToTien(
  pidCon: number,
  parentOf: ReadonlyMap<number, number>,
  shellPids: ReadonlyMap<number, string>,
  maxHop = 15,
): string | null {
  const daTham = new Set<number>();
  let pid: number | undefined = pidCon;
  for (let hop = 0; hop < maxHop && pid !== undefined; hop += 1) {
    if (daTham.has(pid)) return null; // chu trình dữ liệu — dừng, không treo
    daTham.add(pid);
    const terminalId = shellPids.get(pid);
    if (terminalId !== undefined && pid !== pidCon) return terminalId;
    pid = parentOf.get(pid);
  }
  return null;
}

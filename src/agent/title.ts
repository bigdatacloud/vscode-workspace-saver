/**
 * Agent ghi tiêu đề tab bằng escape sequence, kèm ký hiệu trạng thái đổi liên tục
 * (Claude: "✳", "◐/◓/◑/◒"…). Nếu chuỗi đó lỡ bị hút vào tên entry thì tên lưu trên đĩa mang
 * theo một ký hiệu vô nghĩa; hàm này cắt phần đó ra.
 *
 * Chỉ cắt ở ĐẦU chuỗi và không bao giờ trả chuỗi rỗng: tên do người dùng đặt có thể bắt đầu
 * bằng emoji khác, và một entry không tên là dữ liệu sai schema.
 */
export function boKyHieuTrangThai(ten: string): string {
  // Dải Braille U+2800–U+28FF: Codex quay spinner bằng ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ (đo trên máy thật —
  // tên đã lưu của người dùng có "⠏ quality-glance-report…").
  const sach = ten.replace(/^[✳✶✷✸✹✺◐◑◒◓⠀-⣿·•\s]+/u, '').trim();
  return sach === '' ? ten.trim() : sach;
}

/**
 * Nhãn tab này có phải của terminal mang tên kia không.
 *
 * Phải cắt ký hiệu trạng thái ở CẢ HAI bên rồi mới so. Nợ #002 (anh Ý 26/10/2026, "Terminal
 * đang chạy nhưng không đưa ra trước được") nằm đúng ở đây: đường tìm tab so
 * `tab.label === t.name` nguyên văn, mà agent ghi tiêu đề tab thành "<ký hiệu> <tên phiên>"
 * và đổi liên tục — trong khi `terminal.name` có thể đang là bản chưa/đã mang ký hiệu. Một
 * bên có, bên kia không, nên phép so không bao giờ đúng và vòng xoay tab đi lướt qua đúng
 * cái tab cần tìm rồi báo "không tìm thấy".
 *
 * Nhãn RỖNG không khớp với bất cứ gì: `tab.label` rỗng với mọi tab terminal chưa từng được
 * hiện (đo 25/10/2026), và coi rỗng là khớp thì mọi tab chưa hiện đều thành "đúng cái đang
 * tìm" — lệnh dời ngay sau đó sẽ ném một tab lạ sang ô khác.
 */
export function khopTenTab(nhan: string, ten: string): boolean {
  const a = boKyHieuTrangThai(nhan).trim().toLowerCase();
  const b = boKyHieuTrangThai(ten).trim().toLowerCase();
  if (a === '' || b === '') return false;
  // `boKyHieuTrangThai` trả lại chính chuỗi khi cắt hết — nhãn chỉ có ký hiệu thì nó còn là
  // ký hiệu, và ký hiệu không phải tên của ai.
  if (a === nhan.trim().toLowerCase() && /^[^\p{L}\p{N}]+$/u.test(nhan.trim())) return false;
  return a === b;
}

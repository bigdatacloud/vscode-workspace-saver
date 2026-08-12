/**
 * Agent ghi tiêu đề tab bằng escape sequence, kèm ký hiệu trạng thái đổi liên tục
 * (Claude: "✳", "◐/◓/◑/◒"…). Nếu chuỗi đó lỡ bị hút vào tên entry thì tên lưu trên đĩa mang
 * theo một ký hiệu vô nghĩa; hàm này cắt phần đó ra.
 *
 * Chỉ cắt ở ĐẦU chuỗi và không bao giờ trả chuỗi rỗng: tên do người dùng đặt có thể bắt đầu
 * bằng emoji khác, và một entry không tên là dữ liệu sai schema.
 */
export function boKyHieuTrangThai(ten: string): string {
  const sach = ten.replace(/^[✳✶✷✸✹✺◐◑◒◓·•\s]+/u, '').trim();
  return sach === '' ? ten.trim() : sach;
}

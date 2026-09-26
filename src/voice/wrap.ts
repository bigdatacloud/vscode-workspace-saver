/**
 * Có cần bật xuống dòng tự động cho tab nháp của phiên nghe không.
 *
 * Tab nháp nhận cả một đoạn nói dài trên MỘT dòng; không wrap thì phải cuộn ngang mới đọc hết,
 * mà người dùng đang cần đọc lại trước khi Enter. VS Code không cho đặt `wordWrap` theo từng
 * editor qua API, nhưng lệnh `editor.action.toggleWordWrap` đặt một "transient model property"
 * chỉ sống trong model đang mở — đúng phạm vi ta cần, và không ghi gì vào settings người dùng.
 *
 * Cái bẫy: lệnh đó là toggle HAI CHIỀU. Ai đã bật wrap sẵn mà ta gọi vô điều kiện thì thành ra
 * extension tự tắt wrap của họ. Nên chỉ gọi khi `editor.wordWrap` hiệu lực đang là `off`.
 *
 * @param giaTriHienTai Giá trị `editor.wordWrap` đọc theo tài nguyên của tab nháp.
 */
export function canBatWordWrap(giaTriHienTai: string | undefined): boolean {
  // Vắng mặt = mặc định của VS Code, và mặc định là `off`.
  if (giaTriHienTai === undefined || giaTriHienTai === '') return true;
  return giaTriHienTai === 'off';
}

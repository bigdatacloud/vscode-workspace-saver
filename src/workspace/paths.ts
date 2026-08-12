/**
 * Gộp các nguồn gợi ý đường dẫn (lịch sử đã dùng, cwd của terminal đã biết, thư mục đang mở)
 * thành một danh sách duy nhất, giữ đúng thứ tự ưu tiên và bỏ trùng.
 *
 * Trên Windows `D:\Coding\erp` và `d:\coding\ERP` là MỘT thư mục — không khử trùng theo kiểu
 * không phân biệt hoa thường thì danh sách gợi ý đầy các dòng nhìn y hệt nhau. Chuỗi trả về
 * luôn là dạng người dùng đã gõ ở lần xuất hiện ĐẦU (ưu tiên cao nhất), không bị hạ hoa.
 */
export function gopGoiYDuongDan(
  nhom: readonly (readonly string[])[],
  win32: boolean = process.platform === 'win32',
): string[] {
  const chuanHoa = (p: string) => {
    const bo = p.trim().replace(/[\\/]+$/, '');
    return win32 ? bo.toLowerCase().replaceAll('\\', '/') : bo;
  };
  const ra: string[] = [];
  const daCo = new Set<string>();
  for (const ds of nhom) {
    for (const p of ds) {
      const sach = p.trim();
      if (sach === '') continue;
      const khoa = chuanHoa(sach);
      if (khoa === '' || daCo.has(khoa)) continue;
      daCo.add(khoa);
      ra.push(sach);
    }
  }
  return ra;
}

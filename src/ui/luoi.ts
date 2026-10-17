/**
 * Bố cục lưới cho chế độ "xem song song": chia N terminal thành N ô editor.
 *
 * Thuần, không import vscode — nó chỉ dựng đối số cho lệnh `vscode.setEditorLayout`, còn
 * việc gọi lệnh và dời tab nằm ở `splitview.ts`. Tách ra vì chỗ dễ sai là số học chia ô
 * (thừa một ô trống, hoặc tổng ô không khớp số terminal), không phải việc gọi API.
 */

/**
 * Tối đa 9 ô. Quá số này thì mỗi ô hẹp tới mức dòng lệnh xuống hàng liên tục — một màn hình
 * 20 ô không đọc được gì, nên thà xếp 9 cái đầu và nói rõ còn bao nhiêu cái không vào lưới.
 */
export const TOI_DA_O = 9;

/** Một ô, hoặc một cột đã chia thành nhiều ô theo chiều dọc. */
export interface NhomLuoi {
  groups?: Record<string, never>[];
}

export interface BoCucLuoi {
  /** 0 = chia theo chiều ngang (các cột cạnh nhau). Cột lồng bên trong tự chia dọc. */
  orientation: 0;
  groups: NhomLuoi[];
}

/**
 * Số ô của từng cột, trái sang phải.
 *
 * Số cột = `ceil(sqrt(n))`: giữ lưới gần vuông, và với n nhỏ thì ra đúng cái người ta mong
 * đợi (2 → hai cột, 4 → 2x2, 9 → 3x3). Phần dư rải vào các cột ĐẦU nên cột đầy nằm bên
 * trái; cột thiếu ở bên phải trông tự nhiên hơn là một lỗ ở giữa.
 */
export function phanBoCot(soO: number): number[] {
  const n = Math.min(Math.max(Math.trunc(soO), 1), TOI_DA_O);
  const soCot = Math.ceil(Math.sqrt(n));
  const deu = Math.floor(n / soCot);
  const du = n % soCot;
  return Array.from({ length: soCot }, (_, i) => deu + (i < du ? 1 : 0));
}

/**
 * Cạnh lớn nhất của lưới tự khai: 6×6 = 36 ô.
 *
 * Giới hạn ở cạnh chứ không ở tổng số ô, vì hình dạng mới là thứ người dùng nói: "3 cột 1
 * dòng" trên màn hình rộng là hợp lý, còn 8 cột thì mỗi ô hẹp hơn một dòng lệnh.
 */
export const TOI_DA_CANH = 6;

const kep = (n: number, min: number, max: number): number =>
  Math.min(Math.max(Math.trunc(Number.isFinite(n) ? n : min), min), max);

/**
 * Lưới người dùng tự khai: `cot` cột, mỗi cột `dong` ô.
 *
 * Khác `boCucLuoi` ở chỗ số ô KHÔNG phải số terminal — người dùng được phép dựng 3×3 cho 4
 * terminal và chừa 5 ô trống để lát nữa kéo thêm vào. Đó là lựa chọn của họ, không phải lỗi.
 */
export function boCucTuCotDong(cot: number, dong: number): BoCucLuoi {
  const c = kep(cot, 1, TOI_DA_CANH);
  const d = kep(dong, 1, TOI_DA_CANH);
  return {
    orientation: 0,
    groups: Array.from({ length: c }, () =>
      d === 1 ? {} : { groups: Array.from({ length: d }, () => ({})) },
    ),
  };
}

/**
 * Đọc "3x3", "3 X 2", "2*4", "2,3" hoặc "3" (= 3 cột, 1 dòng) thành số cột và số dòng.
 *
 * Trả `null` với mọi thứ không đọc được HOẶC nằm ngoài khoảng cho phép, để ô nhập báo lỗi
 * ngay lúc gõ thay vì dựng ra một lưới không ai muốn rồi mới biết.
 */
export function docCotDong(s: string): { cot: number; dong: number } | null {
  const t = s.trim().toLowerCase();
  const hopLe = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= TOI_DA_CANH;
  const doi = /^(\d+)\s*[x*,×]\s*(\d+)$/.exec(t);
  if (doi !== null) {
    const cot = Number(doi[1]);
    const dong = Number(doi[2]);
    return hopLe(cot) && hopLe(dong) ? { cot, dong } : null;
  }
  const don = /^(\d+)$/.exec(t);
  if (don !== null) {
    const cot = Number(don[1]);
    return hopLe(cot) ? { cot, dong: 1 } : null;
  }
  return null;
}

/**
 * Đối số cho `vscode.setEditorLayout`. Tổng số ô LUÔN bằng số terminal đưa vào (đã cắt theo
 * `TOI_DA_O`): một ô trống trong lưới là chỗ người dùng tưởng có terminal mà không có.
 */
export function boCucLuoi(soTerminal: number): BoCucLuoi {
  return {
    orientation: 0,
    groups: phanBoCot(soTerminal).map((soHang) =>
      soHang === 1 ? {} : { groups: Array.from({ length: soHang }, () => ({})) },
    ),
  };
}

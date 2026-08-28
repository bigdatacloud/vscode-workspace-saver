import type { Role } from '../model/schema';

/**
 * Sắp xếp lại thứ tự terminal (kéo thả trong cây) và chuyển terminal sang workspace khác.
 *
 * Tách khỏi manager vì cả hai đều là phép biến đổi thuần trên danh sách — chỗ dễ sai nhất
 * không phải việc gọi API vscode mà là chỉ số sau khi đã bỏ các phần tử đang kéo ra.
 */

/**
 * Chèn các mục đang kéo vào TRƯỚC mục đích, giữ nguyên thứ tự tương đối giữa chúng.
 *
 * `idDich === null` (thả ra vùng trống) hoặc đích không tìm thấy → nối vào cuối. Thả lên chính
 * một mục đang bị kéo → không đổi gì: người dùng vừa nhấc lên đặt xuống đúng chỗ cũ.
 *
 * Vị trí chèn tính TRÊN DANH SÁCH ĐÃ BỎ các mục đang kéo, không phải trên danh sách gốc —
 * tính trên danh sách gốc thì kéo xuống dưới luôn lệch một ô.
 */
export function chuyenViTri<T extends { id: string }>(
  ds: readonly T[],
  idKeo: readonly string[],
  idDich: string | null,
): T[] {
  const keo = new Set(idKeo);
  if (idDich !== null && keo.has(idDich)) return [...ds];
  const dangKeo = ds.filter((x) => keo.has(x.id));
  if (dangKeo.length === 0) return [...ds];
  const conLai = ds.filter((x) => !keo.has(x.id));
  const viTri = idDich === null ? -1 : conLai.findIndex((x) => x.id === idDich);
  if (viTri === -1) return [...conLai, ...dangKeo];
  return [...conLai.slice(0, viTri), ...dangKeo, ...conLai.slice(viTri)];
}

export type KetQuaChuyen =
  | { loai: 'giu'; role: Role }
  | { loai: 'bo'; lyDo: 'khongCoVai' | 'dichKhongCoTen' | 'dichDaCoDieuPhoi' };

/**
 * Vai nào ở workspace ĐÍCH ứng với vai cũ khi chuyển một terminal sang đó.
 *
 * Vai thuộc về workspace nên id ở hai bên khác nhau — khớp theo TÊN là cách duy nhất có
 * nghĩa. Không có tên tương ứng thì bỏ vai và nói rõ, chứ không âm thầm nhân bản định nghĩa
 * vai sang workspace đích: nhân bản là tạo ra hai bản mô tả rồi lệch nhau về sau.
 */
export function vaiTuongUng(
  vaiCu: Role | undefined,
  vaiDich: readonly Role[],
  dichDaCoDieuPhoi: boolean,
): KetQuaChuyen {
  if (vaiCu === undefined) return { loai: 'bo', lyDo: 'khongCoVai' };
  const khop = vaiDich.find((r) => r.name.toLowerCase() === vaiCu.name.toLowerCase());
  if (khop === undefined) return { loai: 'bo', lyDo: 'dichKhongCoTen' };
  // Một workspace chỉ một người điều phối. Chuyển terminal không được là đường vòng qua đó.
  if (khop.kind === 'orchestrator' && dichDaCoDieuPhoi) {
    return { loai: 'bo', lyDo: 'dichDaCoDieuPhoi' };
  }
  return { loai: 'giu', role: khop };
}

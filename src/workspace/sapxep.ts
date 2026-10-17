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

/** Đủ để sắp xếp một workspace trong cây; phần còn lại của `Workspace` không liên quan. */
export interface MucSapXep {
  id: string;
  name: string;
  lastActiveAt: string | null;
  /** Có mặt = người dùng đã tự đặt vị trí cho nó (ghim). Vắng mặt = để tự sắp. */
  order?: number;
}

/**
 * Thứ tự workspace trong cây: phần GHIM TAY nằm trên theo đúng số thứ tự đã ghim, phần còn
 * lại nằm dưới và vẫn tự sắp theo lần kích hoạt gần nhất.
 *
 * Vì sao lai chứ không thủ công hẳn: đa số workspace không đáng để ai đi sắp tay, mà cách tự
 * sắp cũ (mới dùng lên đầu) đúng với chúng. Chỉ vài cái quan trọng cần đứng yên một chỗ —
 * ghim đúng mấy cái đó, số còn lại không phải quản.
 *
 * `order` trùng nhau là chuyện có thật (hai cửa sổ VS Code ghi shard lệch nhau), nên vẫn
 * tie-break theo tên để thứ tự không nhảy loạn giữa hai lần vẽ cây.
 */
export function sapXepWorkspace<T extends MucSapXep>(ds: readonly T[]): T[] {
  return [...ds].sort((a, b) => {
    const ga = a.order ?? null;
    const gb = b.order ?? null;
    if (ga !== null && gb !== null && ga !== gb) return ga - gb;
    if (ga !== null && gb === null) return -1;
    if (ga === null && gb !== null) return 1;
    if (ga === null && gb === null && a.lastActiveAt !== b.lastActiveAt) {
      if (a.lastActiveAt === null) return 1;
      if (b.lastActiveAt === null) return -1;
      return b.lastActiveAt.localeCompare(a.lastActiveAt);
    }
    return a.name.localeCompare(b.name);
  });
}

export interface KetQuaGhim {
  /** Thứ tự hiển thị mới, đủ cả danh sách. */
  thuTu: string[];
  /** Những id phải ghim (gán `order` theo đúng chỉ số trong mảng này); id khác phải BỎ ghim. */
  ghim: string[];
}

/**
 * Kéo thả workspace: tính thứ tự mới và xem phải ghim tới đâu.
 *
 * Quy tắc: ghim từ đầu danh sách tới mục bị kéo nằm dưới cùng. Chỉ ghim mình mục bị kéo là
 * không đủ — để nó nằm đúng sau một mục đang tự sắp thì mục kia cũng phải cố định, nếu không
 * lần kích hoạt kế tiếp của một workspace khác sẽ đẩy nó đi chỗ khác. Phần nằm dưới vị trí
 * vừa thả không bị ghim: người dùng chưa phát biểu gì về chúng.
 *
 * Thả xuống cuối (`idDich === null`) thì cả danh sách bị ghim — đó là hệ quả trực tiếp của
 * quy tắc trên, không phải ngoại lệ.
 */
export function ghimSauKhiKeo(
  thuTuHienTai: readonly string[],
  idKeo: readonly string[],
  idDich: string | null,
): KetQuaGhim {
  const thuTu = chuyenViTri(
    thuTuHienTai.map((id) => ({ id })),
    idKeo,
    idDich,
  ).map((x) => x.id);
  const keoCoThat = idKeo.filter((id) => thuTuHienTai.includes(id));
  // Không có gì thực sự di chuyển (thả lên chính nó, hoặc id lạ) thì đừng ghim ai: một cú
  // nhấc-đặt-lại-chỗ-cũ không phải là lời phát biểu về thứ tự.
  const dungYen = keoCoThat.length === 0 || thuTu.every((id, i) => id === thuTuHienTai[i]);
  if (dungYen) return { thuTu, ghim: [] };
  const cuoi = Math.max(...keoCoThat.map((id) => thuTu.indexOf(id)));
  return { thuTu, ghim: thuTu.slice(0, cuoi + 1) };
}

/**
 * Nút Lên / Xuống: đổi chỗ với hàng xóm. KHÔNG vòng từ đầu xuống cuối — bấm quá tay ở biên
 * mà danh sách nhảy vòng là thứ không ai cố ý làm.
 */
export function doiChoHangXom(thuTu: readonly string[], id: string, huong: 'len' | 'xuong'): string[] {
  const ds = [...thuTu];
  const i = ds.indexOf(id);
  if (i === -1) return ds;
  const j = huong === 'len' ? i - 1 : i + 1;
  if (j < 0 || j >= ds.length) return ds;
  [ds[i], ds[j]] = [ds[j] as string, ds[i] as string];
  return ds;
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

/**
 * Mỗi phiên agent một CÂY riêng — và một TÊN riêng.
 *
 * Anh Ý 22/11/2026: "khi mở một phiên mới thì luôn hỏi tên cây mới là gì, để mỗi phiên — dù
 * trên cùng một project hay nhiều project khác nhau, thư mục khác nhau — luôn là một cây, để
 * không bị trùng, dễ bị lộn. Tên terminal trùng tên cây hiện tại để dễ phân biệt."
 *
 * Trước bản vá này, đường tạo phiên mới trả lời sai ở hai chỗ:
 *  - để TRỐNG tên việc là hợp lệ → phiên chạy thẳng trên checkout chính, nhiều phiên dùng
 *    chung một thư mục (đúng cái worktree sinh ra để tránh);
 *  - cây đã tồn tại thì DÙNG LẠI im lặng, không hỏi entry nào đang giữ nó.
 *
 * Module thuần: không biết vscode, không đụng đĩa. Nó chỉ phán xử một chuỗi người dùng vừa gõ.
 */

import { duongDanCay, ghepTenWorktree } from '../git/worktree';
import { choLamViec } from './trungphien';

/** Một entry đang có trong store — mọi workspace, kể cả workspace đang đóng. */
export interface EntryDaCo {
  id: string;
  name: string;
  cwd: string;
  worktree?: { path: string };
  /** Tên workspace chứa entry — chỉ để nói cho người dùng biết phiên trùng đang nằm ở đâu. */
  tenWorkspace: string;
}

export type PhanXuTenCay =
  | { loai: 'ok'; tenCay: string; duongDanCay: string | null }
  /** Chưa gõ gì. Không còn nghĩa "làm thẳng trên thư mục chính" như trước 22/11/2026. */
  | { loai: 'rong' }
  /** Tên này đi vào tên nhánh git và một đoạn đường dẫn — có ký tự không dùng được. */
  | { loai: 'cuPhap' }
  | { loai: 'trungTen'; tenWorkspace: string; tenEntry: string }
  | { loai: 'trungCho'; tenWorkspace: string; tenEntry: string };

export interface DauHieuTenCay {
  /** Chuỗi người dùng vừa gõ (tên việc). */
  viec: string;
  /** Vai, hoặc id agent khi chưa gắn vai — ghép vào đuôi tên cây. */
  vai: string;
  /** Gốc repo chứa thư mục làm việc; `null` = ngoài git, không có cây nào để tạo. */
  repoGoc: string | null;
  /** Mọi entry đang có, mọi workspace. */
  daCo: readonly EntryDaCo[];
  /** Entry đang xét (ca đổi tên) — loại khỏi phép so, không ai trùng với chính mình. */
  boQuaId?: string;
}

/** Tên vào tên nhánh git + một đoạn đường dẫn: chữ, số, và `. _ - /`, không `..`, không mở đầu bằng `-`. */
const TEN_HOP_LE = /^[\w.][\w./-]*$/;

function chuan(s: string): string {
  return s.trim().toLowerCase();
}

export function xetTenCay(d: DauHieuTenCay): PhanXuTenCay {
  const viec = d.viec.trim();
  if (viec === '') return { loai: 'rong' };

  // Ngoài git tên chỉ là nhãn cho tab terminal và cho phiên Claude — không vào tên nhánh nào,
  // nên để nguyên chuỗi người dùng gõ (cho cả khoảng trắng và dấu tiếng Việt).
  const trongGit = d.repoGoc !== null;
  if (trongGit && (!TEN_HOP_LE.test(viec) || viec.includes('..'))) return { loai: 'cuPhap' };

  const tenCay = trongGit ? ghepTenWorktree(viec, d.vai) : viec;
  const cay = d.repoGoc === null ? null : duongDanCay(d.repoGoc, tenCay);

  const cho = cay === null ? null : choLamViec({ cwd: cay });
  const trung = entryTrungTen(tenCay, d.daCo, d.boQuaId);
  if (trung !== null) {
    return { loai: 'trungTen', tenWorkspace: trung.tenWorkspace, tenEntry: trung.name };
  }
  for (const e of d.daCo) {
    if (e.id === d.boQuaId) continue;
    // Trùng CHỖ chỉ xét khi có cây: ngoài git, dùng chung thư mục là chuyện đã được người dùng
    // chấp nhận bằng một cảnh báo riêng (xem `hoiTenCay`), chặn ở đây là chặn luôn ca đó.
    if (cho !== null && choLamViec(e) === cho) {
      return { loai: 'trungCho', tenWorkspace: e.tenWorkspace, tenEntry: e.name };
    }
  }

  return { loai: 'ok', tenCay, duongDanCay: cay };
}

/**
 * Entry nào đang mang đúng tên này — `null` nghĩa là tên còn trống.
 *
 * So trên cả store, không riêng workspace đang mở: hai phiên trùng tên ở hai workspace khác
 * nhau vẫn hiện cạnh nhau trong cùng một cây, trong `claude agents`, và trong session picker.
 * Hạ hoa-thường vì người dùng phân biệt bằng mắt, không bằng mã ký tự.
 */
export function entryTrungTen(
  ten: string,
  daCo: readonly EntryDaCo[],
  boQuaId?: string,
): EntryDaCo | null {
  const t = chuan(ten);
  for (const e of daCo) {
    if (e.id === boQuaId) continue;
    if (chuan(e.name) === t) return e;
  }
  return null;
}

/** Câu báo cho người dùng, ngay trong ô nhập; `null` = tên dùng được. */
export function loiTenCay(kq: PhanXuTenCay, trongGit: boolean): string | null {
  switch (kq.loai) {
    case 'ok':
      return null;
    case 'rong':
      return trongGit
        ? 'Nhập tên việc — mỗi phiên cần thư mục và nhánh riêng.'
        : 'Nhập tên cho phiên này.';
    case 'cuPhap':
      return 'Chỉ dùng chữ, số, dấu . _ - / và không bắt đầu bằng dấu -';
    case 'trungTen':
      return `Tên này đã có: phiên "${kq.tenEntry}" trong workspace "${kq.tenWorkspace}". Đặt tên khác để không lộn.`;
    case 'trungCho':
      return `Cây này đang là của phiên "${kq.tenEntry}" (workspace "${kq.tenWorkspace}"). Đặt tên khác.`;
  }
}

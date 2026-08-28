import { createHash } from 'node:crypto';
import { chuanHoaDuongDan } from '../git/worktree';

/**
 * Kết xuất mô tả vai thành một khối có mốc trong `AGENTS.md` của worktree.
 *
 * Vì sao cần khối có mốc thay vì ghi đè cả file: `AGENTS.md` là file của REPO, người dùng có
 * thể đã viết quy ước riêng trong đó. Ghi đè là xoá công của họ. Khối có mốc cho phép vai và
 * nội dung repo cùng sống, và cho phép gỡ vai ra mà trả lại file y như cũ.
 *
 * Vì sao mốc mang `hash`: hash tính lúc SINH. Đọc lại mà thân khối cho hash khác nghĩa là có
 * người sửa tay bên trong — lúc đó ghi đè là mất công của họ lần nữa, nên phải HỎI.
 */

const NHAN = 'ai-workspace:role';

function thoat(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 8 ký tự hex là đủ để phát hiện sửa tay, và đủ ngắn để mốc vẫn đọc được bằng mắt. */
export function bamNoiDung(s: string): string {
  return createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 8);
}

export function dungKhoiRole(noiDung: string, ten: string, roleId: string): string {
  const than = noiDung.trim();
  return [
    `<!-- ${NHAN} ${ten} id=${roleId} hash=${bamNoiDung(than)} — SINH TỰ ĐỘNG, đừng sửa tay -->`,
    than,
    `<!-- /${NHAN} id=${roleId} -->`,
  ].join('\n');
}

interface KhoiTimThay {
  toanBo: string;
  hash: string;
  than: string;
}

function timKhoi(agentsMd: string, roleId: string): KhoiTimThay | null {
  const id = thoat(roleId);
  const re = new RegExp(
    `<!-- ${NHAN} [^\\n]*?id=${id} hash=([0-9a-f]+)[^\\n]*-->\\r?\\n([\\s\\S]*?)\\r?\\n<!-- /${NHAN} id=${id} -->`,
  );
  const m = re.exec(agentsMd);
  if (m === null) return null;
  return { toanBo: m[0], hash: m[1] ?? '', than: m[2] ?? '' };
}

export type KetQuaChen = 'them' | 'thay' | 'nguoiDungDaSua' | 'khongDoi';

export interface KetQuaChenKhoi {
  noiDung: string;
  ketQua: KetQuaChen;
}

export function chenKhoiRole(
  agentsMd: string,
  noiDungVai: string,
  ten: string,
  roleId: string,
): KetQuaChenKhoi {
  const khoiMoi = dungKhoiRole(noiDungVai, ten, roleId);
  const cu = timKhoi(agentsMd, roleId);

  if (cu === null) {
    if (agentsMd.trim() === '') return { noiDung: `${khoiMoi}\n`, ketQua: 'them' };
    return { noiDung: `${agentsMd.replace(/\s+$/, '')}\n\n${khoiMoi}\n`, ketQua: 'them' };
  }

  // Thân khối không còn khớp hash đã ghi → có người sửa tay. Không đè, để bên gọi đi hỏi.
  if (bamNoiDung(cu.than) !== cu.hash) return { noiDung: agentsMd, ketQua: 'nguoiDungDaSua' };
  // So cả khối (không chỉ thân): tên vai đổi mà nội dung giữ nguyên vẫn phải ghi lại mốc.
  if (cu.toanBo === khoiMoi) return { noiDung: agentsMd, ketQua: 'khongDoi' };
  // Hàm thay thế, không phải chuỗi: `$&`, `$1`… trong nội dung vai sẽ bị diễn giải nếu dùng chuỗi.
  return { noiDung: agentsMd.replace(cu.toanBo, () => khoiMoi), ketQua: 'thay' };
}

/**
 * Gỡ khối của một vai, trả `AGENTS.md` về đúng hình dạng trước khi vai được chèn.
 *
 * Nuốt thêm ĐÚNG một dòng trống ngăn cách phía trước và một xuống dòng phía sau — vừa đủ để
 * không để lại lỗ hổng, và không đụng tới khoảng trắng người dùng cố ý đặt ở chỗ khác.
 */
export function goKhoiRole(agentsMd: string, roleId: string): string {
  const cu = timKhoi(agentsMd, roleId);
  if (cu === null) return agentsMd;
  const i = agentsMd.indexOf(cu.toanBo);
  const truoc = agentsMd.slice(0, i).replace(/\r?\n\r?\n$/, '\n');
  const con = agentsMd.slice(i + cu.toanBo.length).replace(/^\r?\n/, '');
  const ra = `${truoc}${con}`;
  return ra.trim() === '' ? '' : ra;
}

/**
 * Còn entry nào KHÁC vẫn cần khối vai này trong cùng thư mục không.
 *
 * Hai terminal chia nhau một worktree với cùng một vai là chuyện có thật (một cái chạy, một
 * cái để đọc). Gỡ khối chỉ vì một trong hai bị bỏ đi là rút vai khỏi cái còn lại — bên gọi
 * phải hỏi câu này trước khi gỡ.
 *
 * @param conLai Các entry CÒN LẠI sau khi đã bỏ cái đang xét.
 */
export function conCanKhoi(
  roleId: string,
  thuMuc: string,
  conLai: readonly { roleId?: string; thuMuc: string }[],
): boolean {
  const dich = chuanHoaDuongDan(thuMuc);
  return conLai.some((e) => e.roleId === roleId && chuanHoaDuongDan(e.thuMuc) === dich);
}

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PURE_DIRS = ['git', 'agent', 'model', 'adopt', 'claude', 'trust', 'proc', 'capture', 'role'];
/** Module thuần nằm lẻ trong thư mục có cả code lớp vscode (src/workspace). */
const PURE_FILES = [join('src', 'workspace', 'activate.ts')];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Kiểm tra một đoạn mã nguồn có import module 'vscode' hay không, dưới bất kỳ hình thức nào:
 * import tĩnh (`from 'vscode'`, bao gồm cả `import type`), `require('vscode')`,
 * hoặc import động (`import('vscode')` / `await import('vscode')`).
 * KHÔNG được báo động giả với các chuỗi/đường dẫn chỉ trông giống 'vscode'
 * (vd 'vscode-languageserver', './vscode-helpers') hay chữ 'vscode' xuất hiện trong comment.
 */
function chuaImportVscode(source: string): boolean {
  const laImportTinh = /from\s+['"]vscode['"]/.test(source);
  const laRequire = /require\(\s*['"]vscode['"]\s*\)/.test(source);
  const laImportDong = /import\(\s*['"]vscode['"]\s*\)/.test(source);
  return laImportTinh || laRequire || laImportDong;
}

describe('hàng rào kiến trúc', () => {
  it('các module core không được import vscode', () => {
    const offenders: string[] = [];
    const files = [...PURE_DIRS.flatMap((dir) => walk(join('src', dir))), ...PURE_FILES];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (chuaImportVscode(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('hàm chuaImportVscode bắt đủ mọi hình thức import vscode và không báo động giả', () => {
    // Phải bắt được — mọi hình thức import/require module 'vscode', kể cả import động.
    expect(chuaImportVscode(`import * as vscode from 'vscode';`)).toBe(true);
    expect(chuaImportVscode(`const v = await import("vscode");`)).toBe(true);
    expect(chuaImportVscode(`import type {X} from 'vscode'`)).toBe(true);
    expect(chuaImportVscode(`const v = require('vscode')`)).toBe(true);

    // Không được báo động giả — chuỗi/đường dẫn chỉ trông giống 'vscode', hoặc chữ 'vscode' trong comment.
    expect(chuaImportVscode(`const x = 'vscode-languageserver';`)).toBe(false);
    expect(chuaImportVscode(`// nói về vscode trong comment`)).toBe(false);
    expect(chuaImportVscode(`import { helper } from './vscode-helpers';`)).toBe(false);
  });
});

describe('bất biến của phần worktree', () => {
  const manager = readFileSync(join('src', 'workspace', 'manager.ts'), 'utf8');
  const gitWorktree = readFileSync(join('src', 'git', 'worktree.ts'), 'utf8');

  /** Thân của một phương thức, cắt từ chữ ký tới dòng `  }` đầu tiên ở đúng mức thụt lề. */
  function thanPhuongThuc(src: string, chuKy: string): string {
    const dau = src.indexOf(chuKy);
    expect(dau, `không tìm thấy ${chuKy}`).toBeGreaterThan(-1);
    const cuoi = src.indexOf('\n  }', dau);
    return src.slice(dau, cuoi === -1 ? undefined : cuoi);
  }

  it('newPlainTerminal KHÔNG tạo worktree', () => {
    // Shell thường là để chạy dev server, git log, test runner — worktree riêng cho chúng gần
    // như luôn là sai ý. Đây là chủ ý, không phải chuyện tình cờ.
    expect(thanPhuongThuc(manager, 'async newPlainTerminal(')).not.toContain('hoiWorktree');
    // Và bảo đảm phép cắt thân hàm thật sự nhìn thấy nội dung: hai lệnh agent PHẢI có nó.
    expect(thanPhuongThuc(manager, 'async newClaudeTerminal(')).toContain('hoiWorktree');
    expect(thanPhuongThuc(manager, 'async newCodexTerminal(')).toContain('hoiWorktree');
  });

  it('không còn hộp thoại "Lưu và đóng workspace X trước khi mở Y"', () => {
    // Nhiều workspace mở song song là hành vi mong muốn; nhãn nút đó quay lại nghĩa là ai đó
    // đã khôi phục mô hình một-workspace.
    expect(manager).not.toContain('Lưu và đóng');
  });

  it('lệnh git phá huỷ không bao giờ mang cờ ép', () => {
    // git từ chối gỡ worktree còn thay đổi chưa commit, hoặc xoá nhánh chưa merge, là lưới an
    // toàn cuối cùng của lệnh dọn. Thêm --force/-D là gỡ chính cái lưới đó.
    // Soi CHUỖI trong mã, không soi comment: phần giải thích ở đây có nhắc tên các cờ đó.
    for (const co of ['--force', '-D', '-f']) {
      expect(gitWorktree, `cờ ${co} không được xuất hiện trong lệnh git`).not.toContain(`'${co}'`);
    }
  });
});

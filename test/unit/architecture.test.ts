import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PURE_DIRS = ['manifest', 'git', 'agent', 'events', 'index', 'model', 'adopt'];

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
    for (const dir of PURE_DIRS) {
      for (const file of walk(join('src', dir))) {
        const src = readFileSync(file, 'utf8');
        if (chuaImportVscode(src)) {
          offenders.push(file);
        }
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

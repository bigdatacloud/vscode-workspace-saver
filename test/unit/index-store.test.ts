import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceIndex } from '../../src/index/store';

let dir: string; let file: string; let index: WorkspaceIndex;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wss-idx-'));
  file = join(dir, 'index.json');
  index = new WorkspaceIndex(file);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const entry = (name: string, path: string, at = 1) =>
  ({ name, manifestPath: path, lastOpenedAt: at });

describe('WorkspaceIndex', () => {
  it('list trả rỗng khi chưa có file', async () => {
    expect(await index.list()).toEqual([]);
  });

  it('upsert rồi list ra đúng entry', async () => {
    await index.upsert(entry('ERP', '/p/erp/.ai-workspace/workspace.yaml'));
    expect(await index.list()).toEqual([entry('ERP', '/p/erp/.ai-workspace/workspace.yaml')]);
  });

  it('upsert cùng manifestPath thì cập nhật chứ không nhân bản', async () => {
    await index.upsert(entry('ERP', '/p/a/workspace.yaml', 1));
    await index.upsert(entry('ERP đổi tên', '/p/a/workspace.yaml', 2));
    const list = await index.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('ERP đổi tên');
    expect(list[0]!.lastOpenedAt).toBe(2);
  });

  it('list sắp xếp theo lastOpenedAt giảm dần', async () => {
    await index.upsert(entry('cũ', '/p/a/workspace.yaml', 1));
    await index.upsert(entry('mới', '/p/b/workspace.yaml', 9));
    expect((await index.list()).map((e) => e.name)).toEqual(['mới', 'cũ']);
  });

  it('remove xoá đúng entry', async () => {
    await index.upsert(entry('A', '/p/a/workspace.yaml'));
    await index.upsert(entry('B', '/p/b/workspace.yaml'));
    await index.remove('/p/a/workspace.yaml');
    expect((await index.list()).map((e) => e.name)).toEqual(['B']);
  });

  it('list trả rỗng khi file index hỏng, không ném lỗi', async () => {
    writeFileSync(file, '{ hong');
    expect(await index.list()).toEqual([]);
  });

  it('prune bỏ các entry có manifest không còn tồn tại', async () => {
    await index.upsert(entry('còn', '/p/a/workspace.yaml'));
    await index.upsert(entry('mất', '/p/b/workspace.yaml'));
    const kept = await index.prune(async (p) => p === '/p/a/workspace.yaml');
    expect(kept.map((e) => e.name)).toEqual(['còn']);
    expect((await index.list()).map((e) => e.name)).toEqual(['còn']);
  });
});

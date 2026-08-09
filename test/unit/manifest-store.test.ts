import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManifest, writeManifest, readState, writeState, ManifestError } from '../../src/manifest/store';
import type { Manifest } from '../../src/manifest/schema';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'wss-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const MANIFEST: Manifest = {
  version: 1,
  workspace: { name: 'ERP Development Team' },
  project: { root: '.' },
  sessions: [{
    key: 'coordinator', name: 'ERP-Coordinator', role: 'coordinator',
    worktree: { path: '../erp-coordinator', branch: 'main' },
    terminal: { name: 'Coordinator' }, startupCommand: null, agent: 'claude',
  }],
};

describe('manifest store', () => {
  it('ghi rồi đọc lại ra đúng nội dung cũ', async () => {
    await writeManifest(root, MANIFEST);
    expect(await readManifest(root)).toEqual(MANIFEST);
  });

  it('ghi kèm .ai-workspace/.gitignore loại state.json', async () => {
    await writeManifest(root, MANIFEST);
    const ignore = readFileSync(join(root, '.ai-workspace', '.gitignore'), 'utf8');
    expect(ignore).toContain('state.json');
  });

  it('ném ManifestError kèm mô tả khi yaml sai schema', async () => {
    mkdirSync(join(root, '.ai-workspace'), { recursive: true });
    const file = join(root, '.ai-workspace', 'workspace.yaml');
    writeFileSync(file, 'version: 2\nworkspace:\n  name: X\n');
    try {
      await readManifest(root);
      expect.fail('phải ném ManifestError');
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestError);
      if (error instanceof ManifestError) {
        expect(error.issues).not.toHaveLength(0);
        expect(error.issues.some((issue) => issue.includes('version'))).toBe(true);
        expect(error.message).toContain(file);
      }
    }
  });

  it('ném ManifestError khi yaml hỏng cú pháp', async () => {
    mkdirSync(join(root, '.ai-workspace'), { recursive: true });
    const file = join(root, '.ai-workspace', 'workspace.yaml');
    writeFileSync(file, 'version: [1\n');
    try {
      await readManifest(root);
      expect.fail('phải ném ManifestError');
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestError);
      if (error instanceof ManifestError) {
        expect(error.issues).not.toHaveLength(0);
        expect(error.message).toContain(file);
      }
    }
  });

  it('readState trả state rỗng khi chưa có file', async () => {
    expect(await readState(root)).toEqual({ version: 1, sessions: {} });
  });

  it('readState trả state rỗng khi file hỏng thay vì ném lỗi', async () => {
    mkdirSync(join(root, '.ai-workspace'), { recursive: true });
    writeFileSync(join(root, '.ai-workspace', 'state.json'), '{ khong phai json');
    expect(await readState(root)).toEqual({ version: 1, sessions: {} });
  });

  it('ghi rồi đọc lại state', async () => {
    const state = {
      version: 1 as const,
      sessions: {
        coordinator: {
          sessionId: '639a2ba8-e4f0-4e0b-917c-6ab773c8a922',
          pid: 12028, lastStatus: 'idle' as const, lastActiveAt: 1786254024591,
        },
      },
    };
    await writeState(root, state);
    expect(await readState(root)).toEqual(state);
  });

  it('chi tiết lỗi tên session trùng nhau', async () => {
    mkdirSync(join(root, '.ai-workspace'), { recursive: true });
    const yamlWithDuplicateName = `version: 1
workspace:
  name: ERP Team
sessions:
  - key: s1
    name: Duplicate Name
    terminal: { name: S1 }
  - key: s2
    name: Duplicate Name
    terminal: { name: S2 }
`;
    const file = join(root, '.ai-workspace', 'workspace.yaml');
    writeFileSync(file, yamlWithDuplicateName);
    try {
      await readManifest(root);
      expect.fail('phải ném ManifestError');
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestError);
      if (error instanceof ManifestError) {
        expect(error.issues).not.toHaveLength(0);
        expect(error.issues.some((issue) => issue.includes('name'))).toBe(true);
        expect(error.message).toContain(file);
      }
    }
  });
});

# Workspace v2 — Global Terminal Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay lõi extension: danh sách workspace toàn cục, mỗi workspace quản nhiều terminal đang mở (kể cả terminal người dùng tự mở), auto-save liên tục, kích hoạt lại bằng một click.

**Architecture:** Pure core mới (`src/model/`, `src/adopt/`, `src/claude/`, `src/workspace/activate.ts`) + cutover lớp vscode (manager/tree/commands/extension). Spec: `docs/superpowers/specs/2026-08-10-workspace-v2-global-terminal-manager-design.md`.

**Tech Stack:** TypeScript, zod, vitest, VS Code Extension API. Test: `npm test` (vitest), `npm run typecheck`.

## Global Constraints

- Pure core KHÔNG import vscode (kể cả `await import('vscode')`): `src/model/`, `src/adopt/`, `src/claude/`, `src/agent/`, `src/git/`, `src/workspace/activate.ts`.
- Mọi chuỗi đặc thù Claude (tên binary, cờ CLI, biến env) chỉ nằm trong `src/agent/claude.ts`. Ngoại lệ duy nhất được phép: literal `'claude'` làm giá trị `kind` trong `src/model/schema.ts`.
- Chuỗi UI hiển thị cho người dùng bằng tiếng Việt có dấu.
- Mỗi task kết thúc: `npm test` xanh + `npm run typecheck` sạch + commit.
- TDD: viết test đỏ trước, xem nó đỏ, viết code cho xanh.
- KHÔNG dùng `Date.now()`/`randomUUID` trực tiếp trong pure core — nhận qua tham số/port.

---

### Task 1: Model schema (zod)

**Files:**
- Create: `src/model/schema.ts`
- Test: `test/model/schema.test.ts`

**Interfaces:**
- Produces: `TerminalEntrySchema`, `WorkspaceSchema`, `StoreFileSchema`, types `TerminalEntry`, `Workspace`, `StoreFile`, `TerminalKind`, hàm `emptyStore(): StoreFile`. Task 2, 6, 8 dùng các type này.

- [ ] **Step 1: Viết test đỏ** — `test/model/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { StoreFileSchema, WorkspaceSchema, emptyStore } from '../../src/model/schema';

const uuid1 = '11111111-1111-4111-8111-111111111111';
const uuid2 = '22222222-2222-4222-8222-222222222222';
const uuid3 = '33333333-3333-4333-8333-333333333333';

const termClaude = {
  id: uuid2, name: 'erp-agent', cwd: 'D:\\Coding\\erp', kind: 'claude',
  claudeSessionId: uuid3, claudeName: 'erp-agent',
};
const wsValid = {
  id: uuid1, name: 'ERP', lastActiveAt: null, activeWindowId: null,
  terminals: [termClaude, { id: uuid3, name: 'dev', cwd: 'D:\\Coding\\erp', kind: 'plain', startCommand: 'npm run dev' }],
};

describe('StoreFileSchema', () => {
  it('chấp nhận store hợp lệ và emptyStore()', () => {
    expect(() => StoreFileSchema.parse({ version: 2, workspaces: [wsValid] })).not.toThrow();
    expect(StoreFileSchema.parse(emptyStore())).toEqual({ version: 2, workspaces: [] });
  });

  it('từ chối version khác 2', () => {
    expect(() => StoreFileSchema.parse({ version: 1, workspaces: [] })).toThrow();
  });

  it('từ chối hai workspace trùng tên không phân biệt hoa thường, path trỏ đúng phần tử', () => {
    const dup = { ...wsValid, id: uuid2, name: 'erp' };
    const r = StoreFileSchema.safeParse({ version: 2, workspaces: [wsValid, dup] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.').includes('workspaces.1'))).toBe(true);
    }
  });

  it('từ chối hai workspace trùng id', () => {
    const dup = { ...wsValid, name: 'Khác' };
    expect(StoreFileSchema.safeParse({ version: 2, workspaces: [wsValid, dup] }).success).toBe(false);
  });
});

describe('WorkspaceSchema', () => {
  it('từ chối hai terminal trùng id trong một workspace', () => {
    const ws = { ...wsValid, terminals: [termClaude, { ...termClaude, name: 'khác' }] };
    const r = WorkspaceSchema.safeParse(ws);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.').includes('terminals.1'))).toBe(true);
    }
  });

  it('từ chối id không phải uuid và name rỗng', () => {
    expect(WorkspaceSchema.safeParse({ ...wsValid, id: 'abc' }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...wsValid, name: '' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ** — `npx vitest run test/model/schema.test.ts` → FAIL (module chưa tồn tại).

- [ ] **Step 3: Implement** — `src/model/schema.ts`:

```ts
import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, 'phải là UUID');

export const TerminalEntrySchema = z.object({
  id: uuid,
  name: z.string().min(1),
  cwd: z.string().min(1),
  kind: z.enum(['claude', 'plain']),
  startCommand: z.string().min(1).optional(),
  claudeSessionId: uuid.optional(),
  claudeName: z.string().min(1).optional(),
});

export const WorkspaceSchema = z
  .object({
    id: uuid,
    name: z.string().min(1),
    lastActiveAt: z.string().nullable(),
    activeWindowId: z.string().nullable(),
    terminals: z.array(TerminalEntrySchema),
  })
  .superRefine((ws, ctx) => {
    const seen = new Set<string>();
    ws.terminals.forEach((t, i) => {
      if (seen.has(t.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['terminals', i, 'id'], message: `Terminal id trùng: ${t.id}` });
      }
      seen.add(t.id);
    });
  });

export const StoreFileSchema = z
  .object({ version: z.literal(2), workspaces: z.array(WorkspaceSchema) })
  .superRefine((file, ctx) => {
    const names = new Set<string>();
    const ids = new Set<string>();
    file.workspaces.forEach((ws, i) => {
      const lower = ws.name.toLowerCase();
      if (names.has(lower)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['workspaces', i, 'name'], message: `Tên workspace trùng: ${ws.name}` });
      }
      if (ids.has(ws.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['workspaces', i, 'id'], message: `Id workspace trùng: ${ws.id}` });
      }
      names.add(lower);
      ids.add(ws.id);
    });
  });

export type TerminalEntry = z.infer<typeof TerminalEntrySchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type StoreFile = z.infer<typeof StoreFileSchema>;
export type TerminalKind = TerminalEntry['kind'];

export const emptyStore = (): StoreFile => ({ version: 2, workspaces: [] });
```

- [ ] **Step 4: Xanh** — `npx vitest run test/model/schema.test.ts` → PASS. `npm run typecheck` sạch.
- [ ] **Step 5: Commit** — `git add src/model test/model && git commit -m "feat(model): zod schema store v2"`

---

### Task 2: Model store — load/save/backup/CRUD (pure)

**Files:**
- Create: `src/model/store.ts`
- Test: `test/model/store.test.ts`

**Interfaces:**
- Consumes: Task 1 (`StoreFile`, `Workspace`, `TerminalEntry`, `StoreFileSchema`, `emptyStore`).
- Produces (Task 8 dùng):

```ts
export interface StoreFs {
  readFile(path: string): string | null; // null nếu file không tồn tại; lỗi khác cứ throw
  writeFile(path: string, content: string): void;
  rename(from: string, to: string): void;
}
export interface LoadResult { store: StoreFile; recoveredFrom: string | null; }
export function loadStore(fs: StoreFs, filePath: string, epoch: () => number): LoadResult;
export function saveStore(fs: StoreFs, filePath: string, store: StoreFile): void; // temp + rename
export function createWorkspace(store: StoreFile, name: string, id: string): Workspace; // throw nếu trùng tên (case-insensitive)
export function findWorkspace(store: StoreFile, id: string): Workspace | undefined;
export function upsertTerminal(ws: Workspace, entry: TerminalEntry): void; // thay theo id, không có thì push
export function removeTerminal(ws: Workspace, terminalId: string): void;
export const realStoreFs: StoreFs; // node:fs sync, readFile trả null khi ENOENT
```

- [ ] **Step 1: Test đỏ** — `test/model/store.test.ts` (fs giả bằng Map):

```ts
import { describe, expect, it } from 'vitest';
import { emptyStore } from '../../src/model/schema';
import {
  createWorkspace, findWorkspace, loadStore, removeTerminal, saveStore, upsertTerminal, type StoreFs,
} from '../../src/model/store';

function memFs(init: Record<string, string> = {}) {
  const files = new Map(Object.entries(init));
  const ops: string[] = [];
  const fs: StoreFs = {
    readFile: (p) => (files.has(p) ? files.get(p)! : null),
    writeFile: (p, c) => { ops.push(`write:${p}`); files.set(p, c); },
    rename: (a, b) => {
      ops.push(`rename:${a}->${b}`);
      if (!files.has(a)) throw new Error(`ENOENT: ${a}`);
      files.set(b, files.get(a)!); files.delete(a);
    },
  };
  return { fs, files, ops };
}
const P = 'C:\\store\\workspaces.json';
const uuidA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuidB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('loadStore', () => {
  it('file vắng mặt → store rỗng, không recovered', () => {
    const { fs } = memFs();
    expect(loadStore(fs, P, () => 1)).toEqual({ store: emptyStore(), recoveredFrom: null });
  });

  it('file hợp lệ → parse đúng', () => {
    const { fs } = memFs({ [P]: JSON.stringify(emptyStore()) });
    expect(loadStore(fs, P, () => 1).store).toEqual(emptyStore());
  });

  it('file hỏng → backup sang .bak-<epoch>, store rỗng, recoveredFrom trỏ backup', () => {
    const { fs, files } = memFs({ [P]: '{hỏng' });
    const r = loadStore(fs, P, () => 777);
    expect(r.store).toEqual(emptyStore());
    expect(r.recoveredFrom).toBe(`${P}.bak-777`);
    expect(files.get(`${P}.bak-777`)).toBe('{hỏng');
    expect(files.has(P)).toBe(false);
  });

  it('JSON hợp lệ nhưng sai schema (version 1) cũng bị backup', () => {
    const { fs } = memFs({ [P]: JSON.stringify({ version: 1, workspaces: [] }) });
    expect(loadStore(fs, P, () => 5).recoveredFrom).toBe(`${P}.bak-5`);
  });
});

describe('saveStore', () => {
  it('ghi qua temp rồi rename (atomic), nội dung parse lại được', () => {
    const { fs, files, ops } = memFs();
    saveStore(fs, P, emptyStore());
    expect(ops).toEqual([`write:${P}.tmp`, `rename:${P}.tmp->${P}`]);
    expect(JSON.parse(files.get(P)!)).toEqual(emptyStore());
  });
});

describe('CRUD', () => {
  it('createWorkspace thêm và trả workspace; trùng tên case-insensitive thì throw', () => {
    const store = emptyStore();
    const ws = createWorkspace(store, 'ERP', uuidA);
    expect(store.workspaces).toHaveLength(1);
    expect(ws.terminals).toEqual([]);
    expect(() => createWorkspace(store, 'erp', uuidB)).toThrow(/đã tồn tại/);
  });

  it('upsertTerminal thay theo id, removeTerminal gỡ đúng phần tử', () => {
    const store = emptyStore();
    const ws = createWorkspace(store, 'X', uuidA);
    const t = { id: uuidB, name: 'a', cwd: 'C:\\x', kind: 'plain' as const };
    upsertTerminal(ws, t);
    upsertTerminal(ws, { ...t, name: 'b' });
    expect(ws.terminals).toEqual([{ ...t, name: 'b' }]);
    removeTerminal(ws, uuidB);
    expect(ws.terminals).toEqual([]);
    expect(findWorkspace(store, uuidA)).toBe(ws);
  });
});
```

- [ ] **Step 2: Chạy thấy đỏ.**
- [ ] **Step 3: Implement** — `src/model/store.ts`:

```ts
import * as nodeFs from 'node:fs';
import { StoreFileSchema, emptyStore, type StoreFile, type TerminalEntry, type Workspace } from './schema';

export interface StoreFs {
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  rename(from: string, to: string): void;
}

export interface LoadResult { store: StoreFile; recoveredFrom: string | null; }

export function loadStore(fs: StoreFs, filePath: string, epoch: () => number): LoadResult {
  const raw = fs.readFile(filePath);
  if (raw === null) return { store: emptyStore(), recoveredFrom: null };
  try {
    return { store: StoreFileSchema.parse(JSON.parse(raw)), recoveredFrom: null };
  } catch {
    const backup = `${filePath}.bak-${epoch()}`;
    fs.rename(filePath, backup);
    return { store: emptyStore(), recoveredFrom: backup };
  }
}

export function saveStore(fs: StoreFs, filePath: string, store: StoreFile): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFile(tmp, JSON.stringify(store, null, 2));
  fs.rename(tmp, filePath);
}

export function createWorkspace(store: StoreFile, name: string, id: string): Workspace {
  const lower = name.toLowerCase();
  if (store.workspaces.some((w) => w.name.toLowerCase() === lower)) {
    throw new Error(`Tên workspace "${name}" đã tồn tại.`);
  }
  const ws: Workspace = { id, name, lastActiveAt: null, activeWindowId: null, terminals: [] };
  store.workspaces.push(ws);
  return ws;
}

export function findWorkspace(store: StoreFile, id: string): Workspace | undefined {
  return store.workspaces.find((w) => w.id === id);
}

export function upsertTerminal(ws: Workspace, entry: TerminalEntry): void {
  const i = ws.terminals.findIndex((t) => t.id === entry.id);
  if (i >= 0) ws.terminals[i] = entry;
  else ws.terminals.push(entry);
}

export function removeTerminal(ws: Workspace, terminalId: string): void {
  const i = ws.terminals.findIndex((t) => t.id === terminalId);
  if (i >= 0) ws.terminals.splice(i, 1);
}

export const realStoreFs: StoreFs = {
  readFile(p) {
    try {
      return nodeFs.readFileSync(p, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  writeFile(p, c) { nodeFs.writeFileSync(p, c, 'utf8'); },
  rename(a, b) { nodeFs.renameSync(a, b); },
};
```

- [ ] **Step 4: Xanh + typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(model): store load/save atomic + backup + CRUD"`

---

### Task 3: TrustStore — key mờ thay cho đường dẫn manifest

Lý do: v2 dùng key `ws:<uuid>`; `memoryKey` hiện tại gọi `path.resolve` sẽ dán cwd của process vào một uuid → key phụ thuộc cwd, sai. Caller cũ (manager MVP) sẽ bị xóa ở Task 8; chữ ký `string` không đổi nên vẫn compile.

**Files:**
- Modify: `src/trust/store.ts` (bỏ `path.resolve` trong `memoryKey`, đổi tên tham số `manifestPath` → `key`; giữ lowercase)
- Test: `test/trust/store.test.ts` (sửa test hiện có cho khớp + thêm test mới)

- [ ] **Step 1: Thêm test đỏ** vào `test/trust/store.test.ts`:

```ts
it('key mờ không bị path.resolve — hai cwd process khác nhau vẫn cùng key', async () => {
  // 'ws:<uuid>' không phải đường dẫn: fingerprint phải tra được bất kể cwd
  const mem = new Map<string, string>();
  const memory = { get: (k: string) => mem.get(k), set: async (k: string, v: string) => { mem.set(k, v); } };
  const store = new TrustStore(memory);
  const key = 'ws:AAAAAAAA-1111-4111-8111-111111111111';
  await store.trust(key, ['npm run dev']);
  expect(store.isTrusted(key.toLowerCase(), ['npm run dev'])).toBe(true); // case-insensitive
  expect([...mem.keys()][0]).toBe(`trust:${key.toLowerCase()}`); // không dính drive/cwd
});
```

(Chỉnh cú pháp cho khớp khung test hiện có của file — test hiện có dùng đường dẫn manifest, đổi các assert kỳ vọng key `trust:<path đã resolve>` thành `trust:<key lowercase>` và truyền sẵn key tuyệt đối trong test cũ nếu cần.)

- [ ] **Step 2: Chạy thấy đỏ** (key hiện tại sẽ thành `trust:<cwd>\ws:aaaa...`).
- [ ] **Step 3: Sửa `memoryKey`:**

```ts
function memoryKey(key: string): string {
  return `trust:${key.toLowerCase()}`;
}
```

và đổi tên tham số `manifestPath` → `key` trong `isTrusted`/`trust`. Xóa import `node:path` nếu không còn dùng.

- [ ] **Step 4: Toàn bộ `npm test` xanh** (test cũ đã chỉnh phải phản ánh hành vi mới, không bẻ assert cho qua).
- [ ] **Step 5: Commit** — `git commit -m "refactor(trust): key mờ, bỏ path.resolve"`

---

### Task 4: adopt/filter — phân loại terminal mới mở (pure)

**Files:**
- Create: `src/adopt/filter.ts`
- Test: `test/adopt/filter.test.ts`

**Interfaces (Task 8 dùng):**

```ts
export type AdoptDecision = 'auto' | 'suggest';
export interface OpenedTerminalInfo { isPty: boolean; creationName: string | undefined; }
export function classifyTerminal(info: OpenedTerminalInfo): AdoptDecision;
export function pickCwd(
  shellCwd: string | undefined, creationCwd: string | undefined, folderCwd: string | undefined,
): string | null;
```

- [ ] **Step 1: Test đỏ:**

```ts
import { describe, expect, it } from 'vitest';
import { classifyTerminal, pickCwd } from '../../src/adopt/filter';

describe('classifyTerminal', () => {
  it('terminal pty của extension khác → suggest', () => {
    expect(classifyTerminal({ isPty: true, creationName: undefined })).toBe('suggest');
    expect(classifyTerminal({ isPty: true, creationName: 'My Ext' })).toBe('suggest');
  });
  it('terminal có tên do task/extension đặt → suggest', () => {
    expect(classifyTerminal({ isPty: false, creationName: 'npm: build' })).toBe('suggest');
  });
  it('tên rỗng/toàn khoảng trắng coi như không tên → auto', () => {
    expect(classifyTerminal({ isPty: false, creationName: '' })).toBe('auto');
    expect(classifyTerminal({ isPty: false, creationName: '   ' })).toBe('auto');
  });
  it('người dùng Ctrl+Shift+` (không tên) → auto', () => {
    expect(classifyTerminal({ isPty: false, creationName: undefined })).toBe('auto');
  });
});

describe('pickCwd', () => {
  it('ưu tiên shellCwd > creationCwd > folderCwd; không có gì → null', () => {
    expect(pickCwd('C:\\a', 'C:\\b', 'C:\\c')).toBe('C:\\a');
    expect(pickCwd(undefined, 'C:\\b', 'C:\\c')).toBe('C:\\b');
    expect(pickCwd(undefined, undefined, 'C:\\c')).toBe('C:\\c');
    expect(pickCwd(undefined, undefined, undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Đỏ.**
- [ ] **Step 3: Implement:**

```ts
export type AdoptDecision = 'auto' | 'suggest';

export interface OpenedTerminalInfo {
  isPty: boolean;
  creationName: string | undefined;
}

// Heuristic: terminal người dùng mở bằng Ctrl+Shift+` không có creationOptions.name;
// task runner và extension luôn đặt tên hoặc dùng pty riêng.
export function classifyTerminal(info: OpenedTerminalInfo): AdoptDecision {
  if (info.isPty) return 'suggest';
  if (info.creationName !== undefined && info.creationName.trim() !== '') return 'suggest';
  return 'auto';
}

export function pickCwd(
  shellCwd: string | undefined,
  creationCwd: string | undefined,
  folderCwd: string | undefined,
): string | null {
  return shellCwd ?? creationCwd ?? folderCwd ?? null;
}
```

- [ ] **Step 4: Xanh.**
- [ ] **Step 5: Commit** — `git commit -m "feat(adopt): phân loại terminal mới mở"`

---

### Task 5: claude/match — đối chiếu cwd terminal ↔ registry (pure)

**Files:**
- Create: `src/claude/match.ts`
- Test: `test/claude/match.test.ts`

**Interfaces (Task 8 dùng):**

```ts
import type { RunningSession } from '../agent/types';
export interface MatchCandidate { terminalId: string; cwd: string; claimedSessionId?: string; }
export interface MatchedPair { terminalId: string; session: RunningSession; }
export interface AmbiguousGroup { cwd: string; terminalIds: string[]; sessions: RunningSession[]; }
export interface MatchResult { matched: MatchedPair[]; ambiguous: AmbiguousGroup[]; }
export function normalizeCwd(p: string, platform?: NodeJS.Platform): string;
export function matchClaudeSessions(
  candidates: MatchCandidate[], running: RunningSession[], platform?: NodeJS.Platform,
): MatchResult;
```

Luật (spec mục 6): chỉ xét hàng `kind === 'interactive'` có cwd khác rỗng; loại session đã bị candidate nào đó giữ (`claimedSessionId`) và loại candidate đã giữ session; gom theo cwd chuẩn hóa (`path.resolve`, lowercase chỉ trên win32); nhóm 1 candidate + 1 session → `matched`; nhóm có cả hai phía nhưng không phải 1-1 → `ambiguous`; nhóm chỉ có một phía → bỏ.

- [ ] **Step 1: Test đỏ:**

```ts
import { describe, expect, it } from 'vitest';
import type { RunningSession } from '../../src/agent/types';
import { matchClaudeSessions, normalizeCwd } from '../../src/claude/match';

const s = (over: Partial<RunningSession>): RunningSession => ({
  sessionId: '11111111-1111-4111-8111-111111111111', name: 'a', cwd: 'D:\\x',
  pid: 1, kind: 'interactive', status: 'idle', ...over,
});
const SID2 = '22222222-2222-4222-8222-222222222222';
const SID3 = '33333333-3333-4333-8333-333333333333';

describe('normalizeCwd', () => {
  it('win32: không phân biệt hoa thường và dấu chéo', () => {
    expect(normalizeCwd('D:\\Coding\\ERP', 'win32')).toBe(normalizeCwd('d:/coding/erp', 'win32'));
  });
  it('linux: giữ nguyên hoa thường', () => {
    expect(normalizeCwd('/a/B', 'linux')).not.toBe(normalizeCwd('/a/b', 'linux'));
  });
});

describe('matchClaudeSessions', () => {
  it('1 terminal + 1 session cùng cwd → matched', () => {
    const r = matchClaudeSessions([{ terminalId: 't1', cwd: 'd:/x' }], [s({})], 'win32');
    expect(r.matched).toEqual([{ terminalId: 't1', session: s({}) }]);
    expect(r.ambiguous).toEqual([]);
  });

  it('bỏ qua hàng background và hàng cwd rỗng', () => {
    const r = matchClaudeSessions(
      [{ terminalId: 't1', cwd: 'D:\\x' }],
      [s({ kind: 'background' }), s({ sessionId: SID2, cwd: '' })],
      'win32',
    );
    expect(r.matched).toEqual([]);
  });

  it('session đã bị terminal khác giữ thì không match lại; candidate đã giữ cũng đứng ngoài', () => {
    const r = matchClaudeSessions(
      [
        { terminalId: 't1', cwd: 'D:\\x', claimedSessionId: s({}).sessionId },
        { terminalId: 't2', cwd: 'D:\\x' },
      ],
      [s({}), s({ sessionId: SID2 })],
      'win32',
    );
    // t1 giữ session 1 → còn t2 và session 2: 1-1 → matched
    expect(r.matched).toEqual([{ terminalId: 't2', session: s({ sessionId: SID2 }) }]);
  });

  it('2 terminal + 1 session cùng cwd → ambiguous, không đoán', () => {
    const r = matchClaudeSessions(
      [{ terminalId: 't1', cwd: 'D:\\x' }, { terminalId: 't2', cwd: 'D:\\x' }],
      [s({})], 'win32',
    );
    expect(r.matched).toEqual([]);
    expect(r.ambiguous).toEqual([
      { cwd: normalizeCwd('D:\\x', 'win32'), terminalIds: ['t1', 't2'], sessions: [s({})] },
    ]);
  });

  it('1 terminal + 2 session cùng cwd → ambiguous', () => {
    const r = matchClaudeSessions(
      [{ terminalId: 't1', cwd: 'D:\\x' }],
      [s({}), s({ sessionId: SID3 })], 'win32',
    );
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].sessions).toHaveLength(2);
  });

  it('session không cùng cwd với terminal nào → bị bỏ, không matched không ambiguous', () => {
    const r = matchClaudeSessions([{ terminalId: 't1', cwd: 'D:\\y' }], [s({})], 'win32');
    expect(r).toEqual({ matched: [], ambiguous: [] });
  });
});
```

- [ ] **Step 2: Đỏ.**
- [ ] **Step 3: Implement:**

```ts
import * as path from 'node:path';
import type { RunningSession } from '../agent/types';

export interface MatchCandidate { terminalId: string; cwd: string; claimedSessionId?: string; }
export interface MatchedPair { terminalId: string; session: RunningSession; }
export interface AmbiguousGroup { cwd: string; terminalIds: string[]; sessions: RunningSession[]; }
export interface MatchResult { matched: MatchedPair[]; ambiguous: AmbiguousGroup[]; }

export function normalizeCwd(p: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(p);
  return platform === 'win32' ? resolved.toLowerCase().replaceAll('\\', '/') : resolved;
}

export function matchClaudeSessions(
  candidates: MatchCandidate[],
  running: RunningSession[],
  platform: NodeJS.Platform = process.platform,
): MatchResult {
  const claimed = new Set(candidates.map((c) => c.claimedSessionId).filter((x): x is string => !!x));
  const freeSessions = running.filter(
    (r) => r.kind === 'interactive' && r.cwd !== '' && !claimed.has(r.sessionId),
  );
  const freeCandidates = candidates.filter((c) => !c.claimedSessionId);

  const groups = new Map<string, { terminalIds: string[]; sessions: RunningSession[] }>();
  const group = (cwd: string) => {
    const key = normalizeCwd(cwd, platform);
    let g = groups.get(key);
    if (!g) { g = { terminalIds: [], sessions: [] }; groups.set(key, g); }
    return g;
  };
  for (const c of freeCandidates) group(c.cwd).terminalIds.push(c.terminalId);
  for (const r of freeSessions) group(r.cwd).sessions.push(r);

  const result: MatchResult = { matched: [], ambiguous: [] };
  for (const [cwd, g] of groups) {
    if (g.terminalIds.length === 0 || g.sessions.length === 0) continue;
    if (g.terminalIds.length === 1 && g.sessions.length === 1) {
      result.matched.push({ terminalId: g.terminalIds[0], session: g.sessions[0] });
    } else {
      result.ambiguous.push({ cwd, terminalIds: g.terminalIds, sessions: g.sessions });
    }
  }
  return result;
}
```

Lưu ý: test `normalizeCwd` win32 chạy trên máy dev Windows sẽ resolve `d:/coding/erp` về cùng chuỗi; trên CI POSIX `path.resolve('D:\\Coding\\ERP')` không tách drive — vì repo này dev và test trên Windows (như MVP), giữ nguyên; KHÔNG dùng `path.win32` vì cwd thật do registry/VS Code cấp luôn là đường dẫn native của máy đang chạy.

- [ ] **Step 4: Xanh.**
- [ ] **Step 5: Commit** — `git commit -m "feat(claude): match cwd terminal với registry"`

---

### Task 6: workspace/activate — orchestrator kích hoạt (pure)

**Files:**
- Create: `src/workspace/activate.ts`
- Test: `test/workspace/activate.test.ts`

**Interfaces:**
- Consumes: `Workspace`, `TerminalEntry` (Task 1); `AgentAdapter`, `LaunchSpec` (`src/agent/types.ts` — đã có).
- Produces (Task 8 dùng):

```ts
export interface ActivateTerminalHandle { sendText(text: string): void; }
export interface ActivatePorts {
  createTerminal(entry: TerminalEntry): ActivateTerminalHandle; // throw nếu tạo fail
  agent: AgentAdapter;
  fsExists(p: string): boolean;
  isTrusted(commands: string[]): boolean;
  confirmTrust(commands: string[]): Promise<boolean>; // modal "Tin và chạy?"
  onMinted(terminalId: string, sessionId: string): Promise<void>; // PHẢI được gọi trước sendText
  warn(message: string): void;
}
export interface ActivateReport { opened: string[]; failed: { id: string; reason: string }[]; }
export async function activateWorkspace(ws: Workspace, ports: ActivatePorts): Promise<ActivateReport>;
```

Hành vi (spec mục 4): trust chỉ áp cho `startCommand` của terminal `plain` — lệnh claude luôn chạy. Không có startCommand nào → không gọi `isTrusted`/`confirmTrust`. Bị từ chối trust → mở shell nhưng không gửi startCommand (warn một dòng). cwd mất → failed + tiếp tục entry khác. Lỗi per-entry cô lập bằng try/catch. Entry claude thiếu `claudeSessionId` → mint qua `agent.newSessionId()`, `await onMinted(...)` **trước** khi sendText (chống mồ côi hội thoại), mode `new`; có sẵn id → mode `resume`. Tên peer: `claudeName ?? name`.

- [ ] **Step 1: Test đỏ:**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { AgentAdapter, LaunchSpec } from '../../src/agent/types';
import type { TerminalEntry, Workspace } from '../../src/model/schema';
import { activateWorkspace, type ActivatePorts } from '../../src/workspace/activate';

const U = (n: string) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

const fakeAgent = (minted: string): AgentAdapter => ({
  id: 'fake',
  newSessionId: () => minted,
  buildLaunchCommand: (spec: LaunchSpec) => `LAUNCH ${spec.mode.kind} ${spec.mode.sessionId} AS ${spec.name}`,
  listRunning: async () => [],
  isAvailable: async () => true,
});

function ws(terminals: TerminalEntry[]): Workspace {
  return { id: U('1'), name: 'X', lastActiveAt: null, activeWindowId: null, terminals };
}

function makePorts(over: Partial<ActivatePorts> = {}) {
  const sent = new Map<string, string[]>();
  const calls: string[] = [];
  const ports: ActivatePorts = {
    createTerminal: (e) => {
      calls.push(`create:${e.id}`);
      const box: string[] = [];
      sent.set(e.id, box);
      return { sendText: (t) => { calls.push(`send:${e.id}`); box.push(t); } };
    },
    agent: fakeAgent(U('9')),
    fsExists: () => true,
    isTrusted: () => true,
    confirmTrust: async () => true,
    onMinted: async () => { calls.push('minted'); },
    warn: () => {},
    ...over,
  };
  return { ports, sent, calls };
}

const claudeNew: TerminalEntry = { id: U('2'), name: 'agent-a', cwd: 'D:\\x', kind: 'claude' };
const claudeResume: TerminalEntry = { ...claudeNew, id: U('3'), claudeSessionId: U('5'), claudeName: 'peer-b' };
const plainCmd: TerminalEntry = { id: U('4'), name: 'dev', cwd: 'D:\\x', kind: 'plain', startCommand: 'npm run dev' };

describe('activateWorkspace', () => {
  it('claude có sessionId → resume với claudeName; thiếu → mint, onMinted TRƯỚC sendText', async () => {
    const { ports, sent, calls } = makePorts();
    const r = await activateWorkspace(ws([claudeResume, claudeNew]), ports);
    expect(r.opened).toEqual([claudeResume.id, claudeNew.id]);
    expect(sent.get(claudeResume.id)).toEqual([`LAUNCH resume ${U('5')} AS peer-b`]);
    expect(sent.get(claudeNew.id)).toEqual([`LAUNCH new ${U('9')} AS agent-a`]);
    const mintedIdx = calls.indexOf('minted');
    const sendIdx = calls.indexOf(`send:${claudeNew.id}`);
    expect(mintedIdx).toBeGreaterThanOrEqual(0);
    expect(mintedIdx).toBeLessThan(sendIdx);
  });

  it('plain có startCommand + đã trust → gửi lệnh; không startCommand → chỉ mở', async () => {
    const { ports, sent } = makePorts();
    const bare: TerminalEntry = { id: U('6'), name: 'sh', cwd: 'D:\\x', kind: 'plain' };
    await activateWorkspace(ws([plainCmd, bare]), ports);
    expect(sent.get(plainCmd.id)).toEqual(['npm run dev']);
    expect(sent.get(U('6'))).toEqual([]);
  });

  it('chưa trust + người dùng từ chối → mở shell không chạy lệnh, claude vẫn chạy', async () => {
    const { ports, sent } = makePorts({ isTrusted: () => false, confirmTrust: async () => false });
    await activateWorkspace(ws([plainCmd, claudeResume]), ports);
    expect(sent.get(plainCmd.id)).toEqual([]);
    expect(sent.get(claudeResume.id)).toHaveLength(1);
  });

  it('không có startCommand nào → không hỏi trust', async () => {
    const isTrusted = vi.fn(() => true);
    const confirmTrust = vi.fn(async () => true);
    const { ports } = makePorts({ isTrusted, confirmTrust });
    await activateWorkspace(ws([claudeResume]), ports);
    expect(isTrusted).not.toHaveBeenCalled();
    expect(confirmTrust).not.toHaveBeenCalled();
  });

  it('cwd mất → failed nêu đường dẫn, entry khác vẫn chạy', async () => {
    const { ports, sent } = makePorts({ fsExists: (p) => p !== 'D:\\mat' });
    const gone: TerminalEntry = { ...plainCmd, id: U('7'), cwd: 'D:\\mat' };
    const r = await activateWorkspace(ws([gone, claudeResume]), ports);
    expect(r.failed).toEqual([{ id: U('7'), reason: expect.stringContaining('D:\\mat') }]);
    expect(sent.get(claudeResume.id)).toHaveLength(1);
  });

  it('createTerminal ném → cô lập vào failed, không văng ra ngoài', async () => {
    const { ports, sent } = makePorts();
    const boom = ports.createTerminal;
    ports.createTerminal = (e) => {
      if (e.id === claudeResume.id) throw new Error('nổ');
      return boom(e);
    };
    const r = await activateWorkspace(ws([claudeResume, plainCmd]), ports);
    expect(r.failed).toEqual([{ id: claudeResume.id, reason: 'nổ' }]);
    expect(sent.get(plainCmd.id)).toEqual(['npm run dev']);
  });
});
```

- [ ] **Step 2: Đỏ.**
- [ ] **Step 3: Implement** — `src/workspace/activate.ts`:

```ts
import type { AgentAdapter } from '../agent/types';
import type { TerminalEntry, Workspace } from '../model/schema';

export interface ActivateTerminalHandle { sendText(text: string): void; }

export interface ActivatePorts {
  createTerminal(entry: TerminalEntry): ActivateTerminalHandle;
  agent: AgentAdapter;
  fsExists(p: string): boolean;
  isTrusted(commands: string[]): boolean;
  confirmTrust(commands: string[]): Promise<boolean>;
  onMinted(terminalId: string, sessionId: string): Promise<void>;
  warn(message: string): void;
}

export interface ActivateReport {
  opened: string[];
  failed: { id: string; reason: string }[];
}

export async function activateWorkspace(ws: Workspace, ports: ActivatePorts): Promise<ActivateReport> {
  const report: ActivateReport = { opened: [], failed: [] };

  const startCommands = ws.terminals
    .filter((t) => t.kind === 'plain' && t.startCommand)
    .map((t) => t.startCommand as string);
  let runStartCommands = true;
  if (startCommands.length > 0 && !ports.isTrusted(startCommands)) {
    runStartCommands = await ports.confirmTrust(startCommands);
    if (!runStartCommands) {
      ports.warn('Đã mở shell nhưng không chạy lệnh khởi động (chưa được tin cậy).');
    }
  }

  for (const entry of ws.terminals) {
    try {
      if (!ports.fsExists(entry.cwd)) {
        report.failed.push({ id: entry.id, reason: `Thư mục không còn: ${entry.cwd}` });
        continue;
      }
      const handle = ports.createTerminal(entry);
      if (entry.kind === 'claude') {
        const hadId = entry.claudeSessionId !== undefined;
        const sessionId = entry.claudeSessionId ?? ports.agent.newSessionId();
        if (!hadId) await ports.onMinted(entry.id, sessionId);
        handle.sendText(ports.agent.buildLaunchCommand({
          name: entry.claudeName ?? entry.name,
          mode: { kind: hadId ? 'resume' : 'new', sessionId },
        }));
      } else if (entry.startCommand && runStartCommands) {
        handle.sendText(entry.startCommand);
      }
      report.opened.push(entry.id);
    } catch (e) {
      report.failed.push({ id: entry.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}
```

- [ ] **Step 4: Xanh + typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(workspace): orchestrator kích hoạt v2"`

---

### Task 7: TerminalManager — nhận nuôi terminal ngoài + tra danh tính

**Files:**
- Modify: `src/terminal/manager.ts`

Lớp vscode — không unit-test (theo tiền lệ MVP); gate là `npm run typecheck` + smoke Task 9. Đồng thời sửa comment sai đã ghi nợ (lý do delete-trước-dispose: `createTerminal` ném thì không để lại entry chết; sự kiện close là async nên "offline giả" không phải lý do).

- [ ] **Step 1: Thêm 3 API** (giữ nguyên mọi API hiện có):

```ts
/** Nhận nuôi terminal có sẵn (adoption) — track như terminal của mình, không show lại. */
adopt(key: string, terminal: vscode.Terminal): void {
  const cu = this.terminals.get(key);
  if (cu && cu !== terminal) {
    this.terminals.delete(key);
    cu.dispose();
  }
  this.terminals.set(key, terminal);
}

/** Trả key nếu terminal này đang được track, ngược lại null. */
ownsTerminal(terminal: vscode.Terminal): string | null {
  for (const [key, t] of this.terminals) if (t === terminal) return key;
  return null;
}

get(key: string): vscode.Terminal | undefined {
  return this.terminals.get(key);
}
```

- [ ] **Step 2: Sửa comment** trong `create()` cho đúng lý do (xem trên).
- [ ] **Step 3:** `npm run typecheck` sạch, `npm test` vẫn xanh.
- [ ] **Step 4: Commit** — `git commit -m "feat(terminal): adopt + ownsTerminal + get; sửa comment delete-trước-dispose"`

---

### Task 8: Cutover lớp vscode — manager v2, tree 2 tầng, commands, extension, xóa module chết

Task lớn nhất — một lần cắt chuyển để mỗi commit vẫn compile. Không unit-test lớp vscode; gate: `npm run typecheck` sạch + toàn bộ `npm test` xanh (sau khi xóa test chết) + `npm run build` ra `dist/extension.js`.

**Files:**
- Rewrite: `src/workspace/manager.ts` (manager v2 — thay hoàn toàn nội dung cũ)
- Rewrite: `src/ui/tree.ts`, `src/ui/commands.ts`, `src/extension.ts`
- Modify: `package.json` (contributes), `test/architecture.test.ts`
- Delete: `src/manifest/` (cả thư mục), `src/index/`, `src/events/`, `src/workspace/restore.ts`, `src/trust/` phần nào chỉ phục vụ manifest (giữ `store.ts`), cùng các test chết: `test/manifest/**`, `test/index/**`, `test/events/**`, `test/workspace/restore.test.ts`, `test/integration/**` nếu test flow manifest cũ (đọc trước khi xóa — test nào thuần git/agent thì giữ).

**Bước 8.1 — Manager v2** (`src/workspace/manager.ts`). Public surface BẮT BUỘC đúng như sau (tree/commands lệ thuộc):

```ts
export type TerminalState = 'busy' | 'idle' | 'blocked' | 'open' | 'closed' | 'error';
export interface WorkspaceView {
  id: string; name: string; terminalCount: number; isActive: boolean; lastActiveAt: string | null;
}
export interface TerminalView {
  id: string; workspaceId: string; name: string; kind: 'claude' | 'plain';
  state: TerminalState; hasStartCommand: boolean;
}

export class WorkspaceManager implements vscode.Disposable {
  constructor(
    context: vscode.ExtensionContext,   // globalStorageUri + globalState (trust)
    terminals: TerminalManager,
    agent: AgentAdapter,
  );
  readonly onDidChange: vscode.Event<void>;
  workspaceViews(): WorkspaceView[];              // sắp theo lastActiveAt giảm dần, null cuối
  terminalViews(workspaceId: string): TerminalView[];
  getActiveWorkspaceId(): string | null;
  createAndActivate(): Promise<void>;             // showInputBox tên → createWorkspace → activate
  activate(workspaceId: string): Promise<void>;   // flow V6 + khóa V5 (override qua warning button)
  closeActive(): Promise<void>;
  rename(workspaceId: string): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>; // confirm modal; active thì closeActive trước
  newClaudeTerminal(workspaceId: string): Promise<void>;
  setStartCommand(workspaceId: string, terminalId: string): Promise<void>;
  removeTerminal(workspaceId: string, terminalId: string): Promise<void>;
  addOpenTerminal(terminal: vscode.Terminal | undefined): Promise<void>;
  focusTerminal(workspaceId: string, terminalId: string): void; // chưa mở + ws active → mở lại riêng nó
  refreshStatuses(): Promise<void>;               // tick poll 3s
  flush(): void;                                  // save ngay (gọi từ deactivate)
  dispose(): void;
}
```

Chi tiết hành vi bắt buộc (đối chiếu spec mục 4–6 — implementer đọc spec file trước khi viết):

- **Store**: nạp bằng `loadStore(realStoreFs, join(globalStorageUri.fsPath, 'workspaces.json'), Date.now)` (tạo thư mục globalStorage bằng `fs.mkdirSync(recursive)` trước). `recoveredFrom` khác null → `showWarningMessage` một lần nêu đường dẫn backup.
- **Auto-save**: mọi mutation gọi `scheduleSave()` — debounce 500ms qua `setTimeout`; `flush()` clear timer + save ngay; save lỗi → warning + giữ cờ dirty để lần sau thử lại.
- **Map terminalId → key TerminalManager**: dùng chính `entry.id` làm key.
- **activate(id)**: nếu active hiện tại === id → chỉ focus. Nếu có active khác → modal `showWarningMessage('Lưu và đóng workspace "X" trước khi mở "Y"?', {modal:true}, 'Lưu và đóng')` — hủy thì return. Khóa V5: ws đích có `activeWindowId` khác null và khác `vscode.env.sessionId` → `showWarningMessage('Workspace đang mở ở cửa sổ khác.', {modal:true}, 'Vẫn mở')` — hủy thì return. Sau đó gọi `activateWorkspace(ws, ports)` với ports nối vào: `createTerminal` → `terminals.create(entry.id, {key: entry.id, name: entry.name, cwd: entry.cwd})`; `fsExists` → `fs.existsSync`; `isTrusted/confirmTrust` → `TrustStore` key `ws:<id>` + modal liệt kê lệnh (nút 'Tin và chạy'); confirm true thì `trustStore.trust(...)` rồi trả true; `onMinted` → gắn `claudeSessionId`+`claudeName` vào entry + `scheduleSave()` + flush ngay (mint phải xuống đĩa trước khi lệnh chạy — gọi `flush()`); `warn` → `showWarningMessage`. Report: failed khác rỗng → warning gộp `Không mở được N terminal: <lý do; ...>`. Đặt `lastActiveAt = new Date().toISOString()`, `activeWindowId = vscode.env.sessionId`, save, fire onDidChange.
- **closeActive()**: flush save, dispose mọi terminal đang track thuộc ws (qua `terminals`), `activeWindowId = null`, active = null, save, fire.
- **Adoption** (constructor đăng ký `vscode.window.onDidOpenTerminal`): bỏ qua khi không có active ws hoặc `terminals.ownsTerminal(t) !== null`. Trích info: `isPty = 'pty' in t.creationOptions`, `creationName = (t.creationOptions as vscode.TerminalOptions).name` → `classifyTerminal`. cwd: `pickCwd(shellCwd, creationCwd, folderCwd)` với shellCwd = `t.shellIntegration?.cwd?.fsPath`, creationCwd từ `creationOptions.cwd` (string hoặc Uri → fsPath), folderCwd = `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath`; null → không adopt (warn im lặng bỏ). `auto`: tạo entry `{id: crypto.randomUUID(), name: t.name, cwd, kind:'plain'}`, `upsertTerminal`, `terminals.adopt(entry.id, t)`, save, toast không modal `Đã thêm "<tên>" vào workspace "<X>"` nút `Bỏ ra` (bấm → removeTerminal khỏi ws + save; KHÔNG dispose terminal thật). `suggest`: toast `Thêm terminal "<tên>" vào workspace "<X>"?` nút `Thêm` → như nhánh auto.
- **onDidChangeTerminalShellIntegration**: terminal thuộc active ws → cập nhật `entry.cwd = e.terminal.shellIntegration.cwd?.fsPath ?? entry.cwd`, save.
- **Terminal đóng tay** (`terminals.onClosed`): KHÔNG xóa entry (V7) — chỉ fire onDidChange (state thành `closed`).
- **refreshStatuses()**: `agent.listRunning()` MỘT lần → (a) cập nhật state các terminal claude theo sessionId (`busy/idle/blocked`; mở mà không thấy trong registry → `open`; chưa mở → `closed`); (b) với active ws: build `MatchCandidate[]` từ terminal **đang mở** (`terminals.has(id)`), `claimedSessionId` từ entry; `matchClaudeSessions` → matched: gắn `claudeSessionId`+`claudeName = session.name ?? entry.name`, `kind='claude'` (thăng cấp), save; ambiguous: mỗi nhóm cwd chỉ hỏi MỘT lần mỗi phiên (Set `askedCwds`), QuickPick tiêu đề `Terminal nào đang chạy session "<name>"?` items = tên terminal trong nhóm (nhiều session thì lồng: với mỗi session một QuickPick) — người dùng Esc → ghi vào `askedCwds`, không hỏi lại. Fire onDidChange khi có thay đổi.
- **addOpenTerminal(t)**: t undefined → `vscode.window.activeTerminal`; vẫn undefined → warning. Không có active ws → QuickPick chọn ws hiện có hoặc mục `$(add) Tạo workspace mới…` (activate ws chọn xong TRƯỚC rồi adopt — hoặc adopt thẳng vào ws chọn mà không activate? **Chọn: adopt vào ws được chọn không cần activate**, vì activate sẽ mở cả loạt terminal khác — ghi rõ hành vi này trong QuickPick placeholder). Đã own rồi → thông báo `Terminal đã thuộc workspace`. Sau adopt: toast xác nhận.
- **newClaudeTerminal(wsId)**: input tên peer (bắt buộc); input cwd mặc định folder đang mở; nếu cwd là git repo (`GitClient.isRepo`) → QuickPick `Chạy tại thư mục này` / `Tạo worktree mới…` (nhập branch, dùng `GitClient.addWorktree` + `buildAddWorktreeArgs` sẵn có — V8); tạo entry kind `claude` không sessionId, nếu ws đang active thì mở terminal + mint + launch ngay (tái dùng nhánh claude của `activateWorkspace` cho MỘT entry — viết helper riêng `launchOne(entry)` trong manager gọi cùng ports), không active → chỉ lưu entry.
- **setStartCommand**: showInputBox (giá trị hiện tại prefill; chuỗi rỗng → xóa startCommand); đổi xong save. KHÔNG tự re-trust — fingerprint đổi nghĩa là lần activate sau sẽ hỏi lại (đúng thiết kế).
- **rename**: input tên mới; trùng tên (case-insensitive) → warning từ chối.
- **deleteWorkspace**: modal confirm `Xóa workspace "<X>"? Terminal đang mở không bị đóng.`; đang active → closeActive() trước? — KHÔNG: xóa ws active thì đóng terminal trước là hành vi bất ngờ; chọn: nếu active → set active null + `activeWindowId=null` nhưng KHÔNG dispose terminal thật, rồi xóa khỏi store, save.

**Bước 8.2 — Tree 2 tầng** (`src/ui/tree.ts` — thay toàn bộ):

```ts
import * as vscode from 'vscode';
import type { TerminalState, TerminalView, WorkspaceManager, WorkspaceView } from '../workspace/manager';

const POLL_MS = 3000;

const STATE_ICONS: Record<TerminalState, { id: string; color: string }> = {
  busy:   { id: 'circle-filled',  color: 'charts.green' },
  idle:   { id: 'circle-filled',  color: 'charts.blue' },
  blocked:{ id: 'circle-filled',  color: 'charts.yellow' },
  open:   { id: 'terminal',       color: 'charts.blue' },
  closed: { id: 'circle-outline', color: 'disabledForeground' },
  error:  { id: 'error',          color: 'charts.red' },
};
const STATE_LABELS: Record<TerminalState, string> = {
  busy: 'đang chạy', idle: 'rảnh', blocked: 'đang chờ',
  open: 'đang mở', closed: 'chưa mở', error: 'lỗi',
};

export class WorkspaceItem extends vscode.TreeItem {
  constructor(readonly view: WorkspaceView) {
    super(view.name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `ws:${view.id}`;
    this.description = view.isActive ? `(đang active) · ${view.terminalCount} terminal` : `${view.terminalCount} terminal`;
    this.iconPath = new vscode.ThemeIcon(
      view.isActive ? 'folder-active' : 'folder',
      view.isActive ? new vscode.ThemeColor('charts.green') : undefined,
    );
    this.contextValue = view.isActive ? 'aiWorkspaceActive' : 'aiWorkspaceInactive';
    if (!view.isActive) {
      this.command = { command: 'aiWorkspace.activateWorkspace', title: 'Kích hoạt', arguments: [this] };
    }
  }
}

export class TerminalItem extends vscode.TreeItem {
  constructor(readonly view: TerminalView) {
    super(view.name, vscode.TreeItemCollapsibleState.None);
    this.id = `term:${view.id}`;
    const kindLabel = view.kind === 'claude' ? 'AI' : 'shell';
    this.description = `${kindLabel} · ${STATE_LABELS[view.state]}`;
    const icon = STATE_ICONS[view.state];
    this.iconPath = new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color));
    this.contextValue = view.kind === 'claude' ? 'aiTerminalClaude' : 'aiTerminalPlain';
    this.command = { command: 'aiWorkspace.focusTerminal', title: 'Mở terminal', arguments: [this] };
  }
}

export type TreeElement = WorkspaceItem | TerminalItem;

export class WorkspaceTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly changed = new vscode.EventEmitter<TreeElement | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly manager: WorkspaceManager) {
    manager.onDidChange(() => this.changed.fire(undefined));
  }

  getTreeItem(element: TreeElement): vscode.TreeItem { return element; }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) return this.manager.workspaceViews().map((v) => new WorkspaceItem(v));
    if (element instanceof WorkspaceItem) {
      return this.manager.terminalViews(element.view.id).map((v) => new TerminalItem(v));
    }
    return [];
  }

  startPolling(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => { void this.manager.refreshStatuses(); }, POLL_MS);
  }
  stopPolling(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
  dispose(): void { this.stopPolling(); this.changed.dispose(); }
}
```

(Icon `folder-active` không tồn tại trong codicon → dùng `root-folder-opened` cho active, `folder` cho còn lại — implementer kiểm tra danh sách codicon, chọn icon có thật, giữ phân biệt active/không.)

**Bước 8.3 — Commands** (`src/ui/commands.ts` — thay toàn bộ). Đăng ký đúng các lệnh sau, item tree hoặc fallback QuickPick/active như ghi chú:

```ts
import * as vscode from 'vscode';
import type { WorkspaceManager } from '../workspace/manager';
import { TerminalItem, WorkspaceItem } from './tree';

export function registerCommands(manager: WorkspaceManager): vscode.Disposable[] {
  const pickWorkspaceId = async (): Promise<string | null> => {
    const views = manager.workspaceViews();
    if (views.length === 0) { void vscode.window.showInformationMessage('Chưa có workspace nào.'); return null; }
    const picked = await vscode.window.showQuickPick(
      views.map((v) => ({ label: v.name, id: v.id })), { placeHolder: 'Chọn workspace' });
    return picked?.id ?? null;
  };
  const wsArg = async (item?: WorkspaceItem): Promise<string | null> =>
    item?.view.id ?? (await pickWorkspaceId());

  return [
    vscode.commands.registerCommand('aiWorkspace.createWorkspace', () => manager.createAndActivate()),
    vscode.commands.registerCommand('aiWorkspace.activateWorkspace', async (item?: WorkspaceItem) => {
      const id = await wsArg(item); if (id) await manager.activate(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.closeActiveWorkspace', () => manager.closeActive()),
    vscode.commands.registerCommand('aiWorkspace.renameWorkspace', async (item?: WorkspaceItem) => {
      const id = await wsArg(item); if (id) await manager.rename(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.deleteWorkspace', async (item?: WorkspaceItem) => {
      const id = await wsArg(item); if (id) await manager.deleteWorkspace(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.newClaudeTerminal', async (item?: WorkspaceItem) => {
      const id = await wsArg(item); if (id) await manager.newClaudeTerminal(id);
    }),
    vscode.commands.registerCommand('aiWorkspace.setStartCommand', (item: TerminalItem) =>
      manager.setStartCommand(item.view.workspaceId, item.view.id)),
    vscode.commands.registerCommand('aiWorkspace.removeTerminal', (item: TerminalItem) =>
      manager.removeTerminal(item.view.workspaceId, item.view.id)),
    vscode.commands.registerCommand('aiWorkspace.focusTerminal', (item: TerminalItem) =>
      manager.focusTerminal(item.view.workspaceId, item.view.id)),
    vscode.commands.registerCommand('aiWorkspace.addOpenTerminalToWorkspace',
      (terminal?: vscode.Terminal) => manager.addOpenTerminal(terminal)),
  ];
}
```

**Bước 8.4 — package.json contributes** (thay khối cũ):

- `commands`: 10 lệnh trên với title tiếng Việt tiền tố `AI Workspace: ` (vd `AI Workspace: Tạo workspace mới`, `AI Workspace: Thêm terminal đang mở vào workspace`…).
- `views.explorer`: `{ "id": "aiWorkspace.workspaces", "name": "AI Workspaces" }` (đổi id view).
- `menus`:
  - `view/title`: `createWorkspace` (icon `$(add)`) khi `view == aiWorkspace.workspaces`.
  - `view/item/context`: `activateWorkspace|renameWorkspace|deleteWorkspace|newClaudeTerminal` khi `viewItem =~ /aiWorkspace(Active|Inactive)/` (activate chỉ cho `aiWorkspaceInactive`; thêm `closeActiveWorkspace` cho `aiWorkspaceActive`); `setStartCommand` khi `viewItem == aiTerminalPlain`; `removeTerminal` khi `viewItem =~ /aiTerminal(Claude|Plain)/`.
  - `terminal/title/context` VÀ `terminal/context`: `aiWorkspace.addOpenTerminalToWorkspace`.
  - `commandPalette`: ẩn các lệnh chỉ-có-nghĩa-với-item (`setStartCommand`, `removeTerminal`, `focusTerminal`) bằng `"when": "false"`.
- Fact cần smoke thủ công (đã ghi trong spec mục 10): VS Code truyền gì vào handler từ `terminal/title/context` — code đã fallback `activeTerminal` nên chạy được cả hai trường hợp.

**Bước 8.5 — extension.ts** (thay): tạo `TerminalManager`, `ClaudeCodeAdapter` (shell detect như cũ qua `detectShellKind`), `WorkspaceManager(context, terminals, adapter)`, `WorkspaceTreeProvider`, `createTreeView('aiWorkspace.workspaces', ...)` + onDidChangeVisibility → start/stopPolling, `registerCommands`, đăng ký hết vào `context.subscriptions`. `deactivate()` gọi `manager.flush()`.

**Bước 8.6 — Xóa module chết + test chết** theo danh sách Files ở trên. Đọc `test/integration/` trước: giữ test thuần git/agent, xóa test flow manifest. Cập nhật `test/architecture.test.ts`: danh sách thư mục pure quét = `src/model`, `src/adopt`, `src/claude`, `src/agent`, `src/git`, `src/workspace/activate.ts`; giữ nguyên detector và positive-control test của nó. Cập nhật luôn test grep "chuỗi claude ngoài adapter" nếu có: whitelist mới chỉ còn `src/model/schema.ts` (literal kind).

- [ ] **Step cuối:** `npm test` xanh toàn bộ, `npm run typecheck` sạch, `npm run build` OK. Commit theo cụm hợp lý (manager / ui / xóa chết) — nhiều commit được, miễn commit cuối xanh.

---

### Task 9: Smoke test Extension Host + tài liệu

**Files:**
- Modify: `test/vscode/smoke.test.ts`, `README.md`, `docs/manual-verification.md`

- [ ] **Step 1: Smoke** — cập nhật theo surface mới: activation bằng ID cũ `bigdatacloud.ai-workspace-session-manager`; assert các lệnh v2 có trong `vscode.commands.getCommands(true)` (đủ 10 lệnh `aiWorkspace.*`); view mở được qua `aiWorkspace.workspaces.focus`; giữ test TerminalManager thật (duplicate key) + thêm test `adopt`/`ownsTerminal` với terminal thật tạo bằng `vscode.window.createTerminal` (không cần shell chạy xong). Lệnh nào chờ dialog thì không gọi (tiền lệ MVP: headless treo).
- [ ] **Step 2:** `npm run test:vscode` xanh.
- [ ] **Step 3: README** — viết lại phần tính năng theo v2 (danh sách workspace toàn cục, adoption, auto-save, kích hoạt/chuyển, startCommand + trust, bắt Claude session); cập nhật số test.
- [ ] **Step 4: manual-verification.md** — viết lại checklist v2, tối thiểu các mục: tạo/kích hoạt/chuyển (modal)/đóng; adoption auto + Bỏ ra; adoption suggest (mở terminal từ task); Ctrl+Shift+` vào ws active; đóng tay terminal → còn entry `chưa mở`; restore claude resume đúng hội thoại; restore plain + startCommand + trust modal (nhận và từ chối); đổi startCommand → hỏi trust lại; QuickPick ambiguity 2 terminal cùng cwd; menu chuột phải tab terminal; khóa 2 cửa sổ + override; workspaces.json hỏng → backup + warning; xóa workspace không đóng terminal thật.
- [ ] **Step 5: Commit** — `git commit -m "test+docs: smoke v2, README, checklist thủ công v2"`

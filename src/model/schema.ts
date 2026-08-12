import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, 'phải là UUID');

/**
 * `.passthrough()` ở cả hai schema: zod mặc định VỨT mọi khoá lạ, nên một bản extension cũ
 * đọc file do bản mới ghi sẽ âm thầm xoá sạch trường nó chưa biết (agentId, agentSessionId,
 * terminalLocation…) ngay ở lần lưu kế tiếp — đúng thứ mà ghi chú "giữ kind:'plain' cho bản
 * cũ đọc được" bên dưới đang cố tránh. Chạy lẫn hai bản (VS Code + Insiders, hoặc hạ cấp) là
 * chuyện thường, nên giữ nguyên khoá lạ thay vì làm mất dữ liệu của bản kia.
 */
export const TerminalEntrySchema = z.object({
  id: uuid,
  name: z.string().min(1),
  cwd: z.string().min(1),
  kind: z.enum(['claude', 'plain']),
  startCommand: z.string().min(1).optional(),
  claudeSessionId: uuid.optional(),
  claudeName: z.string().min(1).optional(),
  /**
   * Terminal chạy một agent KHÔNG phải Claude. Cố ý để `kind` vẫn là `plain`: bản extension
   * cũ đọc file này sẽ coi nó là terminal thường (mở shell, chạy startCommand) thay vì hỏng
   * schema — thêm giá trị mới vào enum `kind` là làm bản cũ parse lỗi cả file rồi backup và
   * khởi tạo rỗng, tức mất dữ liệu thật.
   */
  agentId: z.enum(['codex']).optional(),
  /**
   * Id phiên của agent đó. Không ép uuid (`codex resume` nhận cả tên phiên) nhưng PHẢI giới
   * hạn ký tự: chuỗi này đi thẳng vào lệnh shell ở đường khôi phục, mà đường đó được MIỄN cổng
   * tin cậy — một `workspaces.json` bị sửa tay không được phép biến thành lệnh tuỳ ý. Cùng bộ
   * ký tự với bộ lọc ở cửa đọc rollout của Codex.
   */
  agentSessionId: z.string().regex(/^[\w.:-]{1,128}$/, 'id phiên agent có ký tự không hợp lệ').optional(),
}).passthrough();

export const WorkspaceSchema = z
  .object({
    id: uuid,
    name: z.string().min(1),
    lastActiveAt: z.string().nullable(),
    activeWindowId: z.string().nullable(),
    /** Vị trí mở terminal riêng của workspace — không có thì theo setting chung. */
    terminalLocation: z.enum(['editor', 'panel']).optional(),
    terminals: z.array(TerminalEntrySchema),
  })
  .passthrough()
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

export const emptyStore = (): StoreFile => ({ version: 2, workspaces: [] });

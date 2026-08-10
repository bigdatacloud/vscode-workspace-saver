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

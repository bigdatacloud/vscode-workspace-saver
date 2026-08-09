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

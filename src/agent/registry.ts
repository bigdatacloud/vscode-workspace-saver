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

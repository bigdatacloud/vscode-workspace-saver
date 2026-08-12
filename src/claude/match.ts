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

/**
 * @param idDaCoChuKhac Session id đã bị entry KHÔNG nằm trong `candidates` giữ (entry có
 *   terminal chưa mở, hoặc của workspace khác trong cùng file store dùng chung giữa các cửa
 *   sổ VS Code). Không tính vào đây thì cửa sổ này coi chúng là tự do và cướp mất → hai entry
 *   cùng một hội thoại → double `--resume`.
 */
export function matchClaudeSessions(
  candidates: MatchCandidate[],
  running: RunningSession[],
  platform: NodeJS.Platform = process.platform,
  idDaCoChuKhac: ReadonlySet<string> = new Set(),
): MatchResult {
  const claimed = new Set(candidates.map((c) => c.claimedSessionId).filter((x): x is string => !!x));
  for (const id of idDaCoChuKhac) claimed.add(id);
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
      result.matched.push({ terminalId: g.terminalIds[0]!, session: g.sessions[0]! });
    } else {
      result.ambiguous.push({ cwd, terminalIds: g.terminalIds, sessions: g.sessions });
    }
  }
  return result;
}

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

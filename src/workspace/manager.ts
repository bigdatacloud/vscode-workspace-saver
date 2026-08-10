import * as path from 'node:path';
import { promises as fsp } from 'node:fs';
import * as vscode from 'vscode';
import { readManifest, writeManifest, readState, writeState, ManifestError } from '../manifest/store';
import { manifestFilePath, resolveProjectRoot, toStoredPath } from '../manifest/paths';
import { ManifestSchema, SessionSchema, type Manifest, type SessionSpec, type SessionStatus, type WorkspaceState } from '../manifest/schema';
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
  /** Thư mục CHỨA `.ai-workspace` của file đang mở. Mọi thao tác đọc/ghi manifest và state
   *  phải neo vào đây, không phải `projectRoot` — vì `project.root` có thể trỏ đi nơi khác,
   *  và khi đó Save sẽ ghi sang một file thứ hai thay vì file vừa mở. */
  private manifestAnchor: string | null = null;
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
    this.manifestAnchor = path.dirname(path.dirname(this.manifestPath));
    this.manifest = ManifestSchema.parse({ version: 1, workspace: { name }, sessions: [] });
    this.state = { version: 1, sessions: {} };
    this.statuses.clear();

    await this.save();
    this.bus.emit('WorkspaceOpened', { name });
    this.onChanged.fire();
  }

  async save(): Promise<void> {
    if (!this.manifest || !this.manifestAnchor || !this.manifestPath) {
      await vscode.window.showWarningMessage('Chưa có workspace nào đang mở.');
      return;
    }
    await writeManifest(this.manifestAnchor, this.manifest);
    await writeState(this.manifestAnchor, this.state);
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
    // Neo vào chính file được mở: thư mục cha của `.ai-workspace`.
    const anchor = resolveProjectRoot(manifestPath, '.');
    try {
      manifest = await readManifest(anchor);
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
    this.manifestAnchor = anchor;
    // `projectRoot` chỉ dùng cho git và cwd của terminal, KHÔNG dùng để đọc/ghi manifest.
    this.projectRoot = resolveProjectRoot(manifestPath, manifest.project.root);
    this.state = await readState(this.manifestAnchor);
    this.statuses.clear();

    let report: RestoreReport;
    try {
      report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Đang dựng lại "${manifest.workspace.name}"…` },
        () => restoreWorkspace(manifest, this.state, this.buildPorts()),
      );
    } catch (error) {
      // Không để lại trạng thái dở dang: trả về đúng trạng thái "chưa mở workspace nào".
      this.manifest = null;
      this.manifestPath = null;
      this.manifestAnchor = null;
      this.projectRoot = null;
      this.state = { version: 1, sessions: {} };
      this.statuses.clear();
      this.onChanged.fire();
      await vscode.window.showErrorMessage(
        `Không dựng lại được workspace "${manifest.workspace.name}": ${String(error)}`,
      );
      return;
    }

    await this.applyReport(report);
    await this.index.upsert({
      name: manifest.workspace.name, manifestPath, lastOpenedAt: Date.now(),
    });
    this.bus.emit('WorkspaceOpened', { name: manifest.workspace.name });
    this.onChanged.fire();
  }

  async close(): Promise<void> {
    if (!this.manifest || !this.manifestAnchor) return;
    await writeState(this.manifestAnchor, this.state);
    this.terminals.closeAll();
    this.bus.emit('WorkspaceClosed', { name: this.manifest.workspace.name });
    this.manifest = null;
    this.manifestPath = null;
    this.manifestAnchor = null;
    this.projectRoot = null;
    // State của workspace cũ không được rò sang workspace mở sau: reset về object mới, không giữ
    // lại tham chiếu sessions cũ.
    this.state = { version: 1, sessions: {} };
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

    const session = SessionSchema.parse({
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
    if (this.terminals.has(key)) {
      // Dựng lại một session đang sống sẽ resume LẠI đúng cuộc hội thoại đó lần thứ hai
      // (và bị đổi tên thành "-2"), đồng thời giết terminal cũ khi tiến trình `claude`
      // vẫn còn bám vào đó. Bắt người dùng đóng terminal trước.
      await vscode.window.showWarningMessage(
        `Session "${key}" đang chạy. Hãy đóng terminal của nó trước nếu bạn muốn dựng lại.`,
      );
      this.terminals.focus(key);
      return;
    }
    const single: Manifest = { ...this.manifest, sessions: [session] };
    try {
      const report = await restoreWorkspace(single, this.state, this.buildPorts());
      await this.applyReport(report);
    } catch (error) {
      await vscode.window.showErrorMessage(`Không dựng lại được session "${key}": ${String(error)}`);
      return;
    }
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
      if (this.manifestAnchor) await writeState(this.manifestAnchor, this.state);
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
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      waitAttempts: 20,
    };
  }

  private async applyReport(report: RestoreReport): Promise<void> {
    // Ghi sessionId ngay khi đã gửi lệnh launch, KHÔNG chờ registry xác nhận: nếu bỏ qua bước
    // này, một session chạy được nhưng lên registry trễ sẽ mất sessionId và cuộc hội thoại
    // đang sống sẽ không bao giờ resume lại được nữa.
    for (const launched of report.launched) {
      if (this.state.sessions[launched.key]?.sessionId === launched.sessionId) continue;
      this.state.sessions[launched.key] = {
        sessionId: launched.sessionId,
        pid: null,
        lastStatus: 'offline',
        lastActiveAt: Date.now(),
      };
    }
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
    if (this.manifestAnchor) {
      try {
        await writeState(this.manifestAnchor, this.state);
      } catch (error) {
        // Ghi state hỏng không được che mất bản tóm tắt restore của người dùng.
        void vscode.window.showWarningMessage(
          `Không ghi được state.json, lần mở sau có thể phải bắt đầu hội thoại mới: ${String(error)}`,
        );
      }
    }

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

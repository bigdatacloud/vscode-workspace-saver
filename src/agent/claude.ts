import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseAgentsJson } from './registry';
import { quoteArg, type ShellKind } from './quote';
import type { AgentAdapter, LaunchOption, LaunchSpec, RunningSession } from './types';

export interface CommandRunner {
  run(command: string, args: string[]): Promise<{ stdout: string; code: number }>;
}

export const realCommandRunner: CommandRunner = {
  run(command, args) {
    return new Promise((resolve) => {
      // timeout: CLI treo (registry kẹt, đĩa chậm) không được phép kéo vòng poll và
      // finalClaimSweep (đang await listRunning) treo theo vĩnh viễn.
      execFile(command, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000, killSignal: 'SIGKILL' }, (error, stdout) => {
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

  buildLaunchOptions(peerName: string): LaunchOption[] {
    const q = (v: string): string => quoteArg(v, this.shell);
    const moi = (label: string, flags: string[]): LaunchOption => {
      const sessionId = this.uuid();
      return {
        label,
        description: [CLAUDE_BIN, ...flags, '(resume đảm bảo)'].join(' '),
        command: [CLAUDE_BIN, '--session-id', q(sessionId), '-n', q(peerName), ...flags].join(' '),
        sessionId,
      };
    };
    const tiep = (label: string, flags: string[]): LaunchOption => ({
      label,
      description: [CLAUDE_BIN, ...flags].join(' '),
      command: [CLAUDE_BIN, ...flags].join(' '),
    });
    return [
      moi('Phiên mới', []),
      moi('Phiên mới — bỏ hỏi quyền', ['--dangerously-skip-permissions']),
      tiep('Tiếp tục hội thoại gần nhất', ['-c']),
      tiep('Tiếp tục gần nhất — bỏ hỏi quyền', ['--dangerously-skip-permissions', '-c']),
      tiep('Chọn hội thoại để resume', ['-r']),
      tiep('Resume — bỏ hỏi quyền', ['--dangerously-skip-permissions', '-r']),
    ];
  }

  ownsCommand(command: string): boolean {
    const ts = tachToken(command);
    if (ts.length === 0) return false;

    // Runner npm: chương trình thật là token SAU runner (bỏ qua cờ của runner).
    const runner = tenChuongTrinh(ts[0] ?? '');
    let idx = -1;
    if (runner === 'npx' || runner === 'bunx') idx = 1;
    else if ((runner === 'pnpm' || runner === 'yarn') && boNhay(ts[1] ?? '').toLowerCase() === 'dlx') idx = 2;

    if (idx > 0) {
      while (idx < ts.length && boNhay(ts[idx] ?? '').startsWith('-')) idx += 1;
      const muc = ts[idx];
      return muc !== undefined && laChuongTrinhClaude(muc);
    }
    return laChuongTrinhClaude(ts[0] ?? '');
  }
}

/** Package npm chứa binary claude — `npx @anthropic-ai/claude-code` chính là chạy claude. */
const CLAUDE_PKG = '@anthropic-ai/claude-code';

/** Tách token tôn trọng nháy đôi/nháy đơn (đường dẫn có khoảng trắng). */
function tachToken(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function boNhay(token: string): string {
  return token.replace(/^["']|["']$/g, '');
}

/** Tên chương trình từ một token: bỏ nháy, bỏ đường dẫn, bỏ đuôi Windows, thường hóa. */
function tenChuongTrinh(token: string): string {
  const ten = boNhay(token).toLowerCase().split(/[\\/]/).pop() ?? '';
  return ten.replace(/\.(exe|cmd|bat|ps1)$/, '');
}

/** Token này có phải cách gọi claude không: tên trần/đường dẫn/.cmd/.exe, `ten@version`, hoặc package spec. */
function laChuongTrinhClaude(tokenTho: string): boolean {
  const token = boNhay(tokenTho).toLowerCase();
  if (token.startsWith('@')) {
    return token === CLAUDE_PKG || token.startsWith(`${CLAUDE_PKG}@`);
  }
  let ten = tenChuongTrinh(tokenTho);
  const viTriVersion = ten.indexOf('@');
  if (viTriVersion > 0) ten = ten.slice(0, viTriVersion);
  return ten === CLAUDE_BIN;
}

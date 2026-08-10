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

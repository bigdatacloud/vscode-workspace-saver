import { execFile } from 'node:child_process';

export interface GitResult { stdout: string; stderr: string; code: number }

export interface GitRunner {
  run(cwd: string, args: string[]): Promise<GitResult>;
}

export const realGitRunner: GitRunner = {
  run(cwd, args) {
    return new Promise((resolve) => {
      // timeout bắt buộc: `git worktree add` có thể chờ credential/lock vô hạn, mà lệnh này
      // nằm ngay trên đường người dùng đang tạo terminal — treo là treo cả luồng.
      const opt = {
        cwd,
        encoding: 'utf8' as const,
        windowsHide: true,
        timeout: 20_000,
        killSignal: 'SIGKILL' as const,
      };
      execFile('git', args, opt, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === 'number'
          ? (error as { code: number }).code
          : error ? 1 : 0;
        resolve({ stdout, stderr, code });
      });
    });
  },
};

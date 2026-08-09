import { execFile } from 'node:child_process';

export interface GitResult { stdout: string; stderr: string; code: number }

export interface GitRunner {
  run(cwd: string, args: string[]): Promise<GitResult>;
}

export const realGitRunner: GitRunner = {
  run(cwd, args) {
    return new Promise((resolve) => {
      execFile('git', args, { cwd, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === 'number'
          ? (error as { code: number }).code
          : error ? 1 : 0;
        resolve({ stdout, stderr, code });
      });
    });
  },
};

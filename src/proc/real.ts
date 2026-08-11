import { execFile } from 'node:child_process';
import { parseBangTienTrinh } from './tree';

function chay(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      // timeout bắt buộc: WMI/CIM treo là chuyện có thật trên Windows — không có timeout
      // thì promise này treo vĩnh viễn và kéo cả vòng poll lẫn lệnh đóng workspace theo.
      {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 5000,
        killSignal: 'SIGKILL',
      },
      (error, stdout) => resolve(error ? '' : stdout),
    );
  });
}

/**
 * Đọc bảng tiến trình của hệ điều hành thành map con → cha.
 * Thất bại (lệnh vắng mặt, timeout…) → map rỗng: caller coi như không tra được
 * phả hệ và rơi về cơ chế hỏi người dùng — không bao giờ ném.
 */
export async function docBangTienTrinh(
  platform: NodeJS.Platform = process.platform,
): Promise<Map<number, number>> {
  const stdout =
    platform === 'win32'
      ? await chay('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }',
        ])
      : await chay('ps', ['-eo', 'pid=,ppid=']);
  return parseBangTienTrinh(stdout);
}

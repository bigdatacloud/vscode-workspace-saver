import { execFile } from 'node:child_process';
import { parseBangDongLenh } from './dongphien';
import { parseBangTienTrinh } from './tree';

function chay(command: string, args: string[], timeout = 5000): Promise<string> {
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
        timeout,
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

/**
 * Đọc bảng pid → dòng lệnh của toàn máy.
 *
 * Dùng để xác minh một pid TRƯỚC khi đóng nó: registry của claude có hàng cũ, mà pid thì hệ
 * điều hành cấp lại cho chương trình khác — xem `dongphien.ts`. Đắt hơn `docBangTienTrinh`
 * (phải kéo cả CommandLine) nên timeout rộng hơn, và chỉ gọi khi người dùng đã bấm nút.
 * Thất bại → map rỗng, và caller hiểu rỗng là "không biết", không phải "không có gì".
 */
export async function docDongLenhTienTrinh(
  platform: NodeJS.Platform = process.platform,
): Promise<Map<number, string>> {
  const stdout =
    platform === 'win32'
      ? await chay(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }',
          ],
          15_000,
        )
      : await chay('ps', ['-eo', 'pid=,args='], 15_000);
  return parseBangDongLenh(stdout);
}

/**
 * Đóng một tiến trình đang bám hội thoại ở cửa sổ khác.
 *
 * Windows không có tín hiệu mềm cho tiến trình console (`SIGTERM` của Node cũng quy về
 * TerminateProcess), nên `/F` là bắt buộc — thiếu nó taskkill chỉ gửi WM_CLOSE và trượt.
 * `/T` cũng bắt buộc: claude đẻ ra MCP server và shell công cụ, không có `/T` là bỏ lại
 * một đám mồ côi. `/T` đi XUỐNG từ pid của claude nên shell của terminal bên cửa sổ kia
 * không hề hấn: nó chỉ hiện lại dấu nhắc.
 *
 * Hội thoại không mất: transcript được ghi dần theo từng lượt; cái mất là việc đang chạy dở.
 */
export async function gietTienTrinh(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (platform === 'win32') {
    await chay('taskkill', ['/PID', String(pid), '/T', '/F'], 10_000);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Đã chết trước khi ta kịp gọi — đúng kết quả mong muốn, không phải lỗi.
  }
}

export type ShellKind = 'powershell' | 'posix' | 'cmd';

/**
 * PowerShell coi CẢ BỐN ký tự này là nháy đơn và dùng lẫn nhau được: `'` (U+0027) cùng bộ
 * nháy cong U+2018 ‘, U+2019 ’, U+201A ‚, U+201B ‛. Đo thật trên PowerShell 7:
 * `Write-Output 'abc’; Write-Output PWNED; ‘x'` chạy thành BA lệnh — tức chỉ escape mỗi
 * U+0027 là để hở đường chèn lệnh, mà nạn nhân không cần là kẻ xấu: một tên phiên copy từ
 * Word/macOS (smart quote) là đủ. Nhân đôi cả bốn thì PowerShell hiểu là ký tự literal
 * (đã kiểm chứng).
 */
const NHAY_DON_POWERSHELL = /['‘’‚‛]/g;

export function quoteArg(value: string, shell: ShellKind): string {
  switch (shell) {
    case 'powershell':
      return `'${value.replace(NHAY_DON_POWERSHELL, (c) => c + c)}'`;
    case 'posix':
      return `'${value.replace(/'/g, "'\\''")}'`;
    case 'cmd':
      return `"${value.replace(/"/g, '')}"`;
  }
}

export function detectShellKind(platform: NodeJS.Platform, shellPath: string | undefined): ShellKind {
  if (platform !== 'win32') return 'posix';
  const lower = (shellPath ?? '').toLowerCase();
  if (lower.includes('cmd.exe')) return 'cmd';
  // Phải kiểm PowerShell TRƯỚC nhánh POSIX: chuỗi 'pwsh.exe' có chứa 'sh.exe'.
  if (lower.includes('pwsh') || lower.includes('powershell')) return 'powershell';
  // 'sh.exe' chỉ tính khi đứng ngay sau dấu phân cách và ở cuối đường dẫn,
  // để không bắt nhầm những tên kết thúc bằng 'sh.exe' như 'pwsh.exe'.
  if (lower.includes('bash') || lower.includes('wsl') || /[\\/]sh\.exe$/.test(lower)) return 'posix';
  return 'powershell';
}

export type ShellKind = 'powershell' | 'posix' | 'cmd';

export function quoteArg(value: string, shell: ShellKind): string {
  switch (shell) {
    case 'powershell':
      return `'${value.replace(/'/g, "''")}'`;
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

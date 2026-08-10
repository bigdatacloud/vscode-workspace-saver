export type AdoptDecision = 'auto' | 'suggest';

export interface OpenedTerminalInfo {
  isPty: boolean;
  creationName: string | undefined;
}

// Heuristic: terminal người dùng mở bằng Ctrl+Shift+` không có creationOptions.name;
// task runner và extension luôn đặt tên hoặc dùng pty riêng.
export function classifyTerminal(info: OpenedTerminalInfo): AdoptDecision {
  if (info.isPty) return 'suggest';
  if (info.creationName !== undefined && info.creationName.trim() !== '') return 'suggest';
  return 'auto';
}

export function pickCwd(
  shellCwd: string | undefined,
  creationCwd: string | undefined,
  folderCwd: string | undefined,
): string | null {
  return shellCwd ?? creationCwd ?? folderCwd ?? null;
}

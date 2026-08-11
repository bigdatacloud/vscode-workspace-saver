export type RunningStatus = 'busy' | 'idle' | 'blocked';

export interface RunningSession {
  sessionId: string;
  name: string | null;
  cwd: string;
  pid: number | null;
  kind: 'interactive' | 'background';
  status: RunningStatus;
}

export type LaunchMode =
  | { kind: 'new'; sessionId: string }
  | { kind: 'resume'; sessionId: string };

export interface LaunchSpec {
  name: string;
  mode: LaunchMode;
}

/** Một biến thể lệnh khởi chạy agent, cho người dùng duyệt bằng QuickPick. */
export interface LaunchOption {
  label: string;
  /** Lệnh sẽ chạy, hiển thị cho người dùng thấy trước. */
  description: string;
  /** Lệnh gửi vào terminal. */
  command: string;
  /** Có với phiên MỚI đã mint id sẵn — lưu xuống đĩa để resume đảm bảo. */
  sessionId?: string;
}

export interface AgentAdapter {
  readonly id: string;
  newSessionId(): string;
  buildLaunchCommand(spec: LaunchSpec): string;
  /** Danh sách biến thể khởi chạy (phiên mới / tiếp tục / resume, kèm bỏ hỏi quyền). */
  buildLaunchOptions(peerName: string): LaunchOption[];
  listRunning(): Promise<RunningSession[]>;
  /**
   * Lệnh shell này có phải là lệnh chạy agent không? Dùng để cơ chế bắt startCommand
   * bỏ qua nó — agent có đường resume riêng, tốt hơn chạy lại lệnh thô.
   */
  ownsCommand(command: string): boolean;
}

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

export interface AgentAdapter {
  readonly id: string;
  newSessionId(): string;
  buildLaunchCommand(spec: LaunchSpec): string;
  listRunning(): Promise<RunningSession[]>;
}

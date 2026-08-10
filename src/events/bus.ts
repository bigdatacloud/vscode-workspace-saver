import type { SessionStatus } from '../manifest/schema';

export interface WorkspaceEvents {
  SessionStarting: { key: string };
  SessionStarted: { key: string; sessionId: string };
  SessionFailed: { key: string; reason: string };
  SessionExited: { key: string };
  SessionStatusChanged: { key: string; status: SessionStatus };
  WorktreeMissing: { key: string; path: string };
  WorkspaceOpened: { name: string };
  WorkspaceClosed: { name: string };
}

export type EventName = keyof WorkspaceEvents;
type Handler<K extends EventName> = (payload: WorkspaceEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<EventName, Set<Handler<EventName>>>();

  on<K extends EventName>(name: K, handler: Handler<K>): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler as Handler<EventName>);
    this.handlers.set(name, set);
    return () => { set.delete(handler as Handler<EventName>); };
  }

  emit<K extends EventName>(name: K, payload: WorkspaceEvents[K]): void {
    for (const handler of this.handlers.get(name) ?? []) {
      try {
        (handler as Handler<K>)(payload);
      } catch {
        // Một người nghe hỏng không được làm chết luồng phát sự kiện.
      }
    }
  }
}

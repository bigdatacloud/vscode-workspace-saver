import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/events/bus';

describe('EventBus', () => {
  it('gọi handler đã đăng ký với đúng payload', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    bus.on('SessionStarted', spy);
    bus.emit('SessionStarted', { key: 'backend', sessionId: 'abc' });
    expect(spy).toHaveBeenCalledWith({ key: 'backend', sessionId: 'abc' });
  });

  it('gọi mọi handler của cùng một event', () => {
    const bus = new EventBus();
    const a = vi.fn(); const b = vi.fn();
    bus.on('WorkspaceOpened', a);
    bus.on('WorkspaceOpened', b);
    bus.emit('WorkspaceOpened', { name: 'W' });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('không gọi handler của event khác', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    bus.on('SessionFailed', spy);
    bus.emit('SessionStarted', { key: 'a', sessionId: 'b' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('hàm trả về từ on() gỡ đăng ký', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    const off = bus.on('WorkspaceClosed', spy);
    off();
    bus.emit('WorkspaceClosed', { name: 'W' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('một handler ném lỗi không chặn các handler còn lại', () => {
    const bus = new EventBus();
    const good = vi.fn();
    bus.on('SessionExited', () => { throw new Error('vỡ'); });
    bus.on('SessionExited', good);
    expect(() => bus.emit('SessionExited', { key: 'a' })).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  it('emit event chưa ai nghe không ném lỗi', () => {
    const bus = new EventBus();
    expect(() => bus.emit('WorktreeMissing', { key: 'a', path: '/p' })).not.toThrow();
  });
});

